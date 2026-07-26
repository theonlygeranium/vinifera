alter table public.shipments
  add column shipping_charge_cents integer not null default 0,
  add constraint shipments_shipping_charge_range
    check (
      shipping_charge_cents >= 0
      and shipping_charge_cents <= charge_amount_cents
    );

alter table public.brands
  add column default_shipping_charge_cents integer not null default 0,
  add constraint brands_default_shipping_charge_range
    check (default_shipping_charge_cents between 0 and 100000);

create or replace function private.apply_brand_shipping_charge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shipping_charge_cents integer;
begin
  if new.shipping_charge_cents <> 0 then
    return new;
  end if;
  select brand.default_shipping_charge_cents
  into v_shipping_charge_cents
  from public.brands as brand
  where brand.organization_id = new.organization_id
    and brand.id = new.brand_id;
  if not found then
    raise exception using errcode = '23503', message = 'Shipment brand not found.';
  end if;
  new.shipping_charge_cents := v_shipping_charge_cents;
  new.charge_amount_cents :=
    new.charge_amount_cents + v_shipping_charge_cents;
  return new;
end;
$$;

create trigger shipments_populate_brand_shipping_charge
before insert on public.shipments
for each row execute function private.apply_brand_shipping_charge();

revoke execute on function private.apply_brand_shipping_charge()
  from public, anon, authenticated;

alter table public.avalara_exemptions
  add column provider_customer_code text,
  add column provider_exemption_reference text,
  add column entity_use_code text,
  add constraint avalara_exemptions_provider_references_safe
    check (
      (
        provider_customer_code is null
        or (
          char_length(provider_customer_code) between 1 and 50
          and provider_customer_code ~ '^[A-Za-z0-9_.:/-]+$'
        )
      )
      and (
        provider_exemption_reference is null
        or (
          char_length(provider_exemption_reference) between 1 and 100
          and provider_exemption_reference !~ '[[:cntrl:]<>]'
        )
      )
      and (
        entity_use_code is null
        or entity_use_code ~ '^[A-Z0-9]{1,25}$'
      )
    );

create table public.avalara_tax_code_mappings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  organization_id uuid not null,
  brand_id uuid not null,
  club_tier_id uuid,
  mapping_kind text not null,
  item_code text not null,
  tax_code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint avalara_tax_code_mappings_connection_fkey
    foreign key (organization_id, brand_id, connection_id)
    references public.integration_connections (organization_id, brand_id, id)
    on delete cascade,
  constraint avalara_tax_code_mappings_tier_fkey
    foreign key (organization_id, brand_id, club_tier_id)
    references public.club_tiers (organization_id, brand_id, id)
    on delete cascade,
  constraint avalara_tax_code_mappings_shape
    check (
      mapping_kind in ('wine', 'shipping')
      and (mapping_kind = 'wine' or club_tier_id is null)
      and item_code ~ '^[A-Za-z0-9_.:/-]{1,100}$'
      and tax_code ~ '^[A-Za-z0-9_.:/-]{1,50}$'
    )
);

create unique index avalara_tax_code_mappings_target_uidx
  on public.avalara_tax_code_mappings (
    connection_id,
    brand_id,
    coalesce(club_tier_id, '00000000-0000-0000-0000-000000000000'::uuid),
    mapping_kind
  );

create unique index quickbooks_account_mappings_target_uidx
  on public.quickbooks_account_mappings (
    connection_id,
    brand_id,
    coalesce(club_tier_id, '00000000-0000-0000-0000-000000000000'::uuid),
    mapping_kind
  );

create table public.avalara_filing_verification_snapshots (
  id uuid primary key,
  connection_id uuid not null,
  organization_id uuid not null,
  brand_id uuid not null,
  registered boolean not null,
  registration_count integer not null,
  response_hash text not null,
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint avalara_filing_snapshot_connection_fkey
    foreign key (organization_id, brand_id, connection_id)
    references public.integration_connections (organization_id, brand_id, id)
    on delete cascade,
  constraint avalara_filing_snapshot_values_safe
    check (
      registration_count >= 0
      and response_hash ~ '^[0-9a-f]{64}$'
      and verified_at <= created_at + interval '5 minutes'
    )
);

create index avalara_filing_snapshots_latest_idx
  on public.avalara_filing_verification_snapshots (
    connection_id,
    verified_at desc,
    id
  );

