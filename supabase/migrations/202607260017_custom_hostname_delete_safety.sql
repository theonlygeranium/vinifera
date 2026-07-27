-- Durable Cloudflare custom-hostname deletion coordination.
-- A lost DELETE response is persisted as lookup-required. A later caller must
-- prove the provider object still exists before another DELETE is authorized.

begin;

create unique index brand_custom_domains_one_enabled_per_brand_idx
  on public.brand_custom_domains (organization_id, brand_id)
  where status <> 'disabled';

create table public.custom_hostname_delete_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  brand_id uuid not null,
  hostname text not null,
  provider_hostname_id text not null unique,
  status text not null default 'claimed',
  mutation_attempt_count integer not null default 1,
  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text,
  mutation_started_at timestamptz not null default now(),
  provider_confirmed_absent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint custom_hostname_delete_brand_fkey
    foreign key (organization_id, brand_id)
    references public.brands (organization_id, id)
    on delete cascade,
  constraint custom_hostname_delete_identity_valid check (
    hostname = lower(hostname)
    and hostname ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$'
    and hostname not like '%.edstratumlabs.ai'
    and provider_hostname_id ~ '^[A-Za-z0-9_-]{6,255}$'
  ),
  constraint custom_hostname_delete_status_valid check (
    status in ('claimed', 'lookup_required', 'provider_absent', 'completed')
  ),
  constraint custom_hostname_delete_attempt_count_valid check (
    mutation_attempt_count >= 1
    and mutation_attempt_count <= 100
  ),
  constraint custom_hostname_delete_error_valid check (
    last_error_code is null
    or last_error_code ~ '^[A-Z0-9_:-]{1,100}$'
  ),
  constraint custom_hostname_delete_absence_valid check (
    (
      status in ('provider_absent', 'completed')
      and provider_confirmed_absent_at is not null
    )
    or (
      status in ('claimed', 'lookup_required')
      and provider_confirmed_absent_at is null
    )
  ),
  constraint custom_hostname_delete_lease_valid check (
    (
      status in ('claimed', 'provider_absent')
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
  constraint custom_hostname_delete_completed_valid check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create index custom_hostname_delete_attempt_claim_idx
  on public.custom_hostname_delete_attempts (
    status,
    lease_expires_at,
    created_at
  );

alter table public.custom_hostname_delete_attempts enable row level security;

revoke all on table public.custom_hostname_delete_attempts
  from public, anon, authenticated;
grant all on table public.custom_hostname_delete_attempts to service_role;

create function public.claim_custom_hostname_delete_attempt(
  p_organization_id uuid,
  p_brand_id uuid,
  p_hostname text,
  p_provider_hostname_id text,
  p_lease_owner text,
  p_lease_seconds integer default 120
)
returns table (
  attempt_id uuid,
  disposition text,
  lease_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.custom_hostname_delete_attempts%rowtype;
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
    or p_provider_hostname_id !~ '^[A-Za-z0-9_-]{6,255}$'
    or p_lease_owner !~ '^[A-Za-z0-9_.:@/-]{1,128}$'
    or p_lease_seconds not between 30 and 900
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid custom-hostname deletion claim.';
  end if;
  if not exists (
    select 1
    from public.brand_custom_domains as domain
    where domain.organization_id = p_organization_id
      and domain.brand_id = p_brand_id
      and domain.hostname = p_hostname
      and domain.provider_hostname_id = p_provider_hostname_id
      and domain.status <> 'disabled'
  ) then
    raise exception using
      errcode = '23503',
      message = 'The active custom hostname does not match this deletion claim.';
  end if;

  select attempt.*
  into v_attempt
  from public.custom_hostname_delete_attempts as attempt
  where attempt.provider_hostname_id = p_provider_hostname_id
  for update;

  if not found then
    insert into public.custom_hostname_delete_attempts (
      organization_id,
      brand_id,
      hostname,
      provider_hostname_id,
      status,
      mutation_attempt_count,
      lease_token,
      lease_owner,
      lease_expires_at
    )
    values (
      p_organization_id,
      p_brand_id,
      p_hostname,
      p_provider_hostname_id,
      'claimed',
      1,
      v_lease_token,
      p_lease_owner,
      now() + make_interval(secs => p_lease_seconds)
    )
    returning * into v_attempt;
    return query
    select v_attempt.id, 'delete'::text, v_attempt.lease_token;
    return;
  end if;

  if v_attempt.organization_id <> p_organization_id
    or v_attempt.brand_id <> p_brand_id
    or v_attempt.hostname <> p_hostname
  then
    raise exception using
      errcode = '23505',
      message = 'The provider hostname is already claimed by another brand.';
  end if;
  if v_attempt.status = 'completed' then
    return query select v_attempt.id, 'completed'::text, null::uuid;
    return;
  end if;
  if v_attempt.lease_token is not null
    and v_attempt.lease_expires_at > now()
  then
    return query select v_attempt.id, 'busy'::text, null::uuid;
    return;
  end if;
  if v_attempt.status = 'provider_absent' then
    update public.custom_hostname_delete_attempts
    set
      lease_token = v_lease_token,
      lease_owner = p_lease_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
    where id = v_attempt.id
    returning * into v_attempt;
    return query
    select v_attempt.id, 'reconcile'::text, v_attempt.lease_token;
    return;
  end if;

  update public.custom_hostname_delete_attempts
  set
    status = 'lookup_required',
    lease_token = v_lease_token,
    lease_owner = p_lease_owner,
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    last_error_code = coalesce(
      last_error_code,
      'DELETE_LEASE_EXPIRED'
    ),
    updated_at = now()
  where id = v_attempt.id
  returning * into v_attempt;
  return query select v_attempt.id, 'lookup'::text, v_attempt.lease_token;
end;
$$;

create function public.mark_custom_hostname_delete_lookup_required(
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
    raise exception using errcode = '22023', message = 'Invalid error code.';
  end if;
  update public.custom_hostname_delete_attempts
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
    raise exception using
      errcode = '55000',
      message = 'Custom-hostname deletion lease is unavailable.';
  end if;
end;
$$;

create function public.release_custom_hostname_delete_lookup(
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
    raise exception using errcode = '22023', message = 'Invalid error code.';
  end if;
  update public.custom_hostname_delete_attempts
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
    raise exception using
      errcode = '55000',
      message = 'Custom-hostname deletion lookup lease is unavailable.';
  end if;
end;
$$;

create function public.authorize_custom_hostname_delete_after_lookup(
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
  update public.custom_hostname_delete_attempts
  set
    status = 'claimed',
    mutation_attempt_count = mutation_attempt_count + 1,
    last_error_code = null,
    mutation_started_at = now(),
    updated_at = now()
  where id = p_attempt_id
    and status = 'lookup_required'
    and lease_token = p_lease_token
    and lease_expires_at > now()
    and mutation_attempt_count < 100;
  if not found then
    raise exception using
      errcode = '55000',
      message = 'Custom-hostname deletion retry is unavailable.';
  end if;
end;
$$;

create function public.record_custom_hostname_delete_provider_absent(
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
  update public.custom_hostname_delete_attempts
  set
    status = 'provider_absent',
    provider_confirmed_absent_at = now(),
    last_error_code = null,
    updated_at = now()
  where id = p_attempt_id
    and status in ('claimed', 'lookup_required')
    and lease_token = p_lease_token
    and lease_expires_at > now();
  if not found then
    raise exception using
      errcode = '55000',
      message = 'Custom-hostname deletion lease is unavailable.';
  end if;
end;
$$;

create function public.complete_custom_hostname_delete_attempt(
  p_attempt_id uuid,
  p_lease_token uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.custom_hostname_delete_attempts%rowtype;
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Service role authorization is required.';
  end if;

  select attempt.*
  into v_attempt
  from public.custom_hostname_delete_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.status = 'provider_absent'
    and attempt.lease_token = p_lease_token
    and attempt.lease_expires_at > now()
  for update;
  if not found then
    raise exception using
      errcode = '55000',
      message = 'Custom-hostname deletion completion lease is unavailable.';
  end if;

  update public.brand_custom_domains
  set
    status = 'disabled',
    updated_at = now()
  where organization_id = v_attempt.organization_id
    and brand_id = v_attempt.brand_id
    and hostname = v_attempt.hostname
    and provider_hostname_id = v_attempt.provider_hostname_id;
  if not found then
    raise exception using
      errcode = '55000',
      message = 'Custom-hostname deletion target is unavailable.';
  end if;

  update public.custom_hostname_delete_attempts
  set
    status = 'completed',
    lease_token = null,
    lease_owner = null,
    lease_expires_at = null,
    completed_at = now(),
    updated_at = now()
  where id = v_attempt.id;

  delete from public.custom_hostname_write_attempts
  where organization_id = v_attempt.organization_id
    and brand_id = v_attempt.brand_id
    and hostname = v_attempt.hostname
    and provider_hostname_id = v_attempt.provider_hostname_id;
end;
$$;

revoke all on function public.claim_custom_hostname_delete_attempt(
  uuid, uuid, text, text, text, integer
) from public, anon, authenticated;
revoke all on function public.mark_custom_hostname_delete_lookup_required(
  uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.release_custom_hostname_delete_lookup(
  uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.authorize_custom_hostname_delete_after_lookup(
  uuid, uuid
) from public, anon, authenticated;
revoke all on function public.record_custom_hostname_delete_provider_absent(
  uuid, uuid
) from public, anon, authenticated;
revoke all on function public.complete_custom_hostname_delete_attempt(
  uuid, uuid
) from public, anon, authenticated;

grant execute on function public.claim_custom_hostname_delete_attempt(
  uuid, uuid, text, text, text, integer
) to service_role;
grant execute on function public.mark_custom_hostname_delete_lookup_required(
  uuid, uuid, text
) to service_role;
grant execute on function public.release_custom_hostname_delete_lookup(
  uuid, uuid, text
) to service_role;
grant execute on function public.authorize_custom_hostname_delete_after_lookup(
  uuid, uuid
) to service_role;
grant execute on function public.record_custom_hostname_delete_provider_absent(
  uuid, uuid
) to service_role;
grant execute on function public.complete_custom_hostname_delete_attempt(
  uuid, uuid
) to service_role;

commit;
