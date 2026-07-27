begin;

-- Phase 4 originally shipped before brand tenancy. Preserve the organization
-- aggregates used for privacy-preserving peer benchmarks, and complete the
-- separate per-brand aggregate introduced in Phase 5.
alter table public.brand_analytics_daily_metrics
  add column mrr_cents bigint not null default 0,
  add column new_members integer not null default 0,
  add column cancelled_members integer not null default 0,
  add column downgraded_members integer not null default 0,
  add column gross_revenue_cents bigint not null default 0,
  add column refunds_cents bigint not null default 0,
  add column net_revenue_cents bigint not null default 0,
  add column revenue_churn_cents bigint not null default 0,
  add column attempted_shipments integer not null default 0,
  add column fulfilled_shipments integer not null default 0,
  add column declined_attempts integer not null default 0,
  add column shipment_value_cents bigint not null default 0,
  add column shipping_cost_cents bigint not null default 0,
  add column emails_sent integer not null default 0,
  add column email_opens integer not null default 0,
  add column email_clicks integer not null default 0,
  add column portal_logins integer not null default 0,
  add column loyalty_points_earned bigint not null default 0,
  add column loyalty_points_redeemed bigint not null default 0,
  add column refreshed_at timestamptz not null default now();

alter table public.brand_analytics_daily_metrics
  add constraint brand_analytics_daily_metrics_phase4_nonnegative
  check (
    mrr_cents >= 0
    and new_members >= 0
    and cancelled_members >= 0
    and downgraded_members >= 0
    and gross_revenue_cents >= 0
    and refunds_cents >= 0
    and revenue_churn_cents >= 0
    and attempted_shipments >= 0
    and fulfilled_shipments >= 0
    and declined_attempts >= 0
    and shipment_value_cents >= 0
    and shipping_cost_cents >= 0
    and emails_sent >= 0
    and email_opens >= 0
    and email_clicks >= 0
    and portal_logins >= 0
    and loyalty_points_earned >= 0
    and loyalty_points_redeemed >= 0
  );

create index brand_analytics_daily_metrics_brand_date_idx
  on public.brand_analytics_daily_metrics (
    organization_id,
    brand_id,
    metric_date desc
  );

create table public.brand_analytics_cohort_retention (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  cohort_month date not null,
  observation_month date not null,
  months_since_join integer not null,
  cohort_size integer not null,
  retained_members integer not null,
  retention_rate numeric(7, 6) not null,
  refreshed_at timestamptz not null default now(),
  constraint brand_analytics_cohort_brand_fkey
    foreign key (organization_id, brand_id)
    references public.brands (organization_id, id)
    on delete cascade,
  constraint brand_analytics_cohort_months_normalized
    check (
      cohort_month = date_trunc('month', cohort_month)::date
      and observation_month = date_trunc('month', observation_month)::date
      and observation_month >= cohort_month
    ),
  constraint brand_analytics_cohort_values_valid
    check (
      months_since_join between 0 and 600
      and cohort_size > 0
      and retained_members between 0 and cohort_size
      and retention_rate between 0 and 1
    ),
  constraint brand_analytics_cohort_brand_month_key
    unique (
      organization_id,
      brand_id,
      cohort_month,
      observation_month
    )
);

create index brand_analytics_cohort_brand_observation_idx
  on public.brand_analytics_cohort_retention (
    organization_id,
    brand_id,
    observation_month desc,
    cohort_month
  );

alter table public.brand_analytics_cohort_retention enable row level security;
alter table public.brand_analytics_cohort_retention force row level security;

create policy brand_analytics_cohort_staff_brand_access
  on public.brand_analytics_cohort_retention
  for select to authenticated
  using (
    private.is_staff_for_org(organization_id)
    and private.can_access_brand(organization_id, brand_id)
  );

revoke all on table public.brand_analytics_cohort_retention
from anon, authenticated;
grant all on table public.brand_analytics_cohort_retention to service_role;