create table public.avalara_filing_registration_statuses (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null,
  connection_id uuid not null,
  organization_id uuid not null,
  brand_id uuid not null,
  filing_calendar_id bigint not null,
  region_code text not null,
  filing_frequency text,
  registration_status text not null,
  response_hash text not null,
  verified_at timestamptz not null,
  stale_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, filing_calendar_id),
  constraint avalara_filing_status_connection_fkey
    foreign key (organization_id, brand_id, connection_id)
    references public.integration_connections (organization_id, brand_id, id)
    on delete cascade,
  constraint avalara_filing_status_snapshot_fkey
    foreign key (snapshot_id)
    references public.avalara_filing_verification_snapshots (id)
    on delete restrict,
  constraint avalara_filing_status_values_safe
    check (
      filing_calendar_id > 0
      and region_code ~ '^[A-Z0-9-]{2,12}$'
      and (
        filing_frequency is null
        or filing_frequency ~ '^[A-Za-z0-9_. -]{1,50}$'
      )
      and registration_status in ('active', 'inactive', 'pending', 'unknown')
      and response_hash ~ '^[0-9a-f]{64}$'
      and verified_at <= updated_at + interval '5 minutes'
      and (stale_at is null or stale_at >= verified_at)
    )
);

create index avalara_filing_statuses_snapshot_idx
  on public.avalara_filing_registration_statuses (snapshot_id);

alter table public.avalara_tax_code_mappings enable row level security;
alter table public.avalara_tax_code_mappings force row level security;
create policy avalara_tax_code_mappings_staff_select
  on public.avalara_tax_code_mappings
  for select to authenticated
  using (
    private.is_staff_for_org(organization_id)
    and private.can_access_brand(organization_id, brand_id)
  );
create policy avalara_tax_code_mappings_admin_insert
  on public.avalara_tax_code_mappings
  for insert to authenticated
  with check (
    private.is_staff_for_org(
      organization_id,
      array['owner', 'admin']::public.staff_role[]
    )
    and private.can_access_brand(organization_id, brand_id)
  );
create policy avalara_tax_code_mappings_admin_update
  on public.avalara_tax_code_mappings
  for update to authenticated
  using (
    private.is_staff_for_org(
      organization_id,
      array['owner', 'admin']::public.staff_role[]
    )
    and private.can_access_brand(organization_id, brand_id)
  )
  with check (
    private.is_staff_for_org(
      organization_id,
      array['owner', 'admin']::public.staff_role[]
    )
    and private.can_access_brand(organization_id, brand_id)
  );

alter table public.avalara_filing_verification_snapshots enable row level security;
alter table public.avalara_filing_verification_snapshots force row level security;
create policy avalara_filing_snapshots_staff_select
  on public.avalara_filing_verification_snapshots
  for select to authenticated
  using (
    private.is_staff_for_org(organization_id)
    and private.can_access_brand(organization_id, brand_id)
  );
alter table public.avalara_filing_registration_statuses enable row level security;
alter table public.avalara_filing_registration_statuses force row level security;
create policy avalara_filing_status_staff_select
  on public.avalara_filing_registration_statuses
  for select to authenticated
  using (
    private.is_staff_for_org(organization_id)
    and private.can_access_brand(organization_id, brand_id)
  );

revoke all on table public.avalara_tax_code_mappings
  from public, anon, authenticated;
grant select, insert, update
  on table public.avalara_tax_code_mappings
  to authenticated;
grant all
  on table public.avalara_tax_code_mappings
  to service_role;

revoke all on table public.avalara_filing_registration_statuses
  from public, anon, authenticated;
revoke all on table public.avalara_filing_verification_snapshots
  from public, anon, authenticated;
grant select
  on table public.avalara_filing_verification_snapshots
  to authenticated;
grant all
  on table public.avalara_filing_verification_snapshots
  to service_role;
grant select
  on table public.avalara_filing_registration_statuses
  to authenticated;
grant all
  on table public.avalara_filing_registration_statuses
  to service_role;

drop function public.get_quickbooks_transaction_source(uuid, integer, uuid);

