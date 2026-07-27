begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(35);

select ok(
  to_regprocedure(
    'public.claim_quickbooks_refresh_lease(uuid,bigint,text,integer)'
  ) is not null,
  'QuickBooks refresh leases are coordinated in the database'
);

select ok(
  to_regprocedure(
    'public.replace_klaviyo_mappings(uuid,jsonb,jsonb)'
  ) is not null,
  'Klaviyo mapping changes use an authorized database command'
);

select ok(
  to_regprocedure(
    'public.replace_quickbooks_account_mappings(uuid,jsonb)'
  ) is not null,
  'QuickBooks mapping changes use an authorized database command'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.klaviyo_field_mappings'::regclass
      and conname = 'klaviyo_field_mapping_connection_same_brand_fkey'
  ),
  'Klaviyo fields have a composite same-brand connection foreign key'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.quickbooks_account_mappings'::regclass
      and conname = 'quickbooks_account_connection_same_brand_fkey'
  ),
  'QuickBooks accounts have a composite same-brand connection foreign key'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_quickbooks_refresh_lease(uuid,bigint,text,integer)',
    'execute'
  ),
  'authenticated callers cannot claim credential refresh leases'
);

insert into auth.users (id, email)
values
  (
    'f6100000-0000-4000-8000-000000000001',
    'phase5-backend-owner@example.test'
  ),
  (
    'f6100000-0000-4000-8000-000000000002',
    'phase5-backend-other@example.test'
  );

insert into public.organizations (
  id,
  name,
  plan_tier,
  access_status
)
values
  (
    'f6200000-0000-4000-8000-000000000001',
    'Phase 5 Backend Winery',
    'reserve',
    'active'
  ),
  (
    'f6200000-0000-4000-8000-000000000002',
    'Phase 5 Other Winery',
    'reserve',
    'active'
  );

