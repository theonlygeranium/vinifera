-- =============================================================================
-- P0 Security & Data-Integrity Patches
-- =============================================================================
-- Migration 202607260018
--
-- Addresses three P0 findings from the expert codebase assessment:
--
-- P0-3: enqueue_email_trigger — missing authorization check
--   The SECURITY DEFINER function accepted p_organization_id as a parameter
--   but never verified the calling JWT's organization matched. Any authenticated
--   user could enqueue email triggers for arbitrary organizations.
--   Fix: Add auth.org_id() validation, with service_role bypass for internal
--   server-side calls.
--
-- P0-4: claim_email_outbox_batch — missing service_role guard
--   The SECURITY DEFINER function was callable by any authenticated user, not
--   just the backend worker using the service_role key. A malicious user could
--   claim and read email outbox batches belonging to other organizations.
--   Fix: Require service_role JWT context.
--
-- P0-7: record_cancel_flow_step — wine swap doesn't update price_cents
--   The swap operation updated release_wine_id, wine_name, vintage, and sku on
--   shipment_items but omitted price_cents. The swapped-in wine retained the
--   original wine's price, causing billing discrepancies.
--   Fix: Look up the target wine's unit_price_cents from release_tier_items for
--   the shipment's release_tier_id and update price_cents accordingly.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- P0-3: enqueue_email_trigger — add organization authorization check
-- -----------------------------------------------------------------------------

