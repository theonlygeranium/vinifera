begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(16);

select ok(
  to_regclass('public.meta_attribution_touchpoints') is not null,
  'Meta attribution has a durable first-party ledger'
);

select is(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.meta_attribution_touchpoints'::regclass
  ),
  true,
  'the Meta attribution ledger forces RLS'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.meta_attribution_touchpoints',
    'select'
  ),
  'authenticated users cannot read encrypted attribution rows directly'
);

select ok(
  (
    select pg_get_functiondef(function.oid)
    from pg_proc as function
    join pg_namespace as namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'public'
      and function.proname = 'store_meta_attribution_touchpoint'
  ) ilike '%on conflict (id) do nothing%',
  'concurrent touchpoint retries use a single atomic insert conflict boundary'
);

insert into auth.users (id, email)
values
  ('f8100000-0000-4000-8000-000000000001', 'meta-owner@example.test'),
  ('f8100000-0000-4000-8000-000000000002', 'meta-member@example.test');

insert into public.organizations (id, name, plan_tier)
values (
  'f8200000-0000-4000-8000-000000000001',
  'Meta Attribution Winery',
  'reserve'
);

insert into public.staff_users (id, organization_id, email, role)
values (
  'f8100000-0000-4000-8000-000000000001',
  'f8200000-0000-4000-8000-000000000001',
  'meta-owner@example.test',
  'owner'
);

insert into public.members (
  id, auth_user_id, organization_id, brand_id, email, first_name, last_name
)
select
  'f8300000-0000-4000-8000-000000000001',
  'f8100000-0000-4000-8000-000000000002',
  organization.id,
  organization.default_brand_id,
  'meta-member@example.test',
  'Meta',
  'Member'
from public.organizations as organization
where organization.id = 'f8200000-0000-4000-8000-000000000001';

insert into public.integration_connections (
  id, organization_id, brand_id, integration_type, status, opted_in,
  consented_at
)
select
  'f8400000-0000-4000-8000-000000000001',
  organization.id,
  organization.default_brand_id,
  'meta',
  'active',
  true,
  now()
from public.organizations as organization
where organization.id = 'f8200000-0000-4000-8000-000000000001';

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select throws_ok(
  $$
    select public.store_meta_attribution_touchpoint(
      'f8500000-0000-4000-8000-000000000001',
      'f8200000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'f8200000-0000-4000-8000-000000000001'),
      'f8300000-0000-4000-8000-000000000001',
      'https://club.example.test/join?utm_id=summer',
      'summer',
      'Summer Club',
      'meta',
      'paid',
      'A256GCM',
      1,
      'v1',
      repeat('A', 32),
      repeat('B', 16),
      repeat('a', 64),
      now() - interval '1 minute'
    )
  $$,
  '42501',
  'Active member Meta consent is required.',
  'attribution capture fails closed before member consent'
);

select lives_ok(
  $$
    select public.set_member_meta_consent(
      'f8200000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'f8200000-0000-4000-8000-000000000001'),
      'f8300000-0000-4000-8000-000000000001',
      true,
      'member_portal',
      '2026-07'
    )
  $$,
  'the service records explicit member Meta consent'
);

reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select lives_ok(
  $$
    select public.store_meta_attribution_touchpoint(
      'f8500000-0000-4000-8000-000000000001',
      'f8200000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'f8200000-0000-4000-8000-000000000001'),
      'f8300000-0000-4000-8000-000000000001',
      'https://club.example.test/join?utm_id=summer',
      'summer',
      'Summer Club',
      'meta',
      'paid',
      'A256GCM',
      1,
      'v1',
      repeat('A', 32),
      repeat('B', 16),
      repeat('a', 64),
      now() - interval '1 minute'
    )
  $$,
  'the service stores an encrypted attribution touchpoint after consent'
);

select is(
  (
    select storage_mode
    from public.meta_attribution_touchpoints
    where id = 'f8500000-0000-4000-8000-000000000001'
  ),
  'encrypted_envelope',
  'browser identifiers are retained only as an encrypted envelope'
);

