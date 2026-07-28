-- Deterministic, synthetic local-development fixtures.
--
-- This file is executed automatically by `supabase db reset`. It intentionally
-- contains no Auth users or provider credentials; scripts/bootstrap-local-auth.mjs
-- creates local-only Auth identities through the Supabase Admin API after reset.
--
-- The three paid shipments stop at `charged`. Advancing them to label_created
-- or shipped would require genuine compliance and label-provider evidence, and a
-- local fixture must not bypass Vinifera's fail-closed fulfillment controls.

begin;
set constraints all deferred;
set local request.jwt.claims = '{"role":"service_role"}';

-- Insert fixed brand identities before their organizations. The composite
-- foreign keys are deferred, and having the brand rows available lets
-- organization seed triggers resolve brand-scoped defaults deterministically.
insert into public.brands (
  id,
  organization_id,
  name,
  slug,
  is_default,
  active
)
values
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Sunrise Cellars',
    'sunrise-cellars',
    true,
    true
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'Pacific Crest Wines',
    'pacific-crest-wines',
    true,
    true
  )
on conflict (id) do nothing;

update public.organizations
set
  name = 'Sunrise Cellars',
  default_brand_id = '20000000-0000-4000-8000-000000000001',
  plan_tier = 'vine',
  subscription_status = 'active',
  access_status = 'active',
  shipping_origin_address = '{"company":"Sunrise Cellars","phone":"+1 555 010 1000","line1":"100 Vineyard Way","city":"Napa","state":"CA","postal_code":"94558","country":"US"}',
  shipping_origin_validated_at = '2026-01-01T00:00:00Z',
  email_sender_name = 'Sunrise Cellars',
  email_sender_address = 'hello@sunrise-cellars.example.com',
  updated_at = now()
where id = '10000000-0000-4000-8000-000000000001';

insert into public.organizations (
  id,
  name,
  default_brand_id,
  plan_tier,
  subscription_status,
  access_status,
  shipping_origin_address,
  shipping_origin_validated_at,
  email_sender_name,
  email_sender_address
)
select
  '10000000-0000-4000-8000-000000000001',
  'Sunrise Cellars',
  '20000000-0000-4000-8000-000000000001',
  'vine',
  'active',
  'active',
  '{"company":"Sunrise Cellars","phone":"+1 555 010 1000","line1":"100 Vineyard Way","city":"Napa","state":"CA","postal_code":"94558","country":"US"}',
  '2026-01-01T00:00:00Z',
  'Sunrise Cellars',
  'hello@sunrise-cellars.example.com'
where not exists (
  select 1
  from public.organizations
  where id = '10000000-0000-4000-8000-000000000001'
);

update public.organizations
set
  name = 'Pacific Crest Wines',
  default_brand_id = '20000000-0000-4000-8000-000000000002',
  plan_tier = 'vine',
  subscription_status = 'active',
  access_status = 'active',
  shipping_origin_address = '{"company":"Pacific Crest Wines","phone":"+1 555 010 2000","line1":"200 Coastal Road","city":"Santa Rosa","state":"CA","postal_code":"95401","country":"US"}',
  shipping_origin_validated_at = '2026-01-01T00:00:00Z',
  email_sender_name = 'Pacific Crest Wines',
  email_sender_address = 'hello@pacific-crest.example.com',
  updated_at = now()
where id = '10000000-0000-4000-8000-000000000002';

insert into public.organizations (
  id,
  name,
  default_brand_id,
  plan_tier,
  subscription_status,
  access_status,
  shipping_origin_address,
  shipping_origin_validated_at,
  email_sender_name,
  email_sender_address
)
select
  '10000000-0000-4000-8000-000000000002',
  'Pacific Crest Wines',
  '20000000-0000-4000-8000-000000000002',
  'vine',
  'active',
  'active',
  '{"company":"Pacific Crest Wines","phone":"+1 555 010 2000","line1":"200 Coastal Road","city":"Santa Rosa","state":"CA","postal_code":"95401","country":"US"}',
  '2026-01-01T00:00:00Z',
  'Pacific Crest Wines',
  'hello@pacific-crest.example.com'
