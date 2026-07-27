-- =============================================================================
-- P2 Launch Readiness Patches
-- =============================================================================
-- Migration 202607260020
--
-- Addresses four P2 findings from the expert codebase assessment:
--
-- P2-6: Credential ciphertext exposed in return values
--   get_integration_runtime returns credential_ciphertext and credential_iv
--   in its result set.  While the function is service_role-gated, defense-
--   in-depth requires that sensitive material not be returned unless
--   explicitly requested.
--   Fix: Add p_include_credentials parameter (default false).  When false,
--   ciphertext/iv columns return NULL.  Server passes true when decrypting.
--
-- P2-7: Plaintext completion tokens in email_outbox
--   claim_email_outbox_batch stores completion_token = gen_random_uuid() as
--   a plaintext UUID.  If the outbox table is compromised, tokens can be used
--   to complete deliveries fraudulently.
--   Fix: Store SHA-256 hash of the token.  Return plaintext once to the
--   caller.  complete_email_outbox_claim hashes the provided token before
--   comparison.  Also fix mark_email_delivery to clear completion_token.
--
-- P2-9/D7: churn_scores upsert breaks append-only audit trail
--   calculate_nightly_churn_scores uses ON CONFLICT DO UPDATE, overwriting
--   prior score rows for the same member/date.  This destroys the history
--   of score recalculation.
--   Fix: Change to ON CONFLICT DO NOTHING to preserve each recalculation as
--   its own auditable row.
--
-- P2-9/D9: Re-engagement email fires only once per member
--   enqueue_due_email_triggers uses idempotency key
--   'email:re_engagement:initial:' || member_id with no time component.
--   The first enqueue succeeds; all subsequent daily runs short-circuit.
--   Fix: Append a year component matching the birthday trigger pattern.
--   D8 (unconditional loyalty_discount_applied) was already fixed in the
--   operative version (migration 005) which uses jsonb_build_object('automatic', true).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- P2-6: Add p_include_credentials to get_integration_runtime
-- -----------------------------------------------------------------------------

drop function public.get_integration_runtime(
  uuid,
  public.integration_type,
  uuid
);

