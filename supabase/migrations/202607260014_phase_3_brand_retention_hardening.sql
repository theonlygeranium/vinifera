begin;

-- Phase 3 remains provider-neutral: this migration hardens the durable
-- contracts that adapters consume when credentials are activated later.

alter table public.brands
  add column time_zone text not null default 'UTC';

create or replace function private.validate_brand_time_zone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform now() at time zone new.time_zone;
  return new;
exception when invalid_parameter_value then
  raise exception using errcode = '22023', message = 'Brand time zone is invalid.';
end;
$$;

create trigger brands_validate_time_zone
before insert or update of time_zone on public.brands
for each row execute function private.validate_brand_time_zone();

alter table public.email_log
  add column request_fingerprint_sha256 text,
  add column provider_status_at timestamptz,
  add constraint email_log_request_fingerprint_format
    check (
      request_fingerprint_sha256 is null
      or request_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
    );

alter table public.email_outbox
  drop constraint email_outbox_lease_consistent,
  add column completion_token uuid,
  add column unsubscribe_signed_at timestamptz,
  add column unsubscribe_expires_at timestamptz;

-- Migration 011 leases have no completion token. Requeue every in-flight row
-- before validating the stronger lease invariant so live upgrades cannot fail
-- or leave a legacy worker able to complete a newly claimed delivery.
update public.email_outbox
set
  status = 'failed',
  available_at = now(),
  lease_expires_at = null,
  worker_id = null,
  attempt_count = least(attempt_count, 4),
  last_error = 'migration_requeued_for_completion_token',
  updated_at = now()
where status = 'processing';

alter table public.email_outbox
  add constraint email_outbox_lease_consistent
    check (
      (
        status = 'processing'
        and lease_expires_at is not null
        and worker_id is not null
        and completion_token is not null
      )
      or (
        status <> 'processing'
        and lease_expires_at is null
        and worker_id is null
        and completion_token is null
      )
    ),
  add constraint email_outbox_unsubscribe_window_consistent
    check (
      (unsubscribe_signed_at is null and unsubscribe_expires_at is null)
      or (
        unsubscribe_signed_at is not null
        and unsubscribe_expires_at > unsubscribe_signed_at
      )
    );

alter table public.cancel_flow_attempts
  add column expires_at timestamptz;
update public.cancel_flow_attempts
set expires_at = started_at + interval '24 hours'
where expires_at is null;
alter table public.cancel_flow_attempts
  alter column expires_at set not null,
  alter column expires_at set default (now() + interval '24 hours'),
  add constraint cancel_flow_attempts_expiry_after_start
    check (expires_at > started_at);

alter table public.member_activity_events
  add column request_fingerprint_sha256 text,
  drop constraint member_activity_events_org_idempotency_key,
  add constraint member_activity_events_org_brand_idempotency_key
    unique (organization_id, brand_id, idempotency_key),
  add constraint member_activity_events_request_fingerprint_format
    check (
      request_fingerprint_sha256 is null
      or request_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
    );

alter table public.loyalty_ledger
  add column request_fingerprint_sha256 text,
  add column ledger_sequence bigint generated always as identity,
  drop constraint loyalty_ledger_org_idempotency_key,
  add constraint loyalty_ledger_org_brand_idempotency_key
    unique (organization_id, brand_id, idempotency_key),
  add constraint loyalty_ledger_sequence_key unique (ledger_sequence),
  add constraint loyalty_ledger_request_fingerprint_format
    check (
      request_fingerprint_sha256 is null
      or request_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
    );

create index loyalty_ledger_member_sequence_idx
  on public.loyalty_ledger (
    organization_id,
    brand_id,
    member_id,
    ledger_sequence desc
  );

alter table public.loyalty_redemptions
  add column request_fingerprint_sha256 text,
  drop constraint loyalty_redemptions_org_idempotency_key,
  add constraint loyalty_redemptions_org_brand_idempotency_key
    unique (organization_id, brand_id, idempotency_key),
  add constraint loyalty_redemptions_request_fingerprint_format
    check (
      request_fingerprint_sha256 is null
      or request_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
    );