where not exists (
  select 1
  from public.organizations
  where id = '10000000-0000-4000-8000-000000000002'
);

insert into public.brands (
  id,
  organization_id,
  name,
  slug,
  portal_title,
  description,
  subscription_status,
  access_status,
  time_zone,
  is_default,
  active
)
values
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Sunrise Cellars',
    'sunrise-cellars',
    'Sunrise Cellars Wine Club',
    'Synthetic local-development tenant.',
    'active',
    'active',
    'America/Los_Angeles',
    true,
    true
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'Pacific Crest Wines',
    'pacific-crest-wines',
    'Pacific Crest Wines Club',
    'Synthetic isolation-control tenant.',
    'active',
    'active',
    'America/Los_Angeles',
    true,
    true
  )
on conflict (id) do update set
  organization_id = excluded.organization_id,
  name = excluded.name,
  slug = excluded.slug,
  portal_title = excluded.portal_title,
  description = excluded.description,
  subscription_status = excluded.subscription_status,
  access_status = excluded.access_status,
  time_zone = excluded.time_zone,
  is_default = excluded.is_default,
  active = excluded.active,
  updated_at = now();

insert into public.club_tiers (
  id,
  organization_id,
  brand_id,
  name,
  description,
  price_cents,
  billing_interval,
  bottle_count,
  frequency,
  active
)
values
  (
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    'Essential',
    'Two bottles every quarter.',
    8900,
    'quarterly',
    2,
    'quarterly',
    true
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    'Reserve',
    'Four reserve bottles every quarter.',
    15900,
    'quarterly',
    4,
    'quarterly',
    true
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    'Collector',
    'Six limited-production bottles every quarter.',
    24900,
    'quarterly',
    6,
    'quarterly',
    true
  ),
  (
    '30000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000002',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000002'),
    'Coastal',
    'Three coastal wines every quarter.',
    12900,
    'quarterly',
    3,
    'quarterly',
    true
  )
on conflict (id) do update set
  organization_id = excluded.organization_id,
  brand_id = excluded.brand_id,
  name = excluded.name,
  description = excluded.description,
  price_cents = excluded.price_cents,
  billing_interval = excluded.billing_interval,
  bottle_count = excluded.bottle_count,
  frequency = excluded.frequency,
  active = excluded.active,
  updated_at = now();