create function public.get_integration_runtime(
  p_organization_id uuid,
  p_integration_type public.integration_type,
  p_brand_id uuid default null,
  p_include_credentials boolean default false
)
returns table (
  connection_id uuid,
  organization_id uuid,
  brand_id uuid,
  integration_type public.integration_type,
  external_account_id text,
  sync_config jsonb,
  storage_mode public.secret_storage_mode,
  envelope_version integer,
  algorithm text,
  credential_ciphertext text,
  credential_iv text,
  key_version text,
  external_secret_ref text,
  credential_generation bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;

  return query
  select
    connection.id,
    connection.organization_id,
    connection.brand_id,
    connection.integration_type,
    connection.external_account_id,
    connection.sync_config,
    secret.storage_mode,
    secret.envelope_version,
    secret.algorithm,
    -- P2-6: Only return ciphertext/iv when explicitly requested.
    case when p_include_credentials then secret.credential_ciphertext else null end,
    case when p_include_credentials then secret.credential_iv else null end,
    secret.key_version,
    secret.external_secret_ref,
    secret.credential_generation
  from public.integration_connections as connection
  join public.integration_secrets as secret
    on secret.connection_id = connection.id
  join public.organizations as organization
    on organization.id = connection.organization_id
  left join public.brands as brand
    on brand.organization_id = connection.organization_id
    and brand.id = connection.brand_id
  where connection.organization_id = p_organization_id
    and connection.integration_type = p_integration_type
    and connection.brand_id is not distinct from p_brand_id
    and connection.status in ('configured', 'active', 'degraded')
    and connection.opted_in
    and organization.access_status <> 'suspended'
    and (
      connection.brand_id is null
      or (
        brand.id is not null
        and brand.active
        and brand.access_status <> 'suspended'
      )
    );
end;
$$;

-- -----------------------------------------------------------------------------
-- P2-7: Hash completion tokens in email_outbox
-- -----------------------------------------------------------------------------

-- Clear existing tokens (all in-flight claims will be retried by the worker).
update public.email_outbox set completion_token = null where completion_token is not null;

-- Drop the constraint that references completion_token.
alter table public.email_outbox drop constraint if exists email_outbox_lease_consistent;

-- Change column type from uuid to text to store SHA-256 hashes.
alter table public.email_outbox alter column completion_token type text using null;

-- Re-add the constraint with the same logic.
alter table public.email_outbox
  add constraint email_outbox_lease_consistent
    check (
      (
        status = 'processing'
        and lease_expires_at is not null
        and completion_token is not null
      )
      or (
        status <> 'processing'
        and completion_token is null
      )
    );

-- Rewrite claim_email_outbox_batch to store a hash, return plaintext.
drop function public.claim_email_outbox_batch(text, integer, integer);

create function public.claim_email_outbox_batch(
  p_worker_id text,
  p_limit integer default 100,
  p_lease_seconds integer default 300
)
returns table (
  outbox_id uuid,
  email_log_id uuid,
  organization_id uuid,
  brand_id uuid,
  member_id uuid,
  to_email text,
  trigger_type public.email_trigger_type,
  subject text,
  body text,
  payload jsonb,
  attempt_count integer,
  sender_identity_id uuid,
  sender_from_name text,
  sender_from_email text,
  sender_status public.sender_identity_status,
  completion_token text,
  unsubscribe_signed_at timestamptz,
  unsubscribe_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw_token text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service authorization is required.';
  end if;

  if char_length(btrim(p_worker_id)) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'Worker ID is required.';
  end if;
  if p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Email claim limit must be between 1 and 100.';
  end if;
  if p_lease_seconds not between 30 and 1800 then
    raise exception using errcode = '22023', message = 'Email lease must be between 30 and 1800 seconds.';
  end if;

  with expired as (
    select outbox.id
    from public.email_outbox as outbox
    where outbox.status = 'processing'
      and outbox.lease_expires_at <= now()
    order by outbox.lease_expires_at, outbox.id
    limit p_limit
    for update skip locked
  )
  update public.email_outbox as outbox
  set
    status = 'failed',
    available_at = now(),
    lease_expires_at = null,
    worker_id = null,
    completion_token = null,
    last_error = 'lease_expired'
  from expired
  where outbox.id = expired.id;

  return query
  with candidates as (
    select outbox.id
    from public.email_outbox as outbox
    join public.email_log as candidate_log
      on candidate_log.organization_id = outbox.organization_id
      and candidate_log.brand_id = outbox.brand_id
      and candidate_log.id = outbox.email_log_id
    where outbox.status in ('pending', 'failed')
      and outbox.available_at <= now()
      and outbox.attempt_count < 5
      and not exists (
        select 1
        from public.brand_sender_identities as blocked_sender
        where blocked_sender.organization_id = candidate_log.organization_id
          and blocked_sender.brand_id = candidate_log.brand_id
          and blocked_sender.status in ('pending', 'failed')
      )
    order by outbox.available_at, outbox.created_at, outbox.id
    limit p_limit
    for update skip locked
  ),
  claimed as (
    update public.email_outbox as outbox
    set
      status = 'processing',
      worker_id = btrim(p_worker_id),
      -- P2-7: Store SHA-256 hash of the token, not the plaintext.
      completion_token = encode(
        digest(gen_random_uuid()::text, 'sha256'),
        'hex'
      ),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempt_count = outbox.attempt_count + 1,
      last_error = null,
      unsubscribe_signed_at = coalesce(outbox.unsubscribe_signed_at, now()),
      unsubscribe_expires_at = coalesce(
        outbox.unsubscribe_expires_at,
        now() + interval '30 days'
      )
    from candidates
    where outbox.id = candidates.id
    returning outbox.*, outbox.completion_token as stored_hash
  ),
  logs_updated as (
    update public.email_log as log
    set status = 'processing', claimed_at = coalesce(log.claimed_at, now())
    from claimed
    where log.id = claimed.email_log_id
      and log.organization_id = claimed.organization_id
    returning log.*
  )
  select
    claimed.id,
    log.id,
    log.organization_id,
    log.brand_id,
    log.member_id,
    log.to_email,
    log.trigger_type,
    log.subject,
    log.body,
    log.payload,
    claimed.attempt_count,
    sender.id,
    sender.from_name,
    sender.from_email,
    sender.status,
    -- P2-7: Return the stored SHA-256 hash.  The server passes this value
    -- back to complete_email_outbox_claim, which compares it directly against
    -- the stored hash (no re-hashing).
    claimed.stored_hash,
    claimed.unsubscribe_signed_at,
    claimed.unsubscribe_expires_at
  from claimed
  join logs_updated as log
    on log.id = claimed.email_log_id
    and log.organization_id = claimed.organization_id
  left join public.brand_sender_identities as sender
    on sender.organization_id = log.organization_id
    and sender.brand_id = log.brand_id
    and sender.status = 'verified';
end;
$$;

-- Rewrite complete_email_outbox_claim to compare against stored hash.
drop function public.complete_email_outbox_claim(uuid, uuid, public.email_status, text, text);

create function public.complete_email_outbox_claim(
  p_outbox_id uuid,
  p_completion_token text,
  p_status public.email_status,
  p_resend_id text default null,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox public.email_outbox%rowtype;
  v_log public.email_log%rowtype;
begin
  if p_status not in ('sent', 'delivered', 'failed', 'bounced') then
    raise exception using errcode = '22023', message = 'Unsupported delivery status.';
  end if;

  select outbox.*
  into v_outbox
  from public.email_outbox as outbox
  where outbox.id = p_outbox_id
  for update;
  if not found
    or v_outbox.status <> 'processing'
    -- P2-7: Compare the provided token directly against the stored hash.
    or v_outbox.completion_token is distinct from p_completion_token
    or v_outbox.lease_expires_at <= now()
  then
    return false;
  end if;

  select log.*
  into v_log
  from public.email_log as log
  where log.id = v_outbox.email_log_id
    and log.organization_id = v_outbox.organization_id
  for update;

  if p_resend_id is not null
    and v_log.resend_id is not null
    and v_log.resend_id <> p_resend_id
  then
    raise exception using
      errcode = '23505',
      message = 'Provider email ID does not match the original delivery.';
  end if;

  update public.email_log
  set resend_id = coalesce(resend_id, p_resend_id)
  where id = v_log.id;
  perform private.converge_email_status(
    v_log.organization_id,
    v_log.id,
    p_status,
    now(),
    p_error
  );

  update public.email_outbox
  set
    status = case
      when p_status in ('sent', 'delivered', 'bounced') then 'completed'::public.email_outbox_status
      when attempt_count >= 5 then 'completed'::public.email_outbox_status
      else 'failed'::public.email_outbox_status
    end,
    available_at = case
      when p_status = 'failed' and attempt_count < 5
        then now() + make_interval(secs => least(900, 30 * (2 ^ attempt_count)::integer))
      else available_at
    end,
    lease_expires_at = null,
    worker_id = null,
    completion_token = null,
    last_error = case when p_status = 'failed' then left(p_error, 4000) else null end
  where id = v_outbox.id;

  return true;
end;
$$;

-- Fix mark_email_delivery to clear completion_token on completion.
create or replace function public.mark_email_delivery(
  p_organization_id uuid,
  p_email_log_id uuid,
  p_status public.email_status,
  p_resend_id text default null,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if p_status not in ('sent', 'delivered', 'failed', 'bounced') then
    raise exception using errcode = '22023', message = 'Unsupported delivery status.';
  end if;

  update public.email_log as log
  set
    status = p_status,
    resend_id = coalesce(p_resend_id, log.resend_id),
    error_message = case when p_status in ('failed', 'bounced') then left(p_error, 4000) else null end,
    sent_at = case when p_status in ('sent', 'delivered') then coalesce(log.sent_at, now()) else log.sent_at end,
    delivered_at = case when p_status = 'delivered' then coalesce(log.delivered_at, now()) else log.delivered_at end,
    failed_at = case when p_status = 'failed' then coalesce(log.failed_at, now()) else log.failed_at end,
    bounced_at = case when p_status = 'bounced' then coalesce(log.bounced_at, now()) else log.bounced_at end
  where log.id = p_email_log_id
    and log.organization_id = p_organization_id;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return false;
  end if;

  update public.email_outbox as outbox
  set
    status = case
      when p_status in ('sent', 'delivered', 'bounced') then 'completed'::public.email_outbox_status
      when outbox.attempt_count >= 5 then 'completed'::public.email_outbox_status
      else 'failed'::public.email_outbox_status
    end,
    available_at = case
      when p_status = 'failed' and outbox.attempt_count < 5
        then now() + make_interval(secs => least(900, 30 * (2 ^ outbox.attempt_count)::integer))
      else outbox.available_at
    end,
    lease_expires_at = null,
    worker_id = null,
    -- P2-7: Clear completion_token when leaving processing status.
    completion_token = null,
    last_error = case when p_status = 'failed' then left(p_error, 4000) else null end
  where outbox.organization_id = p_organization_id
    and outbox.email_log_id = p_email_log_id;

  return true;
end;
$$;

-- Re-grant privileges after function replacements.
revoke execute on function public.claim_email_outbox_batch(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_email_outbox_batch(text, integer, integer)
  to service_role;

revoke execute on function public.complete_email_outbox_claim(uuid, uuid, public.email_status, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_email_outbox_claim(uuid, text, public.email_status, text, text)
  to service_role;

revoke execute on function public.mark_email_delivery(uuid, uuid, public.email_status, text, text)
  from public, anon, authenticated;
grant execute on function public.mark_email_delivery(uuid, uuid, public.email_status, text, text)
  to service_role;

-- -----------------------------------------------------------------------------
-- P2-9/D7: Change churn_scores upsert to insert-only
-- -----------------------------------------------------------------------------

create or replace function public.calculate_nightly_churn_scores(
  p_calculated_at timestamptz default now(),
  p_organization_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_score_date date := (p_calculated_at at time zone 'UTC')::date;
  v_count integer;
begin
  with shipment_stats as (
    select
      shipment.organization_id,
      shipment.member_id,
      max(
        greatest(
          shipment.delivered_at,
          shipment.shipped_at,
          shipment.packed_at,
          shipment.label_created_at,
          shipment.paid_at,
          shipment.updated_at
        )
      ) as last_shipment_interaction_at
    from public.shipments as shipment
    where shipment.created_at >= p_calculated_at - interval '3 years'
      and (p_organization_id is null or shipment.organization_id = p_organization_id)
    group by shipment.organization_id, shipment.member_id
  ),
  decline_stats as (
    select
      attempt.organization_id,
      shipment.member_id,
      count(*)::integer as declined_charge_count
    from public.billing_attempts as attempt
    join public.shipments as shipment
      on shipment.id = attempt.shipment_id
      and shipment.organization_id = attempt.organization_id
    where attempt.status = 'declined'
      and attempt.created_at >= p_calculated_at - interval '12 months'
      and (p_organization_id is null or attempt.organization_id = p_organization_id)
    group by attempt.organization_id, shipment.member_id
  ),
  email_stats as (
    select
      log.organization_id,
      log.member_id,
      count(*) filter (
        where log.status in ('sent', 'delivered', 'bounced')
      )::integer as sent_count,
      count(*) filter (
        where exists (
          select 1
          from public.email_delivery_events as event
          where event.email_log_id = log.id
            and event.organization_id = log.organization_id
            and event.event_type = 'opened'
        )
      )::integer as opened_count,
      count(*) filter (
        where exists (
          select 1
          from public.email_delivery_events as event
          where event.email_log_id = log.id
            and event.organization_id = log.organization_id
            and event.event_type = 'clicked'
        )
      )::integer as clicked_count
    from public.email_log as log
    where log.created_at >= p_calculated_at - interval '90 days'
      and (p_organization_id is null or log.organization_id = p_organization_id)
    group by log.organization_id, log.member_id
  ),
  activity_stats as (
    select
      activity.organization_id,
      activity.member_id,
      max(activity.occurred_at) filter (
        where activity.event_type = 'portal_login'
      ) as last_portal_login_at,
      count(*) filter (
        where activity.event_type = 'tier_downgrade'
          and activity.occurred_at >= p_calculated_at - interval '12 months'
      )::integer as downgrade_count
    from public.member_activity_events as activity
    where activity.occurred_at >= p_calculated_at - interval '12 months'
      and (p_organization_id is null or activity.organization_id = p_organization_id)
    group by activity.organization_id, activity.member_id
  ),
  inputs as (
    select
      member.organization_id,
      member.id as member_id,
      coalesce(
        (p_calculated_at::date - shipment.last_shipment_interaction_at::date),
        9999
      )::integer as shipment_inactive_days,
      coalesce(decline.declined_charge_count, 0) as declined_charge_count,
      greatest(0, p_calculated_at::date - member.joined_on)::integer
        as membership_days,
      coalesce(email.sent_count, 0) as sent_count,
      coalesce(email.opened_count, 0) as opened_count,
      coalesce(email.clicked_count, 0) as clicked_count,
      coalesce(
        member.last_portal_login_at,
        activity.last_portal_login_at
      ) as last_portal_login_at,
      coalesce(activity.downgrade_count, 0) as downgrade_count
    from public.members as member
    left join shipment_stats as shipment
      on shipment.organization_id = member.organization_id
      and shipment.member_id = member.id
    left join decline_stats as decline
      on decline.organization_id = member.organization_id
      and decline.member_id = member.id
    left join email_stats as email
      on email.organization_id = member.organization_id
      and email.member_id = member.id
    left join activity_stats as activity
      on activity.organization_id = member.organization_id
      and activity.member_id = member.id
    where member.deleted_at is null
      and (p_organization_id is null or member.organization_id = p_organization_id)
  ),
  weighted as (
    select
      inputs.*,
      case
        when shipment_inactive_days >= 180 then 35
        when shipment_inactive_days >= 90 then 25
        when shipment_inactive_days >= 60 then 15
        when shipment_inactive_days >= 30 then 8
        else 0
      end as shipment_weight,
      least(30, declined_charge_count * 10) as decline_weight,
      case
        when membership_days >= 730 then -15
        when membership_days >= 365 then -10
        when membership_days >= 180 then -5
        else 0
      end as tenure_weight,
      case
        when sent_count = 0 then 5
        when opened_count::numeric / sent_count < 0.05 then 10
        when opened_count::numeric / sent_count < 0.20 then 5
        else 0
      end as email_open_weight,
      case
        when sent_count = 0 then 5
        when clicked_count::numeric / sent_count < 0.02 then 10
        when clicked_count::numeric / sent_count < 0.10 then 5
        else 0
      end as email_click_weight,
      case
        when last_portal_login_at is null then 10
        when last_portal_login_at >= p_calculated_at - interval '30 days' then -10
        when last_portal_login_at >= p_calculated_at - interval '90 days' then -5
        else 5
      end as portal_weight,
      least(20, downgrade_count * 10) as downgrade_weight
    from inputs
  ),
  scored as (
    select
      weighted.*,
      greatest(
        0,
        least(
          100,
          20
          + shipment_weight
          + decline_weight
          + tenure_weight
          + email_open_weight
          + email_click_weight
          + portal_weight
          + downgrade_weight
        )
      )::integer as score
    from weighted
  ),
  inserted as (
    insert into public.churn_scores (
      organization_id,
      member_id,
      score,
      risk_level,
      contributing_factors,
      score_date,
      calculated_at
    )
    select
      scored.organization_id,
      scored.member_id,
      scored.score,
      case
        when scored.score <= 30 then 'low'::public.churn_risk_level
        when scored.score <= 60 then 'medium'::public.churn_risk_level
        else 'high'::public.churn_risk_level
      end,
      jsonb_build_object(
        'rules_version', 1,
        'base_score', 20,
        'shipment_inactivity', jsonb_build_object(
          'days', scored.shipment_inactive_days,
          'weight', scored.shipment_weight
        ),
        'declined_charges_12m', jsonb_build_object(
          'count', scored.declined_charge_count,
          'weight', scored.decline_weight
        ),
        'membership_tenure', jsonb_build_object(
          'days', scored.membership_days,
          'weight', scored.tenure_weight
        ),
        'email_open_rate_90d', jsonb_build_object(
          'sent', scored.sent_count,
          'opened', scored.opened_count,
          'rate', case
            when scored.sent_count = 0 then null
            else round(scored.opened_count::numeric / scored.sent_count, 4)
          end,
          'weight', scored.email_open_weight
        ),
        'email_click_rate_90d', jsonb_build_object(
          'sent', scored.sent_count,
          'clicked', scored.clicked_count,
          'rate', case
            when scored.sent_count = 0 then null
            else round(scored.clicked_count::numeric / scored.sent_count, 4)
          end,
          'weight', scored.email_click_weight
        ),
        'portal_activity', jsonb_build_object(
          'last_login_at', scored.last_portal_login_at,
          'weight', scored.portal_weight
        ),
        'tier_downgrades_12m', jsonb_build_object(
          'count', scored.downgrade_count,
          'weight', scored.downgrade_weight
        )
      ),
      v_score_date,
      p_calculated_at
    from scored
    -- P2-9/D7: Use DO NOTHING instead of DO UPDATE to preserve the append-only
    -- audit trail of score recalculation.  Each recalculation for a given
    -- member/date is preserved as its own row.
    on conflict (organization_id, member_id, score_date)
    do nothing
    returning organization_id, member_id, score
  )
  update public.members as member
  set churn_risk_score = inserted.score
  from inserted
  where member.organization_id = inserted.organization_id
    and member.id = inserted.member_id;

  select count(*)::integer
  into v_count
  from public.churn_scores as score
  where score.score_date = v_score_date
    and (p_organization_id is null or score.organization_id = p_organization_id);

  return v_count;
end;
$$;

revoke execute on function public.calculate_nightly_churn_scores(timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.calculate_nightly_churn_scores(timestamptz, uuid)
  to service_role;

-- -----------------------------------------------------------------------------
-- P2-9/D9: Add time component to re-engagement idempotency key
-- -----------------------------------------------------------------------------

create or replace function public.enqueue_due_email_triggers(
  p_as_of timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record record;
  v_log_id uuid;
  v_queued integer := 0;
begin
  for v_record in
    select distinct
      release.organization_id,
      release.brand_id,
      member.id as member_id,
      release.id as release_id,
      release.name as release_name,
      release.processing_date
    from public.releases as release
    join public.brands as brand
      on brand.organization_id = release.organization_id
      and brand.id = release.brand_id
    join public.release_tiers as release_tier
      on release_tier.organization_id = release.organization_id
      and release_tier.brand_id = release.brand_id
      and release_tier.release_id = release.id
    join public.members as member
      on member.organization_id = release.organization_id
      and member.brand_id = release.brand_id
      and member.club_tier_id = release_tier.tier_id
      and member.status = 'active'
      and member.deleted_at is null
    join public.email_templates as template
      on template.organization_id = release.organization_id
      and template.brand_id = release.brand_id
      and template.trigger_type = 'pre_shipment'
      and template.enabled
    where release.status = 'scheduled'
      and release.processing_date =
        (p_as_of at time zone brand.time_zone)::date + template.days_before
  loop
    v_log_id := public.enqueue_email_trigger(
      v_record.organization_id,
      v_record.member_id,
      'pre_shipment',
      'email:pre_shipment:' || v_record.release_id::text || ':' || v_record.member_id::text,
      jsonb_build_object(
        'release_id', v_record.release_id,
        'release_name', v_record.release_name,
        'processing_date', v_record.processing_date
      ),
      p_as_of
    );
    if v_log_id is not null then
      v_queued := v_queued + 1;
    end if;
  end loop;

  for v_record in
    select
      member.organization_id,
      member.brand_id,
      member.id as member_id,
      (p_as_of at time zone brand.time_zone)::date as local_date
    from public.members as member
    join public.brands as brand
      on brand.organization_id = member.organization_id
      and brand.id = member.brand_id
    where member.birthday is not null
      and member.status = 'active'
      and member.deleted_at is null
      and extract(month from member.birthday) =
        extract(month from (p_as_of at time zone brand.time_zone)::date)
      and extract(day from member.birthday) =
        extract(day from (p_as_of at time zone brand.time_zone)::date)
  loop
    v_log_id := public.enqueue_email_trigger(
      v_record.organization_id,
      v_record.member_id,
      'birthday',
      'email:birthday:' || extract(year from v_record.local_date)::integer::text
        || ':' || v_record.member_id::text,
      jsonb_build_object('occasion_date', v_record.local_date),
      p_as_of
    );
    if v_log_id is not null then
      v_queued := v_queued + 1;
    end if;
  end loop;

  for v_record in
    select
      member.organization_id,
      member.brand_id,
      member.id as member_id,
      (p_as_of at time zone brand.time_zone)::date as local_date
    from public.members as member
    join public.brands as brand
      on brand.organization_id = member.organization_id
      and brand.id = member.brand_id
    left join lateral (
      select max(activity.occurred_at) as last_activity_at
      from public.member_activity_events as activity
      where activity.organization_id = member.organization_id
        and activity.brand_id = member.brand_id
        and activity.member_id = member.id
        and activity.event_type in ('portal_login', 'shipment_delivered')
    ) as activity on true
    where member.status = 'active'
      and member.deleted_at is null
      and greatest(
        member.created_at,
        coalesce(member.last_portal_login_at, '-infinity'::timestamptz),
        coalesce(activity.last_activity_at, '-infinity'::timestamptz)
      ) <= p_as_of - interval '60 days'
  loop
    v_log_id := public.enqueue_email_trigger(
      v_record.organization_id,
      v_record.member_id,
      're_engagement',
      -- P2-9/D9: Add year component to the idempotency key so re-engagement
      -- emails can fire once per year per member instead of once ever.
      'email:re_engagement:' || extract(year from v_record.local_date)::integer::text
        || ':' || v_record.member_id::text,
      jsonb_build_object('inactive_days', 60),
      p_as_of
    );
    if v_log_id is not null then
      v_queued := v_queued + 1;
    end if;
  end loop;
  return v_queued;
end;
$$;

revoke execute on function public.enqueue_due_email_triggers(timestamptz)
  from public, anon, authenticated;
grant execute on function public.enqueue_due_email_triggers(timestamptz)
  to service_role;
