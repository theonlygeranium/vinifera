-- Retry-safe Cloudflare custom-hostname external-write coordination.
-- Provider calls happen outside database transactions. This ledger ensures an
-- ambiguous create result can only be reconciled by provider lookup, never by
-- replaying the mutation.

begin;

create table public.custom_hostname_write_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  hostname text not null unique,
  status text not null default 'claimed',
  provider_hostname_id text,
  mutation_attempt_count integer not null default 1,
  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text,
  mutation_started_at timestamptz not null default now(),
  provider_confirmed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint custom_hostname_attempt_brand_fkey
    foreign key (organization_id, brand_id)
    references public.brands (organization_id, id)
    on delete cascade,
  constraint custom_hostname_attempt_hostname_valid check (
    hostname = lower(hostname)
    and hostname ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$'
    and hostname not like '%.edstratumlabs.ai'
  ),
  constraint custom_hostname_attempt_status_valid check (
    status in (
      'claimed',
      'lookup_required',
      'provider_confirmed',
      'completed'
    )
  ),
  constraint custom_hostname_attempt_provider_valid check (
    (
      status in ('provider_confirmed', 'completed')
      and provider_hostname_id ~ '^[A-Za-z0-9_-]{6,255}$'
      and provider_confirmed_at is not null
    )
    or (
      status in ('claimed', 'lookup_required')
      and provider_hostname_id is null
      and provider_confirmed_at is null
    )
  ),
  constraint custom_hostname_attempt_lease_valid check (
    (
      status in ('claimed', 'provider_confirmed')
      and lease_token is not null
      and lease_owner ~ '^[A-Za-z0-9_.:@/-]{1,128}$'
      and lease_expires_at is not null
    )
    or (
      status = 'lookup_required'
      and (
        (
          lease_token is not null
          and lease_owner ~ '^[A-Za-z0-9_.:@/-]{1,128}$'
          and lease_expires_at is not null
        )
        or (
          lease_token is null
          and lease_owner is null
          and lease_expires_at is null
        )
      )
    )
    or (
      status = 'completed'
      and lease_token is null
      and lease_owner is null
      and lease_expires_at is null
    )
  ),
  constraint custom_hostname_attempt_count_valid check (
    mutation_attempt_count = 1
  ),
  constraint custom_hostname_attempt_error_valid check (
    last_error_code is null
    or last_error_code ~ '^[A-Z0-9_:-]{1,100}$'
  ),
  constraint custom_hostname_attempt_completed_valid check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create index custom_hostname_write_attempt_claim_idx
  on public.custom_hostname_write_attempts (status, lease_expires_at, created_at);

insert into public.custom_hostname_write_attempts (
  organization_id,
  brand_id,
  hostname,
  status,
  provider_hostname_id,
  lease_token,
  lease_owner,
  lease_expires_at,
  provider_confirmed_at,
  completed_at,
  mutation_started_at,
  created_at,
  updated_at
)
select
  domain.organization_id,
  domain.brand_id,
  domain.hostname,
  case
    when domain.provider_hostname_id is not null then 'completed'
    else 'lookup_required'
  end,
  domain.provider_hostname_id,
  null,
  null,
  null,
  case
    when domain.provider_hostname_id is not null
      then coalesce(domain.verified_at, domain.created_at)
    else null
  end,
  case
    when domain.provider_hostname_id is not null
      then coalesce(domain.verified_at, domain.updated_at)
    else null
  end,
  domain.created_at,
  domain.created_at,
  domain.updated_at
from public.brand_custom_domains as domain
on conflict (hostname) do nothing;

alter table public.custom_hostname_write_attempts enable row level security;

revoke all on table public.custom_hostname_write_attempts
  from public, anon, authenticated;
grant all on table public.custom_hostname_write_attempts to service_role;