insert into public.members (
  id,
  organization_id,
  brand_id,
  email,
  first_name,
  last_name,
  status,
  phone,
  shipping_address_line1,
  shipping_city,
  shipping_region,
  shipping_postal_code,
  shipping_country_code,
  shipping_validated_at,
  club_tier_id,
  joined_on,
  cancelled_at,
  lifetime_value_cents,
  churn_risk_score,
  stripe_customer_id,
  stripe_payment_method_id,
  birthday
)
values
  (
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    'member.sunrise@example.com',
    'Avery',
    'Adams',
    'active',
    '+1 555 010 1001',
    '101 Local Lane',
    'Napa',
    'CA',
    '94558',
    'US',
    '2026-01-01T00:00:00Z',
    '30000000-0000-4000-8000-000000000001',
    '2025-01-15',
    null,
    26700,
    8.00,
    'cus_localSunrise001',
    'pm_localSunrise001',
    '1986-03-12'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    'blake.bennett@example.com',
    'Blake',
    'Bennett',
    'active',
    '+1 555 010 1002',
    '102 Local Lane',
    'Napa',
    'CA',
    '94558',
    'US',
    '2026-01-01T00:00:00Z',
    '30000000-0000-4000-8000-000000000002',
    '2025-02-10',
    null,
    47700,
    12.00,
    'cus_localSunrise002',
    'pm_localSunrise002',
    '1979-07-04'
  ),
  (
    '40000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    'casey.chen@example.com',
    'Casey',
    'Chen',
    'active',
    '+1 555 010 1003',
    '103 Local Lane',
    'Napa',
    'CA',
    '94558',
    'US',
    '2026-01-01T00:00:00Z',
    '30000000-0000-4000-8000-000000000003',
    '2024-11-20',
    null,
    74700,
    4.00,
    'cus_localSunrise003',
    'pm_localSunrise003',
    '1990-11-20'
  ),
  (
    '40000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    'devon.diaz@example.com',
    'Devon',
    'Diaz',
    'active',
    '+1 555 010 1004',
    '104 Local Lane',
    'Napa',
    'CA',
    '94558',
    'US',
    '2026-01-01T00:00:00Z',
    '30000000-0000-4000-8000-000000000001',
    '2025-05-01',
    null,
    17800,
    24.00,
    'cus_localSunrise004',
    'pm_localSunrise004',
    '1988-06-08'
  ),
  (
    '40000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    'ellis.evans@example.com',
    'Ellis',
    'Evans',
    'active',
    '+1 555 010 1005',
    '105 Local Lane',
    'Napa',
    'CA',
    '94558',
    'US',
    '2026-01-01T00:00:00Z',
    '30000000-0000-4000-8000-000000000002',
    '2025-03-19',
    null,
    31800,
    18.00,
    'cus_localSunrise005',
    'pm_localSunrise005',
    '1975-09-28'
  ),
  (
    '40000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    'finley.foster@example.com',
    'Finley',
    'Foster',
    'active',
    '+1 555 010 1006',
    '106 Local Lane',
    'Napa',
    'CA',
    '94558',
    'US',
    '2026-01-01T00:00:00Z',
    '30000000-0000-4000-8000-000000000001',
    '2026-01-05',
    null,
    0,
    30.00,
    null,
    null,
    '1992-04-18'
  ),
  (
    '40000000-0000-4000-8000-000000000007',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    'gray.garcia@example.com',
    'Gray',
    'Garcia',
    'active',
    '+1 555 010 1007',
    '107 Local Lane',
    'Napa',
    'CA',
    '94558',
    'US',
    '2026-01-01T00:00:00Z',
    '30000000-0000-4000-8000-000000000002',
    '2026-01-10',
    null,
    0,
    28.00,
    null,
    null,
    '1984-12-02'
  ),
  (
    '40000000-0000-4000-8000-000000000008',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    'harper.hughes@example.com',
    'Harper',
    'Hughes',
    'cancelled',
    '+1 555 010 1008',
    '108 Local Lane',
    'Napa',
    'CA',
    '94558',
    'US',
    '2026-01-01T00:00:00Z',
    '30000000-0000-4000-8000-000000000001',
    '2024-08-15',
    '2026-01-15T00:00:00Z',
    35600,
    92.00,
    'cus_localSunrise008',
    null,
    '1968-01-16'
  ),
  (
    '40000000-0000-4000-8000-000000000009',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    'indigo.irwin@example.com',
    'Indigo',
    'Irwin',
    'active',
    '+1 555 010 1009',
    '109 Local Lane',
    'Napa',
    'CA',
    '94558',
    'US',
    '2026-01-01T00:00:00Z',
    '30000000-0000-4000-8000-000000000003',
    '2025-07-22',
    null,
    49800,
    70.00,
    'cus_localSunrise009',
    'pm_localSunrise009',
    '1981-10-10'
  ),
  (
    '40000000-0000-4000-8000-000000000010',
    '10000000-0000-4000-8000-000000000002',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000002'),
    'member.pacific@example.com',
    'Jordan',
    'Jones',
    'active',
    '+1 555 010 2010',
    '210 Coastal Avenue',
    'Santa Rosa',
    'CA',
    '95401',
    'US',
    '2026-01-01T00:00:00Z',
    '30000000-0000-4000-8000-000000000004',
    '2025-09-01',
    null,
    25800,
    10.00,
    'cus_localPacific010',
    'pm_localPacific010',
    '1989-08-14'
  ),
  (
    '40000000-0000-4000-8000-000000000011',
    '10000000-0000-4000-8000-000000000002',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000002'),
    'kai.kim@example.com',
    'Kai',
    'Kim',
    'active',
    '+1 555 010 2011',
    '211 Coastal Avenue',
    'Santa Rosa',
    'CA',
    '95401',
    'US',
    '2026-01-01T00:00:00Z',
    '30000000-0000-4000-8000-000000000004',
    '2026-01-12',
    null,
    0,
    34.00,
    null,
    null,
    '1995-02-25'
  )