insert into public.staff_users (id, organization_id, email, role)
values
  (
    'f6100000-0000-4000-8000-000000000001',
    'f6200000-0000-4000-8000-000000000001',
    'phase5-backend-owner@example.test',
    'owner'
  ),
  (
    'f6100000-0000-4000-8000-000000000002',
    'f6200000-0000-4000-8000-000000000002',
    'phase5-backend-other@example.test',
    'owner'
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
  fixture.id,
  organization.id,
  organization.default_brand_id,
  fixture.name,
  15000,
  3,
  'quarterly'
from public.organizations as organization
join (
  values
    (
      'f6300000-0000-4000-8000-000000000001'::uuid,
      'f6200000-0000-4000-8000-000000000001'::uuid,
      'Backend Estate'
    ),
    (
      'f6300000-0000-4000-8000-000000000002'::uuid,
      'f6200000-0000-4000-8000-000000000002'::uuid,
      'Other Estate'
    )
) as fixture(id, organization_id, name)
  on fixture.organization_id = organization.id;

insert into public.members (
  id,
  organization_id,
  brand_id,
  email,
  first_name,
  last_name,
  club_tier_id,
  churn_risk_score
)
select
  'f6400000-0000-4000-8000-000000000001',
  organization.id,
  organization.default_brand_id,
  'phase5-backend-member@example.test',
  'Backend',
  'Member',
  'f6300000-0000-4000-8000-000000000001',
  84.25
from public.organizations as organization
where organization.id = 'f6200000-0000-4000-8000-000000000001';

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
  'f6400000-0000-4000-8000-000000000002',
  organization.id,
  organization.default_brand_id,
  'phase5-backend-second@example.test',
  'Second',
  'Member',
  'f6300000-0000-4000-8000-000000000001'
from public.organizations as organization
where organization.id = 'f6200000-0000-4000-8000-000000000001';

insert into public.releases (
  id,
  organization_id,
  brand_id,
  name,
  processing_date,
  embargo_date,
  status,
  created_by
)
select
  'f6600000-0000-4000-8000-000000000001',
  organization.id,
  organization.default_brand_id,
  'Backend Release',
  current_date + 2,
  current_date,
  'scheduled',
  'f6100000-0000-4000-8000-000000000001'
from public.organizations as organization
where organization.id = 'f6200000-0000-4000-8000-000000000001';

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
  'f6700000-0000-4000-8000-000000000001',
  organization.id,
  organization.default_brand_id,
  'f6600000-0000-4000-8000-000000000001',
  'f6300000-0000-4000-8000-000000000001',
  'Backend Estate',
  15000,
  3
from public.organizations as organization
where organization.id = 'f6200000-0000-4000-8000-000000000001';

insert into public.shipments (
  id,
  organization_id,
  brand_id,
  member_id,
  release_id,
  release_tier_id,
  tier_id,
  shipping_address,
  charge_amount_cents
)
select
  fixture.id,
  organization.id,
  organization.default_brand_id,
  fixture.member_id,
  'f6600000-0000-4000-8000-000000000001',
  'f6700000-0000-4000-8000-000000000001',
  'f6300000-0000-4000-8000-000000000001',
  '{"line1":"1 Backend Way"}'::jsonb,
  15000
from public.organizations as organization
cross join (
  values
    (
      'f6800000-0000-4000-8000-000000000001'::uuid,
      'f6400000-0000-4000-8000-000000000001'::uuid
    ),
    (
      'f6800000-0000-4000-8000-000000000002'::uuid,
      'f6400000-0000-4000-8000-000000000002'::uuid
    )
) as fixture(id, member_id)
where organization.id = 'f6200000-0000-4000-8000-000000000001';

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
join (
  values
    (
      'f6500000-0000-4000-8000-000000000001'::uuid,
      'f6200000-0000-4000-8000-000000000001'::uuid,
      'klaviyo'
    ),
    (
      'f6500000-0000-4000-8000-000000000002'::uuid,
      'f6200000-0000-4000-8000-000000000001'::uuid,
      'quickbooks'
    ),
    (
      'f6500000-0000-4000-8000-000000000003'::uuid,
      'f6200000-0000-4000-8000-000000000002'::uuid,
      'quickbooks'
    ),
    (
      'f6500000-0000-4000-8000-000000000004'::uuid,
      'f6200000-0000-4000-8000-000000000001'::uuid,
      'avalara'
    )
) as fixture(id, organization_id, integration_type)
  on fixture.organization_id = organization.id;

select is(
  (
    select count(*)::integer
    from public.klaviyo_field_mappings
    where connection_id = 'f6500000-0000-4000-8000-000000000001'
  ),
  10,
  'new Klaviyo connections receive executable default field mappings'
);

set local role authenticated;
set local request.jwt.claims =
  '{"role":"authenticated","sub":"f6100000-0000-4000-8000-000000000001","organization_id":"f6200000-0000-4000-8000-000000000001","auth_surface":"staff","user_role":"owner"}';

select lives_ok(
  $$
    select public.replace_klaviyo_mappings(
      'f6500000-0000-4000-8000-000000000001',
      '[
        {
          "vinifera_field":"churn_risk_score",
          "klaviyo_property":"Churn_Risk_Score",
          "enabled":true
        },
        {
          "vinifera_field":"churn_risk_level",
          "klaviyo_property":"Churn_Risk_Level",
          "enabled":true
        }
      ]'::jsonb,
      '[
        {
          "club_tier_id":"f6300000-0000-4000-8000-000000000001",
          "membership_status":"active",
          "list_id":"List_Active_Estate",
          "enabled":true
        }
      ]'::jsonb
    )
  $$,
  'the brand owner can atomically replace Klaviyo field and list mappings'
);

select is(
  (
    select count(*)::integer
    from public.klaviyo_field_mappings
    where connection_id = 'f6500000-0000-4000-8000-000000000001'
      and enabled
  ),
  2,
  'Klaviyo field replacement persists exactly the requested fields'
);

