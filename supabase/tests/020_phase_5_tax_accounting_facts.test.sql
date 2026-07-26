begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(34);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'shipments'
      and column_name = 'shipping_charge_cents'
      and is_nullable = 'NO'
      and column_default = '0'
  ),
  1,
  'shipments durably record a non-null shipping charge fact'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'shipments_shipping_charge_range'
  ),
  'shipping charges are constrained to the shipment merchandise charge'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'brands'
      and column_name = 'default_shipping_charge_cents'
      and is_nullable = 'NO'
      and column_default = '0'
  ),
  1,
  'brands expose a durable default shipping charge configuration'
);

select is(
  (
    select count(*)::integer
    from pg_class
    where relnamespace = 'public'::regnamespace
      and relkind = 'r'
      and relname = any(array[
        'avalara_tax_code_mappings',
        'avalara_filing_verification_snapshots',
        'avalara_filing_registration_statuses'
      ])
  ),
  3,
  'Avalara tax-code mappings and filing verification snapshots are durable'
);

select is(
  (
    select count(*)::integer
    from pg_class
    where relnamespace = 'public'::regnamespace
      and relkind = 'r'
      and relname = any(array[
        'avalara_tax_code_mappings',
        'avalara_filing_verification_snapshots',
        'avalara_filing_registration_statuses'
      ])
      and relrowsecurity
      and relforcerowsecurity
  ),
  3,
  'new Avalara tables force row-level security'
);

select ok(
  to_regclass('public.avalara_tax_code_mappings_target_uidx') is not null,
  'Avalara mappings have one durable target mapping per connection and tier'
);

select ok(
  to_regclass('public.quickbooks_account_mappings_target_uidx') is not null,
  'QuickBooks mappings enforce one exact tier or null fallback target'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'avalara_exemptions'
      and column_name = any(array[
        'provider_customer_code',
        'provider_exemption_reference',
        'entity_use_code'
      ])
  ),
  3,
  'Avalara exemptions retain the provider customer and exemption references'
);

select is(
  (
    select count(*)::integer
    from (
      values
        ('public.get_quickbooks_transaction_source(uuid,integer,uuid)'),
        ('public.get_avalara_shipment_source(uuid,uuid)'),
        ('public.replace_avalara_filing_registration_snapshot(uuid,uuid,jsonb,text,timestamp with time zone)')
    ) as expected(signature)
    where to_regprocedure(expected.signature) is not null
  ),
  3,
  'tax and accounting source and filing verification RPCs exist'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.replace_avalara_filing_registration_snapshot(uuid,uuid,jsonb,text,timestamp with time zone)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.replace_avalara_filing_registration_snapshot(uuid,uuid,jsonb,text,timestamp with time zone)',
    'EXECUTE'
  ),
  'only the service role may persist read-only filing verification results'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.avalara_tax_code_mappings',
    'DELETE'
  ),
  'authenticated staff cannot delete Avalara tax-code mappings'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

insert into public.organizations (
  id,
  name,
  plan_tier,
  shipping_origin_address
)
values (
  'b1000000-0000-4000-8000-000000000001',
  'Phase 5 Tax Accounting Winery',
  'reserve',
  '{
    "company":"Tax Accounting Winery",
    "phone":"+1 707 555 0142",
    "line1":"1 Origin Way",
    "city":"Napa",
    "state":"CA",
    "postal_code":"94558",
    "country":"US"
  }'::jsonb
);

insert into public.club_tiers (
  id,
  organization_id,
  brand_id,
  name,
  price_cents,
  bottle_count,
  frequency
)
select
  'b2000000-0000-4000-8000-000000000002',
  organization.id,
  organization.default_brand_id,
  'Reserve',
  10000,
  3,
  'quarterly'
from public.organizations as organization
where organization.id = 'b1000000-0000-4000-8000-000000000001';

insert into public.members (
  id,
  organization_id,
  brand_id,
  email,
  first_name,
  last_name,
  club_tier_id
)
select
  'b3000000-0000-4000-8000-000000000003',
  organization.id,
  organization.default_brand_id,
  'tax-accounting-member@example.test',
  'Tax',
  'Member',
  'b2000000-0000-4000-8000-000000000002'