create table private.retention_command_results (
  organization_id uuid not null,
  brand_id uuid not null,
  command_id uuid not null,
  command_type text not null,
  request_fingerprint_sha256 text not null,
  result_entity_type text not null,
  result_entity_id uuid,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (organization_id, brand_id, command_id),
  constraint retention_command_results_brand_same_org_fkey
    foreign key (organization_id, brand_id)
    references public.brands (organization_id, id),
  constraint retention_command_results_fingerprint_format
    check (request_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  constraint retention_command_results_result_is_object
    check (jsonb_typeof(result) = 'object')
);

alter table private.retention_command_results enable row level security;
alter table private.retention_command_results force row level security;

create or replace function private.retention_request_fingerprint(p_request jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(coalesce(p_request, 'null'::jsonb)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function private.assert_retention_fingerprint(
  p_fingerprint text
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'Request fingerprint must be a lowercase SHA-256 value.';
  end if;
end;
$$;

create or replace function private.load_retention_command(
  p_organization_id uuid,
  p_brand_id uuid,
  p_command_id uuid,
  p_command_type text,
  p_request_fingerprint_sha256 text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_command private.retention_command_results%rowtype;
begin
  perform private.assert_retention_fingerprint(p_request_fingerprint_sha256);

  select command.*
  into v_command
  from private.retention_command_results as command
  where command.organization_id = p_organization_id
    and command.brand_id = p_brand_id
    and command.command_id = p_command_id;

  if not found then
    return null;
  end if;
  if v_command.command_type <> p_command_type
    or v_command.request_fingerprint_sha256 <> p_request_fingerprint_sha256
  then
    raise exception using
      errcode = '23505',
      message = 'Command ID was already used for a different request.';
  end if;
  return v_command.result || jsonb_build_object('replayed', true);
end;
$$;

create or replace function private.store_retention_command(
  p_organization_id uuid,
  p_brand_id uuid,
  p_command_id uuid,
  p_command_type text,
  p_request_fingerprint_sha256 text,
  p_result_entity_type text,
  p_result_entity_id uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform private.assert_retention_fingerprint(p_request_fingerprint_sha256);
  v_result := coalesce(p_result, '{}'::jsonb) || jsonb_build_object('replayed', false);

  insert into private.retention_command_results (
    organization_id,
    brand_id,
    command_id,
    command_type,
    request_fingerprint_sha256,
    result_entity_type,
    result_entity_id,
    result
  )
  values (
    p_organization_id,
    p_brand_id,
    p_command_id,
    p_command_type,
    p_request_fingerprint_sha256,
    p_result_entity_type,
    p_result_entity_id,
    v_result
  );
  return v_result;
exception when unique_violation then
  return private.load_retention_command(
    p_organization_id,
    p_brand_id,
    p_command_id,
    p_command_type,
    p_request_fingerprint_sha256
  );
end;
$$;

create or replace function private.resolve_retention_actor_brand(
  p_organization_id uuid,
  p_brand_id uuid,
  p_member_id uuid,
  p_actor_user_id uuid default null
)
returns table (
  actor_user_id uuid,
  actor_type public.cancel_actor_type
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_actor_user_id uuid := coalesce(v_auth_user_id, p_actor_user_id);
begin
  if v_actor_user_id is null then
    raise exception using errcode = '42501', message = 'An authenticated actor is required.';
  end if;
  if v_auth_user_id is not null
    and p_actor_user_id is not null
    and v_auth_user_id <> p_actor_user_id
  then
    raise exception using errcode = '42501', message = 'Actor identity mismatch.';
  end if;
  if v_auth_user_id is null
    and coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
  then
    raise exception using errcode = '42501', message = 'Service authorization is required.';
  end if;

  if exists (
    select 1
    from public.staff_users as staff
    left join public.organization_staff_access as access
      on access.organization_id = staff.organization_id
      and access.staff_user_id = staff.id
    where staff.id = v_actor_user_id
      and staff.organization_id = p_organization_id
      and staff.status = 'active'
      and (
        access.scope = 'all_brands'
        or exists (
          select 1
          from public.staff_brand_access as brand_access
          where brand_access.organization_id = p_organization_id
            and brand_access.brand_id = p_brand_id
            and brand_access.staff_user_id = staff.id
        )
      )
  ) then
    actor_user_id := v_actor_user_id;
    actor_type := 'staff';
    return next;
    return;
  end if;

  if p_member_id is not null and exists (
    select 1
    from public.members as member
    where member.id = p_member_id
      and member.organization_id = p_organization_id
      and member.brand_id = p_brand_id
      and member.auth_user_id = v_actor_user_id
      and member.deleted_at is null
  ) then
    actor_user_id := v_actor_user_id;
    actor_type := 'member';
    return next;
    return;
  end if;

  raise exception using
    errcode = '42501',
    message = 'Actor cannot manage this brand member.';
end;
$$;

-- Make brand identity part of every Phase 3 relationship.
alter table public.cancel_flow_steps
  drop constraint cancel_flow_steps_org_position_key,
  add constraint cancel_flow_steps_org_position_key
    unique (organization_id, brand_id, position)
    deferrable initially immediate,
  add constraint cancel_flow_steps_org_brand_id_key
    unique (organization_id, brand_id, id);

alter table public.cancel_flow_attempts
  add constraint cancel_flow_attempts_org_brand_member_id_key
    unique (organization_id, brand_id, member_id, id),
  drop constraint cancel_flow_attempts_step_same_organization_fkey,
  add constraint cancel_flow_attempts_step_same_brand_fkey
    foreign key (organization_id, brand_id, current_step_id)
    references public.cancel_flow_steps (organization_id, brand_id, id);

alter table public.cancel_flow_events
  drop constraint cancel_flow_events_attempt_same_organization_fkey,
  drop constraint cancel_flow_events_member_same_organization_fkey,
  drop constraint cancel_flow_events_step_same_organization_fkey,
  add constraint cancel_flow_events_attempt_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id, attempt_id)
    references public.cancel_flow_attempts (
      organization_id,
      brand_id,
      member_id,
      id
    ),
  add constraint cancel_flow_events_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id),
  add constraint cancel_flow_events_step_same_brand_fkey
    foreign key (organization_id, brand_id, step_id)
    references public.cancel_flow_steps (organization_id, brand_id, id);

alter table public.loyalty_ledger
  add constraint loyalty_ledger_org_brand_member_id_key
    unique (organization_id, brand_id, member_id, id);

alter table public.loyalty_redemptions
  add constraint loyalty_redemptions_org_brand_member_id_key
    unique (organization_id, brand_id, member_id, id),
  add constraint loyalty_redemptions_org_brand_shipment_id_key
    unique (organization_id, brand_id, member_id, shipment_id, id);

alter table public.loyalty_ledger
  drop constraint loyalty_ledger_redemption_same_organization_fkey,
  add constraint loyalty_ledger_redemption_same_brand_fkey
    foreign key (organization_id, brand_id, member_id, redemption_id)
    references public.loyalty_redemptions (
      organization_id,
      brand_id,
      member_id,
      id
    );

alter table public.loyalty_point_lots
  add constraint loyalty_point_lots_org_brand_member_id_key
    unique (organization_id, brand_id, member_id, id),
  drop constraint loyalty_point_lots_award_same_organization_fkey,
  add constraint loyalty_point_lots_award_same_brand_fkey
    foreign key (organization_id, brand_id, member_id, award_ledger_id)
    references public.loyalty_ledger (
      organization_id,
      brand_id,
      member_id,
      id
    );

alter table public.loyalty_reservation_allocations
  add column member_id uuid;
update public.loyalty_reservation_allocations as allocation
set member_id = redemption.member_id
from public.loyalty_redemptions as redemption
where redemption.organization_id = allocation.organization_id
  and redemption.brand_id = allocation.brand_id
  and redemption.id = allocation.redemption_id;
alter table public.loyalty_reservation_allocations
  alter column member_id set not null,
  drop constraint loyalty_reservation_allocations_redemption_same_organization_fkey,
  drop constraint loyalty_reservation_allocations_redemption_same_brand_fkey,
  drop constraint loyalty_reservation_allocations_lot_same_organization_fkey,
  add constraint loyalty_reservation_allocations_redemption_same_brand_fkey
    foreign key (organization_id, brand_id, member_id, redemption_id)
    references public.loyalty_redemptions (
      organization_id,
      brand_id,
      member_id,
      id
    ) on delete cascade,
  add constraint loyalty_reservation_allocations_lot_same_brand_fkey
    foreign key (organization_id, brand_id, member_id, lot_id)
    references public.loyalty_point_lots (
      organization_id,
      brand_id,
      member_id,
      id
    );

create or replace function private.assign_loyalty_allocation_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
begin
  select redemption.member_id
  into v_member_id
  from public.loyalty_redemptions as redemption
  where redemption.organization_id = new.organization_id
    and redemption.brand_id = new.brand_id
    and redemption.id = new.redemption_id;
  if not found then
    raise exception using errcode = '23503', message = 'Loyalty redemption does not belong to the brand.';
  end if;
  if not exists (
    select 1
    from public.loyalty_point_lots as lot
    where lot.organization_id = new.organization_id
      and lot.brand_id = new.brand_id
      and lot.member_id = v_member_id
      and lot.id = new.lot_id
  ) then
    raise exception using errcode = '23503', message = 'Loyalty lot does not belong to the redemption member.';
  end if;
  new.member_id := v_member_id;
  return new;
end;
$$;

create trigger loyalty_reservation_allocations_assign_member
before insert or update of organization_id, brand_id, redemption_id, lot_id
on public.loyalty_reservation_allocations
for each row execute function private.assign_loyalty_allocation_member();

alter table public.shipments
  drop constraint shipments_loyalty_redemption_same_organization_fkey,
  add constraint shipments_loyalty_redemption_same_brand_fkey
    foreign key (
      organization_id,
      brand_id,
      member_id,
      id,
      loyalty_redemption_id
    )
    references public.loyalty_redemptions (
      organization_id,
      brand_id,
      member_id,
      shipment_id,
      id
    );

create or replace function private.seed_phase3_brand_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The default brand is inserted by an organization BEFORE INSERT trigger;
  -- the existing organization seed runs after the parent row exists.
  if not exists (
    select 1
    from public.organizations as organization
    where organization.id = new.organization_id
  ) then
    return new;
  end if;

  insert into public.email_templates (
    organization_id,
    brand_id,
    trigger_type,
    subject,
    body,
    days_before
  )
  values
    (new.organization_id, new.id, 'welcome',
      'Welcome to {{organization_name}}',
      '<p>Welcome, {{member_first_name}}. We are delighted to have you in the club.</p>', null),
    (new.organization_id, new.id, 'pre_shipment',
      'Your next wine club shipment is coming',
      '<p>Your {{release_name}} shipment is scheduled for {{processing_date}}.</p>', 3),
    (new.organization_id, new.id, 'payment_decline',
      'Action needed for your wine club shipment',
      '<p>We could not process your payment. Please update your payment method.</p>', null),
    (new.organization_id, new.id, 'shipped',
      'Your wine club shipment is on its way',
      '<p>Your shipment has shipped. Tracking: {{tracking_number}}</p>', null),
    (new.organization_id, new.id, 'birthday',
      'Happy birthday from {{organization_name}}',
      '<p>Happy birthday, {{member_first_name}}!</p>', null),
    (new.organization_id, new.id, 're_engagement',
      'We miss you at {{organization_name}}',
      '<p>It has been a while. Visit your member portal to see what is new.</p>', null)
  on conflict on constraint email_templates_organization_trigger_key do nothing;

  insert into public.cancel_flow_steps (
    organization_id,
    brand_id,
    step_type,
    position,
    enabled,
    headline,
    body,
    configuration
  )
  values
    (new.organization_id, new.id, 'pause', 1, true,
      'Would you like to pause instead?',
      'Keep your benefits and pause for one or three months.',
      '{"pause_months":[1,3]}'::jsonb),
    (new.organization_id, new.id, 'downgrade', 2, true,
      'Would a lower tier work better?',
      'Switch to a lower-priced active club tier.', '{}'::jsonb),
    (new.organization_id, new.id, 'swap', 3, true,
      'Customize your next shipment',
      'Choose a wine swap instead of cancelling.', '{}'::jsonb),
    (new.organization_id, new.id, 'confirm', 4, true,
      'Are you sure you want to cancel?',
      'Cancelling ends club benefits and future loyalty earning.', '{}'::jsonb)
  on conflict on constraint cancel_flow_steps_org_type_key do nothing;
  return new;
end;
$$;

create trigger brands_seed_phase3_defaults
after insert on public.brands
for each row execute function private.seed_phase3_brand_defaults();

-- Trigger functions cannot be called directly with a record. Seed existing
-- brands explicitly after installing the trigger used for all future brands.
insert into public.email_templates (
  organization_id,
  brand_id,
  trigger_type,
  subject,
  body,
  days_before
)
select brand.organization_id, brand.id, fixture.trigger_type,
  fixture.subject, fixture.body, fixture.days_before
from public.brands as brand
cross join (
  values
    ('welcome'::public.email_trigger_type,
      'Welcome to {{organization_name}}',
      '<p>Welcome, {{member_first_name}}. We are delighted to have you in the club.</p>', null::integer),
    ('pre_shipment'::public.email_trigger_type,
      'Your next wine club shipment is coming',
      '<p>Your {{release_name}} shipment is scheduled for {{processing_date}}.</p>', 3),
    ('payment_decline'::public.email_trigger_type,
      'Action needed for your wine club shipment',
      '<p>We could not process your payment. Please update your payment method.</p>', null::integer),
    ('shipped'::public.email_trigger_type,
      'Your wine club shipment is on its way',
      '<p>Your shipment has shipped. Tracking: {{tracking_number}}</p>', null::integer),
    ('birthday'::public.email_trigger_type,
      'Happy birthday from {{organization_name}}',
      '<p>Happy birthday, {{member_first_name}}!</p>', null::integer),
    ('re_engagement'::public.email_trigger_type,
      'We miss you at {{organization_name}}',
      '<p>It has been a while. Visit your member portal to see what is new.</p>', null::integer)
) as fixture(trigger_type, subject, body, days_before)
on conflict on constraint email_templates_organization_trigger_key do nothing;

insert into public.cancel_flow_steps (
  organization_id,
  brand_id,
  step_type,
  position,
  enabled,
  headline,
  body,
  configuration
)
select brand.organization_id, brand.id, fixture.step_type, fixture.position,
  true, fixture.headline, fixture.body, fixture.configuration
from public.brands as brand
cross join (
  values
    ('pause'::public.cancel_step_type, 1,
      'Would you like to pause instead?',
      'Keep your benefits and pause for one or three months.',
      '{"pause_months":[1,3]}'::jsonb),
    ('downgrade'::public.cancel_step_type, 2,
      'Would a lower tier work better?',
      'Switch to a lower-priced active club tier.', '{}'::jsonb),
    ('swap'::public.cancel_step_type, 3,
      'Customize your next shipment',
      'Choose a wine swap instead of cancelling.', '{}'::jsonb),
    ('confirm'::public.cancel_step_type, 4,
      'Are you sure you want to cancel?',
      'Cancelling ends club benefits and future loyalty earning.', '{}'::jsonb)
) as fixture(step_type, position, headline, body, configuration)
on conflict on constraint cancel_flow_steps_org_type_key do nothing;

create table public.email_provider_event_inbox (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  provider_email_id text not null,
  event_type public.email_delivery_event_type not null,
  occurred_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  organization_id uuid,
  brand_id uuid,
  email_log_id uuid,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint email_provider_event_inbox_event_id_length
    check (char_length(provider_event_id) between 3 and 255),
  constraint email_provider_event_inbox_email_id_length
    check (char_length(provider_email_id) between 1 and 255),
  constraint email_provider_event_inbox_payload_is_object
    check (jsonb_typeof(payload) = 'object'),
  constraint email_provider_event_inbox_match_consistent
    check (
      (email_log_id is null and organization_id is null and brand_id is null and reconciled_at is null)
      or (email_log_id is not null and organization_id is not null and brand_id is not null and reconciled_at is not null)
    ),
  constraint email_provider_event_inbox_log_same_brand_fkey
    foreign key (organization_id, brand_id, email_log_id)
    references public.email_log (organization_id, brand_id, id)
);

create index email_provider_event_inbox_unmatched_idx
  on public.email_provider_event_inbox (provider_email_id, occurred_at, id)
  where email_log_id is null;

alter table public.email_provider_event_inbox enable row level security;
alter table public.email_provider_event_inbox force row level security;

create trigger email_provider_event_inbox_reject_update_delete
before delete on public.email_provider_event_inbox
for each row execute function private.reject_append_only_mutation();

create trigger email_provider_event_inbox_reject_truncate
before truncate on public.email_provider_event_inbox
for each statement execute function private.reject_append_only_mutation();

create or replace function private.email_status_rank(p_status public.email_status)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'queued' then 0
    when 'processing' then 1
    when 'sent' then 2
    when 'delivered' then 5
    when 'failed' then 3
    when 'bounced' then 6
  end;
$$;

create or replace function private.converge_email_status(
  p_organization_id uuid,
  p_email_log_id uuid,
  p_status public.email_status,
  p_occurred_at timestamptz,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_log public.email_log%rowtype;
begin
  select log.*
  into v_log
  from public.email_log as log
  where log.organization_id = p_organization_id
    and log.id = p_email_log_id
  for update;
  if not found then
    return false;
  end if;

  if private.email_status_rank(p_status) < private.email_status_rank(v_log.status)
    or (
      v_log.provider_status_at is not null
      and p_occurred_at < v_log.provider_status_at
      and private.email_status_rank(p_status) <= private.email_status_rank(v_log.status)
    )
  then
    return true;
  end if;

  update public.email_log
  set
    status = p_status,
    provider_status_at = greatest(
      coalesce(provider_status_at, '-infinity'::timestamptz),
      p_occurred_at
    ),
    error_message = case
      when p_status in ('failed', 'bounced') then left(p_error, 4000)
      else error_message
    end,
    sent_at = case
      when p_status in ('sent', 'delivered') then coalesce(sent_at, p_occurred_at)
      else sent_at
    end,
    delivered_at = case
      when p_status = 'delivered' then coalesce(delivered_at, p_occurred_at)
      else delivered_at
    end,
    failed_at = case
      when p_status = 'failed' then coalesce(failed_at, p_occurred_at)
      else failed_at
    end,
    bounced_at = case
      when p_status = 'bounced' then coalesce(bounced_at, p_occurred_at)
      else bounced_at
    end
  where id = p_email_log_id
    and organization_id = p_organization_id;
  return true;
end;
$$;

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
  completion_token uuid,
  unsubscribe_signed_at timestamptz,
  unsubscribe_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
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

create or replace function private.reconcile_email_provider_events(
  p_provider_email_id text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_log public.email_log%rowtype;
  v_event public.email_provider_event_inbox%rowtype;
  v_status public.email_status;
  v_count integer := 0;
begin
  select log.*
  into v_log
  from public.email_log as log
  where log.resend_id = p_provider_email_id
  for update;
  if not found then
    return 0;
  end if;

  for v_event in
    select event.*
    from public.email_provider_event_inbox as event
    where event.provider_email_id = p_provider_email_id
      and event.email_log_id is null
    order by event.occurred_at, event.id
    for update
  loop
    insert into public.email_delivery_events (
      organization_id,
      brand_id,
      email_log_id,
      provider_event_id,
      event_type,
      occurred_at,
      payload
    )
    values (
      v_log.organization_id,
      v_log.brand_id,
      v_log.id,
      v_event.provider_event_id,
      v_event.event_type,
      v_event.occurred_at,
      v_event.payload
    )
    on conflict (provider_event_id) do nothing;

    v_status := case v_event.event_type
      when 'sent' then 'sent'::public.email_status
      when 'delivered' then 'delivered'::public.email_status
      when 'failed' then 'failed'::public.email_status
      when 'bounced' then 'bounced'::public.email_status
      else null
    end;
    if v_status is not null then
      perform private.converge_email_status(
        v_log.organization_id,
        v_log.id,
        v_status,
        v_event.occurred_at,
        case
          when v_event.event_type = 'bounced' then 'Provider reported a bounce.'
          when v_event.event_type = 'failed' then 'Provider reported delivery failure.'
          else null
        end
      );
    end if;

    update public.email_provider_event_inbox
    set
      organization_id = v_log.organization_id,
      brand_id = v_log.brand_id,
      email_log_id = v_log.id,
      reconciled_at = now()
    where id = v_event.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.complete_email_outbox_claim(
  p_outbox_id uuid,
  p_completion_token uuid,
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

  if p_resend_id is not null then
    perform private.reconcile_email_provider_events(p_resend_id);
  end if;
  return true;
end;
$$;

create or replace function public.record_email_provider_event(
  p_provider_event_id text,
  p_provider_email_id text,
  p_event_type public.email_delivery_event_type,
  p_occurred_at timestamptz,
  p_payload jsonb default '{}'::jsonb
)
returns table (
  duplicate boolean,
  matched boolean,
  email_log_id uuid,
  organization_id uuid,
  brand_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.email_provider_event_inbox%rowtype;
  v_inserted boolean := false;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Delivery payload must be an object.';
  end if;

  insert into public.email_provider_event_inbox (
    provider_event_id,
    provider_email_id,
    event_type,
    occurred_at,
    payload
  )
  values (
    p_provider_event_id,
    p_provider_email_id,
    p_event_type,
    p_occurred_at,
    p_payload
  )
  on conflict (provider_event_id) do nothing
  returning * into v_event;
  v_inserted := found;

  if not v_inserted then
    select event.*
    into v_event
    from public.email_provider_event_inbox as event
    where event.provider_event_id = p_provider_event_id;
    if v_event.provider_email_id <> p_provider_email_id
      or v_event.event_type <> p_event_type
      or v_event.occurred_at <> p_occurred_at
      or v_event.payload <> p_payload
    then
      raise exception using
        errcode = '23505',
        message = 'Provider event ID was reused with conflicting content.';
    end if;
  end if;

  if v_event.email_log_id is null then
    perform private.reconcile_email_provider_events(p_provider_email_id);
    select event.*
    into v_event
    from public.email_provider_event_inbox as event
    where event.provider_event_id = p_provider_event_id;
  end if;

  duplicate := not v_inserted;
  matched := v_event.email_log_id is not null;
  email_log_id := v_event.email_log_id;
  organization_id := v_event.organization_id;
  brand_id := v_event.brand_id;
  return next;
end;
$$;

create or replace function public.record_email_delivery_event(
  p_organization_id uuid,
  p_email_log_id uuid,
  p_provider_event_id text,
  p_event_type public.email_delivery_event_type,
  p_occurred_at timestamptz,
  p_payload jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_log public.email_log%rowtype;
  v_existing public.email_delivery_events%rowtype;
  v_status public.email_status;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Delivery payload must be an object.';
  end if;
  select log.*
  into v_log
  from public.email_log as log
  where log.organization_id = p_organization_id
    and log.id = p_email_log_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Email log not found.';
  end if;

  insert into public.email_delivery_events (
    organization_id,
    brand_id,
    email_log_id,
    provider_event_id,
    event_type,
    occurred_at,
    payload
  )
  values (
    p_organization_id,
    v_log.brand_id,
    p_email_log_id,
    p_provider_event_id,
    p_event_type,
    p_occurred_at,
    p_payload
  )
  on conflict (provider_event_id) do nothing
  returning * into v_existing;

  if not found then
    select event.*
    into v_existing
    from public.email_delivery_events as event
    where event.provider_event_id = p_provider_event_id;
    if v_existing.organization_id <> p_organization_id
      or v_existing.email_log_id <> p_email_log_id
      or v_existing.event_type <> p_event_type
      or v_existing.occurred_at <> p_occurred_at
      or v_existing.payload <> p_payload
    then
      raise exception using
        errcode = '23505',
        message = 'Provider event ID was reused with conflicting content.';
    end if;
    return false;
  end if;

  v_status := case p_event_type
    when 'sent' then 'sent'::public.email_status
    when 'delivered' then 'delivered'::public.email_status
    when 'failed' then 'failed'::public.email_status
    when 'bounced' then 'bounced'::public.email_status
    else null
  end;
  if v_status is not null then
    perform private.converge_email_status(
      p_organization_id,
      p_email_log_id,
      v_status,
      p_occurred_at,
      case
        when p_event_type = 'bounced' then 'Provider reported a bounce.'
        when p_event_type = 'failed' then 'Provider reported delivery failure.'
        else null
      end
    );
  end if;
  return true;
end;
$$;

drop index cancel_flow_attempts_one_active_uidx;
create unique index cancel_flow_attempts_one_active_uidx
  on public.cancel_flow_attempts (organization_id, brand_id, member_id)
  where status = 'in_progress';

create or replace function public.update_cancel_flow_configuration(
  p_organization_id uuid,
  p_brand_id uuid,
  p_steps jsonb,
  p_actor_user_id uuid default null
)
returns setof public.cancel_flow_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_updated integer;
begin
  select *
  into v_actor
  from private.resolve_retention_actor_brand(
    p_organization_id,
    p_brand_id,
    null,
    p_actor_user_id
  );
  if v_actor.actor_type <> 'staff' then
    raise exception using errcode = '42501', message = 'Staff authorization is required.';
  end if;
  if jsonb_typeof(p_steps) is distinct from 'array'
    or jsonb_array_length(p_steps) <> 4
  then
    raise exception using errcode = '22023', message = 'Cancel configuration must contain all four steps.';
  end if;
  if (
    select count(distinct fixture.step_type)
    from jsonb_to_recordset(p_steps) as fixture(step_type text)
    where fixture.step_type in ('pause', 'downgrade', 'swap', 'confirm')
  ) <> 4 then
    raise exception using errcode = '22023', message = 'Cancel step types must be unique and complete.';
  end if;
  if (
    select count(distinct fixture.position)
    from jsonb_to_recordset(p_steps) as fixture(position integer)
    where fixture.position between 1 and 4
  ) <> 4 then
    raise exception using errcode = '22023', message = 'Cancel step positions must be unique from 1 through 4.';
  end if;
  if not exists (
    select 1
    from jsonb_to_recordset(p_steps) as fixture(
      step_type text,
      position integer,
      enabled boolean
    )
    where fixture.step_type = 'confirm'
      and fixture.position = 4
      and fixture.enabled
  ) then
    raise exception using
      errcode = '22023',
      message = 'The confirmation step must be enabled and last.';
  end if;

  set constraints public.cancel_flow_steps_org_position_key deferred;
  update public.cancel_flow_steps as step
  set
    position = fixture.position,
    enabled = fixture.enabled,
    headline = fixture.headline,
    body = fixture.body,
    configuration = coalesce(fixture.configuration, '{}'::jsonb)
  from jsonb_to_recordset(p_steps) as fixture(
    step_type text,
    position integer,
    enabled boolean,
    headline text,
    body text,
    configuration jsonb
  )
  where step.organization_id = p_organization_id
    and step.brand_id = p_brand_id
    and step.step_type::text = fixture.step_type;
  get diagnostics v_updated = row_count;
  if v_updated <> 4 then
    raise exception using errcode = '23514', message = 'Cancel flow is not configured for the brand.';
  end if;

  perform public.append_audit_entry(
    p_organization_id,
    p_brand_id,
    v_actor.actor_user_id,
    'cancel_flow.configuration_updated',
    'brand',
    p_brand_id,
    jsonb_build_object('steps', p_steps)
  );

  return query
  select step.*
  from public.cancel_flow_steps as step
  where step.organization_id = p_organization_id
    and step.brand_id = p_brand_id
  order by step.position;
end;
$$;

create or replace function public.update_cancel_flow_configuration(
  p_organization_id uuid,
  p_steps jsonb,
  p_actor_user_id uuid default null
)
returns setof public.cancel_flow_steps
language sql
security definer
set search_path = ''
as $$
  select *
  from public.update_cancel_flow_configuration(
    p_organization_id,
    private.default_brand_for_org(p_organization_id),
    p_steps,
    p_actor_user_id
  );
$$;

create or replace function public.expire_stale_cancel_flow_attempts(
  p_as_of timestamptz default now(),
  p_limit integer default 500
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.cancel_flow_attempts%rowtype;
  v_step_position integer;
  v_count integer := 0;
begin
  if p_limit not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'Cancel expiry limit must be between 1 and 1000.';
  end if;
  for v_attempt in
    select attempt.*
    from public.cancel_flow_attempts as attempt
    where attempt.status = 'in_progress'
      and attempt.expires_at <= p_as_of
    order by attempt.expires_at, attempt.id
    limit p_limit
    for update skip locked
  loop
    select snapshot.position
    into v_step_position
    from jsonb_to_recordset(v_attempt.configuration_snapshot) as snapshot(
      id uuid,
      position integer
    )
    where snapshot.id = v_attempt.current_step_id;

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
      v_attempt.organization_id,
      v_attempt.brand_id,
      v_attempt.member_id,
      v_attempt.id,
      v_attempt.current_step_id,
      coalesce(v_step_position, 1),
      'abandoned',
      v_attempt.actor_user_id,
      v_attempt.actor_type,
      jsonb_build_object('reason', 'attempt_expired')
    );

    update public.cancel_flow_attempts
    set
      status = 'abandoned',
      accepted_outcome = 'abandoned',
      completed_at = p_as_of
    where id = v_attempt.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.start_cancel_flow(
  p_organization_id uuid,
  p_brand_id uuid,
  p_member_id uuid,
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
  v_first_step_id uuid;
  v_snapshot jsonb;
  v_replay jsonb;
begin
  select *
  into v_actor
  from private.resolve_retention_actor_brand(
    p_organization_id,
    p_brand_id,
    p_member_id,
    p_actor_user_id
  );
  v_replay := private.load_retention_command(
    p_organization_id,
    p_brand_id,
    p_command_id,
    'cancel.start',
    p_request_fingerprint_sha256
  );
  if v_replay is not null then
    select attempt.*
    into strict v_attempt
    from public.cancel_flow_attempts as attempt
    where attempt.organization_id = p_organization_id
      and attempt.brand_id = p_brand_id
      and attempt.id = (v_replay ->> 'attemptId')::uuid;
    return v_attempt;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_brand_id::text || ':' || p_member_id::text,
      3
    )
  );

  update public.cancel_flow_attempts
  set
    status = 'abandoned',
    accepted_outcome = 'abandoned',
    completed_at = now()
  where organization_id = p_organization_id
    and brand_id = p_brand_id
    and member_id = p_member_id
    and status = 'in_progress'
    and expires_at <= now();

  select attempt.*
  into v_attempt
  from public.cancel_flow_attempts as attempt
  where attempt.organization_id = p_organization_id
    and attempt.brand_id = p_brand_id
    and attempt.member_id = p_member_id
    and attempt.status = 'in_progress'
  for update;
  if not found then
    select
      jsonb_agg(
        jsonb_build_object(
          'id', step.id,
          'step_type', step.step_type,
          'position', step.position,
          'enabled', step.enabled,
          'headline', step.headline,
          'body', step.body,
          'configuration', step.configuration
        )
        order by step.position
      ),
      (array_agg(step.id order by step.position) filter (where step.enabled))[1]
    into v_snapshot, v_first_step_id
    from public.cancel_flow_steps as step
    where step.organization_id = p_organization_id
      and step.brand_id = p_brand_id;

    if v_snapshot is null
      or jsonb_array_length(v_snapshot) <> 4
      or v_first_step_id is null
      or not exists (
        select 1
        from jsonb_to_recordset(v_snapshot) as snapshot(
          step_type text,
          position integer,
          enabled boolean
        )
        where snapshot.step_type = 'confirm'
          and snapshot.position = 4
          and snapshot.enabled
      )
    then
      raise exception using errcode = '23514', message = 'Cancel flow is not safely configured.';
    end if;

    insert into public.cancel_flow_attempts (
      organization_id,
      brand_id,
      member_id,
      actor_user_id,
      actor_type,
      current_step_id,
      configuration_snapshot,
      expires_at
    )
    values (
      p_organization_id,
      p_brand_id,
      p_member_id,
      v_actor.actor_user_id,
      v_actor.actor_type,
      v_first_step_id,
      v_snapshot,
      now() + interval '24 hours'
    )
    returning * into v_attempt;

    perform public.append_audit_entry(
      p_organization_id,
      p_brand_id,
      v_actor.actor_user_id,
      'cancel_flow.started',
      'cancel_flow_attempt',
      v_attempt.id,
      jsonb_build_object('member_id', p_member_id)
    );
  end if;

  perform private.store_retention_command(
    p_organization_id,
    p_brand_id,
    p_command_id,
    'cancel.start',
    p_request_fingerprint_sha256,
    'cancel_flow_attempt',
    v_attempt.id,
    jsonb_build_object('attemptId', v_attempt.id)
  );
  return v_attempt;
end;
$$;

create or replace function private.capture_shipment_retention_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_referrer_id uuid;
begin
  if old.status is distinct from new.status and new.status = 'label_created' then
    perform public.enqueue_email_trigger(
      new.organization_id,
      new.member_id,
      'shipped',
      'email:shipped:' || new.id::text,
      jsonb_build_object(
        'shipment_id', new.id,
        'tracking_number', new.tracking_number,
        'carrier', new.carrier
      ),
      now()
    );
  end if;

  if old.status is distinct from new.status and new.status = 'delivered' then
    perform public.record_member_activity_event(
      new.organization_id,
      new.member_id,
      'shipment_delivered',
      'shipment',
      new.id,
      'activity:shipment_delivered:' || new.id::text,
      coalesce(new.delivered_at, now()),
      jsonb_build_object('shipment_id', new.id)
    );

    select member.referred_by_member_id
    into v_referrer_id
    from public.members as member
    where member.organization_id = new.organization_id
      and member.brand_id = new.brand_id
      and member.id = new.member_id;

    if v_referrer_id is not null then
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          new.organization_id::text || ':' || new.brand_id::text || ':referral:' || new.member_id::text,
          7
        )
      );
      if not exists (
        select 1
        from public.member_activity_events as activity
        where activity.organization_id = new.organization_id
          and activity.brand_id = new.brand_id
          and activity.idempotency_key =
            'activity:referral_completed:member:' || new.member_id::text
      ) then
        perform public.record_member_activity_event(
          new.organization_id,
          v_referrer_id,
          'referral_completed',
          'member_referral',
          new.member_id,
          'activity:referral_completed:member:' || new.member_id::text,
          coalesce(new.delivered_at, now()),
          jsonb_build_object('referred_member_id', new.member_id)
        );
      end if;
    end if;
  end if;
  return null;
end;
$$;

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
    select member.organization_id, member.brand_id, member.id as member_id
    from public.members as member
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
      'email:re_engagement:initial:' || v_record.member_id::text,
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

create table private.retention_daily_job_runs (
  job_date date primary key,
  result jsonb not null,
  completed_at timestamptz not null default now(),
  constraint retention_daily_job_runs_result_is_object
    check (jsonb_typeof(result) = 'object')
);

alter table private.retention_daily_job_runs enable row level security;
alter table private.retention_daily_job_runs force row level security;

create table private.retention_brand_daily_job_runs (
  organization_id uuid not null,
  brand_id uuid not null,
  job_date date not null,
  result jsonb not null,
  completed_at timestamptz not null default now(),
  primary key (organization_id, brand_id, job_date),
  constraint retention_brand_daily_job_runs_brand_fkey
    foreign key (organization_id, brand_id)
    references public.brands (organization_id, id)
    on delete cascade,
  constraint retention_brand_daily_job_runs_result_is_object
    check (jsonb_typeof(result) = 'object')
);

alter table private.retention_brand_daily_job_runs enable row level security;
alter table private.retention_brand_daily_job_runs force row level security;

create or replace function private.process_brand_daily_loyalty_awards(
  p_organization_id uuid,
  p_brand_id uuid,
  p_local_date date,
  p_occurred_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members%rowtype;
  v_count integer := 0;
begin
  for v_member in
    select member.*
    from public.members as member
    join public.organizations as organization
      on organization.id = member.organization_id
      and organization.loyalty_enabled
    where member.organization_id = p_organization_id
      and member.brand_id = p_brand_id
      and member.status = 'active'
      and member.deleted_at is null
      and (
        (
          member.birthday is not null
          and extract(month from member.birthday) =
            extract(month from p_local_date)
          and extract(day from member.birthday) =
            extract(day from p_local_date)
        )
        or (
          extract(month from member.joined_on) =
            extract(month from p_local_date)
          and extract(day from member.joined_on) =
            extract(day from p_local_date)
          and member.joined_on < p_local_date
        )
      )
  loop
    if v_member.birthday is not null
      and extract(month from v_member.birthday) =
        extract(month from p_local_date)
      and extract(day from v_member.birthday) =
        extract(day from p_local_date)
    then
      perform public.record_member_activity_event(
        p_organization_id,
        v_member.id,
        'birthday',
        'member',
        v_member.id,
        'activity:birthday:' || extract(year from p_local_date)::integer::text
          || ':' || v_member.id::text,
        p_occurred_at,
        jsonb_build_object('brand_local_date', p_local_date)
      );
      v_count := v_count + 1;
    end if;

    if extract(month from v_member.joined_on) =
        extract(month from p_local_date)
      and extract(day from v_member.joined_on) =
        extract(day from p_local_date)
      and v_member.joined_on < p_local_date
    then
      perform public.record_member_activity_event(
        p_organization_id,
        v_member.id,
        'anniversary',
        'member',
        v_member.id,
        'activity:anniversary:'
          || extract(year from p_local_date)::integer::text
          || ':' || v_member.id::text,
        p_occurred_at,
        jsonb_build_object('brand_local_date', p_local_date)
      );
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

create or replace function public.run_retention_daily_jobs(
  p_job_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_global_result jsonb;
  v_brand_result jsonb;
  v_executed_at timestamptz := clock_timestamp();
  v_brand record;
  v_global_replayed boolean := false;
  v_all_brand_replayed boolean := true;
  v_brand_job_count integer := 0;
  v_cancel_expired integer;
  v_members_resumed integer := 0;
  v_emails_queued integer;
  v_churn_scored integer;
  v_daily_awards integer := 0;
  v_reservations_released integer;
  v_points_expired integer;
  v_brand_members_resumed integer;
  v_brand_daily_awards integer;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('retention-daily:' || p_job_date::text, 8)
  );
  select job.result
  into v_global_result
  from private.retention_daily_job_runs as job
  where job.job_date = p_job_date;
  if found then
    v_global_replayed := true;
  else
    -- The UTC job date is only the replay key. All timestamp-sensitive work
    -- uses the actual execution cutoff, never the following midnight, so a
    -- first run cannot expire attempts, reservations, or lots up to 24h early.
    v_cancel_expired := public.expire_stale_cancel_flow_attempts(
      v_executed_at,
      1000
    );
    v_emails_queued := public.enqueue_due_email_triggers(v_executed_at);
    v_churn_scored := public.calculate_nightly_churn_scores(
      v_executed_at,
      null
    );
    v_reservations_released :=
      public.release_expired_loyalty_reservations(v_executed_at, null);
    v_points_expired := public.expire_loyalty_points(v_executed_at, null);

    v_global_result := jsonb_build_object(
      'jobDate', p_job_date,
      'executedAt', v_executed_at,
      'cancelAttemptsExpired', v_cancel_expired,
      'emailsQueued', v_emails_queued,
      'churnScoresWritten', v_churn_scored,
      'loyaltyReservationsReleased', v_reservations_released,
      'loyaltyLotsExpired', v_points_expired
    );
    insert into private.retention_daily_job_runs (job_date, result)
    values (p_job_date, v_global_result);
  end if;

  -- Daily calendar work is keyed by each brand's IANA-local date. The hourly
  -- caller may cross a new local midnight later in the same UTC day; that
  -- brand receives exactly one new run without replaying other brands.
  for v_brand in
    select
      brand.organization_id,
      brand.id as brand_id,
      brand.time_zone,
      (v_executed_at at time zone brand.time_zone)::date as local_date
    from public.brands as brand
    where brand.active
    order by brand.organization_id, brand.id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'retention-brand-daily:' || v_brand.organization_id::text || ':'
          || v_brand.brand_id::text || ':' || v_brand.local_date::text,
        9
      )
    );
    select job.result
    into v_brand_result
    from private.retention_brand_daily_job_runs as job
    where job.organization_id = v_brand.organization_id
      and job.brand_id = v_brand.brand_id
      and job.job_date = v_brand.local_date;
    if not found then
      with due as (
        select member.id
        from public.members as member
        where member.organization_id = v_brand.organization_id
          and member.brand_id = v_brand.brand_id
          and member.status = 'paused'
          and member.paused_until is not null
          and member.paused_until <= v_brand.local_date
        order by member.paused_until, member.id
        limit 1000
        for update skip locked
      )
      update public.members as member
      set status = 'active', paused_until = null
      from due
      where member.id = due.id;
      get diagnostics v_brand_members_resumed = row_count;

      v_brand_daily_awards := private.process_brand_daily_loyalty_awards(
        v_brand.organization_id,
        v_brand.brand_id,
        v_brand.local_date,
        v_executed_at
      );
      v_brand_result := jsonb_build_object(
        'organizationId', v_brand.organization_id,
        'brandId', v_brand.brand_id,
        'timeZone', v_brand.time_zone,
        'jobDate', v_brand.local_date,
        'membersResumed', v_brand_members_resumed,
        'loyaltyAwardsWritten', v_brand_daily_awards
      );
      insert into private.retention_brand_daily_job_runs (
        organization_id,
        brand_id,
        job_date,
        result
      )
      values (
        v_brand.organization_id,
        v_brand.brand_id,
        v_brand.local_date,
        v_brand_result
      );
      v_all_brand_replayed := false;
    end if;
    v_brand_job_count := v_brand_job_count + 1;
    v_members_resumed := v_members_resumed
      + coalesce((v_brand_result ->> 'membersResumed')::integer, 0);
    v_daily_awards := v_daily_awards
      + coalesce((v_brand_result ->> 'loyaltyAwardsWritten')::integer, 0);
  end loop;

  v_result := v_global_result || jsonb_build_object(
    'replayed', v_global_replayed and v_all_brand_replayed,
    'membersResumed', v_members_resumed,
    'loyaltyAwardsWritten', v_daily_awards,
    'loyaltyEventsProcessed', v_daily_awards,
    'churnScoresUpdated',
      coalesce((v_global_result ->> 'churnScoresWritten')::integer, 0),
    'brandJobCount', v_brand_job_count
  );
  return v_result;
end;
$$;

create or replace function public.get_cancel_flow_analytics(
  p_organization_id uuid,
  p_brand_id uuid,
  p_from timestamptz default now() - interval '30 days',
  p_to timestamptz default now()
)
returns table (
  step_type public.cancel_step_type,
  step_position integer,
  viewed_count bigint,
  continued_count bigint,
  intercepted_count bigint,
  cancelled_count bigint,
  conversion_rate numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    private.is_service_role()
    or (
      private.is_staff_for_org(p_organization_id)
      and private.can_access_brand(p_organization_id, p_brand_id)
    )
  ) then
    raise exception using errcode = '42501', message = 'Brand staff authorization is required.';
  end if;
  if p_from >= p_to then
    raise exception using errcode = '22023', message = 'Analytics range is invalid.';
  end if;

  return query
  select
    step.step_type,
    step.position,
    -- "Viewed count" is the stable response-field name, but reach is derived
    -- from any persisted decision event because the application never emits
    -- the legacy unsupported `viewed` action.
    count(event.id),
    count(*) filter (where event.outcome = 'continued'),
    count(*) filter (where event.outcome in ('paused', 'downgraded', 'swapped')),
    count(*) filter (where event.outcome = 'cancelled'),
    case
      when count(event.id) = 0 then 0::numeric
      else round(
        count(*) filter (
          where event.outcome in ('paused', 'downgraded', 'swapped')
        )::numeric
        / count(event.id)::numeric,
        4
      )
    end
  from public.cancel_flow_steps as step
  left join public.cancel_flow_events as event
    on event.organization_id = step.organization_id
    and event.brand_id = step.brand_id
    and event.step_id = step.id
    and event.created_at >= p_from
    and event.created_at < p_to
  where step.organization_id = p_organization_id
    and step.brand_id = p_brand_id
  group by step.step_type, step.position
  order by step.position;
end;
$$;

create or replace function public.get_cancel_flow_analytics_snapshot(
  p_organization_id uuid,
  p_brand_id uuid,
  p_from timestamptz default now() - interval '30 days',
  p_to timestamptz default now(),
  p_recent_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not (
    private.is_service_role()
    or (
      private.is_staff_for_org(p_organization_id)
      and private.can_access_brand(p_organization_id, p_brand_id)
    )
  ) then
    raise exception using errcode = '42501', message = 'Brand staff authorization is required.';
  end if;
  if p_from >= p_to or p_recent_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'Analytics range or limit is invalid.';
  end if;

  with attempt_totals as (
    select
      count(*)::bigint as attempt_count,
      count(*) filter (where attempt.status = 'intercepted')::bigint as retained_count,
      count(*) filter (where attempt.status = 'cancelled')::bigint as cancelled_count,
      count(*) filter (where attempt.status = 'abandoned')::bigint as abandoned_count
    from public.cancel_flow_attempts as attempt
    where attempt.organization_id = p_organization_id
      and attempt.brand_id = p_brand_id
      and attempt.started_at >= p_from
      and attempt.started_at < p_to
  ),
  steps as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'stepType', analytics.step_type,
          'stepPosition', analytics.step_position,
          'viewedCount', analytics.viewed_count,
          'continuedCount', analytics.continued_count,
          'interceptedCount', analytics.intercepted_count,
          'cancelledCount', analytics.cancelled_count,
          'conversionRate', analytics.conversion_rate
        )
        order by analytics.step_position
      ),
      '[]'::jsonb
    ) as value
    from public.get_cancel_flow_analytics(
      p_organization_id,
      p_brand_id,
      p_from,
      p_to
    ) as analytics
  ),
  recent as (
    select coalesce(
      jsonb_agg(outcome.value order by outcome.completed_at desc),
      '[]'::jsonb
    ) as value
    from (
      select
        jsonb_build_object(
          'attemptId', attempt.id,
          'memberId', member.id,
          'memberFirstName', member.first_name,
          'memberLastName', member.last_name,
          'memberEmail', member.email,
          'step', completed_step.step_type,
          'outcome', attempt.accepted_outcome,
          'status', attempt.status,
          'completedAt', attempt.completed_at
        ) as value,
        attempt.completed_at
      from public.cancel_flow_attempts as attempt
      join public.members as member
        on member.organization_id = attempt.organization_id
        and member.brand_id = attempt.brand_id
        and member.id = attempt.member_id
      left join lateral (
        select snapshot.step_type
        from jsonb_to_recordset(attempt.configuration_snapshot) as snapshot(
          id uuid,
          step_type public.cancel_step_type
        )
        where snapshot.id = attempt.current_step_id
        limit 1
      ) as completed_step on true
      where attempt.organization_id = p_organization_id
        and attempt.brand_id = p_brand_id
        and attempt.completed_at is not null
        and attempt.completed_at >= p_from
        and attempt.completed_at < p_to
      order by attempt.completed_at desc
      limit p_recent_limit
    ) as outcome
  )
  select jsonb_build_object(
    'attemptCount', totals.attempt_count,
    'retainedCount', totals.retained_count,
    'cancelledCount', totals.cancelled_count,
    'abandonedCount', totals.abandoned_count,
    -- Retention measures completed member decisions. Open attempts have no
    -- decision yet, and abandoned attempts intentionally count as neither a
    -- retained member nor a cancellation, so both are excluded from the KPI.
    'retentionRate', case
      when totals.retained_count + totals.cancelled_count = 0 then 0
      else round(
        totals.retained_count::numeric
        / (totals.retained_count + totals.cancelled_count)::numeric,
        4
      )
    end,
    'steps', steps.value,
    'recentOutcomes', recent.value
  )
  into v_result
  from attempt_totals as totals
  cross join steps
  cross join recent;
  return v_result;
end;
$$;

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
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
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

    update public.shipment_items as item
    set
      release_wine_id = target_wine.id,
      wine_name = target_wine.wine_name,
      vintage = target_wine.vintage,
      sku = target_wine.sku
    from public.release_wines as target_wine
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

create or replace function public.record_cancel_flow_step(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_step_id uuid,
  p_outcome public.cancel_flow_outcome,
  p_details jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null
)
returns public.cancel_flow_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand_id uuid;
  v_command_id uuid := gen_random_uuid();
begin
  select attempt.brand_id
  into v_brand_id
  from public.cancel_flow_attempts as attempt
  where attempt.organization_id = p_organization_id
    and attempt.id = p_attempt_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Cancel attempt not found.';
  end if;
  return public.record_cancel_flow_step(
    p_organization_id,
    v_brand_id,
    p_attempt_id,
    p_step_id,
    p_outcome,
    p_details,
    p_actor_user_id,
    v_command_id,
    private.retention_request_fingerprint(
      jsonb_build_object(
        'command', 'cancel.record_step',
        'attempt_id', p_attempt_id,
        'step_id', p_step_id,
        'outcome', p_outcome,
        'details', p_details,
        'actor_user_id', p_actor_user_id
      )
    )
  );
end;
$$;

create or replace function public.resume_due_paused_members(
  p_as_of date default current_date,
  p_limit integer default 500
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_limit not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'Pause resume limit must be between 1 and 1000.';
  end if;
  with due as (
    select member.id
    from public.members as member
    join public.brands as brand
      on brand.organization_id = member.organization_id
      and brand.id = member.brand_id
    where member.status = 'paused'
      and member.paused_until is not null
      and member.paused_until <= p_as_of
    order by member.paused_until, member.id
    limit p_limit
    for update of member skip locked
  )
  update public.members as member
  set status = 'active', paused_until = null
  from due
  where member.id = due.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

alter function public.award_loyalty_points(
  uuid,
  uuid,
  integer,
  public.member_activity_event_type,
  uuid,
  text,
  text,
  uuid
) rename to award_loyalty_points_phase3_legacy;

create or replace function public.award_loyalty_points(
  p_organization_id uuid,
  p_member_id uuid,
  p_base_points integer,
  p_source_type public.member_activity_event_type,
  p_source_id uuid,
  p_idempotency_key text,
  p_reason text,
  p_actor_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand_id uuid;
  v_existing public.loyalty_ledger%rowtype;
  v_ledger_id uuid;
  v_fingerprint text;
  v_multiplier numeric(4, 2);
  v_points integer;
  v_expires_at timestamptz;
begin
  select member.brand_id
  into v_brand_id
  from public.members as member
  where member.organization_id = p_organization_id
    and member.id = p_member_id
    and member.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'Loyalty member not found.';
  end if;

  v_fingerprint := private.retention_request_fingerprint(
    jsonb_build_object(
      'organization_id', p_organization_id,
      'brand_id', v_brand_id,
      'member_id', p_member_id,
      'base_points', p_base_points,
      'source_type', p_source_type,
      'source_id', p_source_id,
      'reason', p_reason
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || v_brand_id::text || ':' || p_member_id::text,
      4
    )
  );

  select ledger.*
  into v_existing
  from public.loyalty_ledger as ledger
  where ledger.organization_id = p_organization_id
    and ledger.brand_id = v_brand_id
    and ledger.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint_sha256 is distinct from v_fingerprint then
      raise exception using
        errcode = '23505',
        message = 'Loyalty award idempotency key was already used for a different request.';
    end if;
    return v_existing.id;
  end if;

  if p_base_points <= 0 then
    raise exception using errcode = '22023', message = 'Award points must be positive.';
  end if;
  select coalesce(multiplier.multiplier, 1)
  into v_multiplier
  from public.members as member
  join public.organizations as organization
    on organization.id = member.organization_id
    and organization.loyalty_enabled
  left join public.loyalty_tier_multipliers as multiplier
    on multiplier.organization_id = member.organization_id
    and multiplier.brand_id = member.brand_id
    and multiplier.club_tier_id = member.club_tier_id
  where member.organization_id = p_organization_id
    and member.brand_id = v_brand_id
    and member.id = p_member_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Loyalty member not found or program disabled.';
  end if;

  v_points := floor(p_base_points * v_multiplier)::integer;
  v_expires_at := now() + interval '24 months';
  insert into public.loyalty_ledger (
    organization_id,
    brand_id,
    member_id,
    entry_type,
    points,
    reason,
    idempotency_key,
    request_fingerprint_sha256,
    source_event_type,
    source_event_id,
    actor_user_id,
    expires_at,
    metadata
  )
  values (
    p_organization_id,
    v_brand_id,
    p_member_id,
    'award',
    v_points,
    p_reason,
    p_idempotency_key,
    v_fingerprint,
    p_source_type,
    p_source_id,
    p_actor_user_id,
    v_expires_at,
    jsonb_build_object('base_points', p_base_points, 'multiplier', v_multiplier)
  )
  returning id into v_ledger_id;

  insert into public.loyalty_point_lots (
    organization_id,
    brand_id,
    member_id,
    award_ledger_id,
    awarded_points,
    remaining_points,
    expires_at
  )
  values (
    p_organization_id,
    v_brand_id,
    p_member_id,
    v_ledger_id,
    v_points,
    v_points,
    v_expires_at
  );
  return v_ledger_id;
end;
$$;

alter function public.record_member_activity_event(
  uuid,
  uuid,
  public.member_activity_event_type,
  text,
  uuid,
  text,
  timestamptz,
  jsonb
) rename to record_member_activity_event_phase3_legacy;

create or replace function public.record_member_activity_event(
  p_organization_id uuid,
  p_member_id uuid,
  p_event_type public.member_activity_event_type,
  p_source_entity_type text,
  p_source_entity_id uuid,
  p_idempotency_key text,
  p_occurred_at timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand_id uuid;
  v_existing public.member_activity_events%rowtype;
  v_event_id uuid;
  v_fingerprint text;
  v_award_points integer;
begin
  if jsonb_typeof(p_metadata) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Activity metadata must be an object.';
  end if;
  select member.brand_id
  into v_brand_id
  from public.members as member
  where member.organization_id = p_organization_id
    and member.id = p_member_id
    and member.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'Activity member not found.';
  end if;

  v_fingerprint := private.retention_request_fingerprint(
    jsonb_build_object(
      'organization_id', p_organization_id,
      'brand_id', v_brand_id,
      'member_id', p_member_id,
      'event_type', p_event_type,
      'source_entity_type', p_source_entity_type,
      'source_entity_id', p_source_entity_id,
      'occurred_at', p_occurred_at,
      'metadata', p_metadata
    )
  );

  select event.*
  into v_existing
  from public.member_activity_events as event
  where event.organization_id = p_organization_id
    and event.brand_id = v_brand_id
    and event.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint_sha256 is distinct from v_fingerprint then
      raise exception using
        errcode = '23505',
        message = 'Activity idempotency key was already used for a different request.';
    end if;
    return v_existing.id;
  end if;

  insert into public.member_activity_events (
    organization_id,
    brand_id,
    member_id,
    event_type,
    source_entity_type,
    source_entity_id,
    idempotency_key,
    request_fingerprint_sha256,
    occurred_at,
    metadata
  )
  values (
    p_organization_id,
    v_brand_id,
    p_member_id,
    p_event_type,
    p_source_entity_type,
    p_source_entity_id,
    p_idempotency_key,
    v_fingerprint,
    p_occurred_at,
    p_metadata
  )
  on conflict (organization_id, brand_id, idempotency_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select event.*
    into strict v_existing
    from public.member_activity_events as event
    where event.organization_id = p_organization_id
      and event.brand_id = v_brand_id
      and event.idempotency_key = p_idempotency_key;
    if v_existing.request_fingerprint_sha256 is distinct from v_fingerprint then
      raise exception using
        errcode = '23505',
        message = 'Activity idempotency key was already used for a different request.';
    end if;
    return v_existing.id;
  end if;

  v_award_points := case p_event_type
    when 'shipment_delivered' then 100
    when 'event_attendance' then 50
    when 'referral_completed' then 200
    when 'birthday' then 25
    when 'anniversary' then 50
    else null
  end;
  if v_award_points is not null then
    perform public.award_loyalty_points(
      p_organization_id,
      p_member_id,
      v_award_points,
      p_event_type,
      v_event_id,
      'loyalty:event:' || v_event_id::text,
      replace(p_event_type::text, '_', ' ') || ' award',
      null
    );
  end if;
  if p_event_type = 'portal_login' then
    update public.members
    set last_portal_login_at = greatest(
      coalesce(last_portal_login_at, '-infinity'::timestamptz),
      p_occurred_at
    )
    where organization_id = p_organization_id
      and brand_id = v_brand_id
      and id = p_member_id;
  end if;
  return v_event_id;
end;
$$;

alter function public.reserve_loyalty_discount(
  uuid,
  uuid,
  uuid,
  integer,
  text,
  uuid
) rename to reserve_loyalty_discount_phase3_legacy;

create or replace function public.reserve_loyalty_discount(
  p_organization_id uuid,
  p_member_id uuid,
  p_shipment_id uuid,
  p_points integer,
  p_idempotency_key text,
  p_actor_user_id uuid default null
)
returns public.loyalty_redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand_id uuid;
  v_existing public.loyalty_redemptions%rowtype;
  v_redemption public.loyalty_redemptions%rowtype;
  v_fingerprint text;
begin
  select member.brand_id
  into v_brand_id
  from public.members as member
  where member.organization_id = p_organization_id
    and member.id = p_member_id
    and member.deleted_at is null;
  if not found or not exists (
    select 1
    from public.shipments as shipment
    where shipment.organization_id = p_organization_id
      and shipment.brand_id = v_brand_id
      and shipment.member_id = p_member_id
      and shipment.id = p_shipment_id
  ) then
    raise exception using errcode = 'P0002', message = 'Eligible shipment not found.';
  end if;
  perform 1
  from private.resolve_retention_actor_brand(
    p_organization_id,
    v_brand_id,
    p_member_id,
    p_actor_user_id
  );

  v_fingerprint := private.retention_request_fingerprint(
    jsonb_build_object(
      'organization_id', p_organization_id,
      'brand_id', v_brand_id,
      'member_id', p_member_id,
      'shipment_id', p_shipment_id,
      'points', p_points,
      'actor_user_id', p_actor_user_id
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || v_brand_id::text || ':' || p_member_id::text,
      5
    )
  );

  select redemption.*
  into v_existing
  from public.loyalty_redemptions as redemption
  where redemption.organization_id = p_organization_id
    and redemption.brand_id = v_brand_id
    and redemption.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint_sha256 is distinct from v_fingerprint then
      raise exception using
        errcode = '23505',
        message = 'Loyalty reservation idempotency key was already used for a different request.';
    end if;
    return v_existing;
  end if;

  v_redemption := public.reserve_loyalty_discount_phase3_legacy(
    p_organization_id,
    p_member_id,
    p_shipment_id,
    p_points,
    'loyalty:legacy:' || encode(
      extensions.digest(
        convert_to(
          p_organization_id::text || ':' || v_brand_id::text || ':'
            || p_idempotency_key,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    p_actor_user_id
  );
  update public.loyalty_redemptions
  set
    idempotency_key = p_idempotency_key,
    request_fingerprint_sha256 = v_fingerprint
  where organization_id = p_organization_id
    and brand_id = v_brand_id
    and id = v_redemption.id
  returning * into v_redemption;
  return v_redemption;
end;
$$;

create or replace function public.reserve_loyalty_discount_command(
  p_organization_id uuid,
  p_brand_id uuid,
  p_member_id uuid,
  p_shipment_id uuid,
  p_points integer,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_request_fingerprint_sha256 text
)
returns public.loyalty_redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_redemption public.loyalty_redemptions%rowtype;
begin
  perform 1
  from private.resolve_retention_actor_brand(
    p_organization_id,
    p_brand_id,
    p_member_id,
    p_actor_user_id
  );
  v_replay := private.load_retention_command(
    p_organization_id,
    p_brand_id,
    p_command_id,
    'loyalty.reserve',
    p_request_fingerprint_sha256
  );
  if v_replay is not null then
    select redemption.*
    into strict v_redemption
    from public.loyalty_redemptions as redemption
    where redemption.organization_id = p_organization_id
      and redemption.brand_id = p_brand_id
      and redemption.id = (v_replay ->> 'redemptionId')::uuid;
    return v_redemption;
  end if;

  v_redemption := public.reserve_loyalty_discount(
    p_organization_id,
    p_member_id,
    p_shipment_id,
    p_points,
    'loyalty:command:reserve:' || p_command_id::text,
    p_actor_user_id
  );
  perform private.store_retention_command(
    p_organization_id,
    p_brand_id,
    p_command_id,
    'loyalty.reserve',
    p_request_fingerprint_sha256,
    'loyalty_redemption',
    v_redemption.id,
    jsonb_build_object('redemptionId', v_redemption.id)
  );
  return v_redemption;
end;
$$;

alter function public.adjust_loyalty_points(
  uuid,
  uuid,
  integer,
  text,
  text,
  uuid
) rename to adjust_loyalty_points_phase3_legacy;

create or replace function public.adjust_loyalty_points(
  p_organization_id uuid,
  p_member_id uuid,
  p_points integer,
  p_reason text,
  p_idempotency_key text,
  p_actor_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand_id uuid;
  v_actor record;
  v_existing public.loyalty_ledger%rowtype;
  v_lot public.loyalty_point_lots%rowtype;
  v_available integer := 0;
  v_ledger_id uuid;
  v_fingerprint text;
  v_needed integer;
  v_take integer;
  v_expires_at timestamptz;
begin
  select member.brand_id
  into v_brand_id
  from public.members as member
  where member.organization_id = p_organization_id
    and member.id = p_member_id
    and member.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'Loyalty member not found.';
  end if;
  select *
  into v_actor
  from private.resolve_retention_actor_brand(
    p_organization_id,
    v_brand_id,
    p_member_id,
    p_actor_user_id
  );
  v_fingerprint := private.retention_request_fingerprint(
    jsonb_build_object(
      'organization_id', p_organization_id,
      'brand_id', v_brand_id,
      'member_id', p_member_id,
      'points', p_points,
      'reason', btrim(p_reason),
      'actor_user_id', p_actor_user_id
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || v_brand_id::text || ':' || p_member_id::text,
      6
    )
  );

  select ledger.*
  into v_existing
  from public.loyalty_ledger as ledger
  where ledger.organization_id = p_organization_id
    and ledger.brand_id = v_brand_id
    and ledger.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint_sha256 is distinct from v_fingerprint then
      raise exception using
        errcode = '23505',
        message = 'Loyalty adjustment idempotency key was already used for a different request.';
    end if;
    return v_existing.id;
  end if;

  if p_points < 0 then
    for v_lot in
      select lot.*
      from public.loyalty_point_lots as lot
      where lot.organization_id = p_organization_id
        and lot.brand_id = v_brand_id
        and lot.member_id = p_member_id
        and lot.expires_at > now()
        and lot.remaining_points > lot.reserved_points
      order by lot.expires_at, lot.created_at, lot.id
      for update
    loop
      v_available := v_available + (v_lot.remaining_points - v_lot.reserved_points);
    end loop;
    if v_available < abs(p_points) then
      raise exception using errcode = '40001', message = 'Loyalty availability changed; retry.';
    end if;
    v_needed := abs(p_points);
    for v_lot in
      select lot.*
      from public.loyalty_point_lots as lot
      where lot.organization_id = p_organization_id
        and lot.brand_id = v_brand_id
        and lot.member_id = p_member_id
        and lot.expires_at > now()
        and lot.remaining_points > lot.reserved_points
      order by lot.expires_at, lot.created_at, lot.id
      for update
    loop
      exit when v_needed = 0;
      v_take := least(v_needed, v_lot.remaining_points - v_lot.reserved_points);
      update public.loyalty_point_lots
      set remaining_points = remaining_points - v_take
      where organization_id = p_organization_id
        and brand_id = v_brand_id
        and id = v_lot.id;
      v_needed := v_needed - v_take;
    end loop;
    if v_needed <> 0 then
      raise exception using errcode = '40001', message = 'Loyalty availability changed; retry.';
    end if;
  end if;

  if p_points = 0 or char_length(btrim(p_reason)) < 3 then
    raise exception using errcode = '22023', message = 'Adjustment and reason are required.';
  end if;
  v_expires_at := case
    when p_points > 0 then now() + interval '24 months'
    else null
  end;
  insert into public.loyalty_ledger (
    organization_id,
    brand_id,
    member_id,
    entry_type,
    points,
    reason,
    idempotency_key,
    request_fingerprint_sha256,
    actor_user_id,
    expires_at,
    metadata
  )
  values (
    p_organization_id,
    v_brand_id,
    p_member_id,
    'manual_adjustment',
    p_points,
    p_reason,
    p_idempotency_key,
    v_fingerprint,
    v_actor.actor_user_id,
    v_expires_at,
    jsonb_build_object('manual', true)
  )
  returning id into v_ledger_id;

  if p_points > 0 then
    insert into public.loyalty_point_lots (
      organization_id,
      brand_id,
      member_id,
      award_ledger_id,
      awarded_points,
      remaining_points,
      expires_at
    )
    values (
      p_organization_id,
      v_brand_id,
      p_member_id,
      v_ledger_id,
      p_points,
      p_points,
      v_expires_at
    );
  end if;
  perform public.append_audit_entry(
    p_organization_id,
    v_brand_id,
    v_actor.actor_user_id,
    'loyalty.manually_adjusted',
    'loyalty_ledger',
    v_ledger_id,
    jsonb_build_object(
      'member_id', p_member_id,
      'points', p_points,
      'reason', p_reason
    )
  );
  return v_ledger_id;
end;
$$;

create or replace function public.adjust_loyalty_points_command(
  p_organization_id uuid,
  p_brand_id uuid,
  p_member_id uuid,
  p_points integer,
  p_reason text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_request_fingerprint_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_ledger_id uuid;
begin
  perform 1
  from private.resolve_retention_actor_brand(
    p_organization_id,
    p_brand_id,
    p_member_id,
    p_actor_user_id
  );
  v_replay := private.load_retention_command(
    p_organization_id,
    p_brand_id,
    p_command_id,
    'loyalty.adjust',
    p_request_fingerprint_sha256
  );
  if v_replay is not null then
    return (v_replay ->> 'ledgerId')::uuid;
  end if;
  v_ledger_id := public.adjust_loyalty_points(
    p_organization_id,
    p_member_id,
    p_points,
    p_reason,
    'loyalty:command:adjust:' || p_command_id::text,
    p_actor_user_id
  );
  perform private.store_retention_command(
    p_organization_id,
    p_brand_id,
    p_command_id,
    'loyalty.adjust',
    p_request_fingerprint_sha256,
    'loyalty_ledger',
    v_ledger_id,
    jsonb_build_object('ledgerId', v_ledger_id)
  );
  return v_ledger_id;
end;
$$;

create or replace function public.finalize_loyalty_redemption_command(
  p_organization_id uuid,
  p_brand_id uuid,
  p_redemption_id uuid,
  p_apply boolean,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_request_fingerprint_sha256 text
)
returns public.loyalty_redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_redemption public.loyalty_redemptions%rowtype;
begin
  select redemption.*
  into v_redemption
  from public.loyalty_redemptions as redemption
  where redemption.organization_id = p_organization_id
    and redemption.brand_id = p_brand_id
    and redemption.id = p_redemption_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Loyalty redemption not found.';
  end if;
  perform 1
  from private.resolve_retention_actor_brand(
    p_organization_id,
    p_brand_id,
    v_redemption.member_id,
    p_actor_user_id
  );
  v_replay := private.load_retention_command(
    p_organization_id,
    p_brand_id,
    p_command_id,
    'loyalty.finalize',
    p_request_fingerprint_sha256
  );
  if v_replay is not null then
    select redemption.*
    into strict v_redemption
    from public.loyalty_redemptions as redemption
    where redemption.organization_id = p_organization_id
      and redemption.brand_id = p_brand_id
      and redemption.id = p_redemption_id;
    return v_redemption;
  end if;

  v_redemption := public.finalize_loyalty_redemption(
    p_organization_id,
    p_redemption_id,
    p_apply,
    p_actor_user_id
  );
  update public.loyalty_redemptions
  set request_fingerprint_sha256 = p_request_fingerprint_sha256
  where id = p_redemption_id;
  perform private.store_retention_command(
    p_organization_id,
    p_brand_id,
    p_command_id,
    'loyalty.finalize',
    p_request_fingerprint_sha256,
    'loyalty_redemption',
    p_redemption_id,
    jsonb_build_object('redemptionId', p_redemption_id, 'status', v_redemption.status)
  );
  return v_redemption;
end;
$$;

create or replace function public.start_cancel_flow(
  p_organization_id uuid,
  p_member_id uuid,
  p_actor_user_id uuid default null
)
returns public.cancel_flow_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_brand_id uuid;
  v_command_id uuid := gen_random_uuid();
begin
  select member.brand_id
  into v_brand_id
  from public.members as member
  where member.organization_id = p_organization_id
    and member.id = p_member_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Member not found.';
  end if;
  return public.start_cancel_flow(
    p_organization_id,
    v_brand_id,
    p_member_id,
    p_actor_user_id,
    v_command_id,
    private.retention_request_fingerprint(
      jsonb_build_object(
        'command', 'cancel.start',
        'organization_id', p_organization_id,
        'brand_id', v_brand_id,
        'member_id', p_member_id,
        'actor_user_id', p_actor_user_id
      )
    )
  );
end;
$$;

create or replace function private.release_loyalty_reservation(
  p_redemption public.loyalty_redemptions,
  p_status public.loyalty_redemption_status,
  p_actor_user_id uuid default null
)
returns public.loyalty_redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allocation record;
  v_updated public.loyalty_redemptions%rowtype;
begin
  if p_status not in ('released', 'expired') then
    raise exception using errcode = '22023', message = 'Invalid release status.';
  end if;

  for v_allocation in
    select allocation.lot_id, allocation.points
    from public.loyalty_reservation_allocations as allocation
    where allocation.organization_id = p_redemption.organization_id
      and allocation.brand_id = p_redemption.brand_id
      and allocation.redemption_id = p_redemption.id
    order by allocation.created_at, allocation.id
  loop
    update public.loyalty_point_lots
    set reserved_points = reserved_points - v_allocation.points
    where organization_id = p_redemption.organization_id
      and brand_id = p_redemption.brand_id
      and id = v_allocation.lot_id;
  end loop;

  insert into public.loyalty_ledger (
    organization_id,
    brand_id,
    member_id,
    entry_type,
    points,
    reason,
    idempotency_key,
    redemption_id,
    actor_user_id,
    metadata
  )
  values (
    p_redemption.organization_id,
    p_redemption.brand_id,
    p_redemption.member_id,
    'reservation_release',
    p_redemption.points,
    case when p_status = 'expired'
      then 'Expired loyalty reservation released'
      else 'Loyalty reservation released'
    end,
    'loyalty:release:' || p_redemption.id::text,
    p_redemption.id,
    p_actor_user_id,
    jsonb_build_object('release_status', p_status)
  )
  on conflict (organization_id, brand_id, idempotency_key) do nothing;

  update public.shipments
  set loyalty_discount_cents = 0, loyalty_redemption_id = null
  where organization_id = p_redemption.organization_id
    and brand_id = p_redemption.brand_id
    and loyalty_redemption_id = p_redemption.id;

  update public.loyalty_redemptions
  set status = p_status, released_at = now()
  where organization_id = p_redemption.organization_id
    and brand_id = p_redemption.brand_id
    and id = p_redemption.id
    and status = 'held'
  returning * into v_updated;
  return v_updated;
end;
$$;

create or replace function private.reverse_applied_loyalty_redemption(
  p_redemption public.loyalty_redemptions
)
returns public.loyalty_redemptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allocation record;
  v_updated public.loyalty_redemptions%rowtype;
begin
  if p_redemption.status <> 'applied' then
    return p_redemption;
  end if;

  for v_allocation in
    select allocation.lot_id, allocation.points
    from public.loyalty_reservation_allocations as allocation
    where allocation.organization_id = p_redemption.organization_id
      and allocation.brand_id = p_redemption.brand_id
      and allocation.redemption_id = p_redemption.id
    order by allocation.created_at, allocation.id
  loop
    update public.loyalty_point_lots
    set remaining_points = remaining_points + v_allocation.points
    where organization_id = p_redemption.organization_id
      and brand_id = p_redemption.brand_id
      and id = v_allocation.lot_id;
  end loop;

  insert into public.loyalty_ledger (
    organization_id,
    brand_id,
    member_id,
    entry_type,
    points,
    reason,
    idempotency_key,
    redemption_id,
    actor_user_id,
    metadata
  )
  values (
    p_redemption.organization_id,
    p_redemption.brand_id,
    p_redemption.member_id,
    'reservation_release',
    p_redemption.points,
    'Refunded shipment restored redeemed loyalty points',
    'loyalty:reverse:' || p_redemption.id::text,
    p_redemption.id,
    p_redemption.created_by,
    jsonb_build_object('shipment_id', p_redemption.shipment_id)
  )
  on conflict (organization_id, brand_id, idempotency_key) do nothing;

  update public.loyalty_redemptions
  set status = 'reversed', reversed_at = now()
  where organization_id = p_redemption.organization_id
    and brand_id = p_redemption.brand_id
    and id = p_redemption.id
    and status = 'applied'
  returning * into v_updated;

  perform public.append_audit_entry(
    p_redemption.organization_id,
    p_redemption.brand_id,
    p_redemption.created_by,
    'loyalty.redemption_reversed',
    'loyalty_redemption',
    p_redemption.id,
    jsonb_build_object(
      'member_id', p_redemption.member_id,
      'shipment_id', p_redemption.shipment_id,
      'points', p_redemption.points
    )
  );
  return v_updated;
end;
$$;

create or replace function public.expire_loyalty_points(
  p_as_of timestamptz default now(),
  p_organization_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot public.loyalty_point_lots%rowtype;
  v_expired integer;
  v_count integer := 0;
begin
  perform public.release_expired_loyalty_reservations(
    p_as_of,
    p_organization_id
  );
  for v_lot in
    select lot.*
    from public.loyalty_point_lots as lot
    where lot.expires_at <= p_as_of
      and lot.remaining_points > lot.reserved_points
      and (
        p_organization_id is null
        or lot.organization_id = p_organization_id
      )
    order by lot.expires_at, lot.created_at, lot.id
    for update skip locked
  loop
    v_expired := v_lot.remaining_points - v_lot.reserved_points;
    update public.loyalty_point_lots
    set remaining_points = reserved_points
    where organization_id = v_lot.organization_id
      and brand_id = v_lot.brand_id
      and id = v_lot.id;

    insert into public.loyalty_ledger (
      organization_id,
      brand_id,
      member_id,
      entry_type,
      points,
      reason,
      idempotency_key,
      metadata
    )
    values (
      v_lot.organization_id,
      v_lot.brand_id,
      v_lot.member_id,
      'expiration',
      -v_expired,
      'Loyalty points expired after 24 months',
      'loyalty:expire:' || v_lot.id::text,
      jsonb_build_object('lot_id', v_lot.id)
    )
    on conflict (organization_id, brand_id, idempotency_key) do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on table private.retention_command_results from public, anon, authenticated;
revoke all on table private.retention_daily_job_runs from public, anon, authenticated;
revoke all on table private.retention_brand_daily_job_runs
  from public, anon, authenticated;
revoke all on table public.email_provider_event_inbox from public, anon, authenticated;
grant select, insert, update on table private.retention_command_results to service_role;
grant select, insert on table private.retention_daily_job_runs to service_role;
grant select, insert on table private.retention_brand_daily_job_runs
  to service_role;
grant select, insert, update on table public.email_provider_event_inbox to service_role;

revoke execute on function private.validate_brand_time_zone() from public, anon, authenticated;
revoke execute on function private.retention_request_fingerprint(jsonb) from public, anon, authenticated;
revoke execute on function private.assert_retention_fingerprint(text) from public, anon, authenticated;
revoke execute on function private.load_retention_command(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
revoke execute on function private.store_retention_command(
  uuid, uuid, uuid, text, text, text, uuid, jsonb
) from public, anon, authenticated;
revoke execute on function private.resolve_retention_actor_brand(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke execute on function private.assign_loyalty_allocation_member()
  from public, anon, authenticated;
revoke execute on function private.seed_phase3_brand_defaults()
  from public, anon, authenticated;
revoke execute on function private.email_status_rank(public.email_status)
  from public, anon, authenticated;
revoke execute on function private.converge_email_status(
  uuid, uuid, public.email_status, timestamptz, text
) from public, anon, authenticated;
revoke execute on function private.reconcile_email_provider_events(text)
  from public, anon, authenticated;
revoke execute on function private.process_brand_daily_loyalty_awards(
  uuid, uuid, date, timestamptz
) from public, anon, authenticated;

grant execute on function private.retention_request_fingerprint(jsonb) to service_role;
grant execute on function private.assert_retention_fingerprint(text) to service_role;
grant execute on function private.load_retention_command(uuid, uuid, uuid, text, text)
  to service_role;
grant execute on function private.store_retention_command(
  uuid, uuid, uuid, text, text, text, uuid, jsonb
) to service_role;
grant execute on function private.resolve_retention_actor_brand(uuid, uuid, uuid, uuid)
  to service_role;
grant execute on function private.email_status_rank(public.email_status) to service_role;
grant execute on function private.converge_email_status(
  uuid, uuid, public.email_status, timestamptz, text
) to service_role;
grant execute on function private.reconcile_email_provider_events(text) to service_role;
grant execute on function private.process_brand_daily_loyalty_awards(
  uuid, uuid, date, timestamptz
) to service_role;

revoke execute on function public.claim_email_outbox_batch(text, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.complete_email_outbox_claim(
  uuid, uuid, public.email_status, text, text
) from public, anon, authenticated;
revoke execute on function public.record_email_provider_event(
  text, text, public.email_delivery_event_type, timestamptz, jsonb
) from public, anon, authenticated;
revoke execute on function public.expire_stale_cancel_flow_attempts(timestamptz, integer)
  from public, anon, authenticated;
revoke execute on function public.resume_due_paused_members(date, integer)
  from public, anon, authenticated;
revoke execute on function public.start_cancel_flow(uuid, uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.record_cancel_flow_step(
  uuid, uuid, uuid, uuid, public.cancel_flow_outcome, jsonb, uuid, uuid, text
) from public, anon, authenticated;
revoke execute on function public.reserve_loyalty_discount_command(
  uuid, uuid, uuid, uuid, integer, uuid, uuid, text
) from public, anon, authenticated;
revoke execute on function public.adjust_loyalty_points_command(
  uuid, uuid, uuid, integer, text, uuid, uuid, text
) from public, anon, authenticated;
revoke execute on function public.finalize_loyalty_redemption_command(
  uuid, uuid, uuid, boolean, uuid, uuid, text
) from public, anon, authenticated;
revoke execute on function public.run_retention_daily_jobs(date)
  from public, anon, authenticated;

grant execute on function public.claim_email_outbox_batch(text, integer, integer)
  to service_role;
grant execute on function public.complete_email_outbox_claim(
  uuid, uuid, public.email_status, text, text
) to service_role;
grant execute on function public.record_email_provider_event(
  text, text, public.email_delivery_event_type, timestamptz, jsonb
) to service_role;
grant execute on function public.expire_stale_cancel_flow_attempts(timestamptz, integer)
  to service_role;
grant execute on function public.resume_due_paused_members(date, integer)
  to service_role;
grant execute on function public.start_cancel_flow(uuid, uuid, uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.record_cancel_flow_step(
  uuid, uuid, uuid, uuid, public.cancel_flow_outcome, jsonb, uuid, uuid, text
) to service_role;
grant execute on function public.reserve_loyalty_discount_command(
  uuid, uuid, uuid, uuid, integer, uuid, uuid, text
) to service_role;
grant execute on function public.adjust_loyalty_points_command(
  uuid, uuid, uuid, integer, text, uuid, uuid, text
) to service_role;
grant execute on function public.finalize_loyalty_redemption_command(
  uuid, uuid, uuid, boolean, uuid, uuid, text
) to service_role;
grant execute on function public.run_retention_daily_jobs(date)
  to service_role;

revoke execute on function public.get_cancel_flow_analytics(
  uuid, uuid, timestamptz, timestamptz
) from public, anon, authenticated;
revoke execute on function public.get_cancel_flow_analytics_snapshot(
  uuid, uuid, timestamptz, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.get_cancel_flow_analytics(
  uuid, uuid, timestamptz, timestamptz
) to service_role;
grant execute on function public.get_cancel_flow_analytics_snapshot(
  uuid, uuid, timestamptz, timestamptz, integer
) to service_role;

-- Reapply privileges after legacy function renames and replacements above.
revoke execute on function public.enqueue_email_trigger(
  uuid, uuid, public.email_trigger_type, text, jsonb, timestamptz
) from public, anon, authenticated;
revoke execute on function public.record_email_delivery_event(
  uuid, uuid, text, public.email_delivery_event_type, timestamptz, jsonb
) from public, anon, authenticated;
revoke execute on function public.enqueue_due_email_triggers(timestamptz)
  from public, anon, authenticated;
revoke execute on function public.award_loyalty_points(
  uuid, uuid, integer, public.member_activity_event_type, uuid, text, text, uuid
) from public, anon, authenticated;
revoke execute on function public.record_member_activity_event(
  uuid, uuid, public.member_activity_event_type, text, uuid, text, timestamptz, jsonb
) from public, anon, authenticated;
revoke execute on function public.update_cancel_flow_configuration(uuid, uuid, jsonb, uuid)
  from public, anon, authenticated;
revoke execute on function public.update_cancel_flow_configuration(uuid, jsonb, uuid)
  from public, anon, authenticated;
revoke execute on function public.start_cancel_flow(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.record_cancel_flow_step(
  uuid, uuid, uuid, public.cancel_flow_outcome, jsonb, uuid
) from public, anon, authenticated;
revoke execute on function public.reserve_loyalty_discount(
  uuid, uuid, uuid, integer, text, uuid
) from public, anon, authenticated;
revoke execute on function public.adjust_loyalty_points(
  uuid, uuid, integer, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.enqueue_email_trigger(
  uuid, uuid, public.email_trigger_type, text, jsonb, timestamptz
) to service_role;
grant execute on function public.record_email_delivery_event(
  uuid, uuid, text, public.email_delivery_event_type, timestamptz, jsonb
) to service_role;
grant execute on function public.enqueue_due_email_triggers(timestamptz)
  to service_role;
grant execute on function public.award_loyalty_points(
  uuid, uuid, integer, public.member_activity_event_type, uuid, text, text, uuid
) to service_role;
grant execute on function public.record_member_activity_event(
  uuid, uuid, public.member_activity_event_type, text, uuid, text, timestamptz, jsonb
) to service_role;
grant execute on function public.update_cancel_flow_configuration(uuid, uuid, jsonb, uuid)
  to service_role;
grant execute on function public.update_cancel_flow_configuration(uuid, jsonb, uuid)
  to service_role;
grant execute on function public.start_cancel_flow(uuid, uuid, uuid)
  to service_role;
grant execute on function public.record_cancel_flow_step(
  uuid, uuid, uuid, public.cancel_flow_outcome, jsonb, uuid
) to service_role;
grant execute on function public.reserve_loyalty_discount(
  uuid, uuid, uuid, integer, text, uuid
) to service_role;
grant execute on function public.adjust_loyalty_points(
  uuid, uuid, integer, text, text, uuid
) to service_role;

commit;