on conflict (id) do update set
  organization_id = excluded.organization_id,
  brand_id = excluded.brand_id,
  email = excluded.email,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  status = excluded.status,
  phone = excluded.phone,
  shipping_address_line1 = excluded.shipping_address_line1,
  shipping_city = excluded.shipping_city,
  shipping_region = excluded.shipping_region,
  shipping_postal_code = excluded.shipping_postal_code,
  shipping_country_code = excluded.shipping_country_code,
  shipping_validated_at = excluded.shipping_validated_at,
  club_tier_id = excluded.club_tier_id,
  joined_on = excluded.joined_on,
  cancelled_at = excluded.cancelled_at,
  lifetime_value_cents = excluded.lifetime_value_cents,
  churn_risk_score = excluded.churn_risk_score,
  stripe_customer_id = excluded.stripe_customer_id,
  stripe_payment_method_id = excluded.stripe_payment_method_id,
  birthday = excluded.birthday,
  updated_at = now();

insert into public.releases (
  id,
  organization_id,
  brand_id,
  name,
  description,
  processing_date,
  embargo_date,
  notification_lead_days,
  status
)
values (
  '50000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
  'Spring Local Release',
  'Synthetic release used only for local development.',
  '2026-04-15',
  '2026-04-01',
  3,
  'processing'
)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  brand_id = excluded.brand_id,
  name = excluded.name,
  description = excluded.description,
  processing_date = excluded.processing_date,
  embargo_date = excluded.embargo_date,
  notification_lead_days = excluded.notification_lead_days,
  status = excluded.status,
  updated_at = now();

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
values
  (
    '51000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    '50000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'Essential',
    8900,
    2
  ),
  (
    '51000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    '50000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    'Reserve',
    15900,
    4
  ),
  (
    '51000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    '50000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000003',
    'Collector',
    24900,
    6
  )