from public.organizations as organization
where organization.id = 'b1000000-0000-4000-8000-000000000001';

insert into public.releases (
  id,
  organization_id,
  brand_id,
  name,
  processing_date,
  embargo_date,
  status
)
select
  'b4000000-0000-4000-8000-000000000004',
  organization.id,
  organization.default_brand_id,
  'Tax Accounting Release',
  current_date,
  current_date,
  'processing'
from public.organizations as organization
where organization.id = 'b1000000-0000-4000-8000-000000000001';

insert into public.release_tiers (
  id,
  organization_id,
  brand_id,
  release_id,
  tier_id,
  tier_name,
  price_cents,
  bottle_count
)
select
  'b5000000-0000-4000-8000-000000000005',
  organization.id,
  organization.default_brand_id,
  'b4000000-0000-4000-8000-000000000004',
  'b2000000-0000-4000-8000-000000000002',
  'Reserve',
  10000,
  3
from public.organizations as organization
where organization.id = 'b1000000-0000-4000-8000-000000000001';

update public.brands
set default_shipping_charge_cents = 1500
where organization_id = 'b1000000-0000-4000-8000-000000000001';

insert into public.shipments (
  id,
  organization_id,
  brand_id,
  member_id,
  release_id,
  release_tier_id,
  tier_id,
  status,
  shipping_address,
  charge_amount_cents,
  tax_amount_cents,
  paid_at
)
select
  'b6000000-0000-4000-8000-000000000006',
  organization.id,
  organization.default_brand_id,
  'b3000000-0000-4000-8000-000000000003',
  'b4000000-0000-4000-8000-000000000004',
  'b5000000-0000-4000-8000-000000000005',
  'b2000000-0000-4000-8000-000000000002',
  'charged',
  '{"line1":"1 Member Way","city":"Napa","state":"CA","postalCode":"94558","country":"US"}'::jsonb,
  8500,
  725,
  now()
from public.organizations as organization
where organization.id = 'b1000000-0000-4000-8000-000000000001';

insert into public.integration_connections (
  id,
  organization_id,
  brand_id,
  integration_type,
  status,
  opted_in,
  consented_at
)
select
  fixture.id,
  organization.id,
  organization.default_brand_id,
  fixture.integration_type::public.integration_type,
  'active',
  true,
  now()
from public.organizations as organization
cross join (
  values
    ('b7000000-0000-4000-8000-000000000007'::uuid, 'quickbooks'),
    ('b7000000-0000-4000-8000-000000000008'::uuid, 'avalara')
) as fixture(id, integration_type)
where organization.id = 'b1000000-0000-4000-8000-000000000001';

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
  'b7000000-0000-4000-8000-000000000007',
  organization.id,
  organization.default_brand_id,
  mapping.club_tier_id,
  'membership',
  mapping.account_id,
  mapping.item_id
from public.organizations as organization
cross join (
  values
    (null::uuid, 'qbo-fallback-account', 'qbo-fallback-item'),
    (
      'b2000000-0000-4000-8000-000000000002'::uuid,
      'qbo-reserve-account',
      'qbo-reserve-item'
    )
) as mapping(club_tier_id, account_id, item_id)
where organization.id = 'b1000000-0000-4000-8000-000000000001';

select lives_ok(
  $$
    insert into public.avalara_tax_code_mappings (
      connection_id,
      organization_id,
      brand_id,
      club_tier_id,
      mapping_kind,
      item_code,
      tax_code
    )
    select
      'b7000000-0000-4000-8000-000000000008',
      organization.id,
      organization.default_brand_id,
      mapping.club_tier_id,
      mapping.mapping_kind,
      mapping.item_code,
      mapping.tax_code
    from public.organizations as organization
    cross join (
      values
        (
          'b2000000-0000-4000-8000-000000000002'::uuid,
          'wine',
          'wine-reserve',
          'P0000000'
        ),
        (
          null::uuid,
          'shipping',
          'shipping-standard',
          'FR020000'
        )
    ) as mapping(club_tier_id, mapping_kind, item_code, tax_code)
    where organization.id = 'b1000000-0000-4000-8000-000000000001'
  $$,
  'service role can persist wine and shipping tax-code mappings'
);