select is(
  (
    select list_id
    from public.klaviyo_list_mappings
    where connection_id = 'f6500000-0000-4000-8000-000000000001'
  ),
  'List_Active_Estate',
  'Klaviyo list membership rules are persisted'
);

select throws_ok(
  $$
    select public.replace_klaviyo_mappings(
      'f6500000-0000-4000-8000-000000000001',
      '[]'::jsonb,
      '[
        {
          "club_tier_id":"f6300000-0000-4000-8000-000000000002",
          "list_id":"List_Other_Estate"
        }
      ]'::jsonb
    )
  $$,
  '23503',
  null,
  'a Klaviyo list rule cannot reference another brand tier'
);

select lives_ok(
  $$
    select public.replace_quickbooks_account_mappings(
      'f6500000-0000-4000-8000-000000000002',
      '[
        {
          "club_tier_id":"f6300000-0000-4000-8000-000000000001",
          "mapping_kind":"membership",
          "quickbooks_account_id":"Income-100",
          "quickbooks_item_id":"Estate-Quarterly"
        }
      ]'::jsonb
    )
  $$,
  'the brand owner can atomically replace QuickBooks account mappings'
);

select is(
  (
    select quickbooks_item_id
    from public.quickbooks_account_mappings
    where connection_id = 'f6500000-0000-4000-8000-000000000002'
  ),
  'Estate-Quarterly',
  'QuickBooks tier and item mapping is persisted'
);

set local request.jwt.claims =
  '{"role":"authenticated","sub":"f6100000-0000-4000-8000-000000000002","organization_id":"f6200000-0000-4000-8000-000000000002","auth_surface":"staff","user_role":"owner"}';

