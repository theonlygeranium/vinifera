-- Phase 5 provider completion: durable QuickBooks OAuth refresh coordination,
-- tenant-safe mapping commands, and executable Klaviyo field/list mappings.

begin;

alter table public.integration_secrets
  add column credential_generation bigint not null default 1,
  add column refresh_lease_token_hash text,
  add column refresh_lease_owner text,
  add column refresh_lease_expires_at timestamptz,
  add constraint integration_secrets_generation_positive
    check (credential_generation > 0),
  add constraint integration_secrets_refresh_lease_consistent
    check (
      (
        refresh_lease_token_hash is null
        and refresh_lease_owner is null
        and refresh_lease_expires_at is null
      )
      or (
        refresh_lease_token_hash ~ '^[0-9a-f]{64}$'
        and refresh_lease_owner ~ '^[A-Za-z0-9_.:@/-]{1,128}$'
        and refresh_lease_expires_at is not null
      )
    );

alter table public.klaviyo_field_mappings
  add constraint klaviyo_field_mapping_connection_same_brand_fkey
    foreign key (organization_id, brand_id, connection_id)
    references public.integration_connections (organization_id, brand_id, id),
  add constraint klaviyo_field_mapping_source_allowlist
    check (
      vinifera_field in (
        'email',
        'first_name',
        'last_name',
        'club_tier_id',
        'joined_on',
        'lifetime_value_cents',
        'membership_status',
        'churn_risk_score',
        'churn_risk_level',
        'vinifera_deleted'
      )
    );

alter table public.quickbooks_account_mappings
  add constraint quickbooks_account_connection_same_brand_fkey
    foreign key (organization_id, brand_id, connection_id)
    references public.integration_connections (organization_id, brand_id, id),
  add constraint quickbooks_account_provider_ids_safe
    check (
      quickbooks_account_id ~ '^[A-Za-z0-9_.:-]{1,255}$'
      and (
        quickbooks_item_id is null
        or quickbooks_item_id ~ '^[A-Za-z0-9_.:-]{1,255}$'
      )
    );

create unique index klaviyo_field_mappings_property_uidx
  on public.klaviyo_field_mappings (
    connection_id,
    lower(klaviyo_property)
  );

alter table public.klaviyo_profile_mappings
  add column list_ids text[] not null default '{}'::text[],
  add constraint klaviyo_profile_mapping_list_ids_safe
    check (
      cardinality(list_ids) <= 100
      and array_position(list_ids, null) is null
      and (
        cardinality(list_ids) = 0
        or array_to_string(list_ids, ',') ~
          '^[A-Za-z0-9_-]{4,128}(,[A-Za-z0-9_-]{4,128})*$'
      )
    );

create table public.klaviyo_list_mappings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  organization_id uuid not null,
  brand_id uuid not null,
  club_tier_id uuid,
  membership_status public.member_status,
  list_id text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint klaviyo_list_mapping_connection_same_brand_fkey
    foreign key (organization_id, brand_id, connection_id)
    references public.integration_connections (organization_id, brand_id, id)
    on delete cascade,
  constraint klaviyo_list_mapping_tier_same_brand_fkey
    foreign key (organization_id, brand_id, club_tier_id)
    references public.club_tiers (organization_id, brand_id, id)
    on delete cascade,
  constraint klaviyo_list_mapping_list_id_safe
    check (list_id ~ '^[A-Za-z0-9_-]{4,128}$')
);

