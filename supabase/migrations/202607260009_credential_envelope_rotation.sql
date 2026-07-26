-- Server-only, resumable credential-envelope key rotation.
-- Ciphertext remains in the source secret tables; durable job rows contain only
-- identifiers, lease state, bounded retry metadata, and sanitized error codes.

begin;

create table public.credential_envelope_rotation_runs (
  id uuid primary key default gen_random_uuid(),
  source_key_version text not null,
  target_key_version text not null,
  requested_git_sha text not null,
  batch_size integer not null,
  status text not null default 'running',
  total_items integer not null default 0,
  rotated_items integer not null default 0,
  skipped_items integer not null default 0,
  failed_items integer not null default 0,
  started_at timestamptz not null default now(),
  verified_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint credential_rotation_versions_valid check (
    source_key_version ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'
    and target_key_version ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'
    and source_key_version <> target_key_version
  ),
  constraint credential_rotation_git_sha_valid check (
    requested_git_sha ~ '^[0-9a-f]{40}$'
  ),
  constraint credential_rotation_batch_size_valid check (
    batch_size between 1 and 500
  ),
  constraint credential_rotation_status_valid check (
    status in ('running', 'verified', 'failed')
  ),
  constraint credential_rotation_verified_at_valid check (
    (status = 'verified' and verified_at is not null)
    or (status <> 'verified' and verified_at is null)
  )
);

create unique index credential_envelope_rotation_one_running_idx
  on public.credential_envelope_rotation_runs ((true))
  where status = 'running';