create or replace function public.claim_custom_hostname_write_attempt(
  p_organization_id uuid,
  p_brand_id uuid,
  p_hostname text,
  p_lease_owner text,
  p_lease_seconds integer default 120
)
returns table (
  attempt_id uuid,
  disposition text,
  lease_token uuid,
  provider_hostname_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.custom_hostname_write_attempts%rowtype;
  v_inserted_id uuid;
  v_lease_token uuid := gen_random_uuid();
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Service role authorization is required.';
  end if;
  if p_hostname <> lower(p_hostname)
    or p_hostname !~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$'
    or p_hostname like '%.edstratumlabs.ai'
    or p_lease_owner !~ '^[A-Za-z0-9_.:@/-]{1,128}$'
    or p_lease_seconds not between 30 and 900
  then
    raise exception using errcode = '22023', message = 'Custom-hostname write claim is invalid.';
  end if;
  if not exists (
    select 1
    from public.brands
    where organization_id = p_organization_id and id = p_brand_id
  ) then
    raise exception using errcode = 'P0002', message = 'Brand not found.';
  end if;

  insert into public.custom_hostname_write_attempts (
    organization_id,
    brand_id,
    hostname,
    lease_token,
    lease_owner,
    lease_expires_at
  )
  values (
    p_organization_id,
    p_brand_id,
    p_hostname,
    v_lease_token,
    p_lease_owner,
    now() + make_interval(secs => p_lease_seconds)
  )
  on conflict (hostname) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is not null then
    return query
    select v_inserted_id, 'create'::text, v_lease_token, null::text;
    return;
  end if;

  select *
  into v_attempt
  from public.custom_hostname_write_attempts
  where hostname = p_hostname
  for update;

  if v_attempt.organization_id <> p_organization_id
    or v_attempt.brand_id <> p_brand_id
  then
    raise exception using
      errcode = '23505',
      message = 'The custom hostname is already claimed by another brand.';
  end if;

  if v_attempt.status = 'completed' then
    return query
    select
      v_attempt.id,
      'completed'::text,
      null::uuid,
      v_attempt.provider_hostname_id;
    return;
  end if;

  if v_attempt.lease_expires_at > now() then
    return query
    select
      v_attempt.id,
      'busy'::text,
      null::uuid,
      v_attempt.provider_hostname_id;
    return;
  end if;

  if v_attempt.status = 'claimed' then
    update public.custom_hostname_write_attempts
    set
      status = 'lookup_required',
      lease_token = v_lease_token,
      lease_owner = p_lease_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      last_error_code = 'CREATE_RESULT_UNKNOWN',
      updated_at = now()
    where id = v_attempt.id;
    return query
    select v_attempt.id, 'lookup'::text, v_lease_token, null::text;
    return;
  end if;

  update public.custom_hostname_write_attempts
  set
    lease_token = v_lease_token,
    lease_owner = p_lease_owner,
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    updated_at = now()
  where id = v_attempt.id;

  return query
  select
    v_attempt.id,
    case
      when v_attempt.status = 'provider_confirmed' then 'reconcile'
      else 'lookup'
    end,
    v_lease_token,
    v_attempt.provider_hostname_id;
end;
$$;

create or replace function public.mark_custom_hostname_lookup_required(
  p_attempt_id uuid,
  p_lease_token uuid,
  p_error_code text
)
returns void
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
  if p_error_code !~ '^[A-Z0-9_:-]{1,100}$' then
    raise exception using errcode = '22023', message = 'Custom-hostname error code is invalid.';
  end if;

  update public.custom_hostname_write_attempts
  set
    status = 'lookup_required',
    lease_token = null,
    lease_owner = null,
    lease_expires_at = null,
    last_error_code = p_error_code,
    updated_at = now()
  where id = p_attempt_id
    and status = 'claimed'
    and lease_token = p_lease_token
    and lease_expires_at > now();
  if not found then
    raise exception using errcode = '55000', message = 'Custom-hostname write lease is unavailable.';
  end if;
end;
$$;

create or replace function public.release_custom_hostname_lookup(
  p_attempt_id uuid,
  p_lease_token uuid,
  p_error_code text
)
returns void
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
  if p_error_code !~ '^[A-Z0-9_:-]{1,100}$' then
    raise exception using errcode = '22023', message = 'Custom-hostname error code is invalid.';
  end if;

  update public.custom_hostname_write_attempts
  set
    lease_token = null,
    lease_owner = null,
    lease_expires_at = null,
    last_error_code = p_error_code,
    updated_at = now()
  where id = p_attempt_id
    and status = 'lookup_required'
    and lease_token = p_lease_token
    and lease_expires_at > now();
  if not found then
    raise exception using errcode = '55000', message = 'Custom-hostname lookup lease is unavailable.';
  end if;
end;
$$;

create or replace function public.record_custom_hostname_provider_result(
  p_attempt_id uuid,
  p_lease_token uuid,
  p_provider_hostname_id text
)
returns void
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
  if p_provider_hostname_id !~ '^[A-Za-z0-9_-]{6,255}$' then
    raise exception using errcode = '22023', message = 'Provider custom-hostname identity is invalid.';
  end if;

  update public.custom_hostname_write_attempts
  set
    status = 'provider_confirmed',
    provider_hostname_id = p_provider_hostname_id,
    provider_confirmed_at = now(),
    last_error_code = null,
    updated_at = now()
  where id = p_attempt_id
    and status in ('claimed', 'lookup_required')
    and lease_token = p_lease_token
    and lease_expires_at > now();
  if not found then
    raise exception using errcode = '55000', message = 'Custom-hostname write lease is unavailable.';
  end if;
end;
$$;

create or replace function public.complete_custom_hostname_write_attempt(
  p_attempt_id uuid,
  p_lease_token uuid
)
returns void
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

  update public.custom_hostname_write_attempts
  set
    status = 'completed',
    lease_token = null,
    lease_owner = null,
    lease_expires_at = null,
    completed_at = now(),
    updated_at = now()
  where id = p_attempt_id
    and status = 'provider_confirmed'
    and lease_token = p_lease_token
    and lease_expires_at > now();
  if not found then
    raise exception using errcode = '55000', message = 'Custom-hostname completion lease is unavailable.';
  end if;
end;
$$;

revoke all on function public.claim_custom_hostname_write_attempt(
  uuid, uuid, text, text, integer
) from public, anon, authenticated;
revoke all on function public.mark_custom_hostname_lookup_required(
  uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.release_custom_hostname_lookup(
  uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.record_custom_hostname_provider_result(
  uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.complete_custom_hostname_write_attempt(
  uuid, uuid
) from public, anon, authenticated;

grant execute on function public.claim_custom_hostname_write_attempt(
  uuid, uuid, text, text, integer
) to service_role;
grant execute on function public.mark_custom_hostname_lookup_required(
  uuid, uuid, text
) to service_role;
grant execute on function public.release_custom_hostname_lookup(
  uuid, uuid, text
) to service_role;
grant execute on function public.record_custom_hostname_provider_result(
  uuid, uuid, text
) to service_role;
grant execute on function public.complete_custom_hostname_write_attempt(
  uuid, uuid
) to service_role;

commit;