on conflict (id) do update set
  organization_id = excluded.organization_id,
  brand_id = excluded.brand_id,
  release_id = excluded.release_id,
  tier_id = excluded.tier_id,
  tier_name = excluded.tier_name,
  price_cents = excluded.price_cents,
  bottle_count = excluded.bottle_count;

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
  address_validation_status,
  address_validation_messages,
  validated_shipping_address,
  charge_amount_cents,
  stripe_payment_intent_id,
  stripe_charge_id,
  decline_code,
  decline_reason,
  retry_count,
  next_retry_at,
  last_payment_event_at,
  paid_at
)
values
  (
    '60000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'pending',
    '{"name":"Avery Adams","line1":"101 Local Lane","city":"Napa","state":"CA","postal_code":"94558","country":"US"}',
    'valid',
    '[]',
    '{"name":"Avery Adams","line1":"101 Local Lane","city":"Napa","state":"CA","postal_code":"94558","country":"US"}',
    8900,
    'pi_localShipment001',
    'ch_localShipment001',
    null,
    null,
    0,
    null,
    '2026-04-15T10:00:00Z',
    '2026-04-15T10:00:00Z'
  ),
  (
    '60000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    '40000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002',
    'pending',
    '{"name":"Blake Bennett","line1":"102 Local Lane","city":"Napa","state":"CA","postal_code":"94558","country":"US"}',
    'valid',
    '[]',
    '{"name":"Blake Bennett","line1":"102 Local Lane","city":"Napa","state":"CA","postal_code":"94558","country":"US"}',
    15900,
    'pi_localShipment002',
    'ch_localShipment002',
    null,
    null,
    0,
    null,
    '2026-04-15T10:05:00Z',
    '2026-04-15T10:05:00Z'
  ),
  (
    '60000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    '40000000-0000-4000-8000-000000000003',
    '50000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000003',
    'pending',
    '{"name":"Casey Chen","line1":"103 Local Lane","city":"Napa","state":"CA","postal_code":"94558","country":"US"}',
    'valid',
    '[]',
    '{"name":"Casey Chen","line1":"103 Local Lane","city":"Napa","state":"CA","postal_code":"94558","country":"US"}',
    24900,
    'pi_localShipment003',
    'ch_localShipment003',
    null,
    null,
    0,
    null,
    '2026-04-15T10:10:00Z',
    '2026-04-15T10:10:00Z'
  ),
  (
    '60000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    '40000000-0000-4000-8000-000000000004',
    '50000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'pending',
    '{"name":"Devon Diaz","line1":"104 Local Lane","city":"Napa","state":"CA","postal_code":"94558","country":"US"}',
    'valid',
    '[]',
    '{"name":"Devon Diaz","line1":"104 Local Lane","city":"Napa","state":"CA","postal_code":"94558","country":"US"}',
    8900,
    null,
    null,
    null,
    null,
    0,
    null,
    null,
    null
  ),
  (
    '60000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    '40000000-0000-4000-8000-000000000005',
    '50000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002',
    'pending',
    '{"name":"Ellis Evans","line1":"105 Local Lane","city":"Napa","state":"CA","postal_code":"94558","country":"US"}',
    'valid',
    '[]',
    '{"name":"Ellis Evans","line1":"105 Local Lane","city":"Napa","state":"CA","postal_code":"94558","country":"US"}',
    15900,
    null,
    null,
    null,
    null,
    0,
    null,
    null,
    null
  ),
  (
    '60000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    '40000000-0000-4000-8000-000000000009',
    '50000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000003',
    'pending',
    '{"name":"Indigo Irwin","line1":"109 Local Lane","city":"Napa","state":"CA","postal_code":"94558","country":"US"}',
    'valid',
    '[]',
    '{"name":"Indigo Irwin","line1":"109 Local Lane","city":"Napa","state":"CA","postal_code":"94558","country":"US"}',
    24900,
    'pi_localShipment006',
    null,
    'card_declined',
    'Synthetic local decline.',
    1,
    '2026-04-18T10:00:00Z',
    '2026-04-15T10:15:00Z',
    null
  )
-- Preserve an existing shipment's lifecycle state on reapplication. The
-- terminal updates below safely move new pending rows forward, while trying to
-- reset a charged/declined row to pending would violate the lifecycle trigger.
on conflict (id) do update set
  organization_id = excluded.organization_id,
  brand_id = excluded.brand_id,
  member_id = excluded.member_id,
  release_id = excluded.release_id,
  release_tier_id = excluded.release_tier_id,
  tier_id = excluded.tier_id,
  shipping_address = excluded.shipping_address,
  address_validation_status = excluded.address_validation_status,
  address_validation_messages = excluded.address_validation_messages,
  validated_shipping_address = excluded.validated_shipping_address,
  charge_amount_cents = excluded.charge_amount_cents,
  stripe_payment_intent_id = excluded.stripe_payment_intent_id,
  stripe_charge_id = excluded.stripe_charge_id,
  decline_code = excluded.decline_code,
  decline_reason = excluded.decline_reason,
  retry_count = excluded.retry_count,
  next_retry_at = excluded.next_retry_at,
  last_payment_event_at = excluded.last_payment_event_at,
  paid_at = excluded.paid_at,
  updated_at = now();

