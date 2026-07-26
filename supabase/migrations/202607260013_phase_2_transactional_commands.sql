-- Phase 2 transactional command hardening.
-- Business state, append-only audit evidence, replay results, and external
-- side-effect intent are committed together. Provider calls remain outside the
-- database transaction and are reconciled through a leased outbox.

begin;

alter table public.billing_attempts
  add column recovery_lease_token uuid,
  add column recovery_lease_owner text,
  add column recovery_lease_expires_at timestamptz,
  add column recovery_available_at timestamptz,
  add column recovery_attempt_count integer not null default 0,
  add constraint billing_attempts_recovery_attempt_count_nonnegative
    check (recovery_attempt_count >= 0),
  add constraint billing_attempts_recovery_lease_consistent
    check (
      (
        recovery_lease_token is null
        and recovery_lease_owner is null
        and recovery_lease_expires_at is null
      )
      or (
        recovery_lease_token is not null
        and recovery_lease_owner is not null
        and recovery_lease_expires_at is not null
      )
    );

create index billing_attempts_refund_recovery_idx
  on public.billing_attempts (
    recovery_available_at,
    started_at,
    recovery_lease_expires_at
  )
  where attempt_kind = 'refund'
    and status = 'processing';

-- Migration 004 attaches this function to both organizations and members.
-- Branch before dereferencing table-specific trigger-record fields so a member
-- update never attempts to read organization-only columns (and vice versa).
create or replace function private.invalidate_dependent_compliance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'organizations' then
    if new.shipping_origin_address is distinct
      from old.shipping_origin_address
    then
      update public.shipments
      set
        latest_compliance_check_id = null,
        latest_compliance_request_fingerprint = null,
        latest_compliance_state_fingerprint = null,
        compliance_status = null,
        compliance_reason = null,
        compliance_tax_estimate_cents = null,
        compliance_checked_at = null
      where organization_id = new.id
        and status = 'charged'
        and latest_compliance_check_id is not null;
    end if;
  elsif tg_table_name = 'members' then
    if new.birthday is distinct from old.birthday then
      update public.shipments
      set
        latest_compliance_check_id = null,
        latest_compliance_request_fingerprint = null,
        latest_compliance_state_fingerprint = null,
        compliance_status = null,
        compliance_reason = null,
        compliance_tax_estimate_cents = null,
        compliance_checked_at = null
      where organization_id = new.organization_id
        and member_id = new.id
        and status = 'charged'
        and latest_compliance_check_id is not null;
    end if;
  end if;
  return new;
end;
$$;

create table private.core_club_command_results (
  organization_id uuid not null,
  brand_id uuid not null,
  command_id uuid not null,
  actor_user_id uuid not null,
  operation text not null,
  payload_sha256 text not null,
  entity_type text not null,
  entity_id uuid,
  result jsonb not null,
  audit_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, brand_id, command_id),
  constraint core_club_commands_brand_fkey
    foreign key (organization_id, brand_id)
    references public.brands (organization_id, id)
    on delete cascade,
  constraint core_club_commands_operation_format check (
    operation ~ '^(club_tier|member|release)[.][a-z_]+$'
    and char_length(operation) between 5 and 100
  ),
  constraint core_club_commands_payload_hash_format check (
    payload_sha256 ~ '^[a-f0-9]{64}$'
  ),
  constraint core_club_commands_entity_type_format check (
    entity_type in ('club_tier', 'member', 'release', 'organization')
  ),
  constraint core_club_commands_result_object check (
    jsonb_typeof(result) = 'object'
  )
);

create index core_club_command_actor_created_idx
  on private.core_club_command_results (
    organization_id,
    brand_id,
    actor_user_id,
    created_at desc
  );

create table private.member_side_effect_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  command_id uuid not null,
  member_id uuid,
  effect_type text not null,
  provider_subject_id text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 8,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_side_effect_command_fkey
    foreign key (organization_id, brand_id, command_id)
    references private.core_club_command_results (
      organization_id,
      brand_id,
      command_id
    )
    deferrable initially deferred,
  constraint member_side_effect_brand_fkey
    foreign key (organization_id, brand_id)
    references public.brands (organization_id, id)
    on delete cascade,
  constraint member_side_effect_command_kind_key
    unique (organization_id, brand_id, command_id, effect_type),
  constraint member_side_effect_type_valid check (
    effect_type in ('stripe_customer_sync', 'auth_user_delete')
  ),
  constraint member_side_effect_provider_subject_length check (
    char_length(provider_subject_id) between 3 and 255
  ),
  constraint member_side_effect_payload_object check (
    jsonb_typeof(payload) = 'object'
  ),
  constraint member_side_effect_status_valid check (
    status in ('pending', 'processing', 'retry', 'completed', 'dead_letter')
  ),
  constraint member_side_effect_attempt_count_valid check (
    attempt_count between 0 and max_attempts
    and max_attempts between 1 and 20
  ),
  constraint member_side_effect_error_code_valid check (
    last_error_code is null
    or last_error_code ~ '^[A-Z0-9_.:-]{1,100}$'
  ),
  constraint member_side_effect_lease_valid check (
    (
      status = 'processing'
      and lease_token is not null
      and lease_owner ~ '^[A-Za-z0-9_.:@/-]{1,128}$'
      and lease_expires_at is not null
    )
    or (
      status <> 'processing'
      and lease_token is null
      and lease_owner is null
      and lease_expires_at is null
    )
  ),
  constraint member_side_effect_completion_valid check (
    (status in ('completed', 'dead_letter') and completed_at is not null)
    or (status not in ('completed', 'dead_letter') and completed_at is null)
  )
);

create index member_side_effect_claim_idx
  on private.member_side_effect_outbox (
    available_at,
    created_at,
    id
  )
  where status in ('pending', 'retry');

create index member_side_effect_lease_idx
  on private.member_side_effect_outbox (lease_expires_at)
  where status = 'processing';

create index member_side_effect_member_idx
  on private.member_side_effect_outbox (
    organization_id,
    brand_id,
    member_id,
    created_at desc
  )
  where member_id is not null;

alter table private.core_club_command_results enable row level security;
alter table private.core_club_command_results force row level security;
alter table private.member_side_effect_outbox enable row level security;
alter table private.member_side_effect_outbox force row level security;

revoke all on table private.core_club_command_results
  from public, anon, authenticated;
revoke all on table private.member_side_effect_outbox
  from public, anon, authenticated;
grant all on table private.core_club_command_results to service_role;
grant all on table private.member_side_effect_outbox to service_role;

create trigger member_side_effect_outbox_touch_updated_at
before update on private.member_side_effect_outbox
for each row execute function private.touch_updated_at();

create or replace function private.core_club_command_hash(
  p_operation text,
  p_input jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'operation',
          lower(btrim(p_operation)),
          'input',
          coalesce(p_input, '{}'::jsonb)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function private.load_core_club_command(
  p_organization_id uuid,
  p_brand_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_operation text,
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_command private.core_club_command_results%rowtype;
  v_payload_sha256 text;
begin
  if p_command_id is null then
    raise exception using
      errcode = '22023',
      message = 'A command id is required.';
  end if;

  v_payload_sha256 :=
    private.core_club_command_hash(p_operation, p_input);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text
      || ':'
      || p_brand_id::text
      || ':'
      || p_command_id::text,
      13
    )
  );

  select command.*
  into v_command
  from private.core_club_command_results as command
  where command.organization_id = p_organization_id
    and command.brand_id = p_brand_id
    and command.command_id = p_command_id;

  if found then
    if v_command.actor_user_id <> p_actor_user_id
      or v_command.operation <> lower(btrim(p_operation))
      or v_command.payload_sha256 <> v_payload_sha256
    then
      raise exception using
        errcode = '23505',
        message = 'The idempotency key was reused with different command input.';
    end if;
    return v_command.result || jsonb_build_object('replayed', true);
  end if;

  return null;
end;
$$;

create or replace function private.assert_release_ready(
  p_organization_id uuid,
  p_brand_id uuid,
  p_release_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.release_tiers as tier
    where tier.organization_id = p_organization_id
      and tier.brand_id = p_brand_id
      and tier.release_id = p_release_id
  )
    or not exists (
      select 1
      from public.release_wines as wine
      where wine.organization_id = p_organization_id
        and wine.brand_id = p_brand_id
        and wine.release_id = p_release_id
    )
    or not exists (
      select 1
      from public.release_tier_items as item
      where item.organization_id = p_organization_id
        and item.brand_id = p_brand_id
        and item.release_id = p_release_id
    )
    or exists (
      select 1
      from public.release_tiers as tier
      left join public.release_tier_items as item
        on item.organization_id = tier.organization_id
        and item.brand_id = tier.brand_id
        and item.release_id = tier.release_id
        and item.release_tier_id = tier.id
      where tier.organization_id = p_organization_id
        and tier.brand_id = p_brand_id
        and tier.release_id = p_release_id
      group by tier.id, tier.bottle_count
      having count(item.id) = 0
        or coalesce(sum(item.quantity), 0) <> tier.bottle_count
    )
  then
    raise exception using
      errcode = '23514',
      message = 'Every release tier must contain its snapshotted bottle count before scheduling.';
  end if;