create or replace function public.enqueue_email_trigger(
  p_organization_id uuid,
  p_member_id uuid,
  p_trigger_type public.email_trigger_type,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb,
  p_scheduled_for timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.email_log%rowtype;
  v_log_id uuid;
  v_member public.members%rowtype;
  v_template public.email_templates%rowtype;
  v_organization_name text;
  v_fingerprint text;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Email payload must be an object.';
  end if;

  -- P0-3: Authorization check.  Verify the calling JWT belongs to the same
  -- organization as p_organization_id.  service_role (backend server-side calls)
  -- is exempt since it operates outside a user session.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
    and auth.org_id() is distinct from p_organization_id
  then
    raise exception using errcode = '42501', message = 'Organization authorization mismatch.';
  end if;

  select member.*
  into v_member
  from public.members as member
  where member.id = p_member_id
    and member.organization_id = p_organization_id
    and member.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'Member not found.';
  end if;

  v_fingerprint := private.retention_request_fingerprint(
    jsonb_build_object(
      'organization_id', p_organization_id,
      'brand_id', v_member.brand_id,
      'member_id', p_member_id,
      'trigger_type', p_trigger_type,
      'payload', p_payload
    )
  );

  select log.*
  into v_existing
  from public.email_log as log
  where log.organization_id = p_organization_id
    and log.brand_id = v_member.brand_id
    and log.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint_sha256 is distinct from v_fingerprint then
      raise exception using
        errcode = '23505',
        message = 'Email idempotency key was already used for a different request.';
    end if;
    return v_existing.id;
  end if;

  if not v_member.transactional_email_enabled or exists (
    select 1
    from public.member_email_preferences as preference
    where preference.organization_id = p_organization_id
      and preference.brand_id = v_member.brand_id
      and preference.member_id = p_member_id
      and preference.trigger_type = p_trigger_type
      and not preference.enabled
  ) then
    return null;
  end if;

  select template.*
  into v_template
  from public.email_templates as template
  where template.organization_id = p_organization_id
    and template.brand_id = v_member.brand_id
    and template.trigger_type = p_trigger_type
    and template.enabled;
  if not found then
    return null;
  end if;

  select organization.name
  into v_organization_name
  from public.organizations as organization
  where organization.id = p_organization_id;

  insert into public.email_log (
    organization_id,
    brand_id,
    member_id,
    template_id,
    trigger_type,
    idempotency_key,
    request_fingerprint_sha256,
    to_email,
    subject,
    body,
    payload,
    scheduled_for
  )
  values (
    p_organization_id,
    v_member.brand_id,
    p_member_id,
    v_template.id,
    p_trigger_type,
    p_idempotency_key,
    v_fingerprint,
    v_member.email,
    v_template.subject,
    v_template.body,
    p_payload || jsonb_build_object(
      'organization_name', v_organization_name,
      'member_first_name', v_member.first_name,
      'member_last_name', v_member.last_name,
      'member_email', v_member.email
    ),
    p_scheduled_for
  )
  returning id into v_log_id;

  insert into public.email_outbox (
    organization_id,
    brand_id,
    email_log_id,
    available_at
  )
  values (p_organization_id, v_member.brand_id, v_log_id, p_scheduled_for);
  return v_log_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- P0-4: claim_email_outbox_batch — add service_role guard
-- -----------------------------------------------------------------------------

create or replace function public.claim_email_outbox_batch(
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
  completion_token uuid,
  unsubscribe_signed_at timestamptz,
  unsubscribe_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- P0-4: Service-role guard.  Only the backend email worker (which uses the
  -- service_role key) may claim outbox batches.  Without this check any
  -- authenticated user could claim and read email payloads across all
  -- organizations.
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
      -- An explicitly configured but unverified sender is activation-blocked,
      -- not a delivery failure. Leave its outbox row untouched so activation
      -- cannot burn retries before provider credentials are connected.
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
      completion_token = gen_random_uuid(),
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
    returning outbox.*
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
    claimed.completion_token,
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

-- -----------------------------------------------------------------------------
-- P0-7: record_cancel_flow_step — update price_cents on wine swap
-- -----------------------------------------------------------------------------

create or replace function public.record_cancel_flow_step(
  p_organization_id uuid,
  p_brand_id uuid,
  p_attempt_id uuid,
  p_step_id uuid,
  p_outcome public.cancel_flow_outcome,
  p_details jsonb,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_request_fingerprint_sha256 text
)
returns public.cancel_flow_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_attempt public.cancel_flow_attempts%rowtype;
  v_step record;
  v_replay jsonb;
  v_next_step_id uuid;
  v_pause_months integer;
  v_target_tier_id uuid;
  v_current_price integer;
  v_target_price integer;
  v_final_status public.cancel_attempt_status;
  v_shipment_id uuid;
  v_shipment_item_id uuid;
  v_target_release_wine_id uuid;
  v_source_release_wine_id uuid;
  v_swap_quantity integer;
  v_swap_price_cents integer;
begin
  if jsonb_typeof(p_details) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Cancel event details must be an object.';
  end if;

  select attempt.*
  into v_attempt
  from public.cancel_flow_attempts as attempt
  where attempt.organization_id = p_organization_id
    and attempt.brand_id = p_brand_id
    and attempt.id = p_attempt_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Cancel attempt not found.';
  end if;

  -- Authorization intentionally precedes terminal replay handling.
  select *
  into v_actor
  from private.resolve_retention_actor_brand(
    p_organization_id,
    p_brand_id,
    v_attempt.member_id,
    p_actor_user_id
  );

  v_replay := private.load_retention_command(
    p_organization_id,
    p_brand_id,
    p_command_id,
    'cancel.record_step',
    p_request_fingerprint_sha256
  );
  if v_replay is not null then
    return v_attempt;
  end if;
  if v_attempt.status <> 'in_progress' then
    raise exception using errcode = '23505', message = 'Cancel attempt is already complete.';
  end if;
  if v_attempt.expires_at <= now() then
    update public.cancel_flow_attempts
    set
      status = 'abandoned',
      accepted_outcome = 'abandoned',
      completed_at = now()
    where id = v_attempt.id
    returning * into v_attempt;
    perform private.store_retention_command(
      p_organization_id,
      p_brand_id,
      p_command_id,
      'cancel.record_step',
      p_request_fingerprint_sha256,
      'cancel_flow_attempt',
      v_attempt.id,
      jsonb_build_object('attemptId', v_attempt.id, 'expired', true)
    );
    return v_attempt;
  end if;

  select snapshot.*
  into v_step
  from jsonb_to_recordset(v_attempt.configuration_snapshot) as snapshot(
    id uuid,
    step_type public.cancel_step_type,
    position integer,
    enabled boolean,
    headline text,
    body text,
    configuration jsonb
  )
  where snapshot.id = p_step_id;
  if not found
    or v_attempt.current_step_id <> p_step_id
    or not v_step.enabled
  then
    raise exception using errcode = '22023', message = 'Cancel step is not current.';
  end if;

  if p_outcome = 'continued' then
    select snapshot.id
    into v_next_step_id
    from jsonb_to_recordset(v_attempt.configuration_snapshot) as snapshot(
      id uuid,
      position integer,
      enabled boolean
    )
    where snapshot.enabled
      and snapshot.position > v_step.position
    order by snapshot.position
    limit 1;
    if v_next_step_id is null then
      raise exception using errcode = '22023', message = 'Final confirmation requires a cancellation decision.';
    end if;
  elsif p_outcome = 'paused' then
    if v_step.step_type <> 'pause' then
      raise exception using errcode = '22023', message = 'Pause outcome is only valid on the pause step.';
    end if;
    v_pause_months := nullif(p_details ->> 'pause_months', '')::integer;
    if v_pause_months not in (1, 3) then
      raise exception using errcode = '22023', message = 'Pause duration must be one or three months.';
    end if;
    update public.members as member
    set
      status = 'paused',
      paused_until = (
        (now() at time zone brand.time_zone)::date
        + make_interval(months => v_pause_months)
      )::date
    from public.brands as brand
    where member.id = v_attempt.member_id
      and member.organization_id = p_organization_id
      and member.brand_id = p_brand_id
      and brand.organization_id = member.organization_id
      and brand.id = member.brand_id;
    v_final_status := 'intercepted';
  elsif p_outcome = 'downgraded' then
    if v_step.step_type <> 'downgrade' then
      raise exception using errcode = '22023', message = 'Downgrade outcome is only valid on the downgrade step.';
    end if;
    if coalesce(p_details ->> 'target_tier_id', '') !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    then
      raise exception using errcode = '22023', message = 'A valid target tier is required.';
    end if;
    v_target_tier_id := (p_details ->> 'target_tier_id')::uuid;
    select current_tier.price_cents, target_tier.price_cents
    into v_current_price, v_target_price
    from public.members as member
    join public.club_tiers as current_tier
      on current_tier.organization_id = member.organization_id
      and current_tier.brand_id = member.brand_id
      and current_tier.id = member.club_tier_id
    join public.club_tiers as target_tier
      on target_tier.organization_id = member.organization_id
      and target_tier.brand_id = member.brand_id
      and target_tier.id = v_target_tier_id
      and target_tier.active
    where member.organization_id = p_organization_id
      and member.brand_id = p_brand_id
      and member.id = v_attempt.member_id;
    if not found or v_target_price >= v_current_price then
      raise exception using errcode = '22023', message = 'Target tier must be active and lower priced.';
    end if;
    update public.members
    set club_tier_id = v_target_tier_id
    where organization_id = p_organization_id
      and brand_id = p_brand_id
      and id = v_attempt.member_id;
    v_final_status := 'intercepted';
  elsif p_outcome = 'swapped' then
    if v_step.step_type <> 'swap' then
      raise exception using errcode = '22023', message = 'Swap outcome is only valid on the swap step.';
    end if;
    if coalesce(p_details ->> 'shipment_id', '') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or coalesce(p_details ->> 'shipment_item_id', '') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      or coalesce(p_details ->> 'target_release_wine_id', '') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    then
      raise exception using errcode = '22023', message = 'Shipment, item, and target wine IDs are required.';
    end if;
    v_shipment_id := (p_details ->> 'shipment_id')::uuid;
    v_shipment_item_id := (p_details ->> 'shipment_item_id')::uuid;
    v_target_release_wine_id := (p_details ->> 'target_release_wine_id')::uuid;

    select item.release_wine_id, item.quantity, item.price_cents
    into v_source_release_wine_id, v_swap_quantity, v_swap_price_cents
    from public.shipments as shipment
    join public.shipment_items as item
      on item.organization_id = shipment.organization_id
      and item.brand_id = shipment.brand_id
      and item.shipment_id = shipment.id
    join public.release_wines as target_wine
      on target_wine.organization_id = shipment.organization_id
      and target_wine.brand_id = shipment.brand_id
      and target_wine.release_id = shipment.release_id
      and target_wine.id = v_target_release_wine_id
    where shipment.organization_id = p_organization_id
      and shipment.brand_id = p_brand_id
      and shipment.id = v_shipment_id
      and shipment.member_id = v_attempt.member_id
      and shipment.status in ('pending', 'charged')
      and shipment.packed_at is null
      and item.id = v_shipment_item_id
      and item.packed_quantity = 0
      and item.release_wine_id is distinct from v_target_release_wine_id
      and not exists (
        select 1
        from public.shipment_items as existing_item
        where existing_item.organization_id = shipment.organization_id
          and existing_item.brand_id = shipment.brand_id
          and existing_item.shipment_id = shipment.id
          and existing_item.release_wine_id = v_target_release_wine_id
      )
    for update of shipment, item;
    if not found then
      raise exception using errcode = '22023', message = 'Shipment swap target is not eligible.';
    end if;

    -- P0-7: Update price_cents to the target wine's unit price for this
    -- shipment's release tier.  The previous implementation set release_wine_id,
    -- wine_name, vintage, and sku but left price_cents at the source wine's
    -- price, causing billing discrepancies on swapped shipments.
    update public.shipment_items as item
    set
      release_wine_id = target_wine.id,
      wine_name = target_wine.wine_name,
      vintage = target_wine.vintage,
      sku = target_wine.sku,
      price_cents = coalesce(tier_item.unit_price_cents, item.price_cents)
    from public.release_wines as target_wine
    left join public.release_tier_items as tier_item
      on tier_item.organization_id = p_organization_id
      and tier_item.release_wine_id = target_wine.id
      and tier_item.release_tier_id = (
        select s.release_tier_id
        from public.shipments as s
        where s.organization_id = p_organization_id
          and s.id = v_shipment_id
      )
    where item.organization_id = p_organization_id
      and item.brand_id = p_brand_id
      and item.id = v_shipment_item_id
      and target_wine.organization_id = item.organization_id
      and target_wine.brand_id = item.brand_id
      and target_wine.id = v_target_release_wine_id;
    p_details := p_details || jsonb_build_object(
      'source_release_wine_id', v_source_release_wine_id,
      'preserved_quantity', v_swap_quantity,
      'preserved_price_cents', v_swap_price_cents
    );
    v_final_status := 'intercepted';
  elsif p_outcome = 'cancelled' then
    if v_step.step_type <> 'confirm' then
      raise exception using errcode = '22023', message = 'Cancellation is only valid on the confirmation step.';
    end if;
    update public.members
    set status = 'cancelled', paused_until = null
    where organization_id = p_organization_id
      and brand_id = p_brand_id
      and id = v_attempt.member_id;
    v_final_status := 'cancelled';
  elsif p_outcome = 'abandoned' then
    v_final_status := 'abandoned';
  elsif p_outcome <> 'viewed' then
    raise exception using errcode = '22023', message = 'Outcome cannot complete this cancel step.';
  end if;

  insert into public.cancel_flow_events (
    organization_id,
    brand_id,
    member_id,
    attempt_id,
    step_id,
    step_position,
    outcome,
    actor_user_id,
    actor_type,
    details
  )
  values (
    p_organization_id,
    p_brand_id,
    v_attempt.member_id,
    v_attempt.id,
    p_step_id,
    v_step.position,
    p_outcome,
    v_actor.actor_user_id,
    v_actor.actor_type,
    p_details
  );

  if p_outcome = 'continued' then
    update public.cancel_flow_attempts
    set current_step_id = v_next_step_id
    where id = v_attempt.id
    returning * into v_attempt;
  elsif p_outcome not in ('viewed', 'continued') then
    update public.cancel_flow_attempts
    set
      status = v_final_status,
      accepted_outcome = p_outcome,
      completed_at = now()
    where id = v_attempt.id
    returning * into v_attempt;

    perform public.append_audit_entry(
      p_organization_id,
      p_brand_id,
      v_actor.actor_user_id,
      'cancel_flow.' || p_outcome::text,
      'cancel_flow_attempt',
      v_attempt.id,
      jsonb_build_object(
        'member_id', v_attempt.member_id,
        'step_type', v_step.step_type,
        'details', p_details
      )
    );
  end if;

  perform private.store_retention_command(
    p_organization_id,
    p_brand_id,
    p_command_id,
    'cancel.record_step',
    p_request_fingerprint_sha256,
    'cancel_flow_attempt',
    v_attempt.id,
    jsonb_build_object('attemptId', v_attempt.id)
  );
  return v_attempt;
end;
$$;

-- Re-grant privileges after function replacements.

revoke execute on function public.enqueue_email_trigger(
  uuid, uuid, public.email_trigger_type, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.enqueue_email_trigger(
  uuid, uuid, public.email_trigger_type, text, jsonb, timestamptz
) to service_role;

revoke execute on function public.claim_email_outbox_batch(
  text, integer, integer
) from public, anon, authenticated;
grant execute on function public.claim_email_outbox_batch(
  text, integer, integer
) to service_role;

revoke execute on function public.record_cancel_flow_step(
  uuid, uuid, uuid, uuid, public.cancel_flow_outcome, jsonb, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.record_cancel_flow_step(
  uuid, uuid, uuid, uuid, public.cancel_flow_outcome, jsonb, uuid, uuid, text
) to service_role;