select is(
  public.store_meta_attribution_touchpoint(
    'f8500000-0000-4000-8000-000000000001',
    'f8200000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = 'f8200000-0000-4000-8000-000000000001'),
    'f8300000-0000-4000-8000-000000000001',
    'https://club.example.test/join?utm_id=summer',
    'summer',
    'Summer Club',
    'meta',
    'paid',
    'A256GCM',
    1,
    'v1',
    repeat('A', 32),
    repeat('B', 16),
    repeat('a', 64),
    now() - interval '1 minute'
  ),
  'f8500000-0000-4000-8000-000000000001'::uuid,
  'capture retries are idempotent'
);

select throws_ok(
  $$
    select public.store_meta_attribution_touchpoint(
      'f8500000-0000-4000-8000-000000000001',
      'f8200000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'f8200000-0000-4000-8000-000000000001'),
      'f8300000-0000-4000-8000-000000000001',
      'https://club.example.test/join?utm_id=other',
      'other',
      'Other Club',
      'meta',
      'paid',
      'A256GCM',
      1,
      'v1',
      repeat('C', 32),
      repeat('D', 16),
      repeat('b', 64),
      now() - interval '1 minute'
    )
  $$,
  '23505',
  'Meta attribution idempotency key was reused for another payload.',
  'capture idempotency keys cannot be reused for changed payloads'
);

insert into public.meta_conversion_events (
  id, connection_id, organization_id, brand_id, member_id, event_id,
  event_name, event_time, user_data_hashes, custom_data, status, sent_at,
  attribution_touchpoint_id, event_source_url
)
select
  'f8600000-0000-4000-8000-000000000001',
  'f8400000-0000-4000-8000-000000000001',
  organization.id,
  organization.default_brand_id,
  'f8300000-0000-4000-8000-000000000001',
  'vinifera:Purchase:meta-attribution-test',
  'Purchase',
  now(),
  jsonb_build_object('em', repeat('c', 64)),
  '{"currency":"USD","value":125}'::jsonb,
  'completed',
  now(),
  'f8500000-0000-4000-8000-000000000001',
  'https://club.example.test/join?utm_id=summer'
from public.organizations as organization
where organization.id = 'f8200000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"f8100000-0000-4000-8000-000000000001","role":"authenticated","organization_id":"f8200000-0000-4000-8000-000000000001","user_role":"owner","auth_surface":"staff","platform_role":null}';

select is(
  (
    public.get_meta_attribution_report(
      'f8200000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'f8200000-0000-4000-8000-000000000001'),
      now() - interval '1 day',
      now() + interval '1 minute'
    ) -> 'summary' ->> 'attributedConversions'
  )::integer,
  1,
  'authorized staff can reconcile attributed conversions'
);

select is(
  (
    public.get_meta_attribution_report(
      'f8200000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'f8200000-0000-4000-8000-000000000001'),
      now() - interval '1 day',
      now() + interval '1 minute'
    ) -> 'campaigns' -> 0 ->> 'purchaseValue'
  )::numeric,
  125::numeric,
  'campaign reconciliation aggregates purchase value'
);

select ok(
  public.get_meta_attribution_report(
    'f8200000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = 'f8200000-0000-4000-8000-000000000001'),
    now() - interval '1 day',
    now() + interval '1 minute'
  )::text !~ '(ciphertext|browser_data|member_id)',
  'aggregate reporting never exposes browser identifiers, ciphertext, or members'
);

reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select lives_ok(
  $$
    select public.set_member_meta_consent(
      'f8200000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'f8200000-0000-4000-8000-000000000001'),
      'f8300000-0000-4000-8000-000000000001',
      false,
      'member_portal',
      '2026-07'
    )
  $$,
  'the service records member Meta consent revocation'
);

select is(
  (
    select storage_mode
    from public.meta_attribution_touchpoints
    where id = 'f8500000-0000-4000-8000-000000000001'
  ),
  'redacted',
  'revoking consent redacts stored browser identifiers'
);

select ok(
  (
    select browser_data_ciphertext is null
      and browser_data_iv is null
      and key_version is null
    from public.meta_attribution_touchpoints
    where id = 'f8500000-0000-4000-8000-000000000001'
  ),
  'revocation removes every decryptable browser-identifier field'
);

select * from finish();
rollback;