create table public.credential_envelope_rotation_items (
  run_id uuid not null
    references public.credential_envelope_rotation_runs (id) on delete cascade,
  secret_kind text not null,
  secret_id uuid not null,
  organization_id uuid not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (run_id, secret_kind, secret_id),
  constraint credential_rotation_item_kind_valid check (
    secret_kind in ('integration', 'meta_attribution', 'mobile_push')
  ),
  constraint credential_rotation_item_status_valid check (
    status in ('pending', 'processing', 'rotated', 'skipped', 'failed')
  ),
  constraint credential_rotation_item_attempts_valid check (
    attempts between 0 and 5
  ),
  constraint credential_rotation_item_lease_valid check (
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
  constraint credential_rotation_item_error_valid check (
    error_code is null or error_code ~ '^[A-Z0-9_:-]{1,100}$'
  )
);

create index credential_envelope_rotation_items_claim_idx
  on public.credential_envelope_rotation_items (run_id, status, secret_kind, secret_id);

alter table public.credential_envelope_rotation_runs enable row level security;
alter table public.credential_envelope_rotation_items enable row level security;

revoke all on table
  public.credential_envelope_rotation_runs,
  public.credential_envelope_rotation_items
from public, anon, authenticated;

grant all on table
  public.credential_envelope_rotation_runs,
  public.credential_envelope_rotation_items
to service_role;

create or replace function private.refresh_credential_envelope_rotation_items(
  p_run_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.credential_envelope_rotation_runs%rowtype;
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Service role authorization is required.';
  end if;

  select *
  into v_run
  from public.credential_envelope_rotation_runs
  where id = p_run_id
  for update;

  if v_run.id is null then
    raise exception using errcode = 'P0002', message = 'Credential rotation run not found.';
  end if;
  if v_run.status <> 'running' then
    raise exception using errcode = '55000', message = 'Credential rotation run is not active.';
  end if;

  insert into public.credential_envelope_rotation_items (
    run_id,
    secret_kind,
    secret_id,
    organization_id
  )
  select
    v_run.id,
    'integration',
    secret.connection_id,
    secret.organization_id
  from public.integration_secrets as secret
  where secret.storage_mode = 'encrypted_envelope'
    and secret.key_version = v_run.source_key_version
  union all
  select
    v_run.id,
    'mobile_push',
    secret.device_id,
    secret.organization_id
  from public.mobile_device_secrets as secret
  where secret.storage_mode = 'encrypted_envelope'
    and secret.key_version = v_run.source_key_version
  union all
  select
    v_run.id,
    'meta_attribution',
    touchpoint.id,
    touchpoint.organization_id
  from public.meta_attribution_touchpoints as touchpoint
  where touchpoint.storage_mode = 'encrypted_envelope'
    and touchpoint.key_version = v_run.source_key_version
  on conflict (run_id, secret_kind, secret_id) do nothing;

  update public.credential_envelope_rotation_items as item
  set
    status = 'pending',
    lease_token = null,
    lease_owner = null,
    lease_expires_at = null,
    error_code = 'LEASE_EXPIRED',
    updated_at = now()
  where item.run_id = v_run.id
    and item.status = 'processing'
    and item.lease_expires_at <= now()
    and item.attempts < 5;

  update public.credential_envelope_rotation_items as item
  set
    status = 'failed',
    lease_token = null,
    lease_owner = null,
    lease_expires_at = null,
    error_code = 'LEASE_RETRY_EXHAUSTED',
    updated_at = now()
  where item.run_id = v_run.id
    and item.status = 'processing'
    and item.lease_expires_at <= now()
    and item.attempts >= 5;

  update public.credential_envelope_rotation_items as item
  set
    status = 'skipped',
    lease_token = null,
    lease_owner = null,
    lease_expires_at = null,
    error_code = null,
    updated_at = now()
  where item.run_id = v_run.id
    and item.status = 'pending'
    and (
      (
        item.secret_kind = 'integration'
        and not exists (
          select 1
          from public.integration_secrets as secret
          where secret.connection_id = item.secret_id
            and secret.storage_mode = 'encrypted_envelope'
            and secret.key_version = v_run.source_key_version
        )
      )
      or (
        item.secret_kind = 'mobile_push'
        and not exists (
          select 1
          from public.mobile_device_secrets as secret
          where secret.device_id = item.secret_id
            and secret.storage_mode = 'encrypted_envelope'
            and secret.key_version = v_run.source_key_version
        )
      )
      or (
        item.secret_kind = 'meta_attribution'
        and not exists (
          select 1
          from public.meta_attribution_touchpoints as touchpoint
          where touchpoint.id = item.secret_id
            and touchpoint.storage_mode = 'encrypted_envelope'
            and touchpoint.key_version = v_run.source_key_version
        )
      )
    );

  update public.credential_envelope_rotation_items as item
  set
    status = 'pending',
    attempts = 0,
    lease_token = null,
    lease_owner = null,
    lease_expires_at = null,
    error_code = 'SOURCE_ENVELOPE_REAPPEARED',
    updated_at = now()
  where item.run_id = v_run.id
    and item.status in ('rotated', 'skipped')
    and (
      (
        item.secret_kind = 'integration'
        and exists (
          select 1
          from public.integration_secrets as secret
          where secret.connection_id = item.secret_id
            and secret.storage_mode = 'encrypted_envelope'
            and secret.key_version = v_run.source_key_version
        )
      )
      or (
        item.secret_kind = 'mobile_push'
        and exists (
          select 1
          from public.mobile_device_secrets as secret
          where secret.device_id = item.secret_id
            and secret.storage_mode = 'encrypted_envelope'
            and secret.key_version = v_run.source_key_version
        )
      )
      or (
        item.secret_kind = 'meta_attribution'
        and exists (
          select 1
          from public.meta_attribution_touchpoints as touchpoint
          where touchpoint.id = item.secret_id
            and touchpoint.storage_mode = 'encrypted_envelope'
            and touchpoint.key_version = v_run.source_key_version
        )
      )
    );

  update public.credential_envelope_rotation_runs as run
  set
    total_items = (
      select count(*)::integer
      from public.credential_envelope_rotation_items as item
      where item.run_id = v_run.id
    ),
    rotated_items = (
      select count(*)::integer
      from public.credential_envelope_rotation_items as item
      where item.run_id = v_run.id and item.status = 'rotated'
    ),
    skipped_items = (
      select count(*)::integer
      from public.credential_envelope_rotation_items as item
      where item.run_id = v_run.id and item.status = 'skipped'
    ),
    failed_items = (
      select count(*)::integer
      from public.credential_envelope_rotation_items as item
      where item.run_id = v_run.id and item.status = 'failed'
    ),
    updated_at = now()
  where run.id = v_run.id;
end;
$$;

create or replace function public.start_credential_envelope_rotation(
  p_source_key_version text,
  p_target_key_version text,
  p_batch_size integer,
  p_requested_git_sha text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Service role authorization is required.';
  end if;
  if p_source_key_version !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'
    or p_target_key_version !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'
    or p_source_key_version = p_target_key_version
    or p_batch_size not between 1 and 500
    or p_requested_git_sha !~ '^[0-9a-f]{40}$'
  then
    raise exception using errcode = '22023', message = 'Credential rotation request is invalid.';
  end if;

  insert into public.credential_envelope_rotation_runs (
    source_key_version,
    target_key_version,
    requested_git_sha,
    batch_size
  )
  values (
    p_source_key_version,
    p_target_key_version,
    p_requested_git_sha,
    p_batch_size
  )
  returning id into v_run_id;

  perform private.refresh_credential_envelope_rotation_items(v_run_id);
  return v_run_id;
end;
$$;

create or replace function public.claim_credential_envelope_rotation_batch(
  p_run_id uuid,
  p_lease_owner text,
  p_lease_seconds integer default 120
)
returns table (
  secret_kind text,
  secret_id uuid,
  organization_id uuid,
  integration_type text,
  target_id uuid,
  envelope_version integer,
  algorithm text,
  ciphertext text,
  iv text,
  key_version text,
  lease_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_size integer;
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Service role authorization is required.';
  end if;
  if p_lease_owner !~ '^[A-Za-z0-9_.:@/-]{1,128}$'
    or p_lease_seconds not between 30 and 900
  then
    raise exception using errcode = '22023', message = 'Credential rotation lease is invalid.';
  end if;

  perform private.refresh_credential_envelope_rotation_items(p_run_id);

  select run.batch_size
  into v_batch_size
  from public.credential_envelope_rotation_runs as run
  where run.id = p_run_id and run.status = 'running';

  if v_batch_size is null then
    raise exception using errcode = '55000', message = 'Credential rotation run is not active.';
  end if;

  return query
  with available as (
    select item.run_id, item.secret_kind, item.secret_id
    from public.credential_envelope_rotation_items as item
    where item.run_id = p_run_id
      and item.status = 'pending'
      and item.attempts < 5
    order by item.secret_kind, item.secret_id
    limit v_batch_size
    for update skip locked
  ),
  claimed as (
    update public.credential_envelope_rotation_items as item
    set
      status = 'processing',
      attempts = item.attempts + 1,
      lease_token = gen_random_uuid(),
      lease_owner = p_lease_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      error_code = null,
      updated_at = now()
    from available
    where item.run_id = available.run_id
      and item.secret_kind = available.secret_kind
      and item.secret_id = available.secret_id
    returning item.*
  )
  select
    claimed.secret_kind,
    claimed.secret_id,
    claimed.organization_id,
    case
      when claimed.secret_kind = 'integration'
        then connection.integration_type::text
      when claimed.secret_kind = 'meta_attribution'
        then 'meta_attribution'
      else 'mobile_push_token'
    end,
    claimed.secret_id,
    coalesce(
      integration_secret.envelope_version,
      meta_touchpoint.envelope_version,
      mobile_secret.envelope_version
    ),
    coalesce(
      integration_secret.algorithm,
      meta_touchpoint.algorithm,
      mobile_secret.algorithm
    ),
    coalesce(
      integration_secret.credential_ciphertext,
      meta_touchpoint.browser_data_ciphertext,
      mobile_secret.push_token_ciphertext
    ),
    coalesce(
      integration_secret.credential_iv,
      meta_touchpoint.browser_data_iv,
      mobile_secret.push_token_iv
    ),
    coalesce(
      integration_secret.key_version,
      meta_touchpoint.key_version,
      mobile_secret.key_version
    ),
    claimed.lease_token
  from claimed
  left join public.integration_secrets as integration_secret
    on claimed.secret_kind = 'integration'
    and integration_secret.connection_id = claimed.secret_id
  left join public.integration_connections as connection
    on claimed.secret_kind = 'integration'
    and connection.id = claimed.secret_id
  left join public.mobile_device_secrets as mobile_secret
    on claimed.secret_kind = 'mobile_push'
    and mobile_secret.device_id = claimed.secret_id
  left join public.meta_attribution_touchpoints as meta_touchpoint
    on claimed.secret_kind = 'meta_attribution'
    and meta_touchpoint.id = claimed.secret_id
  order by claimed.secret_kind, claimed.secret_id;
end;
$$;

create or replace function public.complete_credential_envelope_rotation_item(
  p_run_id uuid,
  p_secret_kind text,
  p_secret_id uuid,
  p_lease_token uuid,
  p_envelope_version integer,
  p_algorithm text,
  p_ciphertext text,
  p_iv text,
  p_key_version text,
  p_source_ciphertext text,
  p_source_iv text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.credential_envelope_rotation_runs%rowtype;
  v_updated integer;
  v_disposition text := 'rotated';
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Service role authorization is required.';
  end if;

  select run.*
  into v_run
  from public.credential_envelope_rotation_runs as run
  where run.id = p_run_id and run.status = 'running'
  for update;
  if v_run.id is null then
    raise exception using errcode = '55000', message = 'Credential rotation run is not active.';
  end if;
  if p_key_version <> v_run.target_key_version
    or p_envelope_version <> 1
    or p_algorithm <> 'A256GCM'
    or p_ciphertext !~ '^[A-Za-z0-9+/=_-]{24,}$'
    or p_iv !~ '^[A-Za-z0-9+/=_-]{12,}$'
    or p_source_ciphertext !~ '^[A-Za-z0-9+/=_-]{24,}$'
    or p_source_iv !~ '^[A-Za-z0-9+/=_-]{12,}$'
  then
    raise exception using errcode = '22023', message = 'Replacement credential envelope is invalid.';
  end if;

  perform 1
  from public.credential_envelope_rotation_items as item
  where item.run_id = p_run_id
    and item.secret_kind = p_secret_kind
    and item.secret_id = p_secret_id
    and item.status = 'processing'
    and item.lease_token = p_lease_token
    and item.lease_expires_at > now()
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'Credential rotation lease is unavailable.';
  end if;

  if p_secret_kind = 'integration' then
    update public.integration_secrets
    set
      envelope_version = p_envelope_version,
      algorithm = p_algorithm,
      credential_ciphertext = p_ciphertext,
      credential_iv = p_iv,
      key_version = p_key_version,
      rotated_at = now(),
      updated_at = now()
    where connection_id = p_secret_id
      and storage_mode = 'encrypted_envelope'
      and key_version = v_run.source_key_version
      and credential_ciphertext = p_source_ciphertext
      and credential_iv = p_source_iv;
  elsif p_secret_kind = 'mobile_push' then
    update public.mobile_device_secrets
    set
      envelope_version = p_envelope_version,
      algorithm = p_algorithm,
      push_token_ciphertext = p_ciphertext,
      push_token_iv = p_iv,
      key_version = p_key_version,
      rotated_at = now(),
      updated_at = now()
    where device_id = p_secret_id
      and storage_mode = 'encrypted_envelope'
      and key_version = v_run.source_key_version
      and push_token_ciphertext = p_source_ciphertext
      and push_token_iv = p_source_iv;
  elsif p_secret_kind = 'meta_attribution' then
    update public.meta_attribution_touchpoints
    set
      envelope_version = p_envelope_version,
      algorithm = p_algorithm,
      browser_data_ciphertext = p_ciphertext,
      browser_data_iv = p_iv,
      key_version = p_key_version
    where id = p_secret_id
      and storage_mode = 'encrypted_envelope'
      and key_version = v_run.source_key_version
      and browser_data_ciphertext = p_source_ciphertext
      and browser_data_iv = p_source_iv;
  else
    raise exception using errcode = '22023', message = 'Credential rotation secret kind is invalid.';
  end if;
  get diagnostics v_updated = row_count;

  if v_updated <> 1 then
    if (
      p_secret_kind = 'integration'
      and exists (
        select 1
        from public.integration_secrets
        where connection_id = p_secret_id
          and storage_mode = 'encrypted_envelope'
          and key_version = v_run.target_key_version
      )
    ) or (
      p_secret_kind = 'mobile_push'
      and exists (
        select 1
        from public.mobile_device_secrets
        where device_id = p_secret_id
          and storage_mode = 'encrypted_envelope'
          and key_version = v_run.target_key_version
      )
    ) or (
      p_secret_kind = 'meta_attribution'
      and exists (
        select 1
        from public.meta_attribution_touchpoints
        where id = p_secret_id
          and storage_mode = 'encrypted_envelope'
          and key_version = v_run.target_key_version
      )
    ) then
      v_disposition := 'skipped';
    else
      raise exception using errcode = '40001', message = 'Credential envelope changed during rotation.';
    end if;
  end if;

  update public.credential_envelope_rotation_items
  set
    status = v_disposition,
    lease_token = null,
    lease_owner = null,
    lease_expires_at = null,
    error_code = null,
    updated_at = now()
  where run_id = p_run_id
    and secret_kind = p_secret_kind
    and secret_id = p_secret_id;

  perform private.refresh_credential_envelope_rotation_items(p_run_id);
  return v_disposition;
end;
$$;

create or replace function public.release_credential_envelope_rotation_item(
  p_run_id uuid,
  p_secret_kind text,
  p_secret_id uuid,
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
    raise exception using errcode = '22023', message = 'Credential rotation error code is invalid.';
  end if;

  update public.credential_envelope_rotation_items
  set
    status = case when attempts >= 5 then 'failed' else 'pending' end,
    lease_token = null,
    lease_owner = null,
    lease_expires_at = null,
    error_code = p_error_code,
    updated_at = now()
  where run_id = p_run_id
    and secret_kind = p_secret_kind
    and secret_id = p_secret_id
    and status = 'processing'
    and lease_token = p_lease_token;
  if not found then
    raise exception using errcode = '55000', message = 'Credential rotation lease is unavailable.';
  end if;

  perform private.refresh_credential_envelope_rotation_items(p_run_id);
end;
$$;

create or replace function public.get_credential_envelope_rotation_status(
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.credential_envelope_rotation_runs%rowtype;
  v_old_integration integer;
  v_old_meta integer;
  v_old_mobile integer;
  v_pending integer;
  v_processing integer;
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Service role authorization is required.';
  end if;

  select *
  into v_run
  from public.credential_envelope_rotation_runs
  where id = p_run_id;
  if v_run.id is null then
    raise exception using errcode = 'P0002', message = 'Credential rotation run not found.';
  end if;

  select count(*)::integer into v_old_integration
  from public.integration_secrets
  where storage_mode = 'encrypted_envelope'
    and key_version = v_run.source_key_version;
  select count(*)::integer into v_old_mobile
  from public.mobile_device_secrets
  where storage_mode = 'encrypted_envelope'
    and key_version = v_run.source_key_version;
  select count(*)::integer into v_old_meta
  from public.meta_attribution_touchpoints
  where storage_mode = 'encrypted_envelope'
    and key_version = v_run.source_key_version;
  select count(*)::integer into v_pending
  from public.credential_envelope_rotation_items
  where run_id = p_run_id and status = 'pending';
  select count(*)::integer into v_processing
  from public.credential_envelope_rotation_items
  where run_id = p_run_id and status = 'processing';

  return jsonb_build_object(
    'failedItems', v_run.failed_items,
    'oldIntegrationEnvelopes', v_old_integration,
    'oldMetaAttributionEnvelopes', v_old_meta,
    'oldMobileEnvelopes', v_old_mobile,
    'pendingItems', v_pending,
    'processingItems', v_processing,
    'rotatedItems', v_run.rotated_items,
    'runId', v_run.id,
    'skippedItems', v_run.skipped_items,
    'status', v_run.status,
    'totalItems', v_run.total_items
  );
end;
$$;

create or replace function public.verify_credential_envelope_rotation(
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status jsonb;
  v_old_count integer;
  v_unfinished integer;
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Service role authorization is required.';
  end if;

  perform private.refresh_credential_envelope_rotation_items(p_run_id);
  v_status := public.get_credential_envelope_rotation_status(p_run_id);
  v_old_count :=
    (v_status->>'oldIntegrationEnvelopes')::integer
    + (v_status->>'oldMetaAttributionEnvelopes')::integer
    + (v_status->>'oldMobileEnvelopes')::integer;
  v_unfinished :=
    (v_status->>'pendingItems')::integer
    + (v_status->>'processingItems')::integer
    + (v_status->>'failedItems')::integer;

  if v_old_count <> 0 or v_unfinished <> 0 then
    raise exception using
      errcode = '55000',
      message = 'Credential rotation cannot be verified while old-key or unfinished envelopes remain.';
  end if;

  update public.credential_envelope_rotation_runs
  set
    status = 'verified',
    verified_at = now(),
    updated_at = now()
  where id = p_run_id and status = 'running';
  if not found then
    raise exception using errcode = '55000', message = 'Credential rotation run is not active.';
  end if;

  return public.get_credential_envelope_rotation_status(p_run_id)
    || jsonb_build_object('oldKeyCountVerifiedZero', true);
end;
$$;

revoke all on function private.refresh_credential_envelope_rotation_items(uuid)
  from public, anon, authenticated;
grant execute on function private.refresh_credential_envelope_rotation_items(uuid)
  to service_role;

revoke all on function public.start_credential_envelope_rotation(text, text, integer, text)
  from public, anon, authenticated;
revoke all on function public.claim_credential_envelope_rotation_batch(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_credential_envelope_rotation_item(
  uuid, text, uuid, uuid, integer, text, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.release_credential_envelope_rotation_item(
  uuid, text, uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.get_credential_envelope_rotation_status(uuid)
  from public, anon, authenticated;
revoke all on function public.verify_credential_envelope_rotation(uuid)
  from public, anon, authenticated;

grant execute on function public.start_credential_envelope_rotation(text, text, integer, text)
  to service_role;
grant execute on function public.claim_credential_envelope_rotation_batch(uuid, text, integer)
  to service_role;
grant execute on function public.complete_credential_envelope_rotation_item(
  uuid, text, uuid, uuid, integer, text, text, text, text, text, text
) to service_role;
grant execute on function public.release_credential_envelope_rotation_item(
  uuid, text, uuid, uuid, text
) to service_role;
grant execute on function public.get_credential_envelope_rotation_status(uuid)
  to service_role;
grant execute on function public.verify_credential_envelope_rotation(uuid)
  to service_role;

commit;