select throws_ok(
  $$
    select public.replace_quickbooks_account_mappings(
      'f6500000-0000-4000-8000-000000000002',
      '[]'::jsonb
    )
  $$,
  '42501',
  null,
  'an owner from another tenant cannot mutate QuickBooks mappings'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select lives_ok(
  $$
    select public.store_integration_credentials(
      'f6500000-0000-4000-8000-000000000002',
      'encrypted_envelope',
      1,
      'A256GCM',
      'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=',
      'QUJDREVGR0hJSktMTU5P',
      'phase5-backend-key-v1',
      null
    )
  $$,
  'service runtime stores the initial encrypted QuickBooks credential generation'
);

create temporary table phase5_qbo_claim as
select *
from public.claim_quickbooks_refresh_lease(
  'f6500000-0000-4000-8000-000000000002',
  1,
  'phase5-worker-a',
  120
);

select is(
  (select disposition from phase5_qbo_claim),
  'acquired',
  'the first QuickBooks refresh worker acquires the durable lease'
);

select is(
  (
    select disposition
    from public.claim_quickbooks_refresh_lease(
      'f6500000-0000-4000-8000-000000000002',
      1,
      'phase5-worker-b',
      120
    )
  ),
  'busy',
  'a concurrent QuickBooks refresh worker observes the existing lease'
);

select is(
  public.complete_quickbooks_refresh_lease(
    'f6500000-0000-4000-8000-000000000002',
    1,
    (select lease_token from phase5_qbo_claim),
    1,
    'A256GCM',
    'WVpYX1dWVVRTUlFQT05NTEtKSUhHRkVEQ0I=',
    'UE9OTUxLSklIR0ZFRENC',
    'phase5-backend-key-v2'
  ),
  2::bigint,
  'refresh completion uses generation CAS and advances the generation'
);

select is(
  (
    select disposition
    from public.claim_quickbooks_refresh_lease(
      'f6500000-0000-4000-8000-000000000002',
      1,
      'phase5-worker-stale',
      120
    )
  ),
  'stale',
  'a stale QuickBooks runtime snapshot cannot overwrite rotated credentials'
);

select is(
  (
    select churn_risk_level
    from public.get_klaviyo_member_source(
      'f6500000-0000-4000-8000-000000000001',
      1000,
      null
    )
    where member_id = 'f6400000-0000-4000-8000-000000000001'
  ),
  'high',
  'Klaviyo source execution exposes churn risk level'
);

select lives_ok(
  $$
    select public.record_avalara_tax_calculation(
      'f6500000-0000-4000-8000-000000000004',
      'f6800000-0000-4000-8000-000000000001',
      'AVA-QUOTE-1',
      'VIN-F680-1',
      'temporary',
      15000,
      0,
      1200,
      100,
      '[]'::jsonb,
      repeat('a', 64),
      repeat('1', 64),
      'USD',
      'SalesInvoice'
    )
  $$,
  'the first temporary Avalara quote is recorded'
);

select lives_ok(
  $$
    select public.record_avalara_tax_calculation(
      'f6500000-0000-4000-8000-000000000004',
      'f6800000-0000-4000-8000-000000000001',
      'AVA-QUOTE-1',
      'VIN-F680-1',
      'temporary',
      15500,
      0,
      1250,
      125,
      '[]'::jsonb,
      repeat('b', 64),
      repeat('2', 64),
      'USD',
      'SalesInvoice'
    )
  $$,
  'the same-shipment temporary Avalara quote can be adjusted under the provider code'
);

select is(
  (
    select count(*)::integer
    from public.avalara_tax_calculations
    where connection_id = 'f6500000-0000-4000-8000-000000000004'
      and provider_transaction_code = 'AVA-QUOTE-1'
  ),
  1,
  'Avalara quote adjustment preserves one provider transaction row'
);

select is(
  (
    select request_hash || ':' || tax_amount_cents::text
    from public.avalara_tax_calculations
    where connection_id = 'f6500000-0000-4000-8000-000000000004'
      and provider_transaction_code = 'AVA-QUOTE-1'
  ),
  repeat('b', 64) || ':1250',
  'Avalara quote adjustment replaces the request hash and quote amounts'
);

select lives_ok(
  $$
    select public.record_avalara_tax_calculation(
      'f6500000-0000-4000-8000-000000000004',
      'f6800000-0000-4000-8000-000000000001',
      'AVA-QUOTE-1',
      'VIN-F680-1',
      'committed',
      15500,
      0,
      1250,
      125,
      '[]'::jsonb,
      repeat('c', 64),
      repeat('3', 64),
      'USD',
      'SalesInvoice'
    )
  $$,
  'a temporary Avalara quote can transition to committed'
);

select throws_ok(
  $$
    select public.record_avalara_tax_calculation(
      'f6500000-0000-4000-8000-000000000004',
      'f6800000-0000-4000-8000-000000000001',
      'AVA-QUOTE-1',
      'VIN-F680-1',
      'committed',
      16000,
      0,
      1300,
      125,
      '[]'::jsonb,
      repeat('d', 64),
      repeat('4', 64),
      'USD',
      'SalesInvoice'
    )
  $$,
  '55000',
  null,
  'a committed Avalara calculation cannot be replaced'
);

select throws_ok(
  $$
    select public.record_avalara_tax_calculation(
      'f6500000-0000-4000-8000-000000000004',
      'f6800000-0000-4000-8000-000000000002',
      'AVA-QUOTE-1',
      'VIN-F680-2',
      'temporary',
      15000,
      0,
      1200,
      100,
      '[]'::jsonb,
      repeat('e', 64),
      repeat('5', 64),
      'USD',
      'SalesInvoice'
    )
  $$,
  '55000',
  null,
  'an Avalara provider code cannot be rebound to another shipment'
);

select lives_ok(
  $$
    select public.enqueue_integration_sync_job(
      'f6500000-0000-4000-8000-000000000001',
      'outbound',
      'profiles.sync',
      'member',
      null,
      'phase5-backend-active-enqueue',
      '{}'::jsonb,
      '{}'::jsonb,
      2
    )
  $$,
  'an active brand can enqueue an integration sync'
);

update public.integration_sync_jobs
set next_attempt_at = now() + interval '1 hour'
where idempotency_key = 'phase5-backend-active-enqueue';

select public.enqueue_integration_sync_job(
  'f6500000-0000-4000-8000-000000000001',
  'outbound',
  'profiles.sync',
  'member',
  null,
  'phase5-backend-twelve-attempts',
  '{}'::jsonb,
  '{}'::jsonb,
  12
);

select is(
  (
    select max_attempts
    from public.claim_integration_sync_jobs(
      'phase5-max-attempt-worker',
      25,
      120,
      now()
    )
    where job_id = (
      select id
      from public.integration_sync_jobs
      where idempotency_key = 'phase5-backend-twelve-attempts'
    )
  ),
  12,
  'claimed integration work carries its persisted attempt ceiling'
);

update public.integration_sync_jobs
set next_attempt_at = now()
where idempotency_key = 'phase5-backend-active-enqueue';

update public.brands
set active = false
where id = (
  select default_brand_id
  from public.organizations
  where id = 'f6200000-0000-4000-8000-000000000001'
);

select throws_ok(
  $$
    select public.enqueue_integration_sync_job(
      'f6500000-0000-4000-8000-000000000001',
      'outbound',
      'profiles.sync',
      'member',
      null,
      'phase5-backend-inactive-enqueue',
      '{}'::jsonb,
      '{}'::jsonb,
      2
    )
  $$,
  '55000',
  null,
  'an inactive brand cannot enqueue an integration sync'
);

select is(
  (
    select count(*)::integer
    from public.get_integration_runtime(
      'f6200000-0000-4000-8000-000000000001',
      'quickbooks',
      (
        select default_brand_id
        from public.organizations
        where id = 'f6200000-0000-4000-8000-000000000001'
      )
    )
  ),
  0,
  'an inactive brand cannot resolve provider runtime credentials'
);

select is(
  (
    select count(*)::integer
    from public.claim_integration_sync_jobs(
      'phase5-inactive-worker',
      25,
      120,
      now()
    )
    where job_id = (
      select id
      from public.integration_sync_jobs
      where idempotency_key = 'phase5-backend-active-enqueue'
    )
  ),
  0,
  'queued work for an inactive brand cannot be claimed'
);

insert into public.integration_sync_jobs (
  connection_id,
  organization_id,
  brand_id,
  integration_type,
  direction,
  sync_type,
  entity_type,
  status,
  idempotency_key,
  lease_token_hash,
  lease_owner,
  lease_expires_at,
  attempt_count,
  max_attempts
)
select
  connection.id,
  connection.organization_id,
  connection.brand_id,
  connection.integration_type,
  'outbound',
  'profiles.sync',
  'member',
  'leased',
  'phase5-backend-expired-final',
  repeat('a', 64),
  'phase5-expired-worker',
  now() - interval '1 minute',
  1,
  1
from public.integration_connections as connection
where connection.id = 'f6500000-0000-4000-8000-000000000001';

select lives_ok(
  $$
    select *
    from public.claim_integration_sync_jobs(
      'phase5-recovery-worker',
      25,
      120,
      now()
    )
  $$,
  'claiming performs final-attempt expired-lease recovery'
);

select is(
  (
    select status::text
    from public.integration_sync_jobs
    where idempotency_key = 'phase5-backend-expired-final'
  ),
  'dead_letter',
  'an expired final-attempt integration job is dead-lettered'
);

select is(
  (
    select last_error_code
    from public.integration_sync_jobs
    where idempotency_key = 'phase5-backend-expired-final'
  ),
  'LEASE_EXPIRED_MAX_ATTEMPTS',
  'dead-lettered expired work records a stable diagnostic code'
);

select * from finish();
rollback;
