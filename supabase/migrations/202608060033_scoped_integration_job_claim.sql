-- Gate 15 and tenant-specific workers must never lease another tenant's job.
-- Preserve the existing global worker RPC while adding a service-role-only,
-- explicitly scoped claim surface for bounded acceptance and recovery work.

create function public.claim_integration_sync_jobs_for_scope(
  p_organization_id uuid,
  p_brand_ids uuid[],
  p_worker text,
  p_limit integer default 25,
  p_lease_seconds integer default 120,
  p_as_of timestamptz default now()
)
returns table (
  job_id uuid,
  lease_token text,
  connection_id uuid,
  organization_id uuid,
  brand_id uuid,
  integration_type public.integration_type,
  direction public.integration_job_direction,
  sync_type text,
  entity_type text,
  entity_id text,
  cursor_data jsonb,
  payload jsonb,
  idempotency_key text,
  attempt_count integer,
  max_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  if p_organization_id is null
    or p_brand_ids is null
    or cardinality(p_brand_ids) not between 1 and 100
    or exists (
      select 1
      from unnest(p_brand_ids) as requested(brand_id)
      where requested.brand_id is null
    )
    or char_length(btrim(p_worker)) not between 1 and 120
    or p_limit not between 1 and 100
    or p_lease_seconds not between 15 and 900
  then
    raise exception using errcode = '22023', message = 'Invalid scoped worker lease parameters.';
  end if;

  update public.integration_sync_jobs as expired
  set
    status = 'dead_letter',
    lease_token_hash = null,
    lease_owner = null,
    lease_expires_at = null,
    last_error_code = 'LEASE_EXPIRED_MAX_ATTEMPTS',
    updated_at = p_as_of
  where expired.organization_id = p_organization_id
    and expired.brand_id = any(p_brand_ids)
    and expired.status = 'leased'
    and expired.lease_expires_at <= p_as_of
    and expired.attempt_count >= expired.max_attempts;

  return query
  with candidates as (
    select
      job.id,
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') as raw_lease_token
    from public.integration_sync_jobs as job
    join public.integration_connections as connection
      on connection.id = job.connection_id
      and connection.organization_id = p_organization_id
      and connection.brand_id = any(p_brand_ids)
    join public.organizations as organization
      on organization.id = connection.organization_id
    join public.brands as brand
      on brand.organization_id = connection.organization_id
      and brand.id = connection.brand_id
    where job.organization_id = p_organization_id
      and job.brand_id = any(p_brand_ids)
      and (
        job.status in ('queued', 'retry')
        or (
          job.status = 'leased'
          and job.lease_expires_at <= p_as_of
        )
      )
      and job.next_attempt_at <= p_as_of
      and job.attempt_count < job.max_attempts
      and connection.opted_in
      and organization.access_status <> 'suspended'
      and brand.active
      and brand.access_status <> 'suspended'
      and (
        connection.status = 'active'
        or (
          connection.status = 'configured'
          and job.sync_type = 'connection.validate'
        )
      )
    order by job.next_attempt_at, job.created_at
    for update of job skip locked
    limit p_limit
  ),
  leased as (
    update public.integration_sync_jobs as job
    set
      status = 'leased',
      lease_owner = btrim(p_worker),
      lease_expires_at = p_as_of + make_interval(secs => p_lease_seconds),
      attempt_count = job.attempt_count + 1,
      lease_token_hash = encode(
        extensions.digest(
          convert_to(candidate.raw_lease_token, 'UTF8'),
          'sha256'
        ),
        'hex'
      ),
      updated_at = p_as_of
    from candidates as candidate
    where job.id = candidate.id
    returning job.*, candidate.raw_lease_token
  )
  select
    leased.id,
    leased.raw_lease_token,
    leased.connection_id,
    leased.organization_id,
    leased.brand_id,
    leased.integration_type,
    leased.direction,
    leased.sync_type,
    leased.entity_type,
    leased.entity_id,
    leased.cursor_data,
    leased.payload,
    leased.idempotency_key,
    leased.attempt_count,
    leased.max_attempts
  from leased;
end;
$$;

revoke all on function public.claim_integration_sync_jobs_for_scope(
  uuid, uuid[], text, integer, integer, timestamptz
) from public, anon, authenticated;

grant execute on function public.claim_integration_sync_jobs_for_scope(
  uuid, uuid[], text, integer, integer, timestamptz
) to service_role;