create function public.get_quickbooks_transaction_source(
  p_connection_id uuid,
  p_limit integer default 100,
  p_after_shipment_id uuid default null
)
returns table (
  shipment_id uuid,
  member_id uuid,
  tier_id uuid,
  status public.shipment_status,
  charge_amount_cents integer,
  shipping_charge_cents integer,
  loyalty_discount_cents integer,
  tax_amount_cents bigint,
  refund_amount_cents integer,
  paid_at timestamptz,
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

  select * into v_connection
  from public.integration_connections as connection
  where connection.id = p_connection_id
    and connection.integration_type = 'quickbooks'
    and connection.status = 'active'
    and connection.opted_in;
  if v_connection.id is null then
    raise exception using errcode = '55000', message = 'QuickBooks is not active and opted in.';
  end if;

  return query
  select
    shipment.id,
    shipment.member_id,
    shipment.tier_id,
    shipment.status,
    shipment.charge_amount_cents,
    shipment.shipping_charge_cents,
    shipment.loyalty_discount_cents,
    shipment.tax_amount_cents,
    shipment.refund_amount_cents,
    shipment.paid_at,
    shipment.updated_at
  from public.shipments as shipment
  where shipment.organization_id = v_connection.organization_id
    and shipment.brand_id = v_connection.brand_id
    and shipment.status in (
      'charged',
      'label_created',
      'packed',
      'shipped',
      'delivered',
      'refunded'
    )
    and (
      p_after_shipment_id is null
      or shipment.id > p_after_shipment_id
    )
  order by shipment.id
  limit p_limit;
end;
$$;

drop function public.get_avalara_shipment_source(uuid, uuid);

create function public.get_avalara_shipment_source(
  p_connection_id uuid,
  p_shipment_id uuid
)
returns table (
  shipment_id uuid,
  member_id uuid,
  tier_id uuid,
  charge_amount_cents integer,
  shipping_charge_cents integer,
  shipping_address jsonb,
  shipping_origin_address jsonb,
  exemption_number_hash text,
  provider_customer_code text,
  provider_exemption_reference text,
  entity_use_code text,
  wine_item_code text,
  wine_tax_code text,
  shipping_item_code text,
  shipping_tax_code text
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

  select * into v_connection
  from public.integration_connections as connection
  where connection.id = p_connection_id
    and connection.integration_type = 'avalara'
    and connection.status = 'active'
    and connection.opted_in;
  if v_connection.id is null then
    raise exception using errcode = '55000', message = 'Avalara is not active and opted in.';
  end if;

  return query
  select
    shipment.id,
    shipment.member_id,
    shipment.tier_id,
    shipment.charge_amount_cents,
    shipment.shipping_charge_cents,
    coalesce(shipment.validated_shipping_address, shipment.shipping_address),
    organization.shipping_origin_address,
    exemption.exemption_number_hash,
    coalesce(
      exemption.provider_customer_code,
      'member-' || shipment.member_id::text
    ),
    exemption.provider_exemption_reference,
    exemption.entity_use_code,
    wine_mapping.item_code,
    wine_mapping.tax_code,
    shipping_mapping.item_code,
    shipping_mapping.tax_code
  from public.shipments as shipment
  join public.organizations as organization
    on organization.id = shipment.organization_id
  left join lateral (
    select active_exemption.*
    from public.avalara_exemptions as active_exemption
    where active_exemption.organization_id = shipment.organization_id
      and active_exemption.brand_id = shipment.brand_id
      and active_exemption.member_id = shipment.member_id
      and active_exemption.verified_at is not null
      and active_exemption.valid_from <= current_date
      and (
        active_exemption.valid_until is null
        or active_exemption.valid_until >= current_date
      )
    order by active_exemption.verified_at desc, active_exemption.id
    limit 1
  ) as exemption on true
  left join lateral (
    select mapping.item_code, mapping.tax_code
    from public.avalara_tax_code_mappings as mapping
    where mapping.connection_id = v_connection.id
      and mapping.organization_id = shipment.organization_id
      and mapping.brand_id = shipment.brand_id
      and mapping.mapping_kind = 'wine'
      and (
        mapping.club_tier_id = shipment.tier_id
        or mapping.club_tier_id is null
      )
    order by (mapping.club_tier_id is not null) desc, mapping.id
    limit 1
  ) as wine_mapping on true
  left join lateral (
    select mapping.item_code, mapping.tax_code
    from public.avalara_tax_code_mappings as mapping
    where mapping.connection_id = v_connection.id
      and mapping.organization_id = shipment.organization_id
      and mapping.brand_id = shipment.brand_id
      and mapping.mapping_kind = 'shipping'
      and mapping.club_tier_id is null
    order by mapping.id
    limit 1
  ) as shipping_mapping on true
  where shipment.id = p_shipment_id
    and shipment.organization_id = v_connection.organization_id
    and shipment.brand_id = v_connection.brand_id;
end;
$$;

create or replace function public.replace_avalara_filing_registration_snapshot(
  p_connection_id uuid,
  p_snapshot_id uuid,
  p_registrations jsonb,
  p_response_hash text,
  p_verified_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.integration_connections%rowtype;
  v_current_count integer;
  v_registered boolean;
  v_stale_count integer;
begin
  if not private.is_service_role() then
    raise exception using errcode = '42501', message = 'Service role authorization is required.';
  end if;
  if p_snapshot_id is null then
    raise exception using errcode = '22023', message = 'A filing verification snapshot ID is required.';
  end if;
  if jsonb_typeof(p_registrations) <> 'array' then
    raise exception using errcode = '22023', message = 'Filing registrations must be a JSON array.';
  end if;
  if lower(btrim(p_response_hash)) !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'The filing response hash is invalid.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_registrations) as registration(
      filing_calendar_id bigint,
      filing_frequency text,
      region_code text,
      registration_status text
    )
    group by registration.filing_calendar_id
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'Filing registration IDs must be unique.';
  end if;
  select connection.*
  into v_connection
  from public.integration_connections as connection
  where connection.id = p_connection_id
    and connection.integration_type = 'avalara'
    and connection.status = 'active'
    and connection.opted_in;
  if not found then
    raise exception using errcode = '55000', message = 'Avalara is not active and opted in.';
  end if;

  select coalesce(
    bool_or(lower(btrim(registration.registration_status)) = 'active'),
    false
  )
  into v_registered
  from jsonb_to_recordset(p_registrations) as registration(
    filing_calendar_id bigint,
    filing_frequency text,
    region_code text,
    registration_status text
  );

  insert into public.avalara_filing_verification_snapshots (
    id,
    connection_id,
    organization_id,
    brand_id,
    registered,
    registration_count,
    response_hash,
    verified_at
  )
  values (
    p_snapshot_id,
    v_connection.id,
    v_connection.organization_id,
    v_connection.brand_id,
    v_registered,
    jsonb_array_length(p_registrations),
    lower(btrim(p_response_hash)),
    p_verified_at
  )
  on conflict (id)
  do update set
    connection_id = excluded.connection_id,
    organization_id = excluded.organization_id,
    brand_id = excluded.brand_id,
    registered = excluded.registered,
    registration_count = excluded.registration_count,
    response_hash = excluded.response_hash,
    verified_at = excluded.verified_at;

  insert into public.avalara_filing_registration_statuses (
    snapshot_id,
    connection_id,
    organization_id,
    brand_id,
    filing_calendar_id,
    region_code,
    filing_frequency,
    registration_status,
    response_hash,
    verified_at
  )
  select
    p_snapshot_id,
    v_connection.id,
    v_connection.organization_id,
    v_connection.brand_id,
    registration.filing_calendar_id,
    upper(btrim(registration.region_code)),
    nullif(btrim(registration.filing_frequency), ''),
    lower(btrim(registration.registration_status)),
    lower(btrim(p_response_hash)),
    p_verified_at
  from jsonb_to_recordset(p_registrations) as registration(
    filing_calendar_id bigint,
    filing_frequency text,
    region_code text,
    registration_status text
  )
  on conflict (connection_id, filing_calendar_id)
  do update set
    snapshot_id = excluded.snapshot_id,
    region_code = excluded.region_code,
    filing_frequency = excluded.filing_frequency,
    registration_status = excluded.registration_status,
    response_hash = excluded.response_hash,
    verified_at = excluded.verified_at,
    stale_at = null,
    updated_at = now()
  ;
  get diagnostics v_current_count = row_count;

  update public.avalara_filing_registration_statuses
  set
    stale_at = p_verified_at,
    updated_at = now()
  where connection_id = v_connection.id
    and stale_at is null
    and not exists (
      select 1
      from jsonb_to_recordset(p_registrations) as registration(
        filing_calendar_id bigint
      )
      where registration.filing_calendar_id =
        avalara_filing_registration_statuses.filing_calendar_id
    );
  get diagnostics v_stale_count = row_count;

  return jsonb_build_object(
    'currentCount', v_current_count,
    'registered', v_registered,
    'snapshotId', p_snapshot_id,
    'staleCount', v_stale_count
  );
end;
$$;

revoke execute on function public.get_quickbooks_transaction_source(
  uuid,
  integer,
  uuid
) from public, anon, authenticated;
grant execute on function public.get_quickbooks_transaction_source(
  uuid,
  integer,
  uuid
) to service_role;

revoke execute on function public.get_avalara_shipment_source(
  uuid,
  uuid
) from public, anon, authenticated;
grant execute on function public.get_avalara_shipment_source(
  uuid,
  uuid
) to service_role;

revoke execute on function public.replace_avalara_filing_registration_snapshot(
  uuid,
  uuid,
  jsonb,
  text,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.replace_avalara_filing_registration_snapshot(
  uuid,
  uuid,
  jsonb,
  text,
  timestamptz
) to service_role;