create or replace function private.can_read_brand_analytics(
  p_organization_id uuid,
  p_brand_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.is_service_role()
    or private.is_super_admin()
    or (
      private.is_staff_for_org(p_organization_id)
      and private.can_access_brand(p_organization_id, p_brand_id)
    );
$$;

create or replace function public.refresh_brand_analytics_snapshots(
  p_metric_date date default current_date,
  p_organization_id uuid default null,
  p_brand_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand record;
  v_start timestamptz;
  v_end timestamptz;
  v_observation_month date := date_trunc('month', p_metric_date)::date;
  v_observation_end timestamptz;
  v_refreshed integer := 0;
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Brand analytics refresh is service-only.';
  end if;
  if p_brand_id is not null and p_organization_id is null then
    raise exception using
      errcode = '22023',
      message = 'A brand analytics refresh requires its organization.';
  end if;

  for v_brand in
    select brand.organization_id, brand.id, brand.time_zone
    from public.brands as brand
    where brand.active
      and (p_organization_id is null or brand.organization_id = p_organization_id)
      and (p_brand_id is null or brand.id = p_brand_id)
    order by brand.organization_id, brand.id
  loop
    v_start := p_metric_date::timestamp at time zone v_brand.time_zone;
    v_end := (p_metric_date + 1)::timestamp at time zone v_brand.time_zone;
    v_observation_end :=
      (v_observation_month + interval '1 month')::timestamp
      at time zone v_brand.time_zone;

    insert into public.brand_analytics_daily_metrics (
      organization_id,
      brand_id,
      metric_date,
      active_members,
      revenue_cents,
      shipment_count,
      churn_count,
      mrr_cents,
      new_members,
      cancelled_members,
      downgraded_members,
      gross_revenue_cents,
      refunds_cents,
      net_revenue_cents,
      revenue_churn_cents,
      attempted_shipments,
      fulfilled_shipments,
      declined_attempts,
      shipment_value_cents,
      shipping_cost_cents,
      emails_sent,
      email_opens,
      email_clicks,
      portal_logins,
      loyalty_points_earned,
      loyalty_points_redeemed,
      calculated_at,
      refreshed_at
    )
    select
      v_brand.organization_id,
      v_brand.id,
      p_metric_date,
      (
        select count(*)::integer
        from public.members as member
        where member.organization_id = v_brand.organization_id
          and member.brand_id = v_brand.id
          and member.joined_on <= p_metric_date
          and (member.deleted_at is null or member.deleted_at >= v_end)
          and (member.cancelled_at is null or member.cancelled_at >= v_end)
      ),
      (
        select coalesce(sum(attempt.amount_cents), 0)::bigint
        from public.billing_attempts as attempt
        where attempt.organization_id = v_brand.organization_id
          and attempt.brand_id = v_brand.id
          and attempt.status = 'succeeded'
          and attempt.attempt_kind in ('charge', 'retry')
          and attempt.completed_at >= v_start
          and attempt.completed_at < v_end
      ),
      (
        select count(*)::integer
        from public.shipments as shipment
        where shipment.organization_id = v_brand.organization_id
          and shipment.brand_id = v_brand.id
          and shipment.paid_at >= v_start
          and shipment.paid_at < v_end
      ),
      (
        select count(*)::integer
        from public.members as member
        where member.organization_id = v_brand.organization_id
          and member.brand_id = v_brand.id
          and member.cancelled_at >= v_start
          and member.cancelled_at < v_end
      ),
      (
        select coalesce(sum(
          case tier.frequency
            when 'monthly' then tier.price_cents
            when 'bi_monthly' then tier.price_cents / 2.0
            when 'quarterly' then tier.price_cents / 3.0
            when 'semi_annual' then tier.price_cents / 6.0
            when 'annual' then tier.price_cents / 12.0
          end
        ), 0)::bigint
        from public.members as member
        join public.club_tiers as tier
          on tier.organization_id = member.organization_id
         and tier.brand_id = member.brand_id
         and tier.id = member.club_tier_id
        where member.organization_id = v_brand.organization_id
          and member.brand_id = v_brand.id
          and member.joined_on <= p_metric_date
          and (member.deleted_at is null or member.deleted_at >= v_end)
          and (member.cancelled_at is null or member.cancelled_at >= v_end)
      ),
      (
        select count(*)::integer
        from public.members as member
        where member.organization_id = v_brand.organization_id
          and member.brand_id = v_brand.id
          and member.joined_on = p_metric_date
          and (member.deleted_at is null or member.deleted_at >= v_end)
      ),
      (
        select count(*)::integer
        from public.members as member
        where member.organization_id = v_brand.organization_id
          and member.brand_id = v_brand.id
          and member.cancelled_at >= v_start
          and member.cancelled_at < v_end
      ),
      (
        select count(*)::integer
        from public.member_activity_events as activity
        where activity.organization_id = v_brand.organization_id
          and activity.brand_id = v_brand.id
          and activity.event_type = 'tier_downgrade'
          and activity.occurred_at >= v_start
          and activity.occurred_at < v_end
      ),
      (
        select coalesce(sum(attempt.amount_cents), 0)::bigint
        from public.billing_attempts as attempt
        where attempt.organization_id = v_brand.organization_id
          and attempt.brand_id = v_brand.id
          and attempt.status = 'succeeded'
          and attempt.attempt_kind in ('charge', 'retry')
          and attempt.completed_at >= v_start
          and attempt.completed_at < v_end
      ),
      (
        select coalesce(sum(attempt.amount_cents), 0)::bigint
        from public.billing_attempts as attempt
        where attempt.organization_id = v_brand.organization_id
          and attempt.brand_id = v_brand.id
          and attempt.status = 'refunded'
          and attempt.completed_at >= v_start
          and attempt.completed_at < v_end
      ),
      (
        select
          coalesce(sum(attempt.amount_cents) filter (
            where attempt.status = 'succeeded'
              and attempt.attempt_kind in ('charge', 'retry')
          ), 0)
          - coalesce(sum(attempt.amount_cents) filter (
            where attempt.status = 'refunded'
          ), 0)
        from public.billing_attempts as attempt
        where attempt.organization_id = v_brand.organization_id
          and attempt.brand_id = v_brand.id
          and attempt.completed_at >= v_start
          and attempt.completed_at < v_end
      ),
      (
        select coalesce(sum(churn.monthly_loss_cents), 0)::bigint
        from (
          select case tier.frequency
            when 'monthly' then tier.price_cents
            when 'bi_monthly' then tier.price_cents / 2.0
            when 'quarterly' then tier.price_cents / 3.0
            when 'semi_annual' then tier.price_cents / 6.0
            when 'annual' then tier.price_cents / 12.0
          end as monthly_loss_cents
          from public.members as member
          join public.club_tiers as tier
            on tier.organization_id = member.organization_id
           and tier.brand_id = member.brand_id
           and tier.id = member.club_tier_id
          where member.organization_id = v_brand.organization_id
            and member.brand_id = v_brand.id
            and member.cancelled_at >= v_start
            and member.cancelled_at < v_end
          union all
          select greatest(
            case previous_tier.frequency
              when 'monthly' then previous_tier.price_cents
              when 'bi_monthly' then previous_tier.price_cents / 2.0
              when 'quarterly' then previous_tier.price_cents / 3.0
              when 'semi_annual' then previous_tier.price_cents / 6.0
              when 'annual' then previous_tier.price_cents / 12.0
            end
            -
            case target_tier.frequency
              when 'monthly' then target_tier.price_cents
              when 'bi_monthly' then target_tier.price_cents / 2.0
              when 'quarterly' then target_tier.price_cents / 3.0
              when 'semi_annual' then target_tier.price_cents / 6.0
              when 'annual' then target_tier.price_cents / 12.0
            end,
            0
          )
          from public.member_activity_events as activity
          join public.club_tiers as previous_tier
            on previous_tier.organization_id = activity.organization_id
           and previous_tier.brand_id = activity.brand_id
           and previous_tier.id =
             (activity.metadata ->> 'previous_tier_id')::uuid
          join public.club_tiers as target_tier
            on target_tier.organization_id = activity.organization_id
           and target_tier.brand_id = activity.brand_id
           and target_tier.id =
             (activity.metadata ->> 'target_tier_id')::uuid
          where activity.organization_id = v_brand.organization_id
            and activity.brand_id = v_brand.id
            and activity.event_type = 'tier_downgrade'
            and activity.occurred_at >= v_start
            and activity.occurred_at < v_end
        ) as churn
      ),
      (
        select count(distinct attempt.shipment_id)::integer
        from public.billing_attempts as attempt
        where attempt.organization_id = v_brand.organization_id
          and attempt.brand_id = v_brand.id
          and attempt.attempt_kind in ('charge', 'retry')
          and attempt.created_at >= v_start
          and attempt.created_at < v_end
      ),
      (
        select count(*)::integer
        from public.shipments as shipment
        where shipment.organization_id = v_brand.organization_id
          and shipment.brand_id = v_brand.id
          and shipment.paid_at >= v_start
          and shipment.paid_at < v_end
      ),
      (
        select count(*)::integer
        from public.billing_attempts as attempt
        where attempt.organization_id = v_brand.organization_id
          and attempt.brand_id = v_brand.id
          and attempt.status = 'declined'
          and attempt.completed_at >= v_start
          and attempt.completed_at < v_end
      ),
      (
        select coalesce(sum(
          shipment.charge_amount_cents - shipment.loyalty_discount_cents
        ), 0)::bigint
        from public.shipments as shipment
        where shipment.organization_id = v_brand.organization_id
          and shipment.brand_id = v_brand.id
          and shipment.paid_at >= v_start
          and shipment.paid_at < v_end
      ),
      (
        select coalesce(sum(shipment.label_cost_cents), 0)::bigint
        from public.shipments as shipment
        where shipment.organization_id = v_brand.organization_id
          and shipment.brand_id = v_brand.id
          and shipment.label_created_at >= v_start
          and shipment.label_created_at < v_end
      ),
      (
        select count(*)::integer
        from public.email_log as email
        where email.organization_id = v_brand.organization_id
          and email.brand_id = v_brand.id
          and email.sent_at >= v_start
          and email.sent_at < v_end
      ),
      (
        select count(distinct event.email_log_id)::integer
        from public.email_delivery_events as event
        join public.email_log as email
          on email.organization_id = event.organization_id
         and email.brand_id = event.brand_id
         and email.id = event.email_log_id
        where event.organization_id = v_brand.organization_id
          and event.brand_id = v_brand.id
          and event.event_type = 'opened'
          and email.sent_at >= v_start
          and email.sent_at < v_end
          and event.occurred_at < v_end
      ),
      (
        select count(distinct event.email_log_id)::integer
        from public.email_delivery_events as event
        join public.email_log as email
          on email.organization_id = event.organization_id
         and email.brand_id = event.brand_id
         and email.id = event.email_log_id
        where event.organization_id = v_brand.organization_id
          and event.brand_id = v_brand.id
          and event.event_type = 'clicked'
          and email.sent_at >= v_start
          and email.sent_at < v_end
          and event.occurred_at < v_end
      ),
      (
        select count(*)::integer
        from public.member_activity_events as activity
        where activity.organization_id = v_brand.organization_id
          and activity.brand_id = v_brand.id
          and activity.event_type = 'portal_login'
          and activity.occurred_at >= v_start
          and activity.occurred_at < v_end
      ),
      (
        select coalesce(sum(ledger.points), 0)::bigint
        from public.loyalty_ledger as ledger
        where ledger.organization_id = v_brand.organization_id
          and ledger.brand_id = v_brand.id
          and ledger.entry_type = 'award'
          and ledger.points > 0
          and ledger.created_at >= v_start
          and ledger.created_at < v_end
      ),
      (
        select coalesce(sum(redemption.points), 0)::bigint
        from public.loyalty_redemptions as redemption
        where redemption.organization_id = v_brand.organization_id
          and redemption.brand_id = v_brand.id
          and redemption.applied_at >= v_start
          and redemption.applied_at < v_end
      ),
      now(),
      now()
    on conflict (organization_id, brand_id, metric_date)
    do update set
      active_members = excluded.active_members,
      revenue_cents = excluded.revenue_cents,
      shipment_count = excluded.shipment_count,
      churn_count = excluded.churn_count,
      mrr_cents = excluded.mrr_cents,
      new_members = excluded.new_members,
      cancelled_members = excluded.cancelled_members,
      downgraded_members = excluded.downgraded_members,
      gross_revenue_cents = excluded.gross_revenue_cents,
      refunds_cents = excluded.refunds_cents,
      net_revenue_cents = excluded.net_revenue_cents,
      revenue_churn_cents = excluded.revenue_churn_cents,
      attempted_shipments = excluded.attempted_shipments,
      fulfilled_shipments = excluded.fulfilled_shipments,
      declined_attempts = excluded.declined_attempts,
      shipment_value_cents = excluded.shipment_value_cents,
      shipping_cost_cents = excluded.shipping_cost_cents,
      emails_sent = excluded.emails_sent,
      email_opens = excluded.email_opens,
      email_clicks = excluded.email_clicks,
      portal_logins = excluded.portal_logins,
      loyalty_points_earned = excluded.loyalty_points_earned,
      loyalty_points_redeemed = excluded.loyalty_points_redeemed,
      calculated_at = excluded.calculated_at,
      refreshed_at = excluded.refreshed_at;

    delete from public.brand_analytics_cohort_retention
    where organization_id = v_brand.organization_id
      and brand_id = v_brand.id
      and observation_month = v_observation_month;

    insert into public.brand_analytics_cohort_retention (
      organization_id,
      brand_id,
      cohort_month,
      observation_month,
      months_since_join,
      cohort_size,
      retained_members,
      retention_rate
    )
    select
      v_brand.organization_id,
      v_brand.id,
      date_trunc('month', member.joined_on)::date,
      v_observation_month,
      (
        extract(year from age(
          v_observation_month,
          date_trunc('month', member.joined_on)::date
        )) * 12
        + extract(month from age(
          v_observation_month,
          date_trunc('month', member.joined_on)::date
        ))
      )::integer,
      count(*)::integer,
      count(*) filter (
        where (member.cancelled_at is null or member.cancelled_at >= v_observation_end)
          and (member.deleted_at is null or member.deleted_at >= v_observation_end)
      )::integer,
      (
        count(*) filter (
          where (member.cancelled_at is null or member.cancelled_at >= v_observation_end)
            and (member.deleted_at is null or member.deleted_at >= v_observation_end)
        )::numeric / count(*)::numeric
      )::numeric(7, 6)
    from public.members as member
    where member.organization_id = v_brand.organization_id
      and member.brand_id = v_brand.id
      and member.joined_on <= p_metric_date
    group by date_trunc('month', member.joined_on)::date;

    v_refreshed := v_refreshed + 1;
  end loop;

  return v_refreshed;
end;
$$;

-- A production label must be backed by independently verifiable compliance
-- evidence. Existing historical rows are left visible for audit, while every
-- new live decision is required to carry a non-local response, tax result, and
-- provider rules version.
alter table public.compliance_checks
  add constraint compliance_checks_live_decision_evidence
  check (
    provider <> 'shipcompliant'
    or status = 'unknown'
    or (
      tax_estimate_cents is not null
      and char_length(coalesce(metadata ->> 'rules_version', ''))
        between 1 and 120
      and coalesce(
        (metadata ->> 'provider_response_is_local')::boolean,
        true
      ) = false
    )
  ) not valid;

create or replace function private.enforce_label_provider_compliance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check public.compliance_checks%rowtype;
begin
  select compliance.*
  into v_check
  from public.compliance_checks as compliance
  where compliance.organization_id = new.organization_id
    and compliance.id = new.compliance_check_id;

  if not found
    or v_check.shipment_id is distinct from new.shipment_id
    or v_check.status is distinct from 'compliant'
  then
    raise exception using
      errcode = '23514',
      message = 'A matching compliant decision is required for a label attempt.';
  end if;

  if new.provider = 'easypost'
    and (
      v_check.provider <> 'shipcompliant'
      or coalesce(
        (v_check.metadata ->> 'provider_response_is_local')::boolean,
        true
      )
    )
  then
    raise exception using
      errcode = '23514',
      message = 'EasyPost labels require live ShipCompliant evidence.';
  end if;
  return new;
end;
$$;

drop trigger if exists shipping_label_attempts_enforce_provider_compliance
on public.shipping_label_attempts;
create trigger shipping_label_attempts_enforce_provider_compliance
before insert or update of
  organization_id,
  shipment_id,
  compliance_check_id,
  provider
on public.shipping_label_attempts
for each row execute function private.enforce_label_provider_compliance();

create or replace function private.enforce_compliance_before_label()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_compliance_provider text;
  v_provider_response_is_local boolean;
  v_label_provider text;
begin
  if new.status in ('label_created', 'packed', 'shipped', 'delivered') then
    select
      compliance.provider,
      coalesce(
        (compliance.metadata ->> 'provider_response_is_local')::boolean,
        true
      )
    into v_compliance_provider, v_provider_response_is_local
    from public.compliance_checks as compliance
    where compliance.organization_id = new.organization_id
      and compliance.id = new.latest_compliance_check_id
      and compliance.shipment_id = new.id
      and compliance.status = 'compliant';

    select attempt.provider
    into v_label_provider
    from public.shipping_label_attempts as attempt
    where attempt.organization_id = new.organization_id
      and attempt.shipment_id = new.id
      and attempt.compliance_check_id = new.latest_compliance_check_id
      and attempt.status = 'succeeded'
    order by attempt.completed_at desc, attempt.id
    limit 1;

    if new.compliance_status is distinct from 'compliant'
      or new.latest_compliance_check_id is null
      or new.latest_compliance_request_fingerprint is null
      or new.latest_compliance_state_fingerprint is null
      or new.latest_compliance_state_fingerprint
        is distinct from private.shipment_compliance_fingerprint(
          new.organization_id,
          new.id
        )
      or new.compliance_checked_at is null
      or new.compliance_checked_at < now() - interval '24 hours'
      or v_label_provider is null
      or (
        v_label_provider = 'easypost'
        and (
          v_compliance_provider <> 'shipcompliant'
          or v_provider_response_is_local
        )
      )
    then
      raise exception using
        errcode = '23514',
        message = 'A matching live compliance decision is required before a production label can advance.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.get_brand_analytics_dashboard(
  p_organization_id uuid,
  p_brand_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_layout jsonb;
  v_result jsonb;
  v_time_zone text;
  v_from_start timestamptz;
  v_to_end timestamptz;
begin
  if not private.can_read_brand_analytics(p_organization_id, p_brand_id) then
    raise exception using
      errcode = '42501',
      message = 'Brand analytics authorization is required.';
  end if;
  if p_to is null or (p_from is not null and p_from > p_to) then
    raise exception using
      errcode = '22023',
      message = 'Analytics date range is invalid.';
  end if;

  select brand.time_zone
  into v_time_zone
  from public.brands as brand
  where brand.organization_id = p_organization_id
    and brand.id = p_brand_id;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Analytics brand not found.';
  end if;

  if p_from is null then
    select coalesce(min(fact.fact_date), p_to)
    into p_from
    from (
      select metric.metric_date as fact_date
      from public.brand_analytics_daily_metrics as metric
      where metric.organization_id = p_organization_id
        and metric.brand_id = p_brand_id
      union all
      select member.joined_on
      from public.members as member
      where member.organization_id = p_organization_id
        and member.brand_id = p_brand_id
    ) as fact;
  end if;

  v_from_start :=
    p_from::timestamp without time zone at time zone v_time_zone;
  v_to_end :=
    (p_to + 1)::timestamp without time zone at time zone v_time_zone;

  select preference.layout
  into v_layout
  from public.dashboard_layout_preferences as preference
  where preference.organization_id = p_organization_id
    and preference.brand_id = p_brand_id
    and preference.staff_user_id = auth.uid();

  select jsonb_build_object(
    'summary', jsonb_build_object(
      'from', p_from,
      'to', p_to,
      'empty', not exists (
        select 1
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ),
      'activeMembers', coalesce((
        select metric.active_members
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
        order by metric.metric_date desc
        limit 1
      ), 0),
      'mrrCents', coalesce((
        select metric.mrr_cents
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
        order by metric.metric_date desc
        limit 1
      ), 0),
      'arrCents', coalesce((
        select metric.mrr_cents * 12
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
        order by metric.metric_date desc
        limit 1
      ), 0),
      'arpmCents', coalesce((
        select round(metric.mrr_cents::numeric / nullif(metric.active_members, 0), 2)
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
        order by metric.metric_date desc
        limit 1
      ), 0),
      'averageLtvCents', coalesce((
        select round(avg(member_spend.ltv_cents), 2)
        from public.members as member
        left join lateral (
          select coalesce(sum(
            greatest(
              shipment.charge_amount_cents
              - shipment.loyalty_discount_cents
              - coalesce(shipment.refund_amount_cents, 0),
              0
            )
          ), 0)::numeric as ltv_cents
          from public.shipments as shipment
          where shipment.organization_id = member.organization_id
            and shipment.brand_id = member.brand_id
            and shipment.member_id = member.id
            and shipment.paid_at < v_to_end
        ) as member_spend on true
        where member.organization_id = p_organization_id
          and member.brand_id = p_brand_id
          and member.joined_on <= p_to
          and (
            member.cancelled_at is null
            or member.cancelled_at >= v_to_end
          )
          and (
            member.deleted_at is null
            or member.deleted_at >= v_to_end
          )
      ), 0),
      'averageShipmentValueCents', coalesce((
        select sum(metric.shipment_value_cents)::numeric
          / nullif(sum(metric.fulfilled_shipments), 0)
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), 0),
      'revenueChurnCents', coalesce((
        select sum(metric.revenue_churn_cents)
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), 0),
      'declineRate', coalesce((
        select least(1, sum(metric.declined_attempts)::numeric
          / nullif(sum(metric.attempted_shipments), 0)
        )
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), 0),
      'fulfillmentRate', coalesce((
        select least(1, sum(metric.fulfilled_shipments)::numeric
          / nullif(sum(metric.attempted_shipments), 0)
        )
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), 0),
      'shippingCostRatio', coalesce((
        select sum(metric.shipping_cost_cents)::numeric
          / nullif(sum(metric.gross_revenue_cents), 0)
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), 0),
      'emailOpenRate', coalesce((
        select least(1, sum(metric.email_opens)::numeric
          / nullif(sum(metric.emails_sent), 0)
        )
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), 0),
      'emailClickRate', coalesce((
        select least(1, sum(metric.email_clicks)::numeric
          / nullif(sum(metric.emails_sent), 0)
        )
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), 0),
      'portalLogins', coalesce((
        select sum(metric.portal_logins)
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), 0),
      'portalLoginsPerMember', coalesce((
        select sum(metric.portal_logins)::numeric
          / nullif((
            select latest.active_members
            from public.brand_analytics_daily_metrics as latest
            where latest.organization_id = p_organization_id
              and latest.brand_id = p_brand_id
              and latest.metric_date between p_from and p_to
            order by latest.metric_date desc
            limit 1
          ), 0)
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), 0),
      'loyaltyPointsRedeemed', coalesce((
        select sum(metric.loyalty_points_redeemed)
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), 0),
      'loyaltyRedemptionRate', coalesce((
        select least(1, sum(metric.loyalty_points_redeemed)::numeric
          / nullif(sum(metric.loyalty_points_earned), 0)
        )
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), 0)
    ),
    'revenue', jsonb_build_object(
      'mrr_cents', coalesce((
        select metric.mrr_cents
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
        order by metric.metric_date desc limit 1
      ), 0),
      'arr_cents', coalesce((
        select metric.mrr_cents * 12
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
        order by metric.metric_date desc limit 1
      ), 0),
      'gross_revenue_cents', coalesce((
        select sum(metric.gross_revenue_cents)
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), 0),
      'refunds_cents', coalesce((
        select sum(metric.refunds_cents)
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), 0),
      'net_revenue_cents', coalesce((
        select sum(metric.net_revenue_cents)
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), 0),
      'revenue_churn_cents', coalesce((
        select sum(metric.revenue_churn_cents)
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), 0),
      'byTier', coalesce((
        select jsonb_agg(jsonb_build_object(
          'tier_id', tier.id,
          'tier_name', tier.name,
          'active_members', tier_metrics.active_members,
          'monthly_revenue_cents', tier_metrics.monthly_revenue_cents,
          'average_ltv_cents', tier_metrics.average_ltv_cents
        ) order by tier.name)
        from public.club_tiers as tier
        cross join lateral (
          select
            count(*)::integer as active_members,
            (
              count(*) * case tier.frequency
                when 'monthly' then tier.price_cents
                when 'bi_monthly' then tier.price_cents / 2.0
                when 'quarterly' then tier.price_cents / 3.0
                when 'semi_annual' then tier.price_cents / 6.0
                when 'annual' then tier.price_cents / 12.0
              end
            )::bigint as monthly_revenue_cents,
            coalesce(round(avg(member_spend.ltv_cents), 2), 0)
              as average_ltv_cents
          from public.members as member
          left join lateral (
            select coalesce(sum(
                greatest(
                  shipment.charge_amount_cents
                  - shipment.loyalty_discount_cents
                  - coalesce(shipment.refund_amount_cents, 0),
                  0
                )
            ), 0)::numeric as ltv_cents
            from public.shipments as shipment
            where shipment.organization_id = member.organization_id
              and shipment.brand_id = member.brand_id
              and shipment.member_id = member.id
              and shipment.paid_at < v_to_end
          ) as member_spend on true
          where member.organization_id = p_organization_id
            and member.brand_id = p_brand_id
            and member.club_tier_id = tier.id
            and member.joined_on <= p_to
            and (
              member.cancelled_at is null
              or member.cancelled_at >= v_to_end
            )
            and (
              member.deleted_at is null
              or member.deleted_at >= v_to_end
            )
        ) as tier_metrics
        where tier.organization_id = p_organization_id
          and tier.brand_id = p_brand_id
          and tier_metrics.active_members > 0
      ), '[]'::jsonb),
      'trend', coalesce((
        select jsonb_agg(to_jsonb(metric) - 'organization_id' - 'brand_id'
          order by metric.metric_date)
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), '[]'::jsonb)
    ),
    'members', jsonb_build_object(
      'active', coalesce((
        select metric.active_members
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
        order by metric.metric_date desc limit 1
      ), 0),
      'new', coalesce((
        select sum(metric.new_members)
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), 0),
      'cancelled', coalesce((
        select sum(metric.cancelled_members)
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), 0),
      'downgraded', coalesce((
        select sum(metric.downgraded_members)
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), 0),
      'net_growth', coalesce((
        select sum(metric.new_members) - sum(metric.cancelled_members)
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), 0),
      'trend', coalesce((
        select jsonb_agg(to_jsonb(metric) - 'organization_id' - 'brand_id'
          order by metric.metric_date)
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), '[]'::jsonb),
      'cohortRetention', coalesce((
        select jsonb_agg(to_jsonb(cohort) - 'organization_id' - 'brand_id'
          order by cohort.cohort_month, cohort.observation_month)
        from public.brand_analytics_cohort_retention as cohort
        where cohort.organization_id = p_organization_id
          and cohort.brand_id = p_brand_id
          and cohort.observation_month between
            date_trunc('month', p_from)::date
            and date_trunc('month', p_to)::date
      ), '[]'::jsonb),
      'tenureDistribution', coalesce((
        select jsonb_agg(jsonb_build_object(
          'bucket', distribution.bucket,
          'members', distribution.members
        ) order by distribution.bucket_order)
        from (
          select
            case
              when p_to - member.joined_on < 90 then '0-3 months'
              when p_to - member.joined_on < 180 then '3-6 months'
              when p_to - member.joined_on < 365 then '6-12 months'
              when p_to - member.joined_on < 730 then '1-2 years'
              else '2+ years'
            end as bucket,
            case
              when p_to - member.joined_on < 90 then 1
              when p_to - member.joined_on < 180 then 2
              when p_to - member.joined_on < 365 then 3
              when p_to - member.joined_on < 730 then 4
              else 5
            end as bucket_order,
            count(*)::integer as members
          from public.members as member
          where member.organization_id = p_organization_id
            and member.brand_id = p_brand_id
            and member.joined_on <= p_to
            and (
              member.cancelled_at is null
              or member.cancelled_at >= v_to_end
            )
            and (
              member.deleted_at is null
              or member.deleted_at >= v_to_end
            )
          group by 1, 2
        ) as distribution
      ), '[]'::jsonb)
    ),
    'shipments', jsonb_build_object(
      'attempted', coalesce((
        select sum(metric.attempted_shipments)
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), 0),
      'fulfilled', coalesce((
        select sum(metric.fulfilled_shipments)
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), 0),
      'declineReasons', coalesce((
        select jsonb_agg(jsonb_build_object(
          'reason', reason.decline_reason,
          'attempts', reason.attempts
        ) order by reason.attempts desc, reason.decline_reason)
        from (
          select
            coalesce(nullif(attempt.decline_reason, ''), 'Unknown')
              as decline_reason,
            count(*)::integer as attempts
          from public.billing_attempts as attempt
          where attempt.organization_id = p_organization_id
            and attempt.brand_id = p_brand_id
            and attempt.status = 'declined'
            and attempt.completed_at >= v_from_start
            and attempt.completed_at < v_to_end
          group by 1
        ) as reason
      ), '[]'::jsonb),
      'trend', coalesce((
        select jsonb_agg(to_jsonb(metric) - 'organization_id' - 'brand_id'
          order by metric.metric_date)
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), '[]'::jsonb)
    ),
    'engagement', jsonb_build_object(
      'trend', coalesce((
        select jsonb_agg(
          (
            to_jsonb(metric)
            - 'organization_id'
            - 'brand_id'
          ) || jsonb_build_object(
            'loyalty_redemption_rate',
              coalesce(least(
                1,
                metric.loyalty_points_redeemed::numeric
                  / nullif(metric.loyalty_points_earned, 0)
              ), 0),
            'portal_logins_per_member',
              coalesce(
                metric.portal_logins::numeric
                  / nullif(metric.active_members, 0),
                0
              )
          )
          order by metric.metric_date)
        from public.brand_analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.brand_id = p_brand_id
          and metric.metric_date between p_from and p_to
      ), '[]'::jsonb)
    ),
    'layout', coalesce(v_layout, '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

create or replace function public.get_brand_analytics_series(
  p_organization_id uuid,
  p_brand_id uuid,
  p_metric text,
  p_from date,
  p_to date
)
returns table (
  metric_date date,
  metric_value numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_read_brand_analytics(p_organization_id, p_brand_id) then
    raise exception using
      errcode = '42501',
      message = 'Brand analytics authorization is required.';
  end if;
  if p_to is null or (p_from is not null and p_from > p_to) then
    raise exception using
      errcode = '22023',
      message = 'Analytics date range is invalid.';
  end if;
  if p_from is null then
    select coalesce(min(metric.metric_date), p_to)
    into p_from
    from public.brand_analytics_daily_metrics as metric
    where metric.organization_id = p_organization_id
      and metric.brand_id = p_brand_id;
  end if;
  if p_metric not in (
    'mrr_cents',
    'active_members',
    'new_members',
    'cancelled_members',
    'net_revenue_cents',
    'fulfilled_shipments',
    'declined_attempts',
    'email_open_rate',
    'email_click_rate'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Unsupported analytics export metric.';
  end if;

  return query
  select metric.metric_date,
    case p_metric
      when 'mrr_cents' then metric.mrr_cents::numeric
      when 'active_members' then metric.active_members::numeric
      when 'new_members' then metric.new_members::numeric
      when 'cancelled_members' then metric.cancelled_members::numeric
      when 'net_revenue_cents' then metric.net_revenue_cents::numeric
      when 'fulfilled_shipments' then metric.fulfilled_shipments::numeric
      when 'declined_attempts' then metric.declined_attempts::numeric
      when 'email_open_rate' then
        coalesce(metric.email_opens::numeric / nullif(metric.emails_sent, 0), 0)
      when 'email_click_rate' then
        coalesce(metric.email_clicks::numeric / nullif(metric.emails_sent, 0), 0)
    end
  from public.brand_analytics_daily_metrics as metric
  where metric.organization_id = p_organization_id
    and metric.brand_id = p_brand_id
    and metric.metric_date between p_from and p_to
  order by metric.metric_date;
end;
$$;

create or replace function public.save_analytics_dashboard_layout(
  p_organization_id uuid,
  p_brand_id uuid,
  p_staff_user_id uuid,
  p_layout jsonb
)
returns public.dashboard_layout_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_layout public.dashboard_layout_preferences%rowtype;
begin
  perform private.require_brand_context(p_organization_id, p_brand_id);
  if not exists (
    select 1
    from public.staff_users as staff
    where staff.organization_id = p_organization_id
      and staff.id = p_staff_user_id
      and staff.status = 'active'
  )
    or (
      not private.is_service_role()
      and (
        auth.uid() is distinct from p_staff_user_id
        or not private.can_access_brand(p_organization_id, p_brand_id)
      )
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Staff may update only their own brand dashboard layout.';
  end if;
  if not private.dashboard_layout_is_valid(p_layout) then
    raise exception using
      errcode = '22023',
      message = 'Dashboard layout is invalid.';
  end if;

  insert into public.dashboard_layout_preferences (
    organization_id,
    brand_id,
    staff_user_id,
    layout
  )
  values (
    p_organization_id,
    p_brand_id,
    p_staff_user_id,
    p_layout
  )
  on conflict on constraint dashboard_layout_preferences_org_staff_key
  do update set
    layout = excluded.layout,
    updated_at = now()
  returning * into v_layout;

  return v_layout;
end;
$$;

create or replace function public.upsert_analytics_report_schedule(
  p_organization_id uuid,
  p_brand_id uuid,
  p_staff_user_id uuid,
  p_frequency public.analytics_report_frequency,
  p_day_of_week smallint,
  p_day_of_month smallint,
  p_send_hour_utc smallint,
  p_widget_ids text[],
  p_enabled boolean,
  p_report_type public.analytics_report_type default 'analytics_summary'
)
returns public.analytics_report_schedules
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule public.analytics_report_schedules%rowtype;
begin
  if p_report_type <> 'analytics_summary' then
    raise exception using
      errcode = '22023',
      message = 'Brand report scheduling accepts analytics summaries only.';
  end if;
  perform private.require_brand_context(p_organization_id, p_brand_id);
  if not exists (
    select 1
    from public.staff_users as staff
    where staff.organization_id = p_organization_id
      and staff.id = p_staff_user_id
      and staff.status = 'active'
  )
    or (
      not private.is_service_role()
      and (
        auth.uid() is distinct from p_staff_user_id
        or not private.can_access_brand(p_organization_id, p_brand_id)
      )
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Staff may update only their own brand report schedule.';
  end if;

  insert into public.analytics_report_schedules (
    organization_id,
    brand_id,
    staff_user_id,
    report_type,
    frequency,
    day_of_week,
    day_of_month,
    send_hour_utc,
    widget_ids,
    enabled,
    next_report_at
  )
  values (
    p_organization_id,
    p_brand_id,
    p_staff_user_id,
    'analytics_summary',
    p_frequency,
    p_day_of_week,
    p_day_of_month,
    p_send_hour_utc,
    p_widget_ids,
    p_enabled,
    private.next_analytics_report_at(
      p_frequency,
      p_day_of_week,
      p_day_of_month,
      p_send_hour_utc,
      now()
    )
  )
  on conflict on constraint analytics_report_schedules_org_staff_type_key
  do update set
    frequency = excluded.frequency,
    day_of_week = excluded.day_of_week,
    day_of_month = excluded.day_of_month,
    send_hour_utc = excluded.send_hour_utc,
    widget_ids = excluded.widget_ids,
    enabled = excluded.enabled,
    next_report_at = excluded.next_report_at,
    updated_at = now()
  returning * into v_schedule;

  return v_schedule;
end;
$$;

-- Benchmark consent and contributions are organization-wide. Consolidate any
-- historical per-brand schedules onto the default brand as a storage sentinel,
-- then enforce one schedule per staff recipient for the organization.
with ranked as (
  select
    schedule.id,
    row_number() over (
      partition by schedule.organization_id, schedule.staff_user_id
      order by
        schedule.enabled desc,
        schedule.updated_at desc,
        schedule.created_at desc,
        schedule.id
    ) as row_number
  from public.analytics_report_schedules as schedule
  where schedule.report_type = 'benchmark'
)
delete from public.analytics_report_schedules as schedule
using ranked
where ranked.id = schedule.id
  and ranked.row_number > 1;

update public.analytics_report_schedules as schedule
set brand_id = organization.default_brand_id
from public.organizations as organization
where schedule.organization_id = organization.id
  and schedule.report_type = 'benchmark'
  and schedule.brand_id is distinct from organization.default_brand_id;

create unique index analytics_benchmark_schedule_org_staff_uidx
  on public.analytics_report_schedules (
    organization_id,
    staff_user_id
  )
  where report_type = 'benchmark';

-- The browser never reads organization aggregates or benchmark source facts
-- directly. Brand-scoped analytics and organization-wide benchmark actions go
-- through authorization-preserving RPCs behind the BFF.
revoke select on table
  public.analytics_daily_metrics,
  public.analytics_cohort_retention,
  public.benchmark_preferences,
  public.benchmark_contributions
from authenticated;

revoke execute on function public.set_benchmark_preferences(
  uuid, boolean, boolean, uuid
) from authenticated;
revoke execute on function public.set_benchmark_opt_in(
  uuid, boolean, boolean, uuid
) from authenticated;
revoke execute on function public.get_benchmark_comparison(uuid, date)
from authenticated;
revoke execute on function public.get_peer_benchmark(uuid, date)
from authenticated;

create or replace function public.enqueue_analytics_report_artifact(
  p_organization_id uuid,
  p_schedule_id uuid,
  p_period_start date,
  p_period_end date,
  p_subject text,
  p_html_body text,
  p_text_body text,
  p_attachments jsonb,
  p_idempotency_key text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule public.analytics_report_schedules%rowtype;
  v_recipient_email text;
  v_email_id uuid;
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Analytics report enqueue is service-only.';
  end if;

  select schedule.*
  into v_schedule
  from public.analytics_report_schedules as schedule
  where schedule.id = p_schedule_id
    and schedule.organization_id = p_organization_id
    and schedule.staff_user_id = p_actor_user_id
    and exists (
      select 1
      from public.staff_users as staff
      where staff.organization_id = schedule.organization_id
        and staff.id = schedule.staff_user_id
        and staff.status = 'active'
    );

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Active analytics report recipient not found.';
  end if;

  select staff.email
  into v_recipient_email
  from public.staff_users as staff
  where staff.organization_id = v_schedule.organization_id
    and staff.id = v_schedule.staff_user_id
    and staff.status = 'active';
  if p_period_start > p_period_end then
    raise exception using
      errcode = '22023',
      message = 'Analytics report period is invalid.';
  end if;
  if char_length(btrim(p_subject)) not between 1 and 200
    or p_subject ~ E'[\r\n]'
    or char_length(p_html_body) not between 1 and 100000
    or lower(p_html_body) ~ '<[[:space:]]*script'
    or char_length(p_text_body) not between 1 and 100000
    or not private.report_attachments_are_valid(p_attachments)
  then
    raise exception using
      errcode = '22023',
      message = 'Analytics report content is invalid.';
  end if;

  insert into public.email_log (
    organization_id,
    brand_id,
    member_id,
    template_id,
    trigger_type,
    is_test,
    requested_by,
    idempotency_key,
    to_email,
    subject,
    body,
    payload,
    scheduled_for
  )
  select
    p_organization_id,
    v_schedule.brand_id,
    null,
    template.id,
    'analytics_report',
    false,
    p_actor_user_id,
    p_idempotency_key,
    v_recipient_email,
    p_subject,
    p_html_body,
    jsonb_build_object(
      'report_type', v_schedule.report_type,
      'brand_id', v_schedule.brand_id,
      'period_start', p_period_start,
      'period_end', p_period_end,
      'text_body', p_text_body,
      'widget_ids', v_schedule.widget_ids,
      'dashboard', case
        when v_schedule.report_type = 'analytics_summary'
        then public.get_brand_analytics_dashboard(
          p_organization_id,
          v_schedule.brand_id,
          p_period_start,
          p_period_end
        )
        else '{}'::jsonb
      end,
      'attachments', p_attachments
    ),
    now()
  from public.email_templates as template
  where template.organization_id = p_organization_id
    and template.brand_id = v_schedule.brand_id
    and template.trigger_type = 'analytics_report'
    and template.enabled
  on conflict on constraint email_log_org_idempotency_key
  do update set idempotency_key = excluded.idempotency_key
  returning id into v_email_id;

  if v_email_id is null then
    raise exception using
      errcode = '23514',
      message = 'Analytics report email template is disabled.';
  end if;

  insert into public.email_outbox (
    organization_id,
    brand_id,
    email_log_id,
    available_at
  )
  values (
    p_organization_id,
    v_schedule.brand_id,
    v_email_id,
    now()
  )
  on conflict on constraint email_outbox_email_log_key do nothing;

  update public.analytics_report_schedules
  set
    last_enqueued_at = now(),
    next_report_at = private.next_analytics_report_at(
      frequency,
      day_of_week,
      day_of_month,
      send_hour_utc,
      greatest(now(), next_report_at)
    )
  where id = p_schedule_id
    and organization_id = p_organization_id
    and brand_id = v_schedule.brand_id;

  return v_email_id;
end;
$$;

create or replace function public.enqueue_due_analytics_reports(
  p_as_of timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule record;
  v_period_start date;
  v_period_end date := (p_as_of - interval '1 day')::date;
  v_dashboard jsonb;
  v_text_body text;
  v_html_body text;
  v_count integer := 0;
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Analytics report queue is service-only.';
  end if;

  for v_schedule in
    select schedule.*
    from public.analytics_report_schedules as schedule
    where schedule.enabled
      and schedule.report_type = 'analytics_summary'
      and schedule.next_report_at <= p_as_of
    order by schedule.next_report_at, schedule.id
    for update of schedule skip locked
  loop
    v_period_start := case v_schedule.frequency
      when 'weekly' then v_period_end - 6
      when 'monthly' then
        (date_trunc('month', v_period_end) - interval '1 month')::date
      else
        (date_trunc('quarter', v_period_end) - interval '3 months')::date
    end;
    v_dashboard := public.get_brand_analytics_dashboard(
      v_schedule.organization_id,
      v_schedule.brand_id,
      v_period_start,
      v_period_end
    );
    v_text_body := format(
      'Vinifera analytics summary from %s through %s. Active members: %s. MRR: %s cents. Fulfillment rate: %s. Email open rate: %s.',
      v_period_start,
      v_period_end,
      coalesce(v_dashboard #>> '{summary,activeMembers}', '0'),
      coalesce(v_dashboard #>> '{summary,mrrCents}', '0'),
      coalesce(v_dashboard #>> '{summary,fulfillmentRate}', '0'),
      coalesce(v_dashboard #>> '{summary,emailOpenRate}', '0')
    );
    v_html_body := format(
      '<p>Vinifera analytics summary from %s through %s.</p><ul><li>Active members: %s</li><li>MRR: %s cents</li><li>Fulfillment rate: %s</li><li>Email open rate: %s</li></ul>',
      v_period_start,
      v_period_end,
      coalesce(v_dashboard #>> '{summary,activeMembers}', '0'),
      coalesce(v_dashboard #>> '{summary,mrrCents}', '0'),
      coalesce(v_dashboard #>> '{summary,fulfillmentRate}', '0'),
      coalesce(v_dashboard #>> '{summary,emailOpenRate}', '0')
    );

    perform public.enqueue_analytics_report_artifact(
      v_schedule.organization_id,
      v_schedule.id,
      v_period_start,
      v_period_end,
      'Vinifera analytics summary',
      v_html_body,
      v_text_body,
      '[]'::jsonb,
      'report:analytics:' || v_schedule.id::text || ':'
        || v_schedule.next_report_at::text,
      v_schedule.staff_user_id
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Persist the temporal cohort order used by training. A later member-profile
-- edit must never rewrite the provenance of an already-built dataset.
alter table public.ml_training_rows
  add column temporal_order_at date;

alter table public.ml_training_rows
  disable trigger ml_training_rows_reject_update_delete;

update public.ml_training_rows as training
set temporal_order_at = member.joined_on
from public.members as member
where member.organization_id = training.organization_id
  and member.id = training.member_id;

alter table public.ml_training_rows
  enable trigger ml_training_rows_reject_update_delete;

alter table public.ml_training_rows
  alter column temporal_order_at set not null;

create or replace function private.assign_ml_training_temporal_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select member.joined_on
  into new.temporal_order_at
  from public.members as member
  where member.organization_id = new.organization_id
    and member.id = new.member_id;

  if new.temporal_order_at is null then
    raise exception using
      errcode = '23503',
      message = 'Training member temporal order could not be resolved.';
  end if;
  return new;
end;
$$;

create trigger ml_training_rows_assign_temporal_order
before insert on public.ml_training_rows
for each row execute function private.assign_ml_training_temporal_order();

create or replace function private.refresh_ml_training_dataset_hash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  if not exists (
    select 1
    from public.ml_training_rows as training
    where training.training_run_id = new.id
  ) then
    return new;
  end if;

  select encode(extensions.digest(
    convert_to(coalesce(string_agg(
      training.member_id::text || ':' || training.feature_snapshot_id::text
        || ':' || training.split || ':' || coalesce(training.fold::text, '-')
        || ':' || training.temporal_order_at::text
        || ':' || training.churned_within_90_days::text,
      ',' order by training.temporal_order_at, training.member_id
    ), ''), 'UTF8'),
    'sha256'
  ), 'hex')
  into v_hash
  from public.ml_training_rows as training
  where training.training_run_id = new.id;

  new.dataset_hash := v_hash;
  return new;
end;
$$;

create trigger ml_training_runs_refresh_dataset_hash
before update of
  status,
  member_count,
  cancellation_count,
  training_row_count,
  holdout_row_count,
  dataset_hash
on public.ml_training_runs
for each row execute function private.refresh_ml_training_dataset_hash();

create table public.ml_training_source_qualifications (
  id uuid primary key default gen_random_uuid(),
  training_run_id uuid not null
    references public.ml_training_runs (id) on delete restrict,
  dataset_hash text not null,
  status text not null,
  source_coverage jsonb not null,
  evidence_hash text not null,
  qualified_by uuid not null
    references auth.users (id) on delete restrict,
  qualified_at timestamptz not null default now(),
  constraint ml_training_source_qualification_status
    check (status in ('qualified', 'rejected')),
  constraint ml_training_source_qualification_hashes
    check (
      dataset_hash ~ '^[a-f0-9]{64}$'
      and evidence_hash ~ '^[a-f0-9]{64}$'
    ),
  constraint ml_training_source_qualification_shape
    check (
      jsonb_typeof(source_coverage) = 'object'
      and source_coverage ?& array[
        'eligible_member_count',
        'reconciled_through',
        'sources'
      ]
    ),
  constraint ml_training_source_qualification_run_evidence_key
    unique (training_run_id, evidence_hash)
);

create index ml_training_source_qualification_run_latest_idx
  on public.ml_training_source_qualifications (
    training_run_id,
    qualified_at desc,
    id desc
  );

create trigger ml_training_source_qualifications_reject_mutation
before update or delete on public.ml_training_source_qualifications
for each row execute function private.reject_phase4_append_only_mutation();

alter table public.ml_training_source_qualifications enable row level security;
alter table public.ml_training_source_qualifications force row level security;

create policy ml_training_source_qualifications_super_admin_all
  on public.ml_training_source_qualifications
  for all to authenticated
  using ((select private.is_super_admin()))
  with check ((select private.is_super_admin()));

revoke all on table public.ml_training_source_qualifications
from anon, authenticated;
grant all on table public.ml_training_source_qualifications to service_role;

create or replace function private.ml_source_coverage_is_adequate(
  p_coverage jsonb,
  p_member_count integer,
  p_required_through date
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_source text;
  v_source_value jsonb;
  v_eligible integer;
  v_reconciled integer;
  v_reconciled_through date;
begin
  if jsonb_typeof(p_coverage) <> 'object'
    or jsonb_typeof(p_coverage -> 'sources') <> 'object'
    or coalesce(p_coverage ->> 'eligible_member_count', '') !~ '^[0-9]+$'
    or (p_coverage ->> 'eligible_member_count')::integer <> p_member_count
    or coalesce(p_coverage ->> 'reconciled_through', '')
      !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  then
    return false;
  end if;

  v_reconciled_through := (p_coverage ->> 'reconciled_through')::date;
  if v_reconciled_through < p_required_through then
    return false;
  end if;

  foreach v_source in array array[
    'shipments',
    'billing',
    'email_delivery',
    'portal_activity',
    'loyalty',
    'declines'
  ]
  loop
    v_source_value := p_coverage -> 'sources' -> v_source;
    if jsonb_typeof(v_source_value) <> 'object'
      or coalesce(v_source_value ->> 'eligible_member_count', '')
        !~ '^[0-9]+$'
      or coalesce(v_source_value ->> 'reconciled_member_count', '')
        !~ '^[0-9]+$'
    then
      return false;
    end if;
    v_eligible :=
      (v_source_value ->> 'eligible_member_count')::integer;
    v_reconciled :=
      (v_source_value ->> 'reconciled_member_count')::integer;
    if v_eligible <> p_member_count
      or v_reconciled < ceil(v_eligible * 0.95)
      or v_reconciled > v_eligible
    then
      return false;
    end if;
  end loop;

  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.record_ml_training_source_qualification(
  p_training_run_id uuid,
  p_dataset_hash text,
  p_status text,
  p_source_coverage jsonb,
  p_evidence_hash text,
  p_actor_user_id uuid
)
returns public.ml_training_source_qualifications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.ml_training_runs%rowtype;
  v_qualification public.ml_training_source_qualifications%rowtype;
begin
  if not private.is_ml_training_actor()
    or not exists (
      select 1
      from public.platform_users as actor
      where actor.id = p_actor_user_id
        and actor.role = 'super_admin'
        and actor.active
    )
    or (
      not private.is_service_role()
      and auth.uid() is distinct from p_actor_user_id
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Platform qualification authorization is required.';
  end if;

  select training.*
  into v_run
  from public.ml_training_runs as training
  where training.id = p_training_run_id
  for share;

  if not found
    or v_run.source <> 'production_history'
    or v_run.status <> 'ready'
    or v_run.dataset_hash is distinct from p_dataset_hash
  then
    raise exception using
      errcode = '23514',
      message = 'A matching ready production dataset is required.';
  end if;
  if p_status not in ('qualified', 'rejected')
    or not private.ml_source_coverage_is_adequate(
      p_source_coverage,
      v_run.member_count,
      v_run.holdout_end + 90
    )
  then
    raise exception using
      errcode = '23514',
      message = 'Source reconciliation evidence is incomplete.';
  end if;

  insert into public.ml_training_source_qualifications (
    training_run_id,
    dataset_hash,
    status,
    source_coverage,
    evidence_hash,
    qualified_by
  )
  values (
    p_training_run_id,
    p_dataset_hash,
    p_status,
    p_source_coverage,
    p_evidence_hash,
    p_actor_user_id
  )
  on conflict on constraint
    ml_training_source_qualification_run_evidence_key
  do nothing
  returning * into v_qualification;

  if not found then
    select qualification.*
    into v_qualification
    from public.ml_training_source_qualifications as qualification
    where qualification.training_run_id = p_training_run_id
      and qualification.evidence_hash = p_evidence_hash;
    if v_qualification.dataset_hash is distinct from p_dataset_hash
      or v_qualification.status is distinct from p_status
      or v_qualification.source_coverage is distinct from p_source_coverage
      or v_qualification.qualified_by is distinct from p_actor_user_id
    then
      raise exception using
        errcode = '23505',
        message = 'Qualification evidence hash was reused for another fact.';
    end if;
  end if;

  return v_qualification;
end;
$$;

create or replace function public.get_ml_training_source_qualification(
  p_training_run_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_run public.ml_training_runs%rowtype;
  v_qualification public.ml_training_source_qualifications%rowtype;
begin
  if not private.is_ml_training_actor() then
    raise exception using
      errcode = '42501',
      message = 'Platform qualification authorization is required.';
  end if;

  select training.*
  into v_run
  from public.ml_training_runs as training
  where training.id = p_training_run_id;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Training run not found.';
  end if;

  select qualification.*
  into v_qualification
  from public.ml_training_source_qualifications as qualification
  where qualification.training_run_id = p_training_run_id
    and qualification.dataset_hash = v_run.dataset_hash
  order by qualification.qualified_at desc, qualification.id desc
  limit 1;

  return jsonb_build_object(
    'trainingRunId', v_run.id,
    'datasetHash', v_run.dataset_hash,
    'status', coalesce(v_qualification.status, 'pending'),
    'sourceCoverage', v_qualification.source_coverage,
    'evidenceHash', v_qualification.evidence_hash,
    'qualifiedAt', v_qualification.qualified_at,
    'qualifiedBy', v_qualification.qualified_by
  );
end;
$$;

create or replace function public.record_ml_training_source_qualification(
  p_training_run_id uuid,
  p_dataset_hash text,
  p_status text,
  p_source_coverage jsonb,
  p_actor_user_id uuid
)
returns public.ml_training_source_qualifications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evidence_hash text;
begin
  v_evidence_hash := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'training_run_id', p_training_run_id,
          'dataset_hash', p_dataset_hash,
          'status', p_status,
          'source_coverage', p_source_coverage
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  return public.record_ml_training_source_qualification(
    p_training_run_id,
    p_dataset_hash,
    p_status,
    p_source_coverage,
    v_evidence_hash,
    p_actor_user_id
  );
end;
$$;

create or replace function private.ml_training_temporal_contract_valid(
  p_training_run_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with run as (
    select *
    from public.ml_training_runs
    where id = p_training_run_id
  ),
  rows as (
    select
      training.*,
      feature.snapshot_date
    from public.ml_training_rows as training
    join public.ml_feature_snapshots as feature
      on feature.organization_id = training.organization_id
     and feature.id = training.feature_snapshot_id
    where training.training_run_id = p_training_run_id
  ),
  counts as (
    select
      count(distinct member_id)::integer as member_count,
      count(*) filter (where churned_within_90_days)::integer
        as cancellation_count,
      count(*) filter (where split = 'train')::integer as training_count,
      count(*) filter (where split = 'holdout')::integer as holdout_count
    from rows
  )
  select coalesce((
    select
      run.temporal_split
      and run.cross_validation_folds = 5
      and counts.member_count = run.member_count
      and counts.cancellation_count = run.cancellation_count
      and counts.training_count = run.training_row_count
      and counts.holdout_count = run.holdout_row_count
      and counts.holdout_count > 0
      and (
        select count(distinct fold)
        from rows where split = 'train'
      ) = 6
      and not exists (
        select 1 from rows
        where (split = 'train' and snapshot_date > run.training_cutoff)
           or (
             split = 'holdout'
             and snapshot_date not between run.holdout_start and run.holdout_end
           )
      )
      and (
        select max(snapshot_date) from rows where split = 'train'
      ) < (
        select min(snapshot_date) from rows where split = 'holdout'
      )
      and not exists (
        select 1
        from rows as train
        join rows as holdout on holdout.member_id = train.member_id
        where train.split = 'train' and holdout.split = 'holdout'
      )
      and not exists (
        select 1
        from rows as earlier
        join rows as later
          on earlier.split = 'train'
         and later.split = 'train'
         and earlier.fold < later.fold
        where (earlier.temporal_order_at, earlier.member_id)
          > (later.temporal_order_at, later.member_id)
      )
    from run cross join counts
  ), false);
$$;

create or replace function private.ml_training_run_is_qualified(
  p_training_run_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.ml_training_runs as training
    join lateral (
      select qualification.*
      from public.ml_training_source_qualifications as qualification
      where qualification.training_run_id = training.id
        and qualification.dataset_hash = training.dataset_hash
      order by qualification.qualified_at desc, qualification.id desc
      limit 1
    ) as latest on true
    where training.id = p_training_run_id
      and training.source = 'production_history'
      and training.status = 'ready'
      and latest.status = 'qualified'
      and private.ml_source_coverage_is_adequate(
        latest.source_coverage,
        training.member_count,
        training.holdout_end + 90
      )
  );
$$;

drop function public.get_ml_training_dataset(uuid);

create or replace function public.get_ml_training_dataset(
  p_training_run_id uuid
)
returns table (
  row_id uuid,
  member_id uuid,
  observed_at timestamptz,
  temporal_order_at date,
  split text,
  fold smallint,
  churned_within_90_days boolean,
  rules_probability numeric,
  features jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_ml_training_actor() then
    raise exception using
      errcode = '42501',
      message = 'Platform training authorization is required.';
  end if;

  return query
  select
    training.id,
    training.member_id,
    feature.snapshot_date::timestamptz,
    training.temporal_order_at,
    training.split,
    training.fold,
    training.churned_within_90_days,
    (feature.rules_score / 100.0)::numeric,
    private.ml_feature_vector(feature)
  from public.ml_training_rows as training
  join public.ml_feature_snapshots as feature
    on feature.organization_id = training.organization_id
   and feature.id = training.feature_snapshot_id
  where training.training_run_id = p_training_run_id
  order by
    training.split,
    training.temporal_order_at,
    feature.snapshot_date,
    training.id;
end;
$$;

create or replace function private.enforce_ml_model_registration_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.ml_training_temporal_contract_valid(new.training_run_id)
    or not private.ml_training_run_is_qualified(new.training_run_id)
  then
    raise exception using
      errcode = '23514',
      message = 'Qualified temporal production provenance is required.';
  end if;
  return new;
end;
$$;

create or replace function private.enforce_active_ml_platform_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
begin
  v_actor_user_id := case tg_table_name
    when 'ml_training_runs'
      then nullif(to_jsonb(new) ->> 'created_by', '')::uuid
    when 'ml_model_versions'
      then nullif(to_jsonb(new) ->> 'registered_by', '')::uuid
    when 'ml_experiments'
      then nullif(to_jsonb(new) ->> 'created_by', '')::uuid
  end;
  if v_actor_user_id is null
    or not exists (
      select 1
      from public.platform_users as actor
      where actor.id = v_actor_user_id
        and actor.role = 'super_admin'
        and actor.active
    )
  then
    raise exception using
      errcode = '42501',
      message = 'An active platform super-admin actor is required.';
  end if;
  if not private.is_service_role()
    and auth.uid() is distinct from v_actor_user_id
  then
    raise exception using
      errcode = '42501',
      message = 'ML actor attribution must match the authenticated platform user.';
  end if;
  return new;
end;
$$;

drop trigger if exists ml_training_runs_require_active_actor
on public.ml_training_runs;
create trigger ml_training_runs_require_active_actor
before insert on public.ml_training_runs
for each row execute function private.enforce_active_ml_platform_actor();

drop trigger if exists ml_model_versions_require_active_actor
on public.ml_model_versions;
create trigger ml_model_versions_require_active_actor
before insert on public.ml_model_versions
for each row execute function private.enforce_active_ml_platform_actor();

drop trigger if exists ml_experiments_require_active_actor
on public.ml_experiments;
create trigger ml_experiments_require_active_actor
before insert on public.ml_experiments
for each row execute function private.enforce_active_ml_platform_actor();

alter table public.ml_model_versions
  add column promoted_by uuid
    references public.platform_users (id) on delete restrict;

alter table public.ml_model_versions
  add constraint ml_model_versions_production_actor_required
  check (
    deployment_status <> 'production'
    or promoted_by is not null
  ) not valid;

create or replace function public.promote_ml_model_version(
  p_model_version_id uuid,
  p_actor_user_id uuid
)
returns public.ml_model_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model public.ml_model_versions%rowtype;
  v_experiment public.ml_experiments%rowtype;
  v_drift public.ml_drift_reports%rowtype;
begin
  if not private.is_service_role()
    or not exists (
      select 1
      from public.platform_users as actor
      where actor.id = p_actor_user_id
        and actor.role = 'super_admin'
        and actor.active
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Audited model promotion requires an active platform super-admin actor.';
  end if;

  select model.*
  into v_model
  from public.ml_model_versions as model
  where model.id = p_model_version_id
  for update;

  select experiment.*
  into v_experiment
  from public.ml_experiments as experiment
  where experiment.model_version_id = p_model_version_id
  order by experiment.created_at desc, experiment.id desc
  limit 1;

  select drift.*
  into v_drift
  from public.ml_drift_reports as drift
  where drift.model_version_id = p_model_version_id
  order by drift.snapshot_date desc, drift.id desc
  limit 1;

  if v_model.id is null
    or v_model.deployment_status is distinct from 'ab_test'
    or not private.ml_training_run_is_qualified(v_model.training_run_id)
    or coalesce((v_model.metrics ->> 'auc_roc')::numeric, -1) < 0.82
    or v_experiment.id is null
    or v_experiment.status is distinct from 'completed'
    or v_experiment.completed_at <
      v_experiment.started_at + interval '30 days'
    or v_experiment.evaluated_outcomes < 50
    or v_experiment.ml_auc is null
    or v_experiment.rules_auc is null
    or v_experiment.ml_brier_score is null
    or v_experiment.rules_brier_score is null
    or v_experiment.ml_auc <= v_experiment.rules_auc
    or v_experiment.ml_brier_score >= v_experiment.rules_brier_score
    or v_drift.id is null
    or v_drift.retraining_required is distinct from false
    or v_drift.snapshot_date < current_date - 7
  then
    raise exception using
      errcode = '23514',
      message = 'Production model promotion gates are not satisfied.';
  end if;

  update public.ml_model_versions
  set
    deployment_status = 'retired',
    retired_at = now()
  where deployment_status = 'production'
    and id <> p_model_version_id;

  update public.ml_model_versions
  set
    deployment_status = 'production',
    promoted_at = now(),
    promoted_by = p_actor_user_id,
    retired_at = null
  where id = p_model_version_id
  returning * into v_model;

  return v_model;
end;
$$;

create trigger ml_model_versions_require_qualified_provenance
before insert on public.ml_model_versions
for each row execute function private.enforce_ml_model_registration_contract();

create or replace function private.ml_candidate_is_experiment_eligible(
  p_model_version_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select
      model.deployment_status = 'candidate'
      and training.source = 'production_history'
      and training.status = 'ready'
      and training.member_count >= 500
      and training.cancellation_count >= 50
      and (model.metrics ->> 'auc_roc')::numeric between 0 and 1
      and (model.metrics ->> 'rules_baseline_auc')::numeric between 0 and 1
      and (model.metrics ->> 'auc_roc')::numeric >= 0.82
      and (model.metrics ->> 'auc_roc')::numeric
        > (model.metrics ->> 'rules_baseline_auc')::numeric
      and private.ml_training_temporal_contract_valid(training.id)
      and private.ml_training_run_is_qualified(training.id)
      and (
        select count(*)
        from (
          select row.fold
          from public.ml_training_rows as row
          where row.training_run_id = training.id
            and row.split = 'train'
            and row.fold between 1 and 5
          group by row.fold
          having count(*) filter (where row.churned_within_90_days) > 0
            and count(*) filter (where not row.churned_within_90_days) > 0
        ) as evaluable
      ) = 5
    from public.ml_model_versions as model
    join public.ml_training_runs as training
      on training.id = model.training_run_id
    where model.id = p_model_version_id
  ), false);
$$;

create or replace function public.start_ml_experiment(
  p_model_version_id uuid,
  p_actor_user_id uuid
)
returns public.ml_experiments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model public.ml_model_versions%rowtype;
  v_experiment public.ml_experiments%rowtype;
begin
  if not private.is_ml_training_actor() then
    raise exception using
      errcode = '42501',
      message = 'Platform training authorization is required.';
  end if;

  lock table public.ml_experiments in share row exclusive mode;
  select experiment.*
  into v_experiment
  from public.ml_experiments as experiment
  where experiment.model_version_id = p_model_version_id
    and experiment.status in ('scheduled', 'running')
  order by experiment.created_at desc
  limit 1;
  if found then
    return v_experiment;
  end if;

  select model.*
  into v_model
  from public.ml_model_versions as model
  where model.id = p_model_version_id
  for update;

  if not found
    or not private.ml_candidate_is_experiment_eligible(p_model_version_id)
    or exists (
      select 1
      from public.ml_experiments as experiment
      where experiment.status in ('scheduled', 'running')
    )
  then
    raise exception using
      errcode = '23514',
      message = 'Model is not eligible for a production A/B test.';
  end if;

  insert into public.ml_experiments (
    model_version_id,
    status,
    started_at,
    planned_end_at,
    created_by
  )
  values (
    v_model.id,
    'running',
    now(),
    now() + interval '30 days',
    p_actor_user_id
  )
  returning * into v_experiment;

  update public.ml_model_versions
  set deployment_status = 'ab_test'
  where id = v_model.id;

  return v_experiment;
end;
$$;

create or replace function private.ml_model_is_authoritative(
  p_model_version_id uuid,
  p_as_of date default current_date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select
      model.deployment_status = 'production'
      and training.source = 'production_history'
      and training.status = 'ready'
      and private.ml_training_run_is_qualified(training.id)
      and experiment.status = 'completed'
      and experiment.completed_at >= experiment.started_at + interval '30 days'
      and experiment.evaluated_outcomes >= 50
      and experiment.ml_auc > experiment.rules_auc
      and experiment.ml_brier_score < experiment.rules_brier_score
      and drift.id is not null
      and not drift.retraining_required
      and drift.snapshot_date >= p_as_of - 7
    from public.ml_model_versions as model
    join public.ml_training_runs as training
      on training.id = model.training_run_id
    left join lateral (
      select candidate.*
      from public.ml_experiments as candidate
      where candidate.model_version_id = model.id
        and candidate.status = 'completed'
      order by candidate.completed_at desc, candidate.id desc
      limit 1
    ) as experiment on true
    left join lateral (
      select report.*
      from public.ml_drift_reports as report
      where report.model_version_id = model.id
      order by report.snapshot_date desc, report.id desc
      limit 1
    ) as drift on true
    where model.id = p_model_version_id
  ), false);
$$;

-- Score every authoritative production model and every running shadow
-- candidate. Candidate predictions never create operational alerts or mutate
-- the member's effective churn score.
create or replace function public.score_ml_churn_batch(
  p_prediction_date date default current_date,
  p_organization_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model public.ml_model_versions%rowtype;
  v_experiment_id uuid;
  v_inserted integer;
  v_total_inserted integer := 0;
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'ML scoring is service-only.';
  end if;

  for v_model in
    select model.*
    from public.ml_model_versions as model
    where (
      model.deployment_status = 'production'
      and private.ml_model_is_authoritative(model.id, p_prediction_date)
    )
    or (
      model.deployment_status = 'ab_test'
      and exists (
        select 1
        from public.ml_experiments as experiment
        where experiment.model_version_id = model.id
          and experiment.status = 'running'
      )
    )
    order by
      case model.deployment_status when 'production' then 0 else 1 end,
      model.trained_at desc,
      model.id
  loop
    select experiment.id
    into v_experiment_id
    from public.ml_experiments as experiment
    where experiment.model_version_id = v_model.id
      and experiment.status = 'running'
    order by experiment.created_at desc
    limit 1;

    with features as (
      select
        feature.*,
        private.ml_feature_vector(feature) as feature_vector
      from public.ml_feature_snapshots as feature
      join public.members as member
        on member.organization_id = feature.organization_id
       and member.brand_id = feature.brand_id
       and member.id = feature.member_id
       and member.status = 'active'
       and member.deleted_at is null
      where feature.snapshot_date = p_prediction_date
        and (
          p_organization_id is null
          or feature.organization_id = p_organization_id
        )
    ),
    scored as (
      select
        feature.*,
        private.ml_probability(
          v_model.coefficients,
          v_model.intercept,
          v_model.hyperparameters,
          feature.feature_vector
        ) as probability
      from features as feature
    )
    insert into public.ml_churn_predictions (
      organization_id,
      brand_id,
      member_id,
      feature_snapshot_id,
      model_version_id,
      experiment_id,
      experiment_arm,
      score,
      rules_score,
      confidence_interval_low,
      confidence_interval_high,
      probability_band_method,
      top_features,
      predicted_at,
      prediction_date
    )
    select
      scored.organization_id,
      scored.brand_id,
      scored.member_id,
      scored.id,
      v_model.id,
      v_experiment_id,
      case
        when v_model.deployment_status = 'production' then 'ml'
        when mod(abs(hashtext(scored.member_id::text))::bigint, 2) = 0 then 'ml'
        else 'rules'
      end::public.ml_prediction_source,
      scored.probability,
      scored.rules_score,
      greatest(
        0,
        scored.probability
          - sqrt((v_model.metrics ->> 'brier_score')::numeric)
      ),
      least(
        1,
        scored.probability
          + sqrt((v_model.metrics ->> 'brier_score')::numeric)
      ),
      'heldout_brier_calibration_v1',
      private.ml_top_features(
        v_model.coefficients,
        v_model.hyperparameters,
        scored.feature_vector
      ),
      now(),
      p_prediction_date
    from scored
    on conflict on constraint ml_churn_predictions_member_model_date_key
    do nothing;

    get diagnostics v_inserted = row_count;
    v_total_inserted := v_total_inserted + v_inserted;

    if v_model.deployment_status = 'production' then
      insert into public.ml_high_risk_alerts (
        organization_id,
        brand_id,
        member_id,
        prediction_id,
        score,
        threshold
      )
      select
        prediction.organization_id,
        prediction.brand_id,
        prediction.member_id,
        prediction.id,
        prediction.score,
        v_model.high_risk_threshold
      from public.ml_churn_predictions as prediction
      where prediction.model_version_id = v_model.id
        and prediction.prediction_date = p_prediction_date
        and prediction.score >= v_model.high_risk_threshold
        and (
          p_organization_id is null
          or prediction.organization_id = p_organization_id
        )
        and not exists (
          select 1
          from public.ml_churn_predictions as previous
          where previous.organization_id = prediction.organization_id
            and previous.brand_id = prediction.brand_id
            and previous.member_id = prediction.member_id
            and previous.model_version_id = prediction.model_version_id
            and previous.prediction_date < prediction.prediction_date
            and previous.score >= v_model.high_risk_threshold
        )
      on conflict on constraint ml_high_risk_alerts_org_prediction_key
      do nothing;

      update public.members as member
      set churn_risk_score = round(prediction.score * 100, 2)
      from public.ml_churn_predictions as prediction
      where prediction.organization_id = member.organization_id
        and prediction.brand_id = member.brand_id
        and prediction.member_id = member.id
        and prediction.model_version_id = v_model.id
        and prediction.prediction_date = p_prediction_date
        and (
          p_organization_id is null
          or member.organization_id = p_organization_id
        );
    end if;
  end loop;

  return v_total_inserted;
end;
$$;

create or replace function public.list_churn_intelligence(
  p_organization_id uuid,
  p_brand_id uuid,
  p_risk_level text default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  member_id uuid,
  member_name text,
  member_email text,
  tier_name text,
  rules_score numeric,
  ml_probability numeric,
  ml_score numeric,
  effective_score numeric,
  effective_source public.ml_prediction_source,
  risk_level public.churn_risk_level,
  confidence_interval_low numeric,
  confidence_interval_high numeric,
  top_features jsonb,
  predicted_at timestamptz,
  alert_id uuid,
  alert_created_at timestamptz,
  alert_acknowledged_at timestamptz,
  alert_acknowledged_by_name text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_brand_context(p_organization_id, p_brand_id);
  if p_risk_level is not null
    and p_risk_level not in ('low', 'medium', 'high')
  then
    raise exception using
      errcode = '22023',
      message = 'Unsupported churn risk level.';
  end if;
  if p_limit not between 1 and 200 or p_offset < 0 then
    raise exception using
      errcode = '22023',
      message = 'Churn pagination is invalid.';
  end if;
  if p_search is not null and char_length(p_search) > 120 then
    raise exception using
      errcode = '22023',
      message = 'Churn search is too long.';
  end if;

  return query
  with authoritative_model as (
    select model.id
    from public.ml_model_versions as model
    where model.deployment_status = 'production'
      and private.ml_model_is_authoritative(model.id, current_date)
    order by model.promoted_at desc, model.id
    limit 1
  ),
  intelligence as (
    select
      member.id as member_id,
      btrim(member.first_name || ' ' || member.last_name) as member_name,
      member.email as member_email,
      tier.name as tier_name,
      coalesce(rule.score, member.churn_risk_score, 0)::numeric
        as rules_score,
      prediction.score::numeric as ml_probability,
      round(prediction.score * 100, 2)::numeric as ml_score,
      case
        when prediction.id is not null
        then round(prediction.score * 100, 2)::numeric
        else coalesce(rule.score, member.churn_risk_score, 0)::numeric
      end as effective_score,
      case
        when prediction.id is not null then 'ml'::public.ml_prediction_source
        else 'rules'::public.ml_prediction_source
      end as effective_source,
      prediction.confidence_interval_low,
      prediction.confidence_interval_high,
      prediction.top_features,
      prediction.predicted_at,
      alert.id as alert_id,
      alert.created_at as alert_created_at,
      alert.acknowledged_at as alert_acknowledged_at,
      case
        when alert.acknowledged_by is null then null
        else acknowledger.email
      end as alert_acknowledged_by_name
    from public.members as member
    left join public.club_tiers as tier
      on tier.organization_id = member.organization_id
     and tier.brand_id = member.brand_id
     and tier.id = member.club_tier_id
    left join lateral (
      select score.*
      from public.churn_scores as score
      where score.organization_id = member.organization_id
        and score.brand_id = member.brand_id
        and score.member_id = member.id
      order by score.score_date desc
      limit 1
    ) as rule on true
    left join lateral (
      select candidate.*
      from public.ml_churn_predictions as candidate
      join authoritative_model as active
        on active.id = candidate.model_version_id
      where candidate.organization_id = member.organization_id
        and candidate.brand_id = member.brand_id
        and candidate.member_id = member.id
      order by candidate.prediction_date desc, candidate.predicted_at desc
      limit 1
    ) as prediction on true
    left join public.ml_high_risk_alerts as alert
      on alert.organization_id = member.organization_id
     and alert.brand_id = member.brand_id
     and alert.prediction_id = prediction.id
    left join public.staff_users as acknowledger
      on acknowledger.organization_id = alert.organization_id
     and acknowledger.id = alert.acknowledged_by
    where member.organization_id = p_organization_id
      and member.brand_id = p_brand_id
      and member.status = 'active'
      and member.deleted_at is null
      and (
        p_search is null
        or position(
          lower(btrim(p_search))
          in lower(
            member.first_name || ' ' || member.last_name || ' ' || member.email
          )
        ) > 0
      )
  ),
  classified as (
    select intelligence.*,
      case
        when intelligence.effective_score <= 30 then 'low'
        when intelligence.effective_score <= 60 then 'medium'
        else 'high'
      end::public.churn_risk_level as risk_level
    from intelligence
  )
  select
    classified.member_id,
    classified.member_name,
    classified.member_email,
    classified.tier_name,
    classified.rules_score,
    classified.ml_probability,
    classified.ml_score,
    classified.effective_score,
    classified.effective_source,
    classified.risk_level,
    classified.confidence_interval_low,
    classified.confidence_interval_high,
    coalesce(classified.top_features, '[]'::jsonb),
    classified.predicted_at,
    classified.alert_id,
    classified.alert_created_at,
    classified.alert_acknowledged_at,
    classified.alert_acknowledged_by_name,
    count(*) over()
  from classified
  where p_risk_level is null
    or classified.risk_level::text = p_risk_level
  order by classified.effective_score desc, classified.member_name
  limit p_limit
  offset p_offset;
end;
$$;

create or replace function public.get_ml_operations_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_production_model public.ml_model_versions%rowtype;
  v_ab_model public.ml_model_versions%rowtype;
  v_production_model_json jsonb;
  v_ab_model_json jsonb;
  v_production_experiment jsonb;
  v_ab_experiment jsonb;
  v_production_drift jsonb;
  v_ab_drift jsonb;
begin
  if not private.is_service_role()
    and not private.is_super_admin()
    and not private.is_staff_for_org(auth.org_id())
  then
    raise exception using
      errcode = '42501',
      message = 'Staff authorization is required.';
  end if;

  select model.*
  into v_production_model
  from public.ml_model_versions as model
  where model.deployment_status = 'production'
  order by model.promoted_at desc, model.id
  limit 1;

  select model.*
  into v_ab_model
  from public.ml_model_versions as model
  where model.deployment_status = 'ab_test'
  order by model.trained_at desc, model.id
  limit 1;

  if v_production_model.id is not null then
    select jsonb_build_object(
      'id', model.id,
      'version', model.version,
      'algorithm', model.algorithm,
      'deploymentStatus', model.deployment_status,
      'trainingSource', training.source,
      'memberCount', training.member_count,
      'trainingDataSize', model.training_data_size,
      'cancellationCount', model.cancellation_count,
      'metrics', model.metrics,
      'trainedAt', model.trained_at,
      'promotedAt', model.promoted_at,
      'authoritative',
        private.ml_model_is_authoritative(model.id, current_date)
    )
    into v_production_model_json
    from public.ml_model_versions as model
    join public.ml_training_runs as training
      on training.id = model.training_run_id
    where model.id = v_production_model.id;

    select jsonb_build_object(
      'id', experiment.id,
      'modelVersionId', experiment.model_version_id,
      'status', experiment.status,
      'startedAt', experiment.started_at,
      'plannedEndAt', experiment.planned_end_at,
      'completedAt', experiment.completed_at,
      'evaluatedOutcomes', experiment.evaluated_outcomes,
      'mlAuc', experiment.ml_auc,
      'rulesAuc', experiment.rules_auc,
      'mlBrierScore', experiment.ml_brier_score,
      'rulesBrierScore', experiment.rules_brier_score
    )
    into v_production_experiment
    from public.ml_experiments as experiment
    where experiment.model_version_id = v_production_model.id
      and experiment.status = 'completed'
    order by experiment.completed_at desc, experiment.id desc
    limit 1;

    select jsonb_build_object(
      'modelVersionId', drift.model_version_id,
      'snapshotDate', drift.snapshot_date,
      'populationSize', drift.population_size,
      'populationStabilityIndex', drift.population_stability_index,
      'retrainingRequired', drift.retraining_required,
      'status', case
        when drift.retraining_required then 'degraded'
        when drift.snapshot_date < current_date - 7 then 'stale'
        else 'stable'
      end
    )
    into v_production_drift
    from public.ml_drift_reports as drift
    where drift.model_version_id = v_production_model.id
    order by drift.snapshot_date desc, drift.id desc
    limit 1;
  end if;

  if v_ab_model.id is not null then
    select jsonb_build_object(
      'id', model.id,
      'version', model.version,
      'algorithm', model.algorithm,
      'deploymentStatus', model.deployment_status,
      'trainingSource', training.source,
      'memberCount', training.member_count,
      'trainingDataSize', model.training_data_size,
      'cancellationCount', model.cancellation_count,
      'metrics', model.metrics,
      'trainedAt', model.trained_at
    )
    into v_ab_model_json
    from public.ml_model_versions as model
    join public.ml_training_runs as training
      on training.id = model.training_run_id
    where model.id = v_ab_model.id;

    select jsonb_build_object(
      'id', experiment.id,
      'modelVersionId', experiment.model_version_id,
      'status', experiment.status,
      'startedAt', experiment.started_at,
      'plannedEndAt', experiment.planned_end_at,
      'completedAt', experiment.completed_at,
      'evaluatedOutcomes', experiment.evaluated_outcomes,
      'mlAuc', experiment.ml_auc,
      'rulesAuc', experiment.rules_auc,
      'mlBrierScore', experiment.ml_brier_score,
      'rulesBrierScore', experiment.rules_brier_score
    )
    into v_ab_experiment
    from public.ml_experiments as experiment
    where experiment.model_version_id = v_ab_model.id
    order by experiment.created_at desc, experiment.id desc
    limit 1;

    select jsonb_build_object(
      'modelVersionId', drift.model_version_id,
      'snapshotDate', drift.snapshot_date,
      'populationSize', drift.population_size,
      'populationStabilityIndex', drift.population_stability_index,
      'retrainingRequired', drift.retraining_required,
      'status', case
        when drift.retraining_required then 'degraded'
        when drift.snapshot_date < current_date - 7 then 'stale'
        else 'stable'
      end
    )
    into v_ab_drift
    from public.ml_drift_reports as drift
    where drift.model_version_id = v_ab_model.id
    order by drift.snapshot_date desc, drift.id desc
    limit 1;
  end if;

  return jsonb_build_object(
    'productionModel', v_production_model_json,
    'abTestModel', v_ab_model_json,
    'productionExperiment', v_production_experiment,
    'productionDrift', v_production_drift,
    'abTestExperiment', v_ab_experiment,
    'abTestDrift', v_ab_drift,
    'experiment', coalesce(v_production_experiment, v_ab_experiment),
    'latestDrift', coalesce(v_production_drift, v_ab_drift),
    'fallback',
      v_production_model.id is null
      or not private.ml_model_is_authoritative(
        v_production_model.id,
        current_date
      )
  );
end;
$$;

-- Completed experiments remain pending when the only missing gate is a fresh
-- drift report. Reject only measured inferiority or an observed drift breach.
create or replace function public.run_ml_lifecycle(
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model record;
  v_next_candidate record;
  v_evaluated integer;
  v_drifted integer;
  v_promoted integer := 0;
  v_rejected integer := 0;
  v_pending_promotion integer := 0;
  v_started_experiment_id uuid;
  v_retraining_model_count integer := 0;
  v_retraining_model_ids jsonb := '[]'::jsonb;
  v_retraining_trigger_count integer := 0;
  v_retraining_trigger_model_ids jsonb := '[]'::jsonb;
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'ML lifecycle orchestration is service-only.';
  end if;

  v_evaluated := public.evaluate_due_ml_experiments(p_as_of);
  v_drifted := public.refresh_ml_drift_reports(p_as_of::date);

  for v_model in
    select
      model.id,
      experiment.created_by,
      (
        private.ml_training_run_is_qualified(training.id)
        and (model.metrics ->> 'auc_roc')::numeric >= 0.82
        and experiment.completed_at >= experiment.started_at + interval '30 days'
        and experiment.evaluated_outcomes >= 50
        and experiment.ml_auc > experiment.rules_auc
        and experiment.ml_brier_score < experiment.rules_brier_score
        and coalesce(actor.active, false)
        and drift.id is not null
        and not drift.retraining_required
        and drift.snapshot_date >= p_as_of::date - 7
      ) as promotion_eligible,
      (
        experiment.evaluated_outcomes >= 50
        and (
          experiment.ml_auc <= experiment.rules_auc
          or experiment.ml_brier_score >= experiment.rules_brier_score
        )
      ) as measured_inferior,
      coalesce(drift.retraining_required, false) as drift_breached
    from public.ml_model_versions as model
    join public.ml_training_runs as training
      on training.id = model.training_run_id
    join public.ml_experiments as experiment
      on experiment.model_version_id = model.id
     and experiment.status = 'completed'
    left join public.platform_users as actor
      on actor.id = experiment.created_by
     and actor.role = 'super_admin'
    left join lateral (
      select report.*
      from public.ml_drift_reports as report
      where report.model_version_id = model.id
      order by report.snapshot_date desc, report.id desc
      limit 1
    ) as drift on true
    where model.deployment_status = 'ab_test'
    order by experiment.completed_at, model.id
    for update of model skip locked
  loop
    if v_model.promotion_eligible then
      perform public.promote_ml_model_version(
        v_model.id,
        v_model.created_by
      );
      v_promoted := v_promoted + 1;
    elsif v_model.measured_inferior or v_model.drift_breached then
      update public.ml_model_versions
      set deployment_status = 'rejected'
      where id = v_model.id;
      v_rejected := v_rejected + 1;
    else
      v_pending_promotion := v_pending_promotion + 1;
    end if;
  end loop;

  select
    count(*)::integer,
    coalesce(jsonb_agg(model.id order by model.id), '[]'::jsonb)
  into v_retraining_model_count, v_retraining_model_ids
  from public.ml_model_versions as model
  join public.ml_drift_reports as drift
    on drift.model_version_id = model.id
   and drift.snapshot_date = p_as_of::date
   and drift.retraining_required
  where model.deployment_status in ('production', 'ab_test');

  with inserted as (
    insert into public.ml_retraining_signals (
      model_version_id,
      first_breach_date,
      population_stability_index
    )
    select
      model.id,
      drift.snapshot_date,
      drift.population_stability_index
    from public.ml_model_versions as model
    join public.ml_drift_reports as drift
      on drift.model_version_id = model.id
     and drift.snapshot_date = p_as_of::date
     and drift.retraining_required
    where model.deployment_status in ('production', 'ab_test')
      and not exists (
        select 1
        from public.ml_retraining_signals as prior
        where prior.model_version_id = model.id
          and prior.created_at >= p_as_of - interval '30 days'
      )
    on conflict on constraint ml_retraining_signals_model_breach_key
    do nothing
    returning model_version_id
  )
  select
    count(*)::integer,
    coalesce(
      jsonb_agg(model_version_id order by model_version_id),
      '[]'::jsonb
    )
  into v_retraining_trigger_count, v_retraining_trigger_model_ids
  from inserted;

  if not exists (
    select 1
    from public.ml_experiments as experiment
    where experiment.status in ('scheduled', 'running')
  ) then
    select model.id, model.registered_by
    into v_next_candidate
    from public.ml_model_versions as model
    join public.platform_users as actor
      on actor.id = model.registered_by
     and actor.role = 'super_admin'
     and actor.active
    where model.deployment_status = 'candidate'
      and private.ml_candidate_is_experiment_eligible(model.id)
      and not exists (
        select 1
        from public.ml_experiments as prior
        where prior.model_version_id = model.id
      )
    order by
      (model.metrics ->> 'auc_roc')::numeric desc,
      model.trained_at desc,
      model.id
    for update of model skip locked
    limit 1;

    if found then
      select (public.start_ml_experiment(
        v_next_candidate.id,
        v_next_candidate.registered_by
      )).id
      into v_started_experiment_id;
    end if;
  end if;

  return jsonb_build_object(
    'evaluated', v_evaluated,
    'driftReports', v_drifted,
    'promoted', v_promoted,
    'rejected', v_rejected,
    'pendingPromotion', v_pending_promotion,
    'startedExperimentId', v_started_experiment_id,
    'retrainingRequired', v_retraining_model_count > 0,
    'retrainingTriggered', v_retraining_trigger_count > 0,
    'retrainingTriggerCount', v_retraining_trigger_count,
    'retrainingTriggerModelIds', v_retraining_trigger_model_ids,
    'retrainingModelCount', v_retraining_model_count,
    'retrainingModelIds', v_retraining_model_ids
  );
end;
$$;

create or replace function private.require_orgwide_benchmark_actor(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_required_roles public.staff_role[] default null
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Organization-wide benchmark access is BFF-only.';
  end if;
  if exists (
    select 1
    from public.platform_users as platform_user
    where platform_user.id = p_actor_user_id
      and platform_user.role = 'super_admin'
      and platform_user.active
  ) then
    return;
  end if;
  if not exists (
    select 1
    from public.staff_users as staff
    join public.organization_staff_access as access
      on access.organization_id = staff.organization_id
     and access.staff_user_id = staff.id
     and access.scope = 'all_brands'
    where staff.organization_id = p_organization_id
      and staff.id = p_actor_user_id
      and staff.status = 'active'
      and (
        p_required_roles is null
        or staff.role = any(p_required_roles)
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'Active all-brand staff authorization is required.';
  end if;
end;
$$;

create or replace function public.get_benchmark_comparison(
  p_organization_id uuid,
  p_period date,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_orgwide_benchmark_actor(
    p_organization_id,
    p_actor_user_id,
    null
  );
  return public.get_benchmark_comparison(p_organization_id, p_period);
end;
$$;

create or replace function public.get_peer_benchmark(
  p_organization_id uuid,
  p_period date,
  p_actor_user_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.get_benchmark_comparison(
    p_organization_id,
    p_period,
    p_actor_user_id
  );
$$;

create or replace function public.set_orgwide_benchmark_preferences(
  p_organization_id uuid,
  p_opted_in boolean,
  p_quarterly_report_enabled boolean,
  p_actor_user_id uuid
)
returns public.benchmark_preferences
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_orgwide_benchmark_actor(
    p_organization_id,
    p_actor_user_id,
    array['owner', 'admin']::public.staff_role[]
  );
  return public.set_benchmark_preferences(
    p_organization_id,
    p_opted_in,
    p_quarterly_report_enabled,
    p_actor_user_id
  );
end;
$$;

-- The persisted bounds are model-calibrated uncertainty bands retained for
-- compatibility; they are not statistical confidence intervals.
comment on column public.ml_churn_predictions.confidence_interval_low is
  'Model-calibrated heuristic uncertainty-band lower bound; not a statistical confidence interval.';
comment on column public.ml_churn_predictions.confidence_interval_high is
  'Model-calibrated heuristic uncertainty-band upper bound; not a statistical confidence interval.';

-- PostgreSQL grants PUBLIC execute on new functions by default. Revoke that
-- implicit capability, then grant only the explicit BFF and platform-admin
-- boundaries used by the application.
revoke all on function private.can_read_brand_analytics(uuid, uuid)
from public, anon, authenticated;
revoke all on function private.enforce_label_provider_compliance()
from public, anon, authenticated;
revoke all on function private.enforce_compliance_before_label()
from public, anon, authenticated;
revoke all on function private.assign_ml_training_temporal_order()
from public, anon, authenticated;
revoke all on function private.refresh_ml_training_dataset_hash()
from public, anon, authenticated;
revoke all on function private.ml_source_coverage_is_adequate(
  jsonb, integer, date
) from public, anon, authenticated;
revoke all on function private.ml_training_temporal_contract_valid(uuid)
from public, anon, authenticated;
revoke all on function private.ml_training_run_is_qualified(uuid)
from public, anon, authenticated;
revoke all on function private.enforce_ml_model_registration_contract()
from public, anon, authenticated;
revoke all on function private.enforce_active_ml_platform_actor()
from public, anon, authenticated;
revoke all on function private.ml_candidate_is_experiment_eligible(uuid)
from public, anon, authenticated;
revoke all on function private.ml_model_is_authoritative(uuid, date)
from public, anon, authenticated;
revoke all on function private.require_orgwide_benchmark_actor(
  uuid, uuid, public.staff_role[]
) from public, anon, authenticated;

revoke all on function public.refresh_brand_analytics_snapshots(date, uuid, uuid)
from public, anon, authenticated;
revoke all on function public.get_brand_analytics_dashboard(uuid, uuid, date, date)
from public, anon, authenticated;
revoke all on function public.get_brand_analytics_series(uuid, uuid, text, date, date)
from public, anon, authenticated;
revoke all on function public.save_analytics_dashboard_layout(uuid, uuid, uuid, jsonb)
from public, anon, authenticated;
revoke all on function public.upsert_analytics_report_schedule(
  uuid, uuid, uuid, public.analytics_report_frequency,
  smallint, smallint, smallint, text[], boolean, public.analytics_report_type
) from public, anon, authenticated;
revoke all on function public.enqueue_analytics_report_artifact(
  uuid, uuid, date, date, text, text, text, jsonb, text, uuid
) from public, anon, authenticated;
revoke all on function public.enqueue_due_analytics_reports(timestamptz)
from public, anon, authenticated;
revoke all on function public.record_ml_training_source_qualification(
  uuid, text, text, jsonb, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.record_ml_training_source_qualification(
  uuid, text, text, jsonb, uuid
) from public, anon, authenticated;
revoke all on function public.get_ml_training_source_qualification(uuid)
from public, anon;
revoke all on function public.get_ml_training_dataset(uuid)
from public, anon;
revoke all on function public.start_ml_experiment(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.score_ml_churn_batch(date, uuid)
from public, anon, authenticated;
revoke all on function public.list_churn_intelligence(
  uuid, uuid, text, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.get_ml_operations_status()
from public, anon;
revoke all on function public.run_ml_lifecycle(timestamptz)
from public, anon, authenticated;
revoke all on function public.create_ml_training_run(
  date, date, date, public.ml_training_source, uuid
) from public, anon, authenticated;
revoke all on function public.register_ml_model_version(
  uuid, text, text, jsonb, jsonb, numeric, jsonb, jsonb,
  text, numeric, timestamptz, uuid
) from public, anon, authenticated;
revoke all on function public.promote_ml_model_version(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.get_benchmark_comparison(uuid, date)
from public, anon, authenticated;
revoke all on function public.get_peer_benchmark(uuid, date)
from public, anon, authenticated;
revoke all on function public.set_benchmark_preferences(
  uuid, boolean, boolean, uuid
) from public, anon, authenticated;
revoke all on function public.set_benchmark_opt_in(
  uuid, boolean, boolean, uuid
) from public, anon, authenticated;
revoke all on function public.get_benchmark_comparison(uuid, date, uuid)
from public, anon, authenticated;
revoke all on function public.get_peer_benchmark(uuid, date, uuid)
from public, anon, authenticated;
revoke all on function public.set_orgwide_benchmark_preferences(
  uuid, boolean, boolean, uuid
) from public, anon, authenticated;

grant execute on function public.refresh_brand_analytics_snapshots(date, uuid, uuid)
to service_role;
grant execute on function public.get_brand_analytics_dashboard(uuid, uuid, date, date)
to service_role;
grant execute on function public.get_brand_analytics_series(uuid, uuid, text, date, date)
to service_role;
grant execute on function public.save_analytics_dashboard_layout(uuid, uuid, uuid, jsonb)
to service_role;
grant execute on function public.upsert_analytics_report_schedule(
  uuid, uuid, uuid, public.analytics_report_frequency,
  smallint, smallint, smallint, text[], boolean, public.analytics_report_type
) to service_role;
grant execute on function public.enqueue_analytics_report_artifact(
  uuid, uuid, date, date, text, text, text, jsonb, text, uuid
) to service_role;
grant execute on function public.enqueue_due_analytics_reports(timestamptz)
to service_role;
grant execute on function public.record_ml_training_source_qualification(
  uuid, text, text, jsonb, uuid
) to service_role;
grant execute on function public.get_ml_training_source_qualification(uuid)
to authenticated, service_role;
grant execute on function public.get_ml_training_dataset(uuid)
to authenticated, service_role;
grant execute on function public.start_ml_experiment(uuid, uuid)
to service_role;
grant execute on function public.score_ml_churn_batch(date, uuid)
to service_role;
grant execute on function public.list_churn_intelligence(
  uuid, uuid, text, text, integer, integer
) to service_role;
grant execute on function public.get_ml_operations_status()
to authenticated, service_role;
grant execute on function public.run_ml_lifecycle(timestamptz)
to service_role;
grant execute on function public.create_ml_training_run(
  date, date, date, public.ml_training_source, uuid
) to service_role;
grant execute on function public.register_ml_model_version(
  uuid, text, text, jsonb, jsonb, numeric, jsonb, jsonb,
  text, numeric, timestamptz, uuid
) to service_role;
grant execute on function public.promote_ml_model_version(uuid, uuid)
to service_role;
grant execute on function public.get_benchmark_comparison(uuid, date)
to service_role;
grant execute on function public.get_peer_benchmark(uuid, date)
to service_role;
grant execute on function public.set_benchmark_preferences(
  uuid, boolean, boolean, uuid
) to service_role;
grant execute on function public.set_benchmark_opt_in(
  uuid, boolean, boolean, uuid
) to service_role;
grant execute on function public.get_benchmark_comparison(uuid, date, uuid)
to service_role;
grant execute on function public.get_peer_benchmark(uuid, date, uuid)
to service_role;
grant execute on function public.set_orgwide_benchmark_preferences(
  uuid, boolean, boolean, uuid
) to service_role;

comment on function public.refresh_brand_analytics_snapshots(date, uuid, uuid) is
  'Service-only, brand-local daily aggregation over production operational facts.';
comment on function public.get_brand_analytics_dashboard(uuid, uuid, date, date) is
  'BFF-only brand analytics projection. A null start date resolves to the earliest durable brand fact.';
comment on function public.run_ml_lifecycle(timestamptz) is
  'Service-only model lifecycle. Completed superior candidates await fresh drift evidence rather than being rejected.';

commit;