insert into public.avalara_exemptions (
  organization_id,
  brand_id,
  member_id,
  exemption_number_hash,
  region_code,
  valid_from,
  verified_at,
  provider_customer_code,
  provider_exemption_reference,
  entity_use_code
)
select
  organization.id,
  organization.default_brand_id,
  'b3000000-0000-4000-8000-000000000003',
  repeat('a', 64),
  'CA',
  current_date,
  now(),
  'ava-customer-42',
  'CERT-2026-42',
  'A'
from public.organizations as organization
where organization.id = 'b1000000-0000-4000-8000-000000000001';

select is(
  (
    select shipping_charge_cents
    from public.get_quickbooks_transaction_source(
      'b7000000-0000-4000-8000-000000000007',
      100,
      null
    )
    where shipment_id = 'b6000000-0000-4000-8000-000000000006'
  ),
  1500,
  'QuickBooks source exposes the durable shipping charge fact'
);

select is(
  (
    select charge_amount_cents
    from public.shipments
    where id = 'b6000000-0000-4000-8000-000000000006'
  ),
  10000,
  'shipment creation applies the configured shipping charge to the billed total'
);

select is(
  (
    select wine_item_code
    from public.get_avalara_shipment_source(
      'b7000000-0000-4000-8000-000000000008',
      'b6000000-0000-4000-8000-000000000006'
    )
  ),
  'wine-reserve',
  'Avalara source resolves the tier wine item mapping'
);

select is(
  (
    select wine_tax_code
    from public.get_avalara_shipment_source(
      'b7000000-0000-4000-8000-000000000008',
      'b6000000-0000-4000-8000-000000000006'
    )
  ),
  'P0000000',
  'Avalara source resolves the tier wine tax mapping'
);

select is(
  (
    select shipping_item_code
    from public.get_avalara_shipment_source(
      'b7000000-0000-4000-8000-000000000008',
      'b6000000-0000-4000-8000-000000000006'
    )
  ),
  'shipping-standard',
  'Avalara source resolves the brand shipping item mapping'
);

select is(
  (
    select shipping_tax_code
    from public.get_avalara_shipment_source(
      'b7000000-0000-4000-8000-000000000008',
      'b6000000-0000-4000-8000-000000000006'
    )
  ),
  'FR020000',
  'Avalara source resolves the brand shipping tax mapping'
);

select is(
  (
    select provider_customer_code
    from public.get_avalara_shipment_source(
      'b7000000-0000-4000-8000-000000000008',
      'b6000000-0000-4000-8000-000000000006'
    )
  ),
  'ava-customer-42',
  'Avalara source consumes the provider customer reference'
);

select is(
  (
    select provider_exemption_reference
    from public.get_avalara_shipment_source(
      'b7000000-0000-4000-8000-000000000008',
      'b6000000-0000-4000-8000-000000000006'
    )
  ),
  'CERT-2026-42',
  'Avalara source consumes the provider exemption reference'
);

select is(
  (
    select entity_use_code
    from public.get_avalara_shipment_source(
      'b7000000-0000-4000-8000-000000000008',
      'b6000000-0000-4000-8000-000000000006'
    )
  ),
  'A',
  'Avalara source consumes the entity-use code'
);

select lives_ok(
  $$
    select public.replace_avalara_filing_registration_snapshot(
      'b7000000-0000-4000-8000-000000000008',
      'b8000000-0000-4000-8000-000000000008',
      '[
        {
          "filing_calendar_id": 17,
          "filing_frequency": "Monthly",
          "region_code": "ca",
          "registration_status": "ACTIVE"
        },
        {
          "filing_calendar_id": 18,
          "filing_frequency": "Quarterly",
          "region_code": "or",
          "registration_status": "pending"
        }
      ]'::jsonb,
      repeat('b', 64),
      now() - interval '1 minute'
    )
  $$,
  'the service role can atomically persist an Avalara filing snapshot'
);

