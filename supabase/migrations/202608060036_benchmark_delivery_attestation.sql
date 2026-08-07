begin;

drop function if exists public.get_due_benchmark_report_recipients(timestamptz);

create function public.get_due_benchmark_report_recipients(
  p_as_of timestamptz default now()
)
returns table (
  schedule_id uuid,
  organization_id uuid,
  organization_name text,
  staff_user_id uuid,
  recipient_email text,
  period date,
  benchmark_available boolean,
  contribution_id uuid,
  aggregate_id uuid,
  peer_group jsonb,
  sample_count_band text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    schedule.id,
    schedule.organization_id,
    organization.name,
    schedule.staff_user_id,
    staff.email,
    (date_trunc('quarter', p_as_of) - interval '3 months')::date,
    aggregate.id is not null,
    contribution.id,
    aggregate.id,
    case when aggregate.id is null then null else jsonb_build_object(
      'region_group', aggregate.region_group,
      'tier_distribution_band', aggregate.tier_distribution_band,
      'member_count_band', aggregate.member_count_band,
      'coarsening_level', aggregate.coarsening_level
    ) end,
    aggregate.participant_count_band
  from public.analytics_report_schedules as schedule
  join public.organizations as organization
    on organization.id = schedule.organization_id
    and organization.plan_tier in ('estate', 'reserve')
  join public.staff_users as staff
    on staff.organization_id = schedule.organization_id
    and staff.id = schedule.staff_user_id
    and staff.status = 'active'
  left join public.benchmark_contributions as contribution
    on contribution.organization_id = schedule.organization_id
    and contribution.period = (
      date_trunc('quarter', p_as_of) - interval '3 months'
    )::date
    and contribution.opted_in
  left join lateral (
    select candidate.*
    from public.benchmark_aggregates as candidate
    where candidate.period = contribution.period
      and (
        (candidate.coarsening_level = 0
          and candidate.region_group = contribution.region_group
          and candidate.tier_distribution_band = contribution.tier_distribution_band
          and candidate.member_count_band = contribution.member_count_band)
        or (candidate.coarsening_level = 1
          and candidate.region_group = contribution.region_group
          and candidate.tier_distribution_band = contribution.tier_distribution_band
          and candidate.member_count_band = '*')
        or (candidate.coarsening_level = 2
          and candidate.region_group = contribution.region_group
          and candidate.tier_distribution_band = '*'
          and candidate.member_count_band = '*')
        or (candidate.coarsening_level = 3
          and candidate.region_group = '*'
          and candidate.tier_distribution_band = '*'
          and candidate.member_count_band = '*')
      )
    order by candidate.coarsening_level
    limit 1
  ) as aggregate on true
  where schedule.enabled
    and schedule.report_type = 'benchmark'
    and schedule.frequency = 'quarterly'
    and schedule.next_report_at <= p_as_of
  order by schedule.next_report_at, schedule.id;
$$;

create function public.enqueue_benchmark_report_artifact(
  p_organization_id uuid,
  p_schedule_id uuid,
  p_period_start date,
  p_period_end date,
  p_subject text,
  p_html_body text,
  p_text_body text,
  p_attachments jsonb,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_contribution_id uuid,
  p_aggregate_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contribution public.benchmark_contributions%rowtype;
  v_aggregate public.benchmark_aggregates%rowtype;
  v_email_id uuid;
  v_brand_id uuid;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Benchmark report enqueue is service-only.';
  end if;

  select contribution.* into v_contribution
  from public.benchmark_contributions as contribution
  where contribution.id = p_contribution_id
    and contribution.organization_id = p_organization_id
    and contribution.period = date_trunc('month', p_period_start)::date
    and contribution.opted_in;

  if v_contribution.id is null
    or jsonb_typeof(p_attachments) <> 'array'
    or jsonb_array_length(p_attachments) <> 2
  then
    raise exception using errcode = '23514', message = 'Available benchmark artifact binding is invalid.';
  end if;

  select aggregate.* into v_aggregate
  from public.benchmark_aggregates as aggregate
  where aggregate.id = p_aggregate_id
    and aggregate.period = v_contribution.period
    and aggregate.id = (
      select candidate.id
      from public.benchmark_aggregates as candidate
      where candidate.period = v_contribution.period
        and (
          (candidate.coarsening_level = 0
            and candidate.region_group = v_contribution.region_group
            and candidate.tier_distribution_band = v_contribution.tier_distribution_band
            and candidate.member_count_band = v_contribution.member_count_band)
          or (candidate.coarsening_level = 1
            and candidate.region_group = v_contribution.region_group
            and candidate.tier_distribution_band = v_contribution.tier_distribution_band
            and candidate.member_count_band = '*')
          or (candidate.coarsening_level = 2
            and candidate.region_group = v_contribution.region_group
            and candidate.tier_distribution_band = '*'
            and candidate.member_count_band = '*')
          or (candidate.coarsening_level = 3
            and candidate.region_group = '*'
            and candidate.tier_distribution_band = '*'
            and candidate.member_count_band = '*')
        )
      order by candidate.coarsening_level
      limit 1
    );

  if v_aggregate.id is null
    or not exists (
      select 1 from jsonb_array_elements(p_attachments) as attachment
      where attachment ->> 'content_type' = 'application/pdf'
    )
    or not exists (
      select 1 from jsonb_array_elements(p_attachments) as attachment
      where attachment ->> 'content_type' = 'text/csv'
    )
  then
    raise exception using errcode = '23514', message = 'Available benchmark artifact binding is invalid.';
  end if;

  v_email_id := public.enqueue_analytics_report_artifact(
    p_organization_id, p_schedule_id, p_period_start, p_period_end,
    p_subject, p_html_body, p_text_body, p_attachments,
    p_idempotency_key, p_actor_user_id
  );

  select schedule.brand_id into v_brand_id
  from public.analytics_report_schedules as schedule
  where schedule.id = p_schedule_id
    and schedule.organization_id = p_organization_id
    and schedule.report_type = 'benchmark';

  update public.email_log
  set payload = payload || jsonb_build_object(
    'benchmark_available', true,
    'benchmark_schedule_id', p_schedule_id,
    'benchmark_contribution_id', v_contribution.id,
    'benchmark_aggregate_id', v_aggregate.id
  )
  where id = v_email_id
    and organization_id = p_organization_id
    and brand_id = v_brand_id;

  if not found then
    raise exception using errcode = '23514', message = 'Persisted benchmark report could not be bound.';
  end if;
  return v_email_id;
end;
$$;

create function public.get_benchmark_delivery_attestation(
  p_organization_id uuid,
  p_brand_id uuid,
  p_email_log_id uuid,
  p_delivery_event_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_log public.email_log%rowtype;
  v_event public.email_delivery_events%rowtype;
  v_aggregate public.benchmark_aggregates%rowtype;
  v_contribution public.benchmark_contributions%rowtype;
  v_pdf jsonb;
  v_csv jsonb;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Benchmark delivery attestation is service-only.';
  end if;

  select log.* into v_log
  from public.email_log as log
  where log.id = p_email_log_id
    and log.organization_id = p_organization_id
    and log.brand_id = p_brand_id
    and log.trigger_type = 'analytics_report'
    and log.status = 'delivered'
    and log.payload ->> 'report_type' = 'benchmark'
    and (log.payload ->> 'benchmark_available')::boolean;

  select event.* into v_event
  from public.email_delivery_events as event
  where event.id = p_delivery_event_id
    and event.organization_id = p_organization_id
    and event.brand_id = p_brand_id
    and event.email_log_id = p_email_log_id
    and event.event_type = 'delivered';

  select contribution.* into v_contribution
  from public.benchmark_contributions as contribution
  where contribution.id = (v_log.payload ->> 'benchmark_contribution_id')::uuid
    and contribution.organization_id = p_organization_id
    and contribution.opted_in;

  select aggregate.* into v_aggregate
  from public.benchmark_aggregates as aggregate
  where aggregate.id = (v_log.payload ->> 'benchmark_aggregate_id')::uuid
    and aggregate.period = v_contribution.period
    and aggregate.id = (
      select candidate.id
      from public.benchmark_aggregates as candidate
      where candidate.period = v_contribution.period
        and (
          (candidate.coarsening_level = 0
            and candidate.region_group = v_contribution.region_group
            and candidate.tier_distribution_band = v_contribution.tier_distribution_band
            and candidate.member_count_band = v_contribution.member_count_band)
          or (candidate.coarsening_level = 1
            and candidate.region_group = v_contribution.region_group
            and candidate.tier_distribution_band = v_contribution.tier_distribution_band
            and candidate.member_count_band = '*')
          or (candidate.coarsening_level = 2
            and candidate.region_group = v_contribution.region_group
            and candidate.tier_distribution_band = '*'
            and candidate.member_count_band = '*')
          or (candidate.coarsening_level = 3
            and candidate.region_group = '*'
            and candidate.tier_distribution_band = '*'
            and candidate.member_count_band = '*')
        )
      order by candidate.coarsening_level
      limit 1
    );

  if v_log.id is null or v_event.id is null or v_contribution.id is null
    or v_aggregate.id is null
    or jsonb_typeof(v_log.payload -> 'attachments') <> 'array'
    or jsonb_array_length(v_log.payload -> 'attachments') <> 2
  then
    raise exception using errcode = 'P0002', message = 'Confirmed benchmark delivery evidence was not found.';
  end if;

  select attachment into v_pdf
  from jsonb_array_elements(v_log.payload -> 'attachments') as attachment
  where attachment ->> 'content_type' = 'application/pdf';
  select attachment into v_csv
  from jsonb_array_elements(v_log.payload -> 'attachments') as attachment
  where attachment ->> 'content_type' = 'text/csv';

  if v_pdf is null or v_csv is null
  then
    raise exception using errcode = 'P0002', message = 'Confirmed benchmark delivery evidence was not found.';
  end if;

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'brand_id', p_brand_id,
    'cohort_id', v_aggregate.id,
    'report_id', (v_log.payload ->> 'benchmark_schedule_id')::uuid,
    'report_type', 'quarterly_benchmark',
    'source_window_start', v_log.payload ->> 'period_start',
    'source_window_end', v_log.payload ->> 'period_end',
    'benchmark_available', true,
    'benchmark_contribution_id', v_contribution.id,
    'benchmark_aggregate_id', v_aggregate.id,
    'benchmark_aggregate_sha256', encode(extensions.digest(convert_to(to_jsonb(v_aggregate)::text, 'UTF8'), 'sha256'), 'hex'),
    'persisted_report_content_sha256', encode(extensions.digest(convert_to(jsonb_build_object('subject', v_log.subject, 'html', v_log.body, 'text', v_log.payload ->> 'text_body')::text, 'UTF8'), 'sha256'), 'hex'),
    'attachment_count', 2,
    'pdf_attachment_sha256', encode(extensions.digest(decode(v_pdf ->> 'content_base64', 'base64'), 'sha256'), 'hex'),
    'csv_attachment_sha256', encode(extensions.digest(decode(v_csv ->> 'content_base64', 'base64'), 'sha256'), 'hex'),
    'email_log_id', v_log.id,
    'email_log_status', v_log.status,
    'delivery_event_id', v_event.id,
    'delivery_event_type', v_event.event_type,
    'provider_event_id', v_event.provider_event_id,
    'provider_message_id', v_log.resend_id,
    'delivered_at', v_event.occurred_at
  );
end;
$$;

revoke all on function public.get_due_benchmark_report_recipients(timestamptz) from public, anon, authenticated;
revoke all on function public.enqueue_benchmark_report_artifact(uuid, uuid, date, date, text, text, text, jsonb, text, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_benchmark_delivery_attestation(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_due_benchmark_report_recipients(timestamptz) to service_role;
grant execute on function public.enqueue_benchmark_report_artifact(uuid, uuid, date, date, text, text, text, jsonb, text, uuid, uuid, uuid) to service_role;
grant execute on function public.get_benchmark_delivery_attestation(uuid, uuid, uuid, uuid) to service_role;

commit;