end;
$$;

create or replace function public.apply_release_command(
  p_organization_id uuid,
  p_brand_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_operation text,
  p_release_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audit_id uuid;
  v_command_input jsonb;
  v_operation text := lower(btrim(p_operation));
  v_release public.releases%rowtype;
  v_release_tier public.release_tiers%rowtype;
  v_release_wine public.release_wines%rowtype;
  v_replay jsonb;
  v_result jsonb;
  v_tier record;
  v_wine record;
  v_wine_ids uuid[] := '{}'::uuid[];
begin
  perform private.require_core_club_staff(
    p_organization_id,
    p_brand_id,
    p_actor_user_id,
    array['owner', 'admin', 'manager']::public.staff_role[]
  );
  if v_operation not in ('create', 'update', 'schedule')
    or jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload - array[
      'description',
      'embargo_date',
      'initial_status',
      'name',
      'processing_date',
      'tiers',
      'wines'
    ] <> '{}'::jsonb
  then
    raise exception using
      errcode = '22023',
      message = 'The release command is invalid.';
  end if;

  v_command_input := jsonb_build_object(
    'release_id',
    p_release_id,
    'payload',
    p_payload
  );
  v_replay := private.load_core_club_command(
    p_organization_id,
    p_brand_id,
    p_actor_user_id,
    p_command_id,
    'release.' || v_operation,
    v_command_input
  );
  if v_replay is not null then
    return v_replay;
  end if;

  if v_operation in ('create', 'update') then
    if not (
      p_payload ? 'name'
      and p_payload ? 'processing_date'
      and p_payload ? 'embargo_date'
      and p_payload ? 'tiers'
      and p_payload ? 'wines'
      and jsonb_typeof(p_payload -> 'tiers') = 'array'
      and jsonb_typeof(p_payload -> 'wines') = 'array'
      and jsonb_array_length(p_payload -> 'tiers') > 0
      and jsonb_array_length(p_payload -> 'wines') > 0
    ) then
      raise exception using
        errcode = '22023',
        message = 'The release aggregate payload is incomplete.';
    end if;
    if (
      select count(*) <> count(distinct tier_id)
      from jsonb_to_recordset(p_payload -> 'tiers')
        as tier(tier_id uuid, price_cents integer)
    ) then
      raise exception using
        errcode = '22023',
        message = 'Release tiers must be unique.';
    end if;
    if exists (
      select 1
      from jsonb_to_recordset(p_payload -> 'tiers')
        as tier(tier_id uuid, price_cents integer)
      where tier.tier_id is null
        or tier.price_cents <= 0
        or not exists (
          select 1
          from public.club_tiers as club_tier
          where club_tier.organization_id = p_organization_id
            and club_tier.brand_id = p_brand_id
            and club_tier.id = tier.tier_id
            and club_tier.active
        )
    ) then
      raise exception using
        errcode = 'P0002',
        message = 'One or more release tiers were not found in this brand.';
    end if;
    if exists (
      select 1
      from jsonb_to_recordset(p_payload -> 'wines')
        as wine(
          wine_name text,
          quantity integer,
          price_cents integer
        )
      where char_length(btrim(coalesce(wine.wine_name, ''))) not between 1 and 200
        or wine.quantity not between 1 and 120
        or wine.price_cents < 0
    ) then
      raise exception using
        errcode = '22023',
        message = 'One or more release wines are invalid.';
    end if;
  end if;

  if v_operation = 'create' then
    if p_release_id is not null
      or coalesce(
        nullif(p_payload ->> 'initial_status', ''),
        'draft'
      ) not in ('draft', 'scheduled')
    then
      raise exception using
        errcode = '22023',
        message = 'The release create state is invalid.';
    end if;

    insert into public.releases (
      organization_id,
      brand_id,
      name,
      description,
      processing_date,
      embargo_date,
      status,
      created_by
    )
    values (
      p_organization_id,
      p_brand_id,
      btrim(p_payload ->> 'name'),
      coalesce(p_payload ->> 'description', ''),
      (p_payload ->> 'processing_date')::date,
      (p_payload ->> 'embargo_date')::date,
      coalesce(
        nullif(p_payload ->> 'initial_status', ''),
        'draft'
      )::public.release_status,
      p_actor_user_id
    )
    returning * into v_release;
  elsif v_operation = 'update' then
    select release.*
    into v_release
    from public.releases as release
    where release.organization_id = p_organization_id
      and release.brand_id = p_brand_id
      and release.id = p_release_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Release not found.';
    end if;
    if v_release.status <> 'draft' then
      raise exception using
        errcode = '23514',
        message = 'Only a draft release can be updated.';
    end if;

    update public.releases as release
    set
      name = btrim(p_payload ->> 'name'),
      description = coalesce(p_payload ->> 'description', ''),
      processing_date = (p_payload ->> 'processing_date')::date,
      embargo_date = (p_payload ->> 'embargo_date')::date
    where release.organization_id = p_organization_id
      and release.brand_id = p_brand_id
      and release.id = p_release_id
    returning * into v_release;

    delete from public.release_tier_items as item
    where item.organization_id = p_organization_id
      and item.brand_id = p_brand_id
      and item.release_id = p_release_id;
    delete from public.release_wines as wine
    where wine.organization_id = p_organization_id
      and wine.brand_id = p_brand_id
      and wine.release_id = p_release_id;
    delete from public.release_tiers as tier
    where tier.organization_id = p_organization_id
      and tier.brand_id = p_brand_id
      and tier.release_id = p_release_id;
  else
    select release.*
    into v_release
    from public.releases as release
    where release.organization_id = p_organization_id
      and release.brand_id = p_brand_id
      and release.id = p_release_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Release not found.';
    end if;
    if v_release.status <> 'draft' then
      raise exception using
        errcode = '23514',
        message = 'Only a draft release can be scheduled.';
    end if;
    perform private.assert_release_ready(
      p_organization_id,
      p_brand_id,
      p_release_id
    );
    update public.releases as release
    set status = 'scheduled'
    where release.organization_id = p_organization_id
      and release.brand_id = p_brand_id
      and release.id = p_release_id
    returning * into v_release;

    v_audit_id := public.append_audit_entry(
      p_organization_id,
      p_brand_id,
      p_actor_user_id,
      'release.scheduled',
      'release',
      v_release.id,
      jsonb_build_object('processing_date', v_release.processing_date)
    );
  end if;

  if v_operation in ('create', 'update') then
    for v_wine in
      select
        wine.ordinality,
        wine.value ->> 'wine_name' as wine_name,
        (wine.value ->> 'quantity')::integer as quantity,
        (wine.value ->> 'price_cents')::integer as price_cents
      from jsonb_array_elements(p_payload -> 'wines')
        with ordinality as wine(value, ordinality)
      order by wine.ordinality
    loop
      insert into public.release_wines (
        organization_id,
        brand_id,
        release_id,
        wine_name
      )
      values (
        p_organization_id,
        p_brand_id,
        v_release.id,
        v_wine.wine_name
      )
      returning * into v_release_wine;
      v_wine_ids[v_wine.ordinality::integer] := v_release_wine.id;
    end loop;

    for v_tier in
      select tier.tier_id, tier.price_cents
      from jsonb_to_recordset(p_payload -> 'tiers')
        as tier(tier_id uuid, price_cents integer)
      order by tier.tier_id
    loop
      insert into public.release_tiers (
        organization_id,
        brand_id,
        release_id,
        tier_id
      )
      values (
        p_organization_id,
        p_brand_id,
        v_release.id,
        v_tier.tier_id
      )
      returning * into v_release_tier;

      update public.release_tiers as release_tier
      set price_cents = v_tier.price_cents
      where release_tier.organization_id = p_organization_id
        and release_tier.brand_id = p_brand_id
        and release_tier.id = v_release_tier.id
      returning * into v_release_tier;

      for v_wine in
        select
          wine.ordinality,
          wine.value ->> 'wine_name' as wine_name,
          (wine.value ->> 'quantity')::integer as quantity,
          (wine.value ->> 'price_cents')::integer as price_cents
        from jsonb_array_elements(p_payload -> 'wines')
          with ordinality as wine(value, ordinality)
        order by wine.ordinality
      loop
        insert into public.release_tier_items (
          organization_id,
          brand_id,
          release_id,
          release_tier_id,
          release_wine_id,
          quantity,
          unit_price_cents
        )
        values (
          p_organization_id,
          p_brand_id,
          v_release.id,
          v_release_tier.id,
          v_wine_ids[v_wine.ordinality::integer],
          v_wine.quantity,
          v_wine.price_cents
        );
      end loop;
    end loop;

    if v_release.status = 'scheduled' then
      perform private.assert_release_ready(
        p_organization_id,
        p_brand_id,
        v_release.id
      );
    end if;

    v_audit_id := public.append_audit_entry(
      p_organization_id,
      p_brand_id,
      p_actor_user_id,
      case
        when v_operation = 'create' then 'release.created'
        else 'release.updated'
      end,
      'release',
      v_release.id,
      case
        when v_operation = 'create' then jsonb_build_object(
          'initial_status',
          v_release.status,
          'tier_count',
          jsonb_array_length(p_payload -> 'tiers'),
          'wine_count',
          jsonb_array_length(p_payload -> 'wines')
        )
        else jsonb_build_object(
          'changed_fields',
          jsonb_build_array(
            'description',
            'embargo_date',
            'name',
            'processing_date',
            'tiers',
            'wines'
          )
        )
      end
    );
  end if;

  v_result := jsonb_build_object(
    'entityId',
    v_release.id,
    'status',
    v_release.status,
    'updatedAt',
    v_release.updated_at
  );
  return private.store_core_club_command(
    p_organization_id,
    p_brand_id,
    p_actor_user_id,
    p_command_id,
    'release.' || v_operation,
    v_command_input,
    'release',
    v_release.id,
    v_result,
    v_audit_id
  );
end;
$$;

create or replace function public.claim_member_side_effects(
  p_worker_id text,
  p_limit integer default 50,
  p_lease_seconds integer default 300
)
returns table (
  outbox_id uuid,
  organization_id uuid,
  brand_id uuid,
  command_id uuid,
  member_id uuid,
  effect_type text,
  provider_subject_id text,
  payload jsonb,
  lease_token uuid,
  attempt_count integer,
  max_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Service role authorization is required.';
  end if;
  if p_worker_id !~ '^[A-Za-z0-9_.:@/-]{1,128}$'
    or p_limit not between 1 and 100
    or p_lease_seconds not between 30 and 1800
  then
    raise exception using
      errcode = '22023',
      message = 'The member side-effect claim is invalid.';
  end if;

  with expired as (
    select outbox.id
    from private.member_side_effect_outbox as outbox
    where outbox.status = 'processing'
      and outbox.lease_expires_at <= now()
    order by outbox.lease_expires_at, outbox.id
    limit p_limit
    for update skip locked
  )
  update private.member_side_effect_outbox as outbox
  set
    status = case
      when outbox.attempt_count >= outbox.max_attempts then 'dead_letter'
      else 'retry'
    end,
    available_at = case
      when outbox.attempt_count >= outbox.max_attempts
        then outbox.available_at
      else now()
    end,
    lease_token = null,
    lease_owner = null,
    lease_expires_at = null,
    last_error_code = 'LEASE_EXPIRED',
    completed_at = case
      when outbox.attempt_count >= outbox.max_attempts then now()
      else null
    end
  from expired
  where outbox.id = expired.id;

  with superseded as (
    select older.id
    from private.member_side_effect_outbox as older
    where older.status in ('pending', 'retry')
      and exists (
        select 1
        from private.member_side_effect_outbox as newer
        where newer.organization_id = older.organization_id
          and newer.brand_id = older.brand_id
          and newer.effect_type = older.effect_type
          and newer.provider_subject_id = older.provider_subject_id
          and newer.status in ('pending', 'processing', 'retry')
          and (newer.created_at, newer.id) > (older.created_at, older.id)
      )
    order by older.created_at, older.id
    limit p_limit
    for update skip locked
  )
  update private.member_side_effect_outbox as older
  set
    status = 'completed',
    completed_at = now(),
    last_error_code = 'SUPERSEDED'
  from superseded
  where older.id = superseded.id;

  return query
  with candidates as (
    select outbox.id
    from private.member_side_effect_outbox as outbox
    where outbox.status in ('pending', 'retry')
      and outbox.available_at <= now()
      and outbox.attempt_count < outbox.max_attempts
      and not exists (
        select 1
        from private.member_side_effect_outbox as newer
        where newer.organization_id = outbox.organization_id
          and newer.brand_id = outbox.brand_id
          and newer.effect_type = outbox.effect_type
          and newer.provider_subject_id = outbox.provider_subject_id
          and newer.status in ('pending', 'processing', 'retry')
          and (newer.created_at, newer.id) > (outbox.created_at, outbox.id)
      )
      and not exists (
        select 1
        from private.member_side_effect_outbox as processing
        where processing.organization_id = outbox.organization_id
          and processing.brand_id = outbox.brand_id
          and processing.effect_type = outbox.effect_type
          and processing.provider_subject_id = outbox.provider_subject_id
          and processing.status = 'processing'
      )
    order by outbox.available_at, outbox.created_at, outbox.id
    limit p_limit
    for update skip locked
  ),
  claimed as (
    update private.member_side_effect_outbox as outbox
    set
      status = 'processing',
      lease_token = gen_random_uuid(),
      lease_owner = p_worker_id,
      lease_expires_at =
        now() + make_interval(secs => p_lease_seconds),
      attempt_count = outbox.attempt_count + 1,
      last_error_code = null
    from candidates
    where outbox.id = candidates.id
    returning outbox.*
  )
  select
    claimed.id,
    claimed.organization_id,
    claimed.brand_id,
    claimed.command_id,
    claimed.member_id,
    claimed.effect_type,
    claimed.provider_subject_id,
    claimed.payload,
    claimed.lease_token,
    claimed.attempt_count,
    claimed.max_attempts
  from claimed
  order by claimed.created_at, claimed.id;
end;
$$;

create or replace function public.complete_member_side_effect(
  p_outbox_id uuid,
  p_lease_token uuid,
  p_succeeded boolean,
  p_error_code text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox private.member_side_effect_outbox%rowtype;
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Service role authorization is required.';
  end if;
  if not p_succeeded
    and coalesce(p_error_code, '') !~ '^[A-Z0-9_.:-]{1,100}$'
  then
    raise exception using
      errcode = '22023',
      message = 'A safe side-effect error code is required.';
  end if;
  if p_succeeded
    and p_error_code is not null
    and p_error_code <> 'SUPERSEDED'
  then
    raise exception using
      errcode = '22023',
      message = 'Only a superseded success outcome may include an error code.';
  end if;

  select outbox.*
  into v_outbox
  from private.member_side_effect_outbox as outbox
  where outbox.id = p_outbox_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Member side-effect outbox entry not found.';
  end if;
  if v_outbox.status <> 'processing'
    or v_outbox.lease_token <> p_lease_token
    or v_outbox.lease_expires_at <= now()
  then
    raise exception using
      errcode = '55000',
      message = 'The member side-effect lease is no longer valid.';
  end if;

  update private.member_side_effect_outbox as outbox
  set
    status = case
      when p_succeeded then 'completed'
      when outbox.attempt_count >= outbox.max_attempts then 'dead_letter'
      else 'retry'
    end,
    available_at = case
      when p_succeeded or outbox.attempt_count >= outbox.max_attempts
        then outbox.available_at
      else now() + make_interval(
        secs => least(
          3600,
          30 * power(2, greatest(outbox.attempt_count - 1, 0))::integer
        )
      )
    end,
    lease_token = null,
    lease_owner = null,
    lease_expires_at = null,
    last_error_code = p_error_code,
    completed_at = case
      when p_succeeded or outbox.attempt_count >= outbox.max_attempts
        then now()
      else null
    end
  where outbox.id = p_outbox_id
  returning * into v_outbox;

  return v_outbox.status;
end;
$$;

create or replace function public.claim_stale_refund_attempts(
  p_as_of timestamptz,
  p_worker_id text,
  p_limit integer default 50,
  p_stale_seconds integer default 300,
  p_lease_seconds integer default 300
)
returns table (
  billing_attempt_id uuid,
  lease_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Service role authorization is required.';
  end if;
  if p_as_of is null
    or p_worker_id !~ '^[A-Za-z0-9_.:@/-]{1,128}$'
    or p_limit not between 1 and 100
    or p_stale_seconds not between 60 and 3600
    or p_lease_seconds not between 30 and 1800
  then
    raise exception using
      errcode = '22023',
      message = 'The refund recovery claim is invalid.';
  end if;

  return query
  with candidates as (
    select attempt.id
    from public.billing_attempts as attempt
    where attempt.attempt_kind = 'refund'
      and attempt.status = 'processing'
      and attempt.started_at is not null
      and attempt.started_at
        <= p_as_of - make_interval(secs => p_stale_seconds)
      and coalesce(attempt.recovery_available_at, attempt.started_at) <= p_as_of
      and (
        attempt.recovery_lease_token is null
        or attempt.recovery_lease_expires_at <= p_as_of
      )
    order by
      coalesce(attempt.recovery_available_at, attempt.started_at),
      attempt.id
    limit p_limit
    for update skip locked
  ),
  claimed as (
    update public.billing_attempts as attempt
    set
      recovery_lease_token = gen_random_uuid(),
      recovery_lease_owner = p_worker_id,
      recovery_lease_expires_at =
        now() + make_interval(secs => p_lease_seconds),
      recovery_attempt_count = attempt.recovery_attempt_count + 1
    from candidates
    where attempt.id = candidates.id
    returning attempt.id, attempt.recovery_lease_token
  )
  select claimed.id, claimed.recovery_lease_token
  from claimed
  order by claimed.id;
end;
$$;

create or replace function public.complete_refund_recovery_claim(
  p_billing_attempt_id uuid,
  p_lease_token uuid,
  p_retry boolean,
  p_error_code text default null
)
returns public.billing_attempt_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.billing_attempts%rowtype;
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Service role authorization is required.';
  end if;
  if p_retry and coalesce(p_error_code, '') !~ '^[A-Z0-9_.:-]{1,100}$' then
    raise exception using
      errcode = '22023',
      message = 'A safe refund recovery error code is required.';
  end if;

  select attempt.*
  into v_attempt
  from public.billing_attempts as attempt
  where attempt.id = p_billing_attempt_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Refund recovery attempt not found.';
  end if;
  if v_attempt.attempt_kind <> 'refund'
    or v_attempt.recovery_lease_token is distinct from p_lease_token
    or (
      v_attempt.status = 'processing'
      and v_attempt.recovery_lease_expires_at <= now()
    )
  then
    raise exception using
      errcode = '55000',
      message = 'The refund recovery lease is no longer valid.';
  end if;
  if p_retry and v_attempt.status <> 'processing' then
    raise exception using
      errcode = '55000',
      message = 'A terminal refund cannot be requeued.';
  end if;
  if not p_retry and v_attempt.status = 'processing' then
    raise exception using
      errcode = '55000',
      message = 'A processing refund must be retried or finalized first.';
  end if;

  update public.billing_attempts as attempt
  set
    recovery_lease_token = null,
    recovery_lease_owner = null,
    recovery_lease_expires_at = null,
    recovery_available_at = case
      when p_retry then now() + make_interval(
        secs => least(
          3600,
          30 * power(
            2,
            greatest(attempt.recovery_attempt_count - 1, 0)
          )::integer
        )
      )
      else null
    end,
    metadata = case
      when p_retry then attempt.metadata || jsonb_build_object(
        'refund_recovery_error_code',
        p_error_code
      )
      else attempt.metadata - 'refund_recovery_error_code'
    end
  where attempt.id = p_billing_attempt_id
  returning * into v_attempt;

  return v_attempt.status;
end;
$$;

create or replace function public.get_member_side_effect_status(
  p_organization_id uuid,
  p_brand_id uuid,
  p_member_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Service role authorization is required.';
  end if;

  with latest as (
    select distinct on (outbox.effect_type, outbox.provider_subject_id)
      outbox.status,
      outbox.updated_at
    from private.member_side_effect_outbox as outbox
    where outbox.organization_id = p_organization_id
      and outbox.brand_id = p_brand_id
      and outbox.member_id = p_member_id
    order by
      outbox.effect_type,
      outbox.provider_subject_id,
      outbox.created_at desc,
      outbox.id desc
  )
  select jsonb_build_object(
    'state',
    case
      when count(*) = 0 then 'not_required'
      when count(*) filter (where status = 'dead_letter') > 0
        then 'reconciliation_required'
      when count(*) filter (
        where status in ('pending', 'processing', 'retry')
      ) > 0 then 'pending'
      else 'synchronized'
    end,
    'pendingCount',
    count(*) filter (
      where status in ('pending', 'processing', 'retry')
    ),
    'deadLetterCount',
    count(*) filter (where status = 'dead_letter'),
    'updatedAt',
    max(updated_at)
  )
  into v_result
  from latest;

  return v_result;
end;
$$;

do $$
declare
  v_function regprocedure;
  v_name text;
begin
  foreach v_name in array array[
    'assert_release_ready',
    'core_club_command_hash',
    'invalidate_dependent_compliance',
    'load_core_club_command',
    'store_core_club_command',
    'require_core_club_staff',
    'enqueue_member_side_effect'
  ]
  loop
    for v_function in
      select procedure.oid::regprocedure
      from pg_proc as procedure
      join pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'private'
        and procedure.proname = v_name
    loop
      execute format(
        'revoke all on function %s from public, anon, authenticated',
        v_function
      );
      execute format(
        'grant execute on function %s to service_role',
        v_function
      );
    end loop;
  end loop;

  foreach v_name in array array[
    'apply_club_tier_command',
    'apply_member_command',
    'apply_member_portal_address_command',
    'apply_release_command',
    'claim_member_side_effects',
    'claim_stale_refund_attempts',
    'complete_refund_recovery_claim',
    'complete_member_side_effect',
    'get_member_side_effect_status'
  ]
  loop
    for v_function in
      select procedure.oid::regprocedure
      from pg_proc as procedure
      join pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = v_name
    loop
      execute format(
        'revoke all on function %s from public, anon, authenticated',
        v_function
      );
      execute format(
        'grant execute on function %s to service_role',
        v_function
      );
    end loop;
  end loop;
end;
$$;

create or replace function public.apply_member_command(
  p_organization_id uuid,
  p_brand_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_operation text,
  p_member_id uuid default null,
  p_member_ids uuid[] default null,
  p_scope_all boolean default false,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_affected jsonb := '[]'::jsonb;
  v_audit_id uuid;
  v_auth_cleanup_queued boolean := false;
  v_auth_user_id uuid;
  v_command_input jsonb;
  v_count integer := 0;
  v_member public.members%rowtype;
  v_operation text := lower(btrim(p_operation));
  v_previous_status public.member_status;
  v_replay jsonb;
  v_result jsonb;
  v_status public.member_status;
  v_target_count integer := 0;
  v_tier_id uuid;
begin
  perform private.require_core_club_staff(
    p_organization_id,
    p_brand_id,
    p_actor_user_id,
    case
      when v_operation = 'delete'
        then array['owner', 'admin']::public.staff_role[]
      when v_operation like 'batch_%'
        then array['owner', 'admin', 'manager']::public.staff_role[]
      else
        array['owner', 'admin', 'manager', 'staff']::public.staff_role[]
    end
  );

  if v_operation not in (
    'create',
    'update',
    'delete',
    'transition',
    'batch_pause',
    'batch_resume',
    'batch_cancel',
    'batch_assign_tier'
  )
    or jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload - array[
      'birthday',
      'club_tier_id',
      'email',
      'first_name',
      'joined_on',
      'last_name',
      'phone',
      'referred_by_member_id',
      'shipping_address_line1',
      'shipping_address_line2',
      'shipping_city',
      'shipping_country_code',
      'shipping_postal_code',
      'shipping_region',
      'status',
      'target_status'
    ] <> '{}'::jsonb
  then
    raise exception using
      errcode = '22023',
      message = 'The member command is invalid.';
  end if;
  if v_operation = 'update' and p_payload ? 'status' then
    raise exception using
      errcode = '22023',
      message = 'Member status must use the transition command.';
  end if;

  v_command_input := jsonb_build_object(
    'member_id',
    p_member_id,
    'member_ids',
    to_jsonb(p_member_ids),
    'scope_all',
    p_scope_all,
    'payload',
    p_payload
  );
  v_replay := private.load_core_club_command(
    p_organization_id,
    p_brand_id,
    p_actor_user_id,
    p_command_id,
    'member.' || v_operation,
    v_command_input
  );
  if v_replay is not null then
    return v_replay;
  end if;

  if v_operation = 'create' then
    if p_member_id is not null
      or not (
        p_payload ? 'email'
        and p_payload ? 'first_name'
        and p_payload ? 'last_name'
      )
    then
      raise exception using
        errcode = '22023',
        message = 'The member create payload is incomplete.';
    end if;

    v_tier_id := nullif(p_payload ->> 'club_tier_id', '')::uuid;
    if v_tier_id is not null
      and not exists (
        select 1
        from public.club_tiers as tier
        where tier.organization_id = p_organization_id
          and tier.brand_id = p_brand_id
          and tier.id = v_tier_id
          and tier.active
      )
    then
      raise exception using errcode = 'P0002', message = 'Club tier not found.';
    end if;
    if nullif(p_payload ->> 'referred_by_member_id', '') is not null
      and not exists (
        select 1
        from public.members as referrer
        where referrer.organization_id = p_organization_id
          and referrer.brand_id = p_brand_id
          and referrer.id =
            (p_payload ->> 'referred_by_member_id')::uuid
          and referrer.deleted_at is null
      )
    then
      raise exception using
        errcode = 'P0002',
        message = 'Referring member not found.';
    end if;

    insert into public.members (
      organization_id,
      brand_id,
      email,
      first_name,
      last_name,
      phone,
      birthday,
      club_tier_id,
      referred_by_member_id,
      joined_on,
      status,
      shipping_address_line1,
      shipping_address_line2,
      shipping_city,
      shipping_region,
      shipping_postal_code,
      shipping_country_code
    )
    values (
      p_organization_id,
      p_brand_id,
      lower(btrim(p_payload ->> 'email')),
      btrim(p_payload ->> 'first_name'),
      btrim(p_payload ->> 'last_name'),
      nullif(btrim(p_payload ->> 'phone'), ''),
      nullif(p_payload ->> 'birthday', '')::date,
      v_tier_id,
      nullif(p_payload ->> 'referred_by_member_id', '')::uuid,
      coalesce(
        nullif(p_payload ->> 'joined_on', '')::date,
        current_date
      ),
      coalesce(
        nullif(p_payload ->> 'status', '')::public.member_status,
        'active'::public.member_status
      ),
      nullif(btrim(p_payload ->> 'shipping_address_line1'), ''),
      nullif(btrim(p_payload ->> 'shipping_address_line2'), ''),
      nullif(btrim(p_payload ->> 'shipping_city'), ''),
      nullif(upper(btrim(p_payload ->> 'shipping_region')), ''),
      nullif(btrim(p_payload ->> 'shipping_postal_code'), ''),
      coalesce(
        nullif(upper(btrim(p_payload ->> 'shipping_country_code')), ''),
        'US'
      )
    )
    returning * into v_member;

    v_audit_id := public.append_audit_entry(
      p_organization_id,
      p_brand_id,
      p_actor_user_id,
      'member.created',
      'member',
      v_member.id,
      jsonb_build_object(
        'club_tier_id',
        v_member.club_tier_id,
        'stripe_customer_created',
        false,
        'stripe_customer_provisioning',
        'deferred_until_payment_method_setup'
      )
    );
  elsif v_operation = 'update' then
    select member.*
    into v_member
    from public.members as member
    where member.organization_id = p_organization_id
      and member.brand_id = p_brand_id
      and member.id = p_member_id
      and member.deleted_at is null
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Member not found.';
    end if;
    v_auth_user_id := case
      when p_payload ? 'email'
        and lower(btrim(p_payload ->> 'email')) <> v_member.email
      then v_member.auth_user_id
      else null
    end;

    if p_payload ? 'club_tier_id'
      and nullif(p_payload ->> 'club_tier_id', '') is not null
      and not exists (
        select 1
        from public.club_tiers as tier
        where tier.organization_id = p_organization_id
          and tier.brand_id = p_brand_id
          and tier.id = (p_payload ->> 'club_tier_id')::uuid
          and tier.active
      )
    then
      raise exception using errcode = 'P0002', message = 'Club tier not found.';
    end if;
    if p_payload ? 'referred_by_member_id'
      and nullif(p_payload ->> 'referred_by_member_id', '')::uuid = p_member_id
    then
      raise exception using
        errcode = '22023',
        message = 'A member cannot refer themselves.';
    end if;
    if p_payload ? 'referred_by_member_id'
      and nullif(p_payload ->> 'referred_by_member_id', '') is not null
      and not exists (
        select 1
        from public.members as referrer
        where referrer.organization_id = p_organization_id
          and referrer.brand_id = p_brand_id
          and referrer.id =
            (p_payload ->> 'referred_by_member_id')::uuid
          and referrer.deleted_at is null
      )
    then
      raise exception using
        errcode = 'P0002',
        message = 'Referring member not found.';
    end if;

    update public.members as member
    set
      email = case
        when p_payload ? 'email'
          then lower(btrim(p_payload ->> 'email'))
        else member.email
      end,
      first_name = case
        when p_payload ? 'first_name'
          then btrim(p_payload ->> 'first_name')
        else member.first_name
      end,
      last_name = case
        when p_payload ? 'last_name'
          then btrim(p_payload ->> 'last_name')
        else member.last_name
      end,
      phone = case
        when p_payload ? 'phone'
          then nullif(btrim(p_payload ->> 'phone'), '')
        else member.phone
      end,
      birthday = case
        when p_payload ? 'birthday'
          then nullif(p_payload ->> 'birthday', '')::date
        else member.birthday
      end,
      club_tier_id = case
        when p_payload ? 'club_tier_id'
          then nullif(p_payload ->> 'club_tier_id', '')::uuid
        else member.club_tier_id
      end,
      referred_by_member_id = case
        when p_payload ? 'referred_by_member_id'
          then nullif(p_payload ->> 'referred_by_member_id', '')::uuid
        else member.referred_by_member_id
      end,
      joined_on = case
        when p_payload ? 'joined_on'
          then (p_payload ->> 'joined_on')::date
        else member.joined_on
      end,
      status = case
        when p_payload ? 'status'
          then (p_payload ->> 'status')::public.member_status
        else member.status
      end,
      shipping_address_line1 = case
        when p_payload ? 'shipping_address_line1'
          then nullif(btrim(p_payload ->> 'shipping_address_line1'), '')
        else member.shipping_address_line1
      end,
      shipping_address_line2 = case
        when p_payload ? 'shipping_address_line2'
          then nullif(btrim(p_payload ->> 'shipping_address_line2'), '')
        else member.shipping_address_line2
      end,
      shipping_city = case
        when p_payload ? 'shipping_city'
          then nullif(btrim(p_payload ->> 'shipping_city'), '')
        else member.shipping_city
      end,
      shipping_region = case
        when p_payload ? 'shipping_region'
          then nullif(upper(btrim(p_payload ->> 'shipping_region')), '')
        else member.shipping_region
      end,
      shipping_postal_code = case
        when p_payload ? 'shipping_postal_code'
          then nullif(btrim(p_payload ->> 'shipping_postal_code'), '')
        else member.shipping_postal_code
      end,
      shipping_country_code = case
        when p_payload ? 'shipping_country_code'
          then coalesce(
            nullif(upper(btrim(p_payload ->> 'shipping_country_code')), ''),
            'US'
          )
        else member.shipping_country_code
      end,
      auth_user_id = case
        when v_auth_user_id is not null then null
        else member.auth_user_id
      end,
      shipping_validated_at = case
        when p_payload ?| array[
          'shipping_address_line1',
          'shipping_address_line2',
          'shipping_city',
          'shipping_region',
          'shipping_postal_code',
          'shipping_country_code'
        ] then null
        else member.shipping_validated_at
      end
    where member.organization_id = p_organization_id
      and member.brand_id = p_brand_id
      and member.id = p_member_id
    returning * into v_member;

    v_audit_id := public.append_audit_entry(
      p_organization_id,
      p_brand_id,
      p_actor_user_id,
      'member.updated',
      'member',
      v_member.id,
      jsonb_build_object(
        'changed_fields',
        (
          select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
          from jsonb_object_keys(p_payload) as key
        ),
        'member_identity_unlinked',
        v_auth_user_id is not null
      )
    );

    v_auth_cleanup_queued :=
      v_auth_user_id is not null
      and not exists (
        select 1
        from public.staff_users as staff
        where staff.id = v_auth_user_id
      )
      and not exists (
        select 1
        from public.platform_users as platform
        where platform.id = v_auth_user_id
      )
      and not exists (
        select 1
        from public.members as other_member
        where other_member.auth_user_id = v_auth_user_id
      );
    if v_auth_cleanup_queued then
      perform private.enqueue_member_side_effect(
        p_organization_id,
        p_brand_id,
        p_command_id,
        v_member.id,
        'auth_user_delete',
        v_auth_user_id::text,
        '{}'::jsonb
      );
    end if;

    if v_member.stripe_customer_id is not null
      and p_payload ?| array[
        'email',
        'first_name',
        'last_name',
        'phone',
        'shipping_address_line1',
        'shipping_address_line2',
        'shipping_city',
        'shipping_region',
        'shipping_postal_code',
        'shipping_country_code'
      ]
    then
      perform private.enqueue_member_side_effect(
        p_organization_id,
        p_brand_id,
        p_command_id,
        v_member.id,
        'stripe_customer_sync',
        v_member.stripe_customer_id,
        jsonb_build_object(
          'email',
          v_member.email,
          'name',
          btrim(concat_ws(' ', v_member.first_name, v_member.last_name)),
          'phone',
          v_member.phone,
          'address',
          case
            when v_member.shipping_address_line1 is null then null
            else jsonb_build_object(
              'line1',
              v_member.shipping_address_line1,
              'line2',
              v_member.shipping_address_line2,
              'city',
              v_member.shipping_city,
              'state',
              v_member.shipping_region,
              'postal_code',
              v_member.shipping_postal_code,
              'country',
              v_member.shipping_country_code
            )
          end
        )
      );
    end if;
  elsif v_operation = 'delete' then
    select member.*
    into v_member
    from public.members as member
    where member.organization_id = p_organization_id
      and member.brand_id = p_brand_id
      and member.id = p_member_id
      and member.deleted_at is null
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Member not found.';
    end if;
    if exists (
      select 1
      from public.shipments as shipment
      where shipment.organization_id = p_organization_id
        and shipment.brand_id = p_brand_id
        and shipment.member_id = p_member_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'Members with shipment history must be cancelled instead of deleted.';
    end if;

    v_auth_user_id := v_member.auth_user_id;
    v_auth_cleanup_queued :=
      v_auth_user_id is not null
      and not exists (
        select 1
        from public.staff_users as staff
        where staff.id = v_auth_user_id
      )
      and not exists (
        select 1
        from public.platform_users as platform
        where platform.id = v_auth_user_id
      )
      and not exists (
        select 1
        from public.members as other_member
        where other_member.auth_user_id = v_auth_user_id
          and other_member.id <> p_member_id
      );
    delete from public.members as member
    where member.organization_id = p_organization_id
      and member.brand_id = p_brand_id
      and member.id = p_member_id;

    v_audit_id := public.append_audit_entry(
      p_organization_id,
      p_brand_id,
      p_actor_user_id,
      'member.deleted',
      'member',
      p_member_id,
      jsonb_build_object(
        'auth_cleanup_queued',
        v_auth_cleanup_queued,
        'shared_identity_preserved',
        v_auth_user_id is not null and not v_auth_cleanup_queued
      )
    );
    if v_auth_cleanup_queued then
      perform private.enqueue_member_side_effect(
        p_organization_id,
        p_brand_id,
        p_command_id,
        p_member_id,
        'auth_user_delete',
        v_auth_user_id::text,
        '{}'::jsonb
      );
    end if;
  elsif v_operation = 'transition' then
    v_status := nullif(p_payload ->> 'target_status', '')::public.member_status;
    if v_status is null then
      raise exception using
        errcode = '22023',
        message = 'A target member status is required.';
    end if;
    select member.*
    into v_member
    from public.members as member
    where member.organization_id = p_organization_id
      and member.brand_id = p_brand_id
      and member.id = p_member_id
      and member.deleted_at is null
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Member not found.';
    end if;
    v_previous_status := v_member.status;

    if v_previous_status <> v_status
      and not (
        (v_previous_status = 'active' and v_status in ('paused', 'cancelled'))
        or (v_previous_status = 'paused' and v_status in ('active', 'cancelled'))
        or (v_previous_status = 'cancelled' and v_status = 'active')
      )
    then
      raise exception using
        errcode = '23514',
        message = 'The member status transition is not allowed.';
    end if;

    update public.members as member
    set status = v_status
    where member.organization_id = p_organization_id
      and member.brand_id = p_brand_id
      and member.id = p_member_id
    returning * into v_member;

    v_audit_id := public.append_audit_entry(
      p_organization_id,
      p_brand_id,
      p_actor_user_id,
      'member.' || v_status::text,
      'member',
      p_member_id,
      jsonb_build_object('previous_status', v_previous_status)
    );
  else
    if p_scope_all and coalesce(cardinality(p_member_ids), 0) > 0 then
      raise exception using
        errcode = '22023',
        message = 'Choose member ids or the all-roster scope, not both.';
    end if;
    if not p_scope_all
      and coalesce(cardinality(p_member_ids), 0) = 0
    then
      raise exception using
        errcode = '22023',
        message = 'Choose members or explicitly select the entire roster.';
    end if;
    if coalesce(cardinality(p_member_ids), 0) > 1000 then
      raise exception using
        errcode = '22023',
        message = 'Batch operations are limited to 1,000 members.';
    end if;
    if p_scope_all then
      select count(*)::integer
      into v_target_count
      from public.members as member
      where member.organization_id = p_organization_id
        and member.brand_id = p_brand_id
        and member.deleted_at is null
        and (
          (v_operation = 'batch_pause' and member.status = 'active')
          or (v_operation = 'batch_resume' and member.status = 'paused')
          or (
            v_operation = 'batch_cancel'
            and member.status in ('active', 'paused')
          )
          or v_operation = 'batch_assign_tier'
        );
      if v_target_count > 1000 then
        raise exception using
          errcode = '22023',
          message = 'Batch operations are limited to 1,000 members.';
      end if;
    end if;
    if not p_scope_all
      and (
        select count(*) <> count(distinct id)
        from unnest(p_member_ids) as id
      )
    then
      raise exception using
        errcode = '22023',
        message = 'Batch member ids must be unique.';
    end if;
    if not p_scope_all
      and exists (
        select 1
        from unnest(p_member_ids) as requested(id)
        where not exists (
          select 1
          from public.members as member
          where member.organization_id = p_organization_id
            and member.brand_id = p_brand_id
            and member.id = requested.id
            and member.deleted_at is null
        )
      )
    then
      raise exception using
        errcode = 'P0002',
        message = 'One or more batch members were not found in this brand.';
    end if;

    if v_operation = 'batch_assign_tier' then
      v_tier_id := nullif(p_payload ->> 'club_tier_id', '')::uuid;
      if v_tier_id is null
        or not exists (
          select 1
          from public.club_tiers as tier
          where tier.organization_id = p_organization_id
            and tier.brand_id = p_brand_id
            and tier.id = v_tier_id
            and tier.active
        )
      then
        raise exception using errcode = 'P0002', message = 'Club tier not found.';
      end if;
    end if;

    with locked as (
      select member.id
      from public.members as member
      where member.organization_id = p_organization_id
        and member.brand_id = p_brand_id
        and member.deleted_at is null
        and (
          p_scope_all
          or member.id = any(coalesce(p_member_ids, '{}'::uuid[]))
        )
        and (
          (v_operation = 'batch_pause' and member.status = 'active')
          or (v_operation = 'batch_resume' and member.status = 'paused')
          or (
            v_operation = 'batch_cancel'
            and member.status in ('active', 'paused')
          )
          or v_operation = 'batch_assign_tier'
        )
      order by member.id
      for update
    ),
    updated as (
      update public.members as member
      set
        status = case
          when v_operation = 'batch_pause'
            then 'paused'::public.member_status
          when v_operation = 'batch_resume'
            then 'active'::public.member_status
          when v_operation = 'batch_cancel'
            then 'cancelled'::public.member_status
          else member.status
        end,
        club_tier_id = case
          when v_operation = 'batch_assign_tier' then v_tier_id
          else member.club_tier_id
        end
      from locked
      where member.id = locked.id
        and member.organization_id = p_organization_id
        and member.brand_id = p_brand_id
      returning member.id, member.updated_at
    )
    select
      count(*)::integer,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id',
            updated.id,
            'updatedAt',
            updated.updated_at
          )
          order by updated.id
        ),
        '[]'::jsonb
      )
    into v_count, v_affected
    from updated;

    v_audit_id := public.append_audit_entry(
      p_organization_id,
      p_brand_id,
      p_actor_user_id,
      'member.' || v_operation,
      'organization',
      p_organization_id,
      jsonb_build_object(
        'count',
        v_count,
        'tier_id',
        v_tier_id
      )
    );
  end if;

  v_result := case
    when v_operation like 'batch_%' then jsonb_build_object(
      'affected',
      v_affected,
      'updated',
      v_count
    )
    when v_operation = 'delete' then jsonb_build_object(
      'entityId',
      p_member_id,
      'sideEffectState',
      case when v_auth_cleanup_queued then 'pending' else 'not_required' end,
      'status',
      'deleted'
    )
    else jsonb_build_object(
      'entityId',
      v_member.id,
      'sideEffectState',
      case
        when exists (
          select 1
          from private.member_side_effect_outbox as outbox
          where outbox.organization_id = p_organization_id
            and outbox.brand_id = p_brand_id
            and outbox.command_id = p_command_id
        ) then 'pending'
        else 'not_required'
      end,
      'status',
      'applied',
      'updatedAt',
      v_member.updated_at
    )
  end;

  return private.store_core_club_command(
    p_organization_id,
    p_brand_id,
    p_actor_user_id,
    p_command_id,
    'member.' || v_operation,
    v_command_input,
    case
      when v_operation like 'batch_%' then 'organization'
      else 'member'
    end,
    case
      when v_operation like 'batch_%' then p_organization_id
      else coalesce(v_member.id, p_member_id)
    end,
    v_result,
    v_audit_id
  );
end;
$$;

create or replace function public.apply_member_portal_address_command(
  p_organization_id uuid,
  p_brand_id uuid,
  p_auth_user_id uuid,
  p_member_id uuid,
  p_command_id uuid,
  p_validated_address jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audit_id uuid;
  v_command_input jsonb;
  v_member public.members%rowtype;
  v_replay jsonb;
  v_result jsonb;
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Service role authorization is required.';
  end if;
  if jsonb_typeof(p_validated_address) is distinct from 'object'
    or p_validated_address - array[
      'city',
      'country',
      'line1',
      'line2',
      'postalCode',
      'state'
    ] <> '{}'::jsonb
  then
    raise exception using
      errcode = '22023',
      message = 'The validated member address is invalid.';
  end if;

  select member.*
  into v_member
  from public.members as member
  join public.brands as brand
    on brand.organization_id = member.organization_id
    and brand.id = member.brand_id
  join public.organizations as organization
    on organization.id = member.organization_id
  where member.organization_id = p_organization_id
    and member.brand_id = p_brand_id
    and member.id = p_member_id
    and member.auth_user_id = p_auth_user_id
    and member.deleted_at is null
    and brand.active
    and (
      (
        brand.billing_mode = 'independent'
        and brand.access_status in ('active', 'grace')
      )
      or (
        brand.billing_mode = 'shared'
        and organization.access_status in ('active', 'grace')
      )
    )
  for update of member;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'Active member authorization is required.';
  end if;

  v_command_input := jsonb_build_object(
    'member_id',
    p_member_id,
    'validated_address',
    p_validated_address
  );
  v_replay := private.load_core_club_command(
    p_organization_id,
    p_brand_id,
    p_auth_user_id,
    p_command_id,
    'member.portal_address',
    v_command_input
  );
  if v_replay is not null then
    return v_replay;
  end if;

  update public.members as member
  set
    shipping_address_line1 =
      nullif(btrim(p_validated_address ->> 'line1'), ''),
    shipping_address_line2 =
      nullif(btrim(p_validated_address ->> 'line2'), ''),
    shipping_city =
      nullif(btrim(p_validated_address ->> 'city'), ''),
    shipping_region =
      nullif(upper(btrim(p_validated_address ->> 'state')), ''),
    shipping_postal_code =
      nullif(btrim(p_validated_address ->> 'postalCode'), ''),
    shipping_country_code =
      coalesce(
        nullif(upper(btrim(p_validated_address ->> 'country')), ''),
        'US'
      ),
    shipping_validated_at = now()
  where member.organization_id = p_organization_id
    and member.brand_id = p_brand_id
    and member.id = p_member_id
  returning * into v_member;

  v_audit_id := public.append_audit_entry(
    p_organization_id,
    p_brand_id,
    p_auth_user_id,
    'member.address_updated',
    'member',
    p_member_id,
    jsonb_build_object('validated', true)
  );

  if v_member.stripe_customer_id is not null then
    perform private.enqueue_member_side_effect(
      p_organization_id,
      p_brand_id,
      p_command_id,
      p_member_id,
      'stripe_customer_sync',
      v_member.stripe_customer_id,
      jsonb_build_object(
        'email',
        v_member.email,
        'name',
        btrim(concat_ws(' ', v_member.first_name, v_member.last_name)),
        'phone',
        v_member.phone,
        'address',
        jsonb_build_object(
          'line1',
          v_member.shipping_address_line1,
          'line2',
          v_member.shipping_address_line2,
          'city',
          v_member.shipping_city,
          'state',
          v_member.shipping_region,
          'postal_code',
          v_member.shipping_postal_code,
          'country',
          v_member.shipping_country_code
        )
      )
    );
  end if;

  v_result := jsonb_build_object(
    'entityId',
    p_member_id,
    'sideEffectState',
    case
      when v_member.stripe_customer_id is null then 'not_required'
      else 'pending'
    end,
    'status',
    'applied',
    'updatedAt',
    v_member.updated_at
  );
  return private.store_core_club_command(
    p_organization_id,
    p_brand_id,
    p_auth_user_id,
    p_command_id,
    'member.portal_address',
    v_command_input,
    'member',
    p_member_id,
    v_result,
    v_audit_id
  );
end;
$$;

create or replace function private.store_core_club_command(
  p_organization_id uuid,
  p_brand_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_operation text,
  p_input jsonb,
  p_entity_type text,
  p_entity_id uuid,
  p_result jsonb,
  p_audit_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  v_result := coalesce(p_result, '{}'::jsonb)
    || jsonb_build_object(
      'commandId',
      p_command_id,
      'replayed',
      false
    );

  insert into private.core_club_command_results (
    organization_id,
    brand_id,
    command_id,
    actor_user_id,
    operation,
    payload_sha256,
    entity_type,
    entity_id,
    result,
    audit_id
  )
  values (
    p_organization_id,
    p_brand_id,
    p_command_id,
    p_actor_user_id,
    lower(btrim(p_operation)),
    private.core_club_command_hash(p_operation, p_input),
    p_entity_type,
    p_entity_id,
    v_result,
    p_audit_id
  );

  return v_result;
end;
$$;

create or replace function private.require_core_club_staff(
  p_organization_id uuid,
  p_brand_id uuid,
  p_actor_user_id uuid,
  p_allowed_roles public.staff_role[]
)
returns public.staff_role
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.staff_role;
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Service role authorization is required.';
  end if;

  select staff.role
  into v_role
  from public.staff_users as staff
  where staff.id = p_actor_user_id
    and staff.organization_id = p_organization_id
    and staff.status = 'active';

  if not found or not (v_role = any(p_allowed_roles)) then
    raise exception using
      errcode = '42501',
      message = 'Active staff authorization is required.';
  end if;

  if not private.brand_accepts_operational_charges(
    p_organization_id,
    p_brand_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'The brand is not available for operational commands.';
  end if;

  if not (
    exists (
      select 1
      from public.organization_staff_access as access
      where access.organization_id = p_organization_id
        and access.staff_user_id = p_actor_user_id
        and access.scope = 'all_brands'
    )
    or exists (
      select 1
      from public.staff_brand_access as access
      where access.organization_id = p_organization_id
        and access.staff_user_id = p_actor_user_id
        and access.brand_id = p_brand_id
        and access.access_level in ('operator', 'admin')
    )
  ) then
    raise exception using
      errcode = '42501',
      message = 'Staff brand authorization is required.';
  end if;

  return v_role;
end;
$$;

create or replace function private.enqueue_member_side_effect(
  p_organization_id uuid,
  p_brand_id uuid,
  p_command_id uuid,
  p_member_id uuid,
  p_effect_type text,
  p_provider_subject_id text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text
      || ':'
      || p_brand_id::text
      || ':'
      || p_effect_type
      || ':'
      || p_provider_subject_id,
      13
    )
  );

  -- Every Stripe sync payload is a complete projection of the member. A newer
  -- pending projection therefore supersedes older unclaimed/retry work for the
  -- same provider subject. Processing work is left leased; the newer row waits
  -- and becomes the final write.
  update private.member_side_effect_outbox as outbox
  set
    status = 'completed',
    completed_at = now(),
    last_error_code = 'SUPERSEDED'
  where outbox.organization_id = p_organization_id
    and outbox.brand_id = p_brand_id
    and outbox.effect_type = p_effect_type
    and outbox.provider_subject_id = p_provider_subject_id
    and outbox.status in ('pending', 'retry');

  insert into private.member_side_effect_outbox (
    organization_id,
    brand_id,
    command_id,
    member_id,
    effect_type,
    provider_subject_id,
    payload
  )
  values (
    p_organization_id,
    p_brand_id,
    p_command_id,
    p_member_id,
    p_effect_type,
    p_provider_subject_id,
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (organization_id, brand_id, command_id, effect_type)
  do update set command_id = excluded.command_id
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.apply_club_tier_command(
  p_organization_id uuid,
  p_brand_id uuid,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_operation text,
  p_tier_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audit_id uuid;
  v_command_input jsonb;
  v_operation text := lower(btrim(p_operation));
  v_replay jsonb;
  v_result jsonb;
  v_tier public.club_tiers%rowtype;
begin
  perform private.require_core_club_staff(
    p_organization_id,
    p_brand_id,
    p_actor_user_id,
    case
      when v_operation = 'delete'
        then array['owner', 'admin']::public.staff_role[]
      else array['owner', 'admin', 'manager']::public.staff_role[]
    end
  );

  if v_operation not in ('create', 'update', 'delete')
    or jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload - array[
      'active',
      'billing_interval',
      'bottle_count',
      'description',
      'frequency',
      'name',
      'price_cents',
      'upgrade_path_id'
    ] <> '{}'::jsonb
  then
    raise exception using
      errcode = '22023',
      message = 'The club tier command is invalid.';
  end if;

  v_command_input := jsonb_build_object(
    'tier_id',
    p_tier_id,
    'payload',
    p_payload
  );
  v_replay := private.load_core_club_command(
    p_organization_id,
    p_brand_id,
    p_actor_user_id,
    p_command_id,
    'club_tier.' || v_operation,
    v_command_input
  );
  if v_replay is not null then
    return v_replay;
  end if;

  if v_operation = 'create' then
    if not (
      p_payload ? 'name'
      and p_payload ? 'price_cents'
      and p_payload ? 'billing_interval'
      and p_payload ? 'bottle_count'
      and p_payload ? 'frequency'
    ) then
      raise exception using
        errcode = '22023',
        message = 'The club tier create payload is incomplete.';
    end if;

    if nullif(p_payload ->> 'upgrade_path_id', '') is not null
      and not exists (
        select 1
        from public.club_tiers as upgrade
        where upgrade.organization_id = p_organization_id
          and upgrade.brand_id = p_brand_id
          and upgrade.id =
            (p_payload ->> 'upgrade_path_id')::uuid
      )
    then
      raise exception using
        errcode = 'P0002',
        message = 'Upgrade tier not found.';
    end if;

    insert into public.club_tiers (
      organization_id,
      brand_id,
      name,
      description,
      price_cents,
      billing_interval,
      bottle_count,
      frequency,
      upgrade_path_id,
      active
    )
    values (
      p_organization_id,
      p_brand_id,
      btrim(p_payload ->> 'name'),
      coalesce(p_payload ->> 'description', ''),
      (p_payload ->> 'price_cents')::integer,
      (p_payload ->> 'billing_interval')::public.club_billing_interval,
      (p_payload ->> 'bottle_count')::integer,
      (p_payload ->> 'frequency')::public.club_frequency,
      nullif(p_payload ->> 'upgrade_path_id', '')::uuid,
      coalesce((p_payload ->> 'active')::boolean, true)
    )
    returning * into v_tier;

    v_audit_id := public.append_audit_entry(
      p_organization_id,
      p_brand_id,
      p_actor_user_id,
      'club_tier.created',
      'club_tier',
      v_tier.id,
      jsonb_build_object(
        'frequency',
        v_tier.frequency,
        'price_cents',
        v_tier.price_cents
      )
    );
  elsif v_operation = 'update' then
    select tier.*
    into v_tier
    from public.club_tiers as tier
    where tier.organization_id = p_organization_id
      and tier.brand_id = p_brand_id
      and tier.id = p_tier_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Club tier not found.';
    end if;

    if p_payload ? 'upgrade_path_id'
      and nullif(p_payload ->> 'upgrade_path_id', '')::uuid = p_tier_id
    then
      raise exception using
        errcode = '22023',
        message = 'A tier cannot upgrade to itself.';
    end if;
    if p_payload ? 'upgrade_path_id'
      and nullif(p_payload ->> 'upgrade_path_id', '') is not null
      and not exists (
        select 1
        from public.club_tiers as upgrade
        where upgrade.organization_id = p_organization_id
          and upgrade.brand_id = p_brand_id
          and upgrade.id =
            (p_payload ->> 'upgrade_path_id')::uuid
      )
    then
      raise exception using errcode = 'P0002', message = 'Upgrade tier not found.';
    end if;

    update public.club_tiers as tier
    set
      name = case
        when p_payload ? 'name' then btrim(p_payload ->> 'name')
        else tier.name
      end,
      description = case
        when p_payload ? 'description'
          then coalesce(p_payload ->> 'description', '')
        else tier.description
      end,
      price_cents = case
        when p_payload ? 'price_cents'
          then (p_payload ->> 'price_cents')::integer
        else tier.price_cents
      end,
      billing_interval = case
        when p_payload ? 'billing_interval'
          then (p_payload ->> 'billing_interval')::public.club_billing_interval
        else tier.billing_interval
      end,
      bottle_count = case
        when p_payload ? 'bottle_count'
          then (p_payload ->> 'bottle_count')::integer
        else tier.bottle_count
      end,
      frequency = case
        when p_payload ? 'frequency'
          then (p_payload ->> 'frequency')::public.club_frequency
        else tier.frequency
      end,
      upgrade_path_id = case
        when p_payload ? 'upgrade_path_id'
          then nullif(p_payload ->> 'upgrade_path_id', '')::uuid
        else tier.upgrade_path_id
      end,
      active = case
        when p_payload ? 'active'
          then (p_payload ->> 'active')::boolean
        else tier.active
      end
    where tier.organization_id = p_organization_id
      and tier.brand_id = p_brand_id
      and tier.id = p_tier_id
    returning * into v_tier;

    v_audit_id := public.append_audit_entry(
      p_organization_id,
      p_brand_id,
      p_actor_user_id,
      'club_tier.updated',
      'club_tier',
      v_tier.id,
      jsonb_build_object(
        'changed_fields',
        (
          select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
          from jsonb_object_keys(p_payload) as key
        )
      )
    );
  else
    select tier.*
    into v_tier
    from public.club_tiers as tier
    where tier.organization_id = p_organization_id
      and tier.brand_id = p_brand_id
      and tier.id = p_tier_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Club tier not found.';
    end if;

    if exists (
      select 1
      from public.members as member
      where member.organization_id = p_organization_id
        and member.brand_id = p_brand_id
        and member.club_tier_id = p_tier_id
        and member.deleted_at is null
    ) then
      raise exception using
        errcode = '23514',
        message = 'Move members to another tier before deleting this tier.';
    end if;

    delete from public.club_tiers as tier
    where tier.organization_id = p_organization_id
      and tier.brand_id = p_brand_id
      and tier.id = p_tier_id;

    v_audit_id := public.append_audit_entry(
      p_organization_id,
      p_brand_id,
      p_actor_user_id,
      'club_tier.deleted',
      'club_tier',
      p_tier_id,
      '{}'::jsonb
    );
  end if;

  v_result := jsonb_build_object(
    'entityId',
    coalesce(v_tier.id, p_tier_id),
    'status',
    case when v_operation = 'delete' then 'deleted' else 'applied' end,
    'updatedAt',
    case
      when v_operation = 'delete' then null
      else to_jsonb(v_tier.updated_at)
    end
  );
  return private.store_core_club_command(
    p_organization_id,
    p_brand_id,
    p_actor_user_id,
    p_command_id,
    'club_tier.' || v_operation,
    v_command_input,
    'club_tier',
    coalesce(v_tier.id, p_tier_id),
    v_result,
    v_audit_id
  );
end;
$$;

-- Phase 5 introduced multi-brand labels after the Phase 2 relationships were
-- first defined. Replace the remaining organization-only foreign keys with
-- brand-composite keys. PostgreSQL validates existing rows while adding each
-- constraint, so an inconsistent deployment fails instead of rewriting data.
alter table public.release_wines
  add constraint release_wines_org_brand_id_key
    unique (organization_id, brand_id, id);

alter table public.audit_log
  add constraint audit_log_org_brand_id_key
    unique (organization_id, brand_id, id);

alter table private.core_club_command_results
  add constraint core_club_commands_audit_same_brand_fkey
    foreign key (organization_id, brand_id, audit_id)
    references public.audit_log (organization_id, brand_id, id)
    on delete restrict;

alter table public.members
  drop constraint members_club_tier_same_organization_fkey,
  drop constraint members_referrer_same_organization_fkey,
  add constraint members_club_tier_same_brand_fkey
    foreign key (organization_id, brand_id, club_tier_id)
    references public.club_tiers (organization_id, brand_id, id)
    on delete set null (club_tier_id),
  add constraint members_referrer_same_brand_fkey
    foreign key (organization_id, brand_id, referred_by_member_id)
    references public.members (organization_id, brand_id, id)
    on delete set null (referred_by_member_id);

alter table public.club_tiers
  drop constraint club_tiers_upgrade_same_organization_fkey,
  add constraint club_tiers_upgrade_same_brand_fkey
    foreign key (organization_id, brand_id, upgrade_path_id)
    references public.club_tiers (organization_id, brand_id, id)
    on delete set null (upgrade_path_id);

alter table public.release_tiers
  drop constraint release_tiers_tier_same_organization_fkey,
  add constraint release_tiers_tier_same_brand_fkey
    foreign key (organization_id, brand_id, tier_id)
    references public.club_tiers (organization_id, brand_id, id)
    on delete restrict;

alter table public.member_import_rows
  drop constraint member_import_rows_member_same_organization_fkey,
  add constraint member_import_rows_member_same_brand_fkey
    foreign key (organization_id, brand_id, member_id)
    references public.members (organization_id, brand_id, id)
    on delete set null (member_id);

alter table public.shipment_items
  drop constraint shipment_items_wine_same_organization_fkey,
  add constraint shipment_items_wine_same_brand_fkey
    foreign key (organization_id, brand_id, release_wine_id)
    references public.release_wines (organization_id, brand_id, id)
    on delete restrict;

-- PostgreSQL grants EXECUTE to PUBLIC when a function is created. Keep this
-- block after every command and helper definition so late-created
-- SECURITY DEFINER routines never inherit that default.
do $$
declare
  v_function regprocedure;
  v_name text;
begin
  foreach v_name in array array[
    'assert_release_ready',
    'core_club_command_hash',
    'invalidate_dependent_compliance',
    'load_core_club_command',
    'store_core_club_command',
    'require_core_club_staff',
    'enqueue_member_side_effect'
  ]
  loop
    for v_function in
      select procedure.oid::regprocedure
      from pg_proc as procedure
      join pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'private'
        and procedure.proname = v_name
    loop
      execute format(
        'revoke all on function %s from public, anon, authenticated',
        v_function
      );
      execute format(
        'grant execute on function %s to service_role',
        v_function
      );
    end loop;
  end loop;

  foreach v_name in array array[
    'apply_club_tier_command',
    'apply_member_command',
    'apply_member_portal_address_command',
    'apply_release_command',
    'claim_member_side_effects',
    'claim_stale_refund_attempts',
    'complete_refund_recovery_claim',
    'complete_member_side_effect',
    'get_member_side_effect_status'
  ]
  loop
    for v_function in
      select procedure.oid::regprocedure
      from pg_proc as procedure
      join pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = v_name
    loop
      execute format(
        'revoke all on function %s from public, anon, authenticated',
        v_function
      );
      execute format(
        'grant execute on function %s to service_role',
        v_function
      );
    end loop;
  end loop;
end;
$$;

commit;