select lives_ok(
  $$
    select public.replace_avalara_filing_registration_snapshot(
      'b7000000-0000-4000-8000-000000000008',
      'b8000000-0000-4000-8000-000000000009',
      '[
        {
          "filing_calendar_id": 17,
          "filing_frequency": "Monthly",
          "region_code": "ca",
          "registration_status": "ACTIVE"
        }
      ]'::jsonb,
      repeat('c', 64),
      now()
    )
  $$,
  'a newer filing snapshot replaces current registrations'
);

select is(
  (
    select registration_status
    from public.avalara_filing_registration_statuses
    where connection_id = 'b7000000-0000-4000-8000-000000000008'
      and filing_calendar_id = 17
  ),
  'active',
  'filing verification persists a normalized registration status'
);

select ok(
  (
    select stale_at is not null
    from public.avalara_filing_registration_statuses
    where connection_id = 'b7000000-0000-4000-8000-000000000008'
      and filing_calendar_id = 18
  ),
  'registrations omitted from the newer snapshot are marked stale'
);

select is(
  (
    select registration_count
    from public.avalara_filing_verification_snapshots
    where id = 'b8000000-0000-4000-8000-000000000009'
  ),
  1,
  'the latest filing snapshot records its complete registration count'
);

select lives_ok(
  $$
    select public.replace_avalara_filing_registration_snapshot(
      'b7000000-0000-4000-8000-000000000008',
      'b8000000-0000-4000-8000-000000000009',
      '[]'::jsonb,
      repeat('d', 64),
      now()
    )
  $$,
  'retrying the same snapshot ID safely replaces its registration set'
);

select ok(
  (
    select stale_at is not null
    from public.avalara_filing_registration_statuses
    where connection_id = 'b7000000-0000-4000-8000-000000000008'
      and filing_calendar_id = 17
  ),
  'same-snapshot retries mark registrations missing from the replacement stale'
);

select throws_ok(
  $$
    update public.shipments
    set shipping_charge_cents = charge_amount_cents + 1
    where id = 'b6000000-0000-4000-8000-000000000006'
  $$,
  '23514',
  null,
  'shipping charges cannot exceed the merchandise charge'
);

select throws_ok(
  $$
    insert into public.avalara_tax_code_mappings (
      connection_id,
      organization_id,
      brand_id,
      club_tier_id,
      mapping_kind,
      item_code,
      tax_code
    )
    select
      'b7000000-0000-4000-8000-000000000008',
      organization.id,
      organization.default_brand_id,
      'b2000000-0000-4000-8000-000000000002',
      'shipping',
      'shipping-invalid-tier',
      'FR020000'
    from public.organizations as organization
    where organization.id = 'b1000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'shipping tax mappings cannot be scoped to a club tier'
);

select throws_ok(
  $$
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
      'b7000000-0000-4000-8000-000000000007',
      organization.id,
      organization.default_brand_id,
      null,
      'membership',
      'duplicate-fallback-account',
      'duplicate-fallback-item'
    from public.organizations as organization
    where organization.id = 'b1000000-0000-4000-8000-000000000001'
  $$,
  '23505',
  null,
  'QuickBooks permits only one null-tier fallback per mapping kind'
);

select throws_ok(
  $$
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
      'b7000000-0000-4000-8000-000000000007',
      organization.id,
      organization.default_brand_id,
      'b2000000-0000-4000-8000-000000000002',
      'membership',
      'duplicate-reserve-account',
      'duplicate-reserve-item'
    from public.organizations as organization
    where organization.id = 'b1000000-0000-4000-8000-000000000001'
  $$,
  '23505',
  null,
  'QuickBooks permits only one exact tier mapping per mapping kind'
);

select ok(
  (
    select count(*) = 3
    from pg_policies
    where schemaname = 'public'
      and tablename = 'avalara_tax_code_mappings'
      and policyname = any(array[
        'avalara_tax_code_mappings_staff_select',
        'avalara_tax_code_mappings_admin_insert',
        'avalara_tax_code_mappings_admin_update'
      ])
  ),
  'Avalara mappings split staff reads from owner and admin mutations'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'avalara_filing_registration_statuses'
      and policyname = 'avalara_filing_status_staff_select'
  ),
  'staff filing verification access is explicitly read only and brand scoped'
);

select * from finish();
rollback;
