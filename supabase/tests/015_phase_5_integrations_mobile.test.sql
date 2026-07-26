begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(55);

insert into auth.users (id, email)
values
  ('e1000000-0000-4000-8000-000000000001', 'phase5-integration-owner@example.test'),
  ('e1000000-0000-4000-8000-000000000002', 'phase5-mobile-member@example.test');

insert into public.organizations (id, name, plan_tier)
values (
  'e2000000-0000-4000-8000-000000000001',
  'Phase 5 Integration Winery',
  'reserve'
);

insert into public.staff_users (id, organization_id, email, role)
values (
  'e1000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'phase5-integration-owner@example.test',
  'owner'
);

insert into public.members (
  id, auth_user_id, organization_id, email, first_name, last_name
)
values (
  'e3000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000002',
  'e2000000-0000-4000-8000-000000000001',
  'phase5-mobile-member@example.test',
  'Mobile',
  'Member'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","organization_id":"e2000000-0000-4000-8000-000000000001","user_role":"owner","auth_surface":"staff","platform_role":null}';

select lives_ok(
  $$
    select public.configure_integration_connection(
      'e2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'e2000000-0000-4000-8000-000000000001'),
      'klaviyo',
      'Primary Klaviyo',
      null,
      '{"lists":{"members":"club-members"}}'
    )
  $$,
  'staff can configure credential-free integration metadata'
);

select is(
  (
    select status::text
    from public.integration_connections
    where integration_type = 'klaviyo'
  ),
  'activation_required',
  'new integration metadata is activation-required until credentials arrive'
);

select throws_ok(
  $$
    select public.configure_integration_connection(
      'e2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'e2000000-0000-4000-8000-000000000001'),
      'quickbooks',
      'Unsafe',
      null,
      '{"nested":{"credentials":[{"api_token":"plaintext"}]}}'
    )
  $$,
  '22023',
  'Connection metadata cannot contain secrets.',
  'recursive secret guards reject nested plaintext credentials'
);

select lives_ok(
  $$
    select public.set_integration_consent(
      (select id from public.integration_connections where integration_type = 'klaviyo'),
      true
    )
  $$,
  'staff can explicitly opt in to an integration'
);

reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

insert into public.brand_sender_identities (
  organization_id, brand_id, from_name, from_email
)
values (
  'e2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'e2000000-0000-4000-8000-000000000001'),
  'Vinifera Club',
  'first-sender@example.test'
);
insert into public.brand_sender_identities (
  organization_id, brand_id, from_name, from_email, status
)
values (
  'e2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'e2000000-0000-4000-8000-000000000001'),
  'Vinifera Estate',
  'replacement-sender@example.test',
  'pending'
)
on conflict (organization_id, brand_id)
do update set
  from_name = excluded.from_name,
  from_email = excluded.from_email,
  status = 'pending',
  provider_identity_id = null,
  verified_at = null;

select is(
  (
    select count(*)
    from public.brand_sender_identities
    where organization_id = 'e2000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'a brand keeps exactly one sender identity when its address is replaced'
);
select is(
  (
    select from_email
    from public.brand_sender_identities
    where organization_id = 'e2000000-0000-4000-8000-000000000001'
  ),
  'replacement-sender@example.test',
  'sender address replacement updates the existing brand identity'
);
update public.brand_sender_identities
set status = 'disabled', provider_identity_id = null, verified_at = null
where organization_id = 'e2000000-0000-4000-8000-000000000001';
select is(
  (
    select status::text
    from public.brand_sender_identities
    where organization_id = 'e2000000-0000-4000-8000-000000000001'
  ),
  'disabled',
  'clearing a sender safely disables the identity pending later reactivation'
);

select lives_ok(
  $$
    select public.store_integration_credentials(
      (select id from public.integration_connections where integration_type = 'klaviyo'),
      'encrypted_envelope',
      1,
      'A256GCM',
      repeat('A', 32),
      repeat('B', 16),
      'v1',
      null
    )
  $$,
  'service role stores a backend-compatible v1 A256GCM envelope'
);

select is(
  (
    select status::text
    from public.integration_connections
    where integration_type = 'klaviyo'
  ),
  'configured',
  'credential storage advances an opted-in connection to configured'
);

select throws_ok(
  $$
    select public.enqueue_integration_sync_job(
      (select id from public.integration_connections where integration_type = 'klaviyo'),
      'outbound',
      'profiles',
      'member',
      'e3000000-0000-4000-8000-000000000001',
      'configured:normal:blocked'
    )
  $$,
  '55000',
  'Integration is not eligible for this sync type.',
  'configured connections cannot enqueue normal disclosure jobs'
);

select lives_ok(
  $$
    select public.enqueue_integration_sync_job(
      (select id from public.integration_connections where integration_type = 'klaviyo'),
      'outbound',
      'connection.validate',
      'connection',
      null,
      'configured:validation'
    )
  $$,
  'configured connections can enqueue a credential validation job'
);

create temporary table claimed_validation_job as
select *
from public.claim_integration_sync_jobs('validation-worker', 1, 120, now());

select is(
  (
    select sync_type
    from claimed_validation_job
  ),
  'connection.validate',
  'workers may claim only the validation job while configured'
);

select lives_ok(
  $$
    select public.complete_integration_sync_job(
      (select job_id from claimed_validation_job),
      (select lease_token from claimed_validation_job),
      'synced',
      1,
      1
    )
  $$,
  'credential validation job completes before activation'
);

select lives_ok(
  $$
    select public.set_integration_health(
      (select id from public.integration_connections where integration_type = 'klaviyo'),
      'active',
      null
    )
  $$,
  'provider reconciliation activates a configured integration'
);

select is(
  (
    select count(*)
    from public.integration_sync_jobs
    where sync_type = 'klaviyo.profiles.bootstrap'
  ),
  1::bigint,
  'activation durably queues an initial Klaviyo profile reconciliation'
);

update public.members
set first_name = 'Mobile Updated'
where id = 'e3000000-0000-4000-8000-000000000001';

select is(
  (
    select count(*)
    from public.integration_sync_jobs
    where sync_type = 'klaviyo.profile.upsert'
      and entity_id = 'e3000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'member changes durably queue real-time Klaviyo profile and list reconciliation'
);
select ok(
  (
    select bool_and(
      payload = jsonb_build_object(
        'member_id',
        'e3000000-0000-4000-8000-000000000001'::uuid
      )
      and not private.jsonb_has_raw_pii_keys(payload)
    )
    from public.integration_sync_jobs
    where sync_type = 'klaviyo.profile.upsert'
      and entity_id = 'e3000000-0000-4000-8000-000000000001'
  ),
  'database-triggered provider jobs persist only internal identifiers'
);

select is(
  (
    select key_version
    from public.get_integration_runtime(
      'e2000000-0000-4000-8000-000000000001',
      'klaviyo',
      (select default_brand_id from public.organizations where id = 'e2000000-0000-4000-8000-000000000001')
    )
  ),
  'v1',
  'service runtime round-trips the text key version'
);

select is(
  (
    select algorithm
    from public.get_integration_runtime(
      'e2000000-0000-4000-8000-000000000001',
      'klaviyo',
      (select default_brand_id from public.organizations where id = 'e2000000-0000-4000-8000-000000000001')
    )
  ),
  'A256GCM',
  'service runtime round-trips the envelope algorithm'
);

select is(
  public.enqueue_integration_sync_job(
    (select id from public.integration_connections where integration_type = 'klaviyo'),
    'outbound',
    'profiles',
    'member',
    'e3000000-0000-4000-8000-000000000001',
    'sync:shared:key',
    '{}',
    '{"member_id":"e3000000-0000-4000-8000-000000000001"}'
  ),
  public.enqueue_integration_sync_job(
    (select id from public.integration_connections where integration_type = 'klaviyo'),
    'outbound',
    'profiles',
    'member',
    'e3000000-0000-4000-8000-000000000001',
    'sync:shared:key',
    '{}',
    '{"member_id":"e3000000-0000-4000-8000-000000000001"}'
  ),
  'the same connection and idempotency key returns the existing job'
);

select throws_ok(
  $$
    select public.enqueue_integration_sync_job(
      (select id from public.integration_connections where integration_type = 'klaviyo'),
      'outbound',
      'profiles',
      'member',
      'e3000000-0000-4000-8000-000000000001',
      'sync:pii:blocked',
      '{}',
      '{"nested":{"email":"raw@example.test"}}'
    )
  $$,
  '23514',
  null,
  'integration queues reject nested raw PII'
);

create temporary table claimed_integration_job as
select *
from public.claim_integration_sync_jobs('phase5-worker', 1, 120, now());

select is(
  (select count(*) from claimed_integration_job),
  1::bigint,
  'worker atomically claims one eligible job'
);
select ok(
  (select lease_token from claimed_integration_job) <> (
    select lease_token_hash
    from public.integration_sync_jobs
    where id = (select job_id from claimed_integration_job)
  ),
  'the worker receives a raw lease while the database stores only its hash'
);

select throws_ok(
  $$
    select public.complete_integration_sync_job(
      (select job_id from claimed_integration_job),
      'wrong-lease',
      'synced'
    )
  $$,
  '42501',
  'Invalid or expired integration job lease.',
  'wrong integration lease cannot complete a job'
);

update public.integration_sync_jobs
set lease_expires_at = now() - interval '1 second'
where id = (select job_id from claimed_integration_job);

update public.integration_sync_jobs
set next_attempt_at = now() + interval '1 hour'
where id <> (select job_id from claimed_integration_job)
  and status in ('queued', 'retry');

select throws_ok(
  $$
    select public.complete_integration_sync_job(
      (select job_id from claimed_integration_job),
      (select lease_token from claimed_integration_job),
      'synced'
    )
  $$,
  '42501',
  'Invalid or expired integration job lease.',
  'an otherwise valid but stale integration lease cannot complete a job'
);

create temporary table reclaimed_integration_job as
select *
from public.claim_integration_sync_jobs('phase5-recovery-worker', 1, 120, now());

select is(
  (select job_id from reclaimed_integration_job),
  (select job_id from claimed_integration_job),
  'an expired integration lease is reclaimed with a fresh one-use token'
);

select lives_ok(
  $$
    select public.complete_integration_sync_job(
      (select job_id from reclaimed_integration_job),
      (select lease_token from reclaimed_integration_job),
      'synced',
      1,
      1,
      0,
      '{"page":1}',
      null,
      25,
      null
    )
  $$,
  'valid integration lease completes the job'
);

select throws_ok(
  $$
    update public.integration_sync_logs set records_written = 99
  $$,
  '55000',
  'This audit table is append-only.',
  'integration sync logs are append-only'
);

insert into public.brands (
  id, organization_id, name, slug, billing_mode, stripe_customer_id
)
values (
  'e4000000-0000-4000-8000-000000000002',
  'e2000000-0000-4000-8000-000000000001',
  'Sibling Brand',
  'sibling-brand',
  'independent',
  'cus_Phase5Sibling'
);

select lives_ok(
  $$
    select *
    from public.apply_brand_subscription_event(
      'evt_Phase5SiblingActive',
      'customer.subscription.updated',
      'e2000000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000002',
      'cus_Phase5Sibling',
      now(),
      '{"livemode":false}'::jsonb,
      false,
      'sub_Phase5Sibling',
      'active',
      'estate'
    )
  $$,
  'an independent brand Stripe webhook is persisted and applied'
);
select is(
  (
    select subscription_status::text
    from public.brands
    where id = 'e4000000-0000-4000-8000-000000000002'
  ),
  'active',
  'independent billing updates only the target brand subscription state'
);
select is(
  (
    select brand_id
    from public.subscription_events
    where stripe_event_id = 'evt_Phase5SiblingActive'
  ),
  'e4000000-0000-4000-8000-000000000002'::uuid,
  'independent subscription events persist their concrete brand'
);
select is(
  (
    select duplicate
    from public.apply_brand_subscription_event(
      'evt_Phase5SiblingActive',
      'customer.subscription.updated',
      'e2000000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000002',
      'cus_Phase5Sibling',
      now(),
      '{"livemode":false}'::jsonb,
      false,
      'sub_Phase5Sibling',
      'active',
      'estate'
    )
  ),
  true,
  'independent brand Stripe webhook replay is idempotent'
);

insert into public.integration_connections (
  id, organization_id, brand_id, integration_type, status, opted_in, consented_at
)
values (
  'e5000000-0000-4000-8000-000000000002',
  'e2000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000002',
  'klaviyo',
  'active',
  true,
  now()
);
select public.store_integration_credentials(
  'e5000000-0000-4000-8000-000000000002',
  'external_reference',
  null,
  null,
  null,
  null,
  null,
  'vault://vinifera/klaviyo/sibling'
);
select public.set_integration_health(
  'e5000000-0000-4000-8000-000000000002',
  'active',
  null
);

select ok(
  public.enqueue_integration_sync_job(
    'e5000000-0000-4000-8000-000000000002',
    'outbound',
    'profiles',
    'member',
    'external-2',
    'sync:shared:key'
  ) <> (select job_id from claimed_integration_job),
  'sibling-brand connections may reuse a provider idempotency key without collision'
);

insert into public.integration_connections (
  id, organization_id, brand_id, integration_type, status, opted_in, consented_at
)
values (
  'e5000000-0000-4000-8000-000000000003',
  'e2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'e2000000-0000-4000-8000-000000000001'),
  'meta',
  'active',
  true,
  now()
);
select public.store_integration_credentials(
  'e5000000-0000-4000-8000-000000000003',
  'external_reference',
  null,
  null,
  null,
  null,
  null,
  'vault://vinifera/meta/default'
);
select public.set_integration_health(
  'e5000000-0000-4000-8000-000000000003',
  'active',
  null
);

select throws_ok(
  $$
    select public.enqueue_meta_conversion_event(
      'e5000000-0000-4000-8000-000000000003',
      'e3000000-0000-4000-8000-000000000001',
      'meta-event-0001',
      'Purchase',
      now(),
      '{"em":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'
    )
  $$,
  '42501',
  'Active Meta consent is required.',
  'Meta events cannot queue without member consent'
);

select public.set_member_meta_consent(
  'e2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'e2000000-0000-4000-8000-000000000001'),
  'e3000000-0000-4000-8000-000000000001',
  true,
  'member_portal',
  '2026-07'
);

select is(
  (
    select count(*)
    from public.integration_sync_jobs
    where sync_type = 'meta.event.lead'
      and entity_id = 'e3000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'granting Meta consent durably queues the member Lead event'
);

insert into public.integration_connections (
  id, organization_id, brand_id, integration_type, opted_in, consented_at
)
values (
  'e5000000-0000-4000-8000-000000000004',
  'e2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'e2000000-0000-4000-8000-000000000001'),
  'quickbooks',
  true,
  now()
);
select public.store_integration_credentials(
  'e5000000-0000-4000-8000-000000000004',
  'external_reference',
  null,
  null,
  null,
  null,
  null,
  'vault://vinifera/quickbooks/default'
);
select public.set_integration_health(
  'e5000000-0000-4000-8000-000000000004',
  'active',
  null
);

insert into public.club_tiers (
  id, organization_id, name, price_cents, bottle_count, frequency
)
values (
  'e9000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'Integration Estate',
  12000,
  3,
  'quarterly'
);
insert into public.releases (
  id, organization_id, name, processing_date, embargo_date, status, created_by
)
values (
  'ea000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'Integration Release',
  current_date + 2,
  current_date,
  'scheduled',
  'e1000000-0000-4000-8000-000000000001'
);
insert into public.release_tiers (
  id, organization_id, release_id, tier_id
)
values (
  'eb000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'ea000000-0000-4000-8000-000000000001',
  'e9000000-0000-4000-8000-000000000001'
);
insert into public.shipments (
  id, organization_id, member_id, release_id, release_tier_id, tier_id,
  shipping_address, charge_amount_cents
)
values (
  'ec000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'ea000000-0000-4000-8000-000000000001',
  'eb000000-0000-4000-8000-000000000001',
  'e9000000-0000-4000-8000-000000000001',
  '{"line1":"1 Durable Outbox Way"}',
  12000
);
update public.shipments
set tax_amount_cents = 725
where id = 'ec000000-0000-4000-8000-000000000001';

select lives_ok(
  $$
    select public.record_billing_attempt(
      'e2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'e2000000-0000-4000-8000-000000000001'),
      'ec000000-0000-4000-8000-000000000001',
      'charge',
      12725,
      'phase5:tax-inclusive:charge'
    )
  $$,
  'brand-scoped billing accepts the exact discounted subtotal plus tax'
);

select throws_ok(
  $$
    select public.record_billing_attempt(
      'e2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'e2000000-0000-4000-8000-000000000001'),
      'ec000000-0000-4000-8000-000000000001',
      'retry',
      12000,
      'phase5:pretax:rejected'
    )
  $$,
  '22023',
  'Charge amount must match the net shipment amount plus tax.',
  'brand-scoped billing rejects a pre-tax amount when tax is due'
);
update public.shipments
set
  status = 'charged',
  stripe_charge_id = 'ch_Phase5Shipment1',
  paid_at = now()
where id = 'ec000000-0000-4000-8000-000000000001';

select is(
  (
    select count(*)
    from public.integration_sync_jobs
    where sync_type = 'quickbooks.transaction.upsert'
      and entity_id = 'ec000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'a successful shipment charge durably queues QuickBooks reconciliation'
);
select is(
  (
    select count(*)
    from public.integration_sync_jobs
    where sync_type = 'meta.event.purchase'
      and entity_id = 'ec000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'a consented successful shipment charge durably queues a Meta Purchase event'
);

insert into public.member_activity_events (
  id, organization_id, member_id, event_type, source_entity_type,
  source_entity_id, idempotency_key, occurred_at
)
values (
  'ed000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'referral_completed',
  'referral',
  'ec000000-0000-4000-8000-000000000001',
  'phase5:referral:0001',
  now()
);
select is(
  (
    select count(*)
    from public.integration_sync_jobs
    where sync_type = 'meta.event.referral'
      and entity_id = 'ed000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'a consented referral completion durably queues a Meta Referral event'
);

select lives_ok(
  $$
    select public.enqueue_meta_conversion_event(
      'e5000000-0000-4000-8000-000000000003',
      'e3000000-0000-4000-8000-000000000001',
      'meta-event-0001',
      'Purchase',
      now(),
      '{"em":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
      '{"value_cents":12000}'
    )
  $$,
  'consented Meta event queues with hashes only'
);

select throws_ok(
  $$
    select public.enqueue_meta_conversion_event(
      'e5000000-0000-4000-8000-000000000003',
      'e3000000-0000-4000-8000-000000000001',
      'meta-event-0002',
      'Purchase',
      now(),
      '{"em":"raw@example.test"}'
    )
  $$,
  '23514',
  null,
  'Meta events reject raw user data'
);

select lives_ok(
  $$
    select public.register_mobile_auth_exchange(
      repeat('1', 64),
      'e1000000-0000-4000-8000-000000000002',
      'e2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'e2000000-0000-4000-8000-000000000001'),
      repeat('2', 64),
      null,
      repeat('3', 64),
      now() + interval '5 minutes'
    )
  $$,
  'pre-auth mobile exchange binds a stable device fingerprint without a device row'
);

select is(
  (
    select count(*)
    from public.consume_mobile_auth_exchange(
      repeat('1', 64),
      repeat('2', 64),
      repeat('9', 64),
      null,
      now()
    )
  ),
  0::bigint,
  'mobile exchange rejects a redirect URI hash mismatch without consuming the code'
);

select is(
  (
    select count(*)
    from public.consume_mobile_auth_exchange(
      repeat('1', 64),
      repeat('2', 64),
      repeat('3', 64),
      null,
      now()
    )
  ),
  1::bigint,
  'mobile exchange token is consumed once with matching fingerprint and redirect URI'
);
select is(
  (
    select count(*)
    from public.consume_mobile_auth_exchange(
      repeat('1', 64),
      repeat('2', 64),
      repeat('3', 64),
      null,
      now()
    )
  ),
  0::bigint,
  'mobile exchange replay returns no session context'
);

insert into public.mobile_devices (
  id, organization_id, brand_id, member_id, platform,
  device_fingerprint_hash, app_version
)
values (
  'e6000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'e2000000-0000-4000-8000-000000000001'),
  'e3000000-0000-4000-8000-000000000001',
  'ios',
  repeat('2', 64),
  '1.0.0'
);

select public.register_mobile_refresh_session(
  repeat('4', 64),
  'e1000000-0000-4000-8000-000000000002',
  'e2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'e2000000-0000-4000-8000-000000000001'),
  'e3000000-0000-4000-8000-000000000001',
  'e6000000-0000-4000-8000-000000000001',
  now() + interval '30 days',
  'e7000000-0000-4000-8000-000000000001'
);

select is(
  (
    select reuse_detected
    from public.rotate_mobile_refresh_session(
      repeat('4', 64),
      repeat('5', 64),
      now() + interval '30 days',
      now()
    )
  ),
  false,
  'first refresh rotates to a new hashed session'
);
select is(
  (
    select reuse_detected
    from public.rotate_mobile_refresh_session(
      repeat('4', 64),
      repeat('6', 64),
      now() + interval '30 days',
      now()
    )
  ),
  true,
  'reusing a rotated refresh token is detected'
);
select is(
  (
    select count(*)
    from public.mobile_refresh_sessions
    where family_id = 'e7000000-0000-4000-8000-000000000001'
      and revoked_at is not null
  ),
  2::bigint,
  'refresh reuse revokes the complete token family'
);

select public.store_mobile_push_token(
  'e6000000-0000-4000-8000-000000000001',
  'encrypted_envelope',
  1,
  'A256GCM',
  repeat('C', 32),
  repeat('D', 16),
  'v1',
  null
);

reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated","organization_id":"e2000000-0000-4000-8000-000000000001","user_role":"member","auth_surface":"member","platform_role":null}';

select throws_ok(
  $$
    insert into public.mobile_push_outbox (
      organization_id, brand_id, member_id, device_id,
      notification_type, title, body, idempotency_key
    )
    values (
      'e2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'e2000000-0000-4000-8000-000000000001'),
      'e3000000-0000-4000-8000-000000000001',
      'e6000000-0000-4000-8000-000000000001',
      'forged',
      'Forged notification',
      'Clients cannot enqueue push messages.',
      'push:forged:client'
    )
  $$,
  '42501',
  null,
  'authenticated members cannot write directly to the push delivery queue'
);

reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

insert into public.members (
  id, organization_id, brand_id, email, first_name, last_name
)
values (
  'e3000000-0000-4000-8000-000000000002',
  'e2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'e2000000-0000-4000-8000-000000000001'),
  'phase5-other-mobile-member@example.test',
  'Other',
  'Member'
);

insert into public.mobile_devices (
  id, organization_id, brand_id, member_id, platform,
  device_fingerprint_hash, app_version
)
values (
  'e6000000-0000-4000-8000-000000000002',
  'e2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'e2000000-0000-4000-8000-000000000001'),
  'e3000000-0000-4000-8000-000000000002',
  'ios',
  repeat('6', 64),
  '1.0.0'
);

select throws_ok(
  $$
    insert into public.mobile_push_outbox (
      organization_id, brand_id, member_id, device_id,
      notification_type, title, body, idempotency_key
    )
    values (
      'e2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'e2000000-0000-4000-8000-000000000001'),
      'e3000000-0000-4000-8000-000000000001',
      'e6000000-0000-4000-8000-000000000002',
      'forged',
      'Cross-member notification',
      'A push row cannot target another member device.',
      'push:forged:cross-member'
    )
  $$,
  '23503',
  null,
  'push delivery rows must target a device owned by the same member'
);

insert into public.mobile_push_outbox (
  id, organization_id, brand_id, member_id, device_id,
  notification_type, title, body, idempotency_key
)
values (
  'e8000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'e2000000-0000-4000-8000-000000000001'),
  'e3000000-0000-4000-8000-000000000001',
  'e6000000-0000-4000-8000-000000000001',
  'release_ready',
  'Release ready',
  'Your club release is ready.',
  'push:release:0001'
);

create temporary table claimed_push as
select *
from public.claim_mobile_push_messages('push-worker', 1, 120, now());

select ok(
  (select lease_token from claimed_push) <> (
    select lease_token_hash
    from public.mobile_push_outbox
    where id = 'e8000000-0000-4000-8000-000000000001'
  ),
  'push workers receive a raw one-use lease while only its hash is stored'
);
select lives_ok(
  $$
    select public.complete_mobile_push_message(
      'e8000000-0000-4000-8000-000000000001',
      (select lease_token from claimed_push),
      true,
      'apns-message-1'
    )
  $$,
  'valid push lease completes delivery'
);

select throws_ok(
  $$
    insert into public.brand_custom_domains (
      organization_id, brand_id, hostname, status,
      provider_hostname_id, hostname_status, ssl_status,
      dns_record_type, dns_record_name, dns_record_value,
      dns_challenge_hash, verified_at
    ) values (
      'e2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'e2000000-0000-4000-8000-000000000001'),
      'club.invalid-cert.example',
      'active',
      'provider-host-1',
      'active',
      'pending',
      'TXT',
      '_cf-custom-hostname.club.invalid-cert.example',
      'validation-value',
      repeat('7', 64),
      now()
    )
  $$,
  '23514',
  null,
  'custom domain cannot activate before both hostname and certificate are active'
);

insert into public.brand_custom_domains (
  organization_id, brand_id, hostname, status,
  provider_hostname_id, hostname_status, ssl_status,
  dns_record_type, dns_record_name, dns_record_value,
  dns_challenge_hash, verified_at
)
values (
  'e2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'e2000000-0000-4000-8000-000000000001'),
  'club.phase5-example.test',
  'active',
  'provider-host-2',
  'active',
  'active',
  'TXT',
  '_cf-custom-hostname.club.phase5-example.test',
  'validation-value',
  repeat('8', 64),
  now()
);

select is(
  (
    select count(*)
    from public.resolve_custom_domain('club.phase5-example.test')
  ),
  1::bigint,
  'only fully active hostname and certificate state resolves white-label branding'
);

select * from finish();
rollback;