do $local_seed$
begin
  -- Billing-attempt inserts intentionally lock and validate the shipment's
  -- current lifecycle state. Skip the complete deterministic set on replay;
  -- a partial set remains visible to the cardinality verifier instead of
  -- attempting an unsafe insert against an already charged shipment.
  if not exists (
    select 1
    from public.billing_attempts
    where id in (
      '70000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000002',
      '70000000-0000-4000-8000-000000000003',
      '70000000-0000-4000-8000-000000000006'
    )
  ) then
insert into public.billing_attempts (
  id,
  organization_id,
  brand_id,
  shipment_id,
  idempotency_key,
  attempt_number,
  attempt_kind,
  status,
  amount_cents,
  livemode,
  stripe_payment_intent_id,
  stripe_charge_id,
  decline_code,
  decline_reason,
  scheduled_for,
  started_at,
  completed_at,
  metadata
)
values
  (
    '70000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    '60000000-0000-4000-8000-000000000001',
    'local-seed-charge-001',
    1,
    'charge',
    'succeeded',
    8900,
    false,
    'pi_localShipment001',
    'ch_localShipment001',
    null,
    null,
    '2026-04-15T10:00:00Z',
    '2026-04-15T10:00:00Z',
    '2026-04-15T10:00:01Z',
    '{"source":"local_seed"}'
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    '60000000-0000-4000-8000-000000000002',
    'local-seed-charge-002',
    1,
    'charge',
    'succeeded',
    15900,
    false,
    'pi_localShipment002',
    'ch_localShipment002',
    null,
    null,
    '2026-04-15T10:05:00Z',
    '2026-04-15T10:05:00Z',
    '2026-04-15T10:05:01Z',
    '{"source":"local_seed"}'
  ),
  (
    '70000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    '60000000-0000-4000-8000-000000000003',
    'local-seed-charge-003',
    1,
    'charge',
    'succeeded',
    24900,
    false,
    'pi_localShipment003',
    'ch_localShipment003',
    null,
    null,
    '2026-04-15T10:10:00Z',
    '2026-04-15T10:10:00Z',
    '2026-04-15T10:10:01Z',
    '{"source":"local_seed"}'
  ),
  (
    '70000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
    '60000000-0000-4000-8000-000000000006',
    'local-seed-charge-006',
    1,
    'charge',
    'declined',
    24900,
    false,
    'pi_localShipment006',
    null,
    'card_declined',
    'Synthetic local decline.',
    '2026-04-15T10:15:00Z',
    '2026-04-15T10:15:00Z',
    '2026-04-15T10:15:01Z',
    '{"source":"local_seed"}'
  )
on conflict (id) do update set
  organization_id = excluded.organization_id,
  brand_id = excluded.brand_id,
  shipment_id = excluded.shipment_id,
  idempotency_key = excluded.idempotency_key,
  attempt_number = excluded.attempt_number,
  attempt_kind = excluded.attempt_kind,
  status = excluded.status,
  amount_cents = excluded.amount_cents,
  livemode = excluded.livemode,
  stripe_payment_intent_id = excluded.stripe_payment_intent_id,
  stripe_charge_id = excluded.stripe_charge_id,
  decline_code = excluded.decline_code,
  decline_reason = excluded.decline_reason,
  scheduled_for = excluded.scheduled_for,
  started_at = excluded.started_at,
  completed_at = excluded.completed_at,
  metadata = excluded.metadata,
  updated_at = now();
  end if;
end;
$local_seed$;

update public.shipments
set status = 'charged'
where id in (
  '60000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000002',
  '60000000-0000-4000-8000-000000000003'
);

update public.shipments
set status = 'declined'
where id = '60000000-0000-4000-8000-000000000006';

commit;