create unique index klaviyo_list_mappings_rule_uidx
  on public.klaviyo_list_mappings (
    connection_id,
    coalesce(club_tier_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(membership_status, 'active'::public.member_status),
    (membership_status is null),
    list_id
  );

create index klaviyo_list_mappings_connection_idx
  on public.klaviyo_list_mappings (
    connection_id,
    enabled,
    club_tier_id,
    membership_status
  );

alter table public.klaviyo_list_mappings enable row level security;
alter table public.klaviyo_list_mappings force row level security;

create policy klaviyo_list_mappings_staff_select
  on public.klaviyo_list_mappings
  for select to authenticated
  using (
    private.is_staff_for_org(organization_id)
    and private.can_access_brand(organization_id, brand_id)
  );

revoke all on table public.klaviyo_list_mappings
  from public, anon, authenticated;
grant select on table public.klaviyo_list_mappings to authenticated;
grant all on table public.klaviyo_list_mappings to service_role;

create trigger klaviyo_list_mappings_touch_updated_at
before update on public.klaviyo_list_mappings
for each row execute function private.touch_updated_at();

create or replace function private.seed_default_klaviyo_field_mappings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.integration_type <> 'klaviyo' or new.brand_id is null then
    return new;
  end if;

  insert into public.klaviyo_field_mappings (
    connection_id,
    organization_id,
    brand_id,
    vinifera_field,
    klaviyo_property,
    enabled
  )
  select
    new.id,
    new.organization_id,
    new.brand_id,
    mapping.vinifera_field,
    mapping.klaviyo_property,
    true
  from (
    values
      ('email', 'email'),
      ('first_name', 'first_name'),
      ('last_name', 'last_name'),
      ('club_tier_id', 'club_tier_id'),
      ('joined_on', 'joined_on'),
      ('lifetime_value_cents', 'lifetime_value_cents'),
      ('membership_status', 'membership_status'),
      ('churn_risk_score', 'churn_risk_score'),
      ('churn_risk_level', 'churn_risk_level'),
      ('vinifera_deleted', 'vinifera_deleted')
  ) as mapping(vinifera_field, klaviyo_property)
  on conflict (connection_id, vinifera_field) do nothing;

  return new;
end;
$$;

create trigger integration_connections_seed_klaviyo_fields
after insert on public.integration_connections
for each row execute function private.seed_default_klaviyo_field_mappings();

insert into public.klaviyo_field_mappings (
  connection_id,
  organization_id,
  brand_id,
  vinifera_field,
  klaviyo_property,
  enabled
)
select
  connection.id,
  connection.organization_id,
  connection.brand_id,
  mapping.vinifera_field,
  mapping.klaviyo_property,
  true
from public.integration_connections as connection
cross join (
  values
    ('email', 'email'),
    ('first_name', 'first_name'),
    ('last_name', 'last_name'),
    ('club_tier_id', 'club_tier_id'),
    ('joined_on', 'joined_on'),
    ('lifetime_value_cents', 'lifetime_value_cents'),
    ('membership_status', 'membership_status'),
    ('churn_risk_score', 'churn_risk_score'),
    ('churn_risk_level', 'churn_risk_level'),
    ('vinifera_deleted', 'vinifera_deleted')
) as mapping(vinifera_field, klaviyo_property)
where connection.integration_type = 'klaviyo'
  and connection.brand_id is not null
on conflict (connection_id, vinifera_field) do nothing;

revoke all on function private.seed_default_klaviyo_field_mappings()
  from public, anon, authenticated;
grant execute on function private.seed_default_klaviyo_field_mappings()
  to service_role;

create or replace function public.store_integration_credentials(
  p_connection_id uuid,
  p_storage_mode public.secret_storage_mode,
  p_envelope_version integer default null,
  p_algorithm text default null,
  p_credential_ciphertext text default null,
  p_credential_iv text default null,
  p_key_version text default null,
  p_external_secret_ref text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;

  select organization_id
  into v_organization_id
  from public.integration_connections
  where id = p_connection_id;

  if v_organization_id is null then
    raise exception using errcode = 'P0002', message = 'Integration connection not found.';
  end if;

  insert into public.integration_secrets (
    connection_id,
    organization_id,
    storage_mode,
    envelope_version,
    algorithm,
    credential_ciphertext,
    credential_iv,
    key_version,
    external_secret_ref,
    credential_generation,
    rotated_at
  )
  values (
    p_connection_id,
    v_organization_id,
    p_storage_mode,
    p_envelope_version,
    p_algorithm,
    p_credential_ciphertext,
    p_credential_iv,
    p_key_version,
    p_external_secret_ref,
    1,
    now()
  )
  on conflict (connection_id)
  do update set
    storage_mode = excluded.storage_mode,
    envelope_version = excluded.envelope_version,
    algorithm = excluded.algorithm,
    credential_ciphertext = excluded.credential_ciphertext,
    credential_iv = excluded.credential_iv,
    key_version = excluded.key_version,
    external_secret_ref = excluded.external_secret_ref,
    credential_generation =
      public.integration_secrets.credential_generation + 1,
    refresh_lease_token_hash = null,
    refresh_lease_owner = null,
    refresh_lease_expires_at = null,
    rotated_at = now(),
    updated_at = now();

  update public.integration_connections
  set
    status = case
      when opted_in then 'configured'::public.integration_connection_status
      else 'activation_required'::public.integration_connection_status
    end,
    updated_at = now()
  where id = p_connection_id;

  return p_connection_id;
end;
$$;

drop function public.get_integration_runtime(
  uuid,
  public.integration_type,
  uuid
);

create function public.get_integration_runtime(
  p_organization_id uuid,
  p_integration_type public.integration_type,
  p_brand_id uuid default null
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
    secret.credential_ciphertext,
    secret.credential_iv,
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

create or replace function public.enqueue_integration_sync_job(
  p_connection_id uuid,
  p_direction public.integration_job_direction,
  p_sync_type text,
  p_entity_type text,
  p_entity_id text,
  p_idempotency_key text,
  p_cursor_data jsonb default '{}'::jsonb,
  p_payload jsonb default '{}'::jsonb,
  p_max_attempts integer default 8
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.integration_connections;
  v_job_id uuid;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;

  select connection.*
  into v_connection
  from public.integration_connections as connection
  join public.organizations as organization
    on organization.id = connection.organization_id
  left join public.brands as brand
    on brand.organization_id = connection.organization_id
    and brand.id = connection.brand_id
  where connection.id = p_connection_id
    and connection.opted_in
    and organization.access_status <> 'suspended'
    and (
      connection.brand_id is null
      or (
        brand.id is not null
        and brand.active
        and brand.access_status <> 'suspended'
      )
    )
    and (
      connection.status = 'active'
      or (
        connection.status = 'configured'
        and p_sync_type = 'connection.validate'
      )
    );

  if v_connection.id is null then
    raise exception using errcode = '55000', message = 'Integration is not eligible for this sync type.';
  end if;

  insert into public.integration_sync_jobs (
    connection_id,
    organization_id,
    brand_id,
    integration_type,
    direction,
    sync_type,
    entity_type,
    entity_id,
    idempotency_key,
    cursor_data,
    payload,
    max_attempts
  )
  values (
    v_connection.id,
    v_connection.organization_id,
    v_connection.brand_id,
    v_connection.integration_type,
    p_direction,
    p_sync_type,
    p_entity_type,
    nullif(p_entity_id, ''),
    p_idempotency_key,
    coalesce(p_cursor_data, '{}'::jsonb),
    coalesce(p_payload, '{}'::jsonb),
    p_max_attempts
  )
  on conflict (connection_id, idempotency_key)
  do update set
    updated_at = public.integration_sync_jobs.updated_at
  returning id into v_job_id;

  return v_job_id;
end;
$$;

drop function public.claim_integration_sync_jobs(
  text,
  integer,
  integer,
  timestamptz
);

create function public.claim_integration_sync_jobs(
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
  if char_length(btrim(p_worker)) not between 1 and 120
    or p_limit not between 1 and 100
    or p_lease_seconds not between 15 and 900
  then
    raise exception using errcode = '22023', message = 'Invalid worker lease parameters.';
  end if;

  update public.integration_sync_jobs as expired
  set
    status = 'dead_letter',
    lease_token_hash = null,
    lease_owner = null,
    lease_expires_at = null,
    last_error_code = 'LEASE_EXPIRED_MAX_ATTEMPTS',
    updated_at = p_as_of
  where expired.status = 'leased'
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
    join public.organizations as organization
      on organization.id = connection.organization_id
    left join public.brands as brand
      on brand.organization_id = connection.organization_id
      and brand.id = connection.brand_id
    where (
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
      and (
        connection.brand_id is null
        or (
          brand.id is not null
          and brand.active
          and brand.access_status <> 'suspended'
        )
      )
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

create or replace function public.record_avalara_tax_calculation(
  p_connection_id uuid,
  p_shipment_id uuid,
  p_provider_transaction_code text,
  p_document_code text,
  p_document_status text,
  p_taxable_basis_cents bigint,
  p_exempt_amount_cents bigint,
  p_tax_amount_cents bigint,
  p_shipping_tax_cents bigint,
  p_jurisdiction_summary jsonb,
  p_request_hash text,
  p_response_hash text,
  p_currency_code text default 'USD',
  p_document_type text default 'SalesInvoice'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.integration_connections;
  v_shipment public.shipments;
  v_calculation_id uuid;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;

  select connection.*
  into v_connection
  from public.integration_connections as connection
  join public.organizations as organization
    on organization.id = connection.organization_id
  join public.brands as brand
    on brand.organization_id = connection.organization_id
    and brand.id = connection.brand_id
  where connection.id = p_connection_id
    and connection.integration_type = 'avalara'
    and connection.status = 'active'
    and connection.opted_in
    and organization.access_status <> 'suspended'
    and brand.active
    and brand.access_status <> 'suspended';

  select shipment.*
  into v_shipment
  from public.shipments as shipment
  where shipment.id = p_shipment_id
    and shipment.organization_id = v_connection.organization_id
    and shipment.brand_id = v_connection.brand_id;

  if v_connection.id is null or v_shipment.id is null then
    raise exception using errcode = '23503', message = 'Connection and shipment brand do not match.';
  end if;

  insert into public.avalara_tax_calculations (
    connection_id,
    organization_id,
    brand_id,
    shipment_id,
    provider_transaction_code,
    document_code,
    document_type,
    document_status,
    currency_code,
    taxable_basis_cents,
    exempt_amount_cents,
    tax_amount_cents,
    shipping_tax_cents,
    jurisdiction_summary,
    request_hash,
    response_hash,
    committed_at,
    voided_at
  )
  values (
    v_connection.id,
    v_connection.organization_id,
    v_connection.brand_id,
    v_shipment.id,
    p_provider_transaction_code,
    p_document_code,
    p_document_type,
    p_document_status,
    p_currency_code,
    p_taxable_basis_cents,
    p_exempt_amount_cents,
    p_tax_amount_cents,
    p_shipping_tax_cents,
    p_jurisdiction_summary,
    p_request_hash,
    p_response_hash,
    case when p_document_status = 'committed' then now() else null end,
    case when p_document_status = 'voided' then now() else null end
  )
  on conflict (connection_id, provider_transaction_code)
  do update set
    shipment_id = excluded.shipment_id,
    organization_id = excluded.organization_id,
    brand_id = excluded.brand_id,
    document_code = excluded.document_code,
    document_type = excluded.document_type,
    document_status = excluded.document_status,
    currency_code = excluded.currency_code,
    taxable_basis_cents = excluded.taxable_basis_cents,
    exempt_amount_cents = excluded.exempt_amount_cents,
    tax_amount_cents = excluded.tax_amount_cents,
    shipping_tax_cents = excluded.shipping_tax_cents,
    jurisdiction_summary = excluded.jurisdiction_summary,
    request_hash = excluded.request_hash,
    response_hash = excluded.response_hash,
    committed_at = excluded.committed_at,
    voided_at = excluded.voided_at
  where public.avalara_tax_calculations.shipment_id = excluded.shipment_id
    and (
      public.avalara_tax_calculations.document_status = 'temporary'
      or (
        public.avalara_tax_calculations.document_status =
          excluded.document_status
        and public.avalara_tax_calculations.document_code =
          excluded.document_code
        and public.avalara_tax_calculations.document_type =
          excluded.document_type
        and public.avalara_tax_calculations.currency_code =
          excluded.currency_code
        and public.avalara_tax_calculations.taxable_basis_cents =
          excluded.taxable_basis_cents
        and public.avalara_tax_calculations.exempt_amount_cents =
          excluded.exempt_amount_cents
        and public.avalara_tax_calculations.tax_amount_cents =
          excluded.tax_amount_cents
        and public.avalara_tax_calculations.shipping_tax_cents =
          excluded.shipping_tax_cents
        and public.avalara_tax_calculations.jurisdiction_summary =
          excluded.jurisdiction_summary
        and public.avalara_tax_calculations.request_hash =
          excluded.request_hash
        and public.avalara_tax_calculations.response_hash =
          excluded.response_hash
      )
    )
  returning id into v_calculation_id;

  if v_calculation_id is null then
    raise exception using
      errcode = '55000',
      message = 'Avalara provider code is already bound to another shipment or committed calculation.';
  end if;

  return v_calculation_id;
end;
$$;

create function public.claim_quickbooks_refresh_lease(
  p_connection_id uuid,
  p_expected_generation bigint,
  p_lease_owner text,
  p_lease_seconds integer default 120
)
returns table (
  disposition text,
  lease_token text,
  credential_generation bigint,
  retry_after timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret public.integration_secrets%rowtype;
  v_raw_lease_token text;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  if p_expected_generation < 1
    or p_lease_owner !~ '^[A-Za-z0-9_.:@/-]{1,128}$'
    or p_lease_seconds not between 30 and 300
  then
    raise exception using errcode = '22023', message = 'QuickBooks refresh lease parameters are invalid.';
  end if;

  select secret.*
  into v_secret
  from public.integration_secrets as secret
  join public.integration_connections as connection
    on connection.id = secret.connection_id
  join public.organizations as organization
    on organization.id = connection.organization_id
  join public.brands as brand
    on brand.organization_id = connection.organization_id
    and brand.id = connection.brand_id
  where secret.connection_id = p_connection_id
    and secret.storage_mode = 'encrypted_envelope'
    and connection.integration_type = 'quickbooks'
    and connection.status in ('configured', 'active', 'degraded')
    and connection.opted_in
    and organization.access_status <> 'suspended'
    and brand.active
    and brand.access_status <> 'suspended'
  for update of secret;

  if v_secret.connection_id is null then
    raise exception using errcode = '55000', message = 'QuickBooks encrypted credentials are unavailable.';
  end if;

  if v_secret.credential_generation <> p_expected_generation then
    return query
    select
      'stale'::text,
      null::text,
      v_secret.credential_generation,
      null::timestamptz;
    return;
  end if;

  if v_secret.refresh_lease_expires_at > now() then
    return query
    select
      'busy'::text,
      null::text,
      v_secret.credential_generation,
      v_secret.refresh_lease_expires_at;
    return;
  end if;

  v_raw_lease_token :=
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  update public.integration_secrets
  set
    refresh_lease_token_hash = encode(
      extensions.digest(convert_to(v_raw_lease_token, 'UTF8'), 'sha256'),
      'hex'
    ),
    refresh_lease_owner = p_lease_owner,
    refresh_lease_expires_at =
      now() + make_interval(secs => p_lease_seconds),
    updated_at = now()
  where connection_id = p_connection_id;

  return query
  select
    'acquired'::text,
    v_raw_lease_token,
    v_secret.credential_generation,
    now() + make_interval(secs => p_lease_seconds);
end;
$$;

create function public.complete_quickbooks_refresh_lease(
  p_connection_id uuid,
  p_expected_generation bigint,
  p_lease_token text,
  p_envelope_version integer,
  p_algorithm text,
  p_credential_ciphertext text,
  p_credential_iv text,
  p_key_version text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_generation bigint;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  if p_expected_generation < 1
    or p_lease_token !~ '^[A-Za-z0-9_-]{32,128}$'
    or p_envelope_version <> 1
    or p_algorithm <> 'A256GCM'
    or p_credential_ciphertext !~ '^[A-Za-z0-9+/=_-]{24,}$'
    or p_credential_iv !~ '^[A-Za-z0-9+/=_-]{12,}$'
    or p_key_version !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'
  then
    raise exception using errcode = '22023', message = 'QuickBooks replacement credentials are invalid.';
  end if;

  update public.integration_secrets as secret
  set
    envelope_version = p_envelope_version,
    algorithm = p_algorithm,
    credential_ciphertext = p_credential_ciphertext,
    credential_iv = p_credential_iv,
    key_version = p_key_version,
    credential_generation = secret.credential_generation + 1,
    refresh_lease_token_hash = null,
    refresh_lease_owner = null,
    refresh_lease_expires_at = null,
    rotated_at = now(),
    updated_at = now()
  where secret.connection_id = p_connection_id
    and secret.storage_mode = 'encrypted_envelope'
    and secret.credential_generation = p_expected_generation
    and secret.refresh_lease_token_hash = encode(
      extensions.digest(convert_to(p_lease_token, 'UTF8'), 'sha256'),
      'hex'
    )
  returning secret.credential_generation into v_generation;

  if v_generation is null then
    raise exception using errcode = '55000', message = 'QuickBooks refresh lease or credential generation is stale.';
  end if;

  return v_generation;
end;
$$;

create function public.release_quickbooks_refresh_lease(
  p_connection_id uuid,
  p_expected_generation bigint,
  p_lease_token text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;

  update public.integration_secrets as secret
  set
    refresh_lease_token_hash = null,
    refresh_lease_owner = null,
    refresh_lease_expires_at = null,
    updated_at = now()
  where secret.connection_id = p_connection_id
    and secret.credential_generation = p_expected_generation
    and secret.refresh_lease_token_hash = encode(
      extensions.digest(convert_to(p_lease_token, 'UTF8'), 'sha256'),
      'hex'
    );

  return found;
end;
$$;

drop function public.upsert_klaviyo_profile_mapping(
  uuid,
  uuid,
  text,
  text
);

create function public.upsert_klaviyo_profile_mapping(
  p_connection_id uuid,
  p_member_id uuid,
  p_external_profile_id text,
  p_payload_hash text,
  p_list_ids text[] default '{}'::text[]
)
returns public.klaviyo_profile_mappings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.integration_connections;
  v_member public.members;
  v_mapping public.klaviyo_profile_mappings;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;

  select * into v_connection
  from public.integration_connections as connection
  join public.organizations as organization
    on organization.id = connection.organization_id
  join public.brands as brand
    on brand.organization_id = connection.organization_id
    and brand.id = connection.brand_id
  where connection.id = p_connection_id
    and connection.integration_type = 'klaviyo'
    and connection.status = 'active'
    and connection.opted_in
    and organization.access_status <> 'suspended'
    and brand.active
    and brand.access_status <> 'suspended';
  select * into v_member
  from public.members
  where id = p_member_id
    and organization_id = v_connection.organization_id
    and brand_id = v_connection.brand_id;

  if v_connection.id is null or v_member.id is null then
    raise exception using errcode = '23503', message = 'Connection and member brand do not match.';
  end if;

  insert into public.klaviyo_profile_mappings (
    connection_id,
    organization_id,
    brand_id,
    member_id,
    external_profile_id,
    last_payload_hash,
    list_ids,
    last_synced_at
  )
  values (
    v_connection.id,
    v_connection.organization_id,
    v_connection.brand_id,
    v_member.id,
    p_external_profile_id,
    p_payload_hash,
    coalesce(p_list_ids, '{}'::text[]),
    now()
  )
  on conflict (connection_id, member_id)
  do update set
    external_profile_id = excluded.external_profile_id,
    last_payload_hash = excluded.last_payload_hash,
    list_ids = excluded.list_ids,
    last_synced_at = now()
  returning * into v_mapping;

  return v_mapping;
end;
$$;

create function public.replace_klaviyo_mappings(
  p_connection_id uuid,
  p_field_mappings jsonb,
  p_list_mappings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.integration_connections;
  v_field_count integer;
  v_list_count integer;
begin
  select *
  into v_connection
  from public.integration_connections
  where id = p_connection_id
    and integration_type = 'klaviyo';

  if v_connection.id is null
    or not private.can_manage_brand(
      v_connection.organization_id,
      v_connection.brand_id
    )
  then
    raise exception using errcode = '42501', message = 'Brand administrator authorization is required.';
  end if;
  if jsonb_typeof(p_field_mappings) <> 'array'
    or jsonb_typeof(p_list_mappings) <> 'array'
    or jsonb_array_length(p_field_mappings) > 50
    or jsonb_array_length(p_list_mappings) > 250
  then
    raise exception using errcode = '22023', message = 'Klaviyo mappings are invalid.';
  end if;

  delete from public.klaviyo_field_mappings
  where connection_id = p_connection_id;

  insert into public.klaviyo_field_mappings (
    connection_id,
    organization_id,
    brand_id,
    vinifera_field,
    klaviyo_property,
    enabled
  )
  select
    v_connection.id,
    v_connection.organization_id,
    v_connection.brand_id,
    mapping.vinifera_field,
    mapping.klaviyo_property,
    coalesce(mapping.enabled, true)
  from jsonb_to_recordset(p_field_mappings) as mapping(
    vinifera_field text,
    klaviyo_property text,
    enabled boolean
  )
  where mapping.vinifera_field is not null
    and mapping.klaviyo_property is not null;
  get diagnostics v_field_count = row_count;

  if v_field_count <> jsonb_array_length(p_field_mappings) then
    raise exception using errcode = '22023', message = 'Every Klaviyo field mapping must be complete.';
  end if;

  delete from public.klaviyo_list_mappings
  where connection_id = p_connection_id;

  insert into public.klaviyo_list_mappings (
    connection_id,
    organization_id,
    brand_id,
    club_tier_id,
    membership_status,
    list_id,
    enabled
  )
  select
    v_connection.id,
    v_connection.organization_id,
    v_connection.brand_id,
    nullif(mapping.club_tier_id, '')::uuid,
    case
      when nullif(mapping.membership_status, '') is null then null
      else mapping.membership_status::public.member_status
    end,
    mapping.list_id,
    coalesce(mapping.enabled, true)
  from jsonb_to_recordset(p_list_mappings) as mapping(
    club_tier_id text,
    membership_status text,
    list_id text,
    enabled boolean
  )
  where mapping.list_id is not null;
  get diagnostics v_list_count = row_count;

  if v_list_count <> jsonb_array_length(p_list_mappings) then
    raise exception using errcode = '22023', message = 'Every Klaviyo list mapping must be complete.';
  end if;

  return jsonb_build_object(
    'connection_id', v_connection.id,
    'field_count', v_field_count,
    'list_count', v_list_count
  );
end;
$$;

create function public.replace_quickbooks_account_mappings(
  p_connection_id uuid,
  p_mappings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.integration_connections;
  v_mapping_count integer;
begin
  select *
  into v_connection
  from public.integration_connections
  where id = p_connection_id
    and integration_type = 'quickbooks';

  if v_connection.id is null
    or not private.can_manage_brand(
      v_connection.organization_id,
      v_connection.brand_id
    )
  then
    raise exception using errcode = '42501', message = 'Brand administrator authorization is required.';
  end if;
  if jsonb_typeof(p_mappings) <> 'array'
    or jsonb_array_length(p_mappings) > 500
  then
    raise exception using errcode = '22023', message = 'QuickBooks account mappings are invalid.';
  end if;

  delete from public.quickbooks_account_mappings
  where connection_id = p_connection_id;

  insert into public.quickbooks_account_mappings (
    connection_id,
    organization_id,
    brand_id,
    club_tier_id,
    mapping_kind,
    quickbooks_account_id,
    quickbooks_item_id
  )
  select
    v_connection.id,
    v_connection.organization_id,
    v_connection.brand_id,
    nullif(mapping.club_tier_id, '')::uuid,
    mapping.mapping_kind,
    mapping.quickbooks_account_id,
    nullif(mapping.quickbooks_item_id, '')
  from jsonb_to_recordset(p_mappings) as mapping(
    club_tier_id text,
    mapping_kind text,
    quickbooks_account_id text,
    quickbooks_item_id text
  )
  where mapping.mapping_kind is not null
    and mapping.quickbooks_account_id is not null;
  get diagnostics v_mapping_count = row_count;

  if v_mapping_count <> jsonb_array_length(p_mappings) then
    raise exception using errcode = '22023', message = 'Every QuickBooks account mapping must be complete.';
  end if;

  return jsonb_build_object(
    'connection_id', v_connection.id,
    'mapping_count', v_mapping_count
  );
end;
$$;

drop function public.get_klaviyo_member_source(uuid, integer, uuid);

create function public.get_klaviyo_member_source(
  p_connection_id uuid,
  p_limit integer default 1000,
  p_after_member_id uuid default null
)
returns table (
  member_id uuid,
  email text,
  first_name text,
  last_name text,
  status public.member_status,
  club_tier_id uuid,
  lifetime_value_cents bigint,
  joined_on date,
  churn_risk_score numeric(5, 2),
  churn_risk_level text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_connection public.integration_connections;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  if p_limit not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'Batch limit must be between 1 and 1000.';
  end if;

  select *
  into v_connection
  from public.integration_connections as connection
  where connection.id = p_connection_id
    and connection.integration_type = 'klaviyo'
    and connection.status = 'active'
    and connection.opted_in;

  if v_connection.id is null then
    raise exception using errcode = '55000', message = 'Klaviyo is not active and opted in.';
  end if;

  return query
  select
    member.id,
    member.email,
    member.first_name,
    member.last_name,
    member.status,
    member.club_tier_id,
    member.lifetime_value_cents,
    member.joined_on,
    member.churn_risk_score,
    case
      when member.churn_risk_score is null then null
      when member.churn_risk_score <= 30 then 'low'
      when member.churn_risk_score <= 60 then 'medium'
      else 'high'
    end,
    member.updated_at
  from public.members as member
  where member.organization_id = v_connection.organization_id
    and member.brand_id = v_connection.brand_id
    and member.deleted_at is null
    and (p_after_member_id is null or member.id > p_after_member_id)
  order by member.id
  limit p_limit;
end;
$$;

revoke all on function public.claim_quickbooks_refresh_lease(
  uuid, bigint, text, integer
) from public, anon, authenticated;
revoke all on function public.claim_integration_sync_jobs(
  text, integer, integer, timestamptz
) from public, anon, authenticated;
revoke all on function public.complete_quickbooks_refresh_lease(
  uuid, bigint, text, integer, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.release_quickbooks_refresh_lease(
  uuid, bigint, text
) from public, anon, authenticated;
revoke all on function public.replace_klaviyo_mappings(
  uuid, jsonb, jsonb
) from public, anon;
revoke all on function public.replace_quickbooks_account_mappings(
  uuid, jsonb
) from public, anon;
revoke all on function public.get_integration_runtime(
  uuid, public.integration_type, uuid
) from public, anon, authenticated;
revoke all on function public.upsert_klaviyo_profile_mapping(
  uuid, uuid, text, text, text[]
) from public, anon, authenticated;
revoke all on function public.get_klaviyo_member_source(
  uuid, integer, uuid
) from public, anon, authenticated;

grant execute on function public.claim_quickbooks_refresh_lease(
  uuid, bigint, text, integer
) to service_role;
grant execute on function public.claim_integration_sync_jobs(
  text, integer, integer, timestamptz
) to service_role;
grant execute on function public.complete_quickbooks_refresh_lease(
  uuid, bigint, text, integer, text, text, text, text
) to service_role;
grant execute on function public.release_quickbooks_refresh_lease(
  uuid, bigint, text
) to service_role;
grant execute on function public.replace_klaviyo_mappings(
  uuid, jsonb, jsonb
) to authenticated, service_role;
grant execute on function public.replace_quickbooks_account_mappings(
  uuid, jsonb
) to authenticated, service_role;
grant execute on function public.get_integration_runtime(
  uuid, public.integration_type, uuid
) to service_role;
grant execute on function public.upsert_klaviyo_profile_mapping(
  uuid, uuid, text, text, text[]
) to service_role;
grant execute on function public.get_klaviyo_member_source(
  uuid, integer, uuid
) to service_role;

commit;
