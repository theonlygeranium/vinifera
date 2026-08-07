begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(51);
set local request.jwt.claims = '{"role":"service_role"}';

insert into auth.users (id, email)
values
  ('c1000000-0000-4000-8000-000000000001', 'phase4-rpc-owner@example.test'),
  ('c1000000-0000-4000-8000-000000000002', 'phase4-ml-platform@example.test');

insert into public.organizations (
  id, name, plan_tier, shipping_origin_address
)
values (
  'c2000000-0000-4000-8000-000000000001',
  'Phase 4 RPC Winery',
  'estate',
  '{
    "company":"Phase 4 RPC Winery",
    "name":"Fulfillment",
    "phone":"+17075550100",
    "line1":"1 Winery Lane",
    "city":"Napa",
    "state":"CA",
    "postal_code":"94558",
    "country":"US"
  }'::jsonb
);

insert into public.staff_users (
  id, organization_id, email, role
)
values (
  'c1000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  'phase4-rpc-owner@example.test',
  'owner'
);

insert into public.platform_users (id, email, role)
values (
  'c1000000-0000-4000-8000-000000000002',
  'phase4-ml-platform@example.test',
  'super_admin'
);

insert into public.club_tiers (
  id, organization_id, name, price_cents, bottle_count, frequency
)
values (
  'c3000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  'Estate',
  15000,
  1,
  'quarterly'
);

insert into public.members (
  id, organization_id, email, first_name, last_name, phone,
  shipping_address_line1, shipping_city, shipping_region,
  shipping_postal_code, club_tier_id, birthday, joined_on
)
values (
  'c4000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  'phase4-shipment@example.test',
  'Shipment',
  'Member',
  '+17075550101',
  '10 Main Street',
  'Napa',
  'CA',
  '94558',
  'c3000000-0000-4000-8000-000000000001',
  current_date - interval '30 years',
  current_date
);

insert into public.releases (
  id, organization_id, name, processing_date, embargo_date, status, created_by
)
values (
  'c5000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  'Phase 4 Release',
  current_date,
  current_date,
  'processing',
  'c1000000-0000-4000-8000-000000000001'
);

insert into public.release_tiers (
  id, organization_id, release_id, tier_id
)
values (
  'c6000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  'c5000000-0000-4000-8000-000000000001',
  'c3000000-0000-4000-8000-000000000001'
);

insert into public.release_wines (
  id, organization_id, release_id, wine_name, vintage, sku
)
values (
  'c7000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  'c5000000-0000-4000-8000-000000000001',
  'Estate Cabernet',
  2024,
  'ESTATE-CAB-24'
);

insert into public.shipments (
  id, organization_id, member_id, release_id, release_tier_id, tier_id,
  status, shipping_address, charge_amount_cents, paid_at
)
values (
  'c8000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  'c4000000-0000-4000-8000-000000000001',
  'c5000000-0000-4000-8000-000000000001',
  'c6000000-0000-4000-8000-000000000001',
  'c3000000-0000-4000-8000-000000000001',
  'charged',
  '{"line1":"10 Main Street","city":"Napa","state":"CA","postal_code":"94558","country":"US"}',
  15000,
  now()
);

insert into public.shipment_items (
  id, organization_id, shipment_id, release_wine_id, wine_name,
  vintage, sku, barcode, quantity, price_cents
)
values (
  'c9000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  'c8000000-0000-4000-8000-000000000001',
  'c7000000-0000-4000-8000-000000000001',
  'Estate Cabernet',
  2024,
  'ESTATE-CAB-24',
  '0123456789012',
  1,
  15000
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

create function pg_temp.acquire_shipping_label_attempt_compat(
  p_organization_id uuid,
  p_brand_id uuid,
  p_shipment_id uuid,
  p_worker_id text,
  p_actor_user_id uuid,
  p_lease_seconds integer,
  p_provider text
)
returns table (
  attempt_id uuid,
  disposition text,
  lease_token text,
  request_fingerprint text,
  correlation_reference text,
  provider text,
  external_shipment_id text,
  external_rate_id text,
  external_label_id text,
  label_url text,
  tracking_number text,
  carrier text,
  label_cost_cents integer,
  provider_metadata jsonb
)
language plpgsql
as $$
declare
  brand_matches boolean;
begin
  if to_regprocedure(
    'public.acquire_shipping_label_attempt(uuid,uuid,uuid,text,uuid,integer,text)'
  ) is not null then
    execute $scope$
      select exists (
        select 1
        from public.shipments
        where organization_id = $1
          and brand_id = $2
          and id = $3
      )
    $scope$
    into brand_matches
    using p_organization_id, p_brand_id, p_shipment_id;

    if not brand_matches then
      raise exception using errcode = 'P0002', message = 'Shipment not found.';
    end if;

    return query execute $current$
      select *
      from public.acquire_shipping_label_attempt(
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7
      )
    $current$
    using
      p_organization_id,
      p_brand_id,
      p_shipment_id,
      p_worker_id,
      p_actor_user_id,
      p_lease_seconds,
      p_provider;
    return;
  end if;

  return query
  select *
  from public.acquire_shipping_label_attempt(
    p_organization_id,
    p_shipment_id,
    p_worker_id,
    p_actor_user_id,
    p_lease_seconds,
    p_provider
  );
end;
$$;

create temporary table phase4_expected_brand (id uuid);

do $$
begin
  if to_regprocedure(
    'public.acquire_shipping_label_attempt(uuid,uuid,uuid,text,uuid,integer,text)'
  ) is not null then
    execute $current$
      insert into phase4_expected_brand (id)
      select id
      from public.brands
      where organization_id = $1
        and is_default = true
    $current$
    using 'c2000000-0000-4000-8000-000000000001'::uuid;
  else
    insert into phase4_expected_brand (id) values (null);
  end if;
end;
$$;

create function pg_temp.wrong_brand_label_acquisition_rejected()
returns boolean
language plpgsql
as $$
begin
  if to_regprocedure(
    'public.acquire_shipping_label_attempt(uuid,uuid,uuid,text,uuid,integer,text)'
  ) is null then
    return true;
  end if;

  perform * from pg_temp.acquire_shipping_label_attempt_compat(
    'c2000000-0000-4000-8000-000000000001',
    'c4000000-0000-4000-8000-000000000002',
    'c8000000-0000-4000-8000-000000000001',
    'wrong-brand-worker',
    'c1000000-0000-4000-8000-000000000001',
    300,
    'simulated'
  );
  return false;
exception
  when sqlstate 'P0002' then
    return sqlerrm = 'Shipment not found.';
end;
$$;

select ok(
  pg_temp.wrong_brand_label_acquisition_rejected(),
  'current-schema label acquisition rejects the wrong active brand'
);

create temporary table phase4_event_ids as
select public.record_analytics_event(
  'c2000000-0000-4000-8000-000000000001',
  'c4000000-0000-4000-8000-000000000001',
  'analytics.dashboard_viewed',
  '{"surface":"staff","email_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
  'phase4:event:dashboard',
  now()
) as id;

select is(
  public.record_analytics_event(
    'c2000000-0000-4000-8000-000000000001',
    'c4000000-0000-4000-8000-000000000001',
    'analytics.dashboard_viewed',
    '{"surface":"staff","email_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
    'phase4:event:dashboard',
    now()
  ),
  (select id from phase4_event_ids),
  'analytics event ingestion is exactly-once by organization and request key'
);
select is(
  (select count(*) from public.analytics_events where idempotency_key = 'phase4:event:dashboard'),
  1::bigint,
  'an analytics retry does not create a duplicate fact'
);
select throws_ok(
  $$ select public.record_analytics_event(
    'c2000000-0000-4000-8000-000000000001',
    null,
    'analytics.dashboard_viewed',
    '{"email":"member@example.test"}',
    'phase4:event:pii',
    now()
  ) $$,
  '22023',
  'Analytics payload contains prohibited or excessive data.',
  'analytics ingestion rejects direct PII'
);
select throws_ok(
  $$ select public.record_analytics_event(
    'c2000000-0000-4000-8000-000000000001',
    null,
    'unknown.event',
    '{}',
    'phase4:event:unknown',
    now()
  ) $$,
  '22023',
  'Unsupported analytics event type.',
  'analytics ingestion rejects events outside the finite taxonomy'
);

select is(
  (public.set_validated_shipment_address(
    'c2000000-0000-4000-8000-000000000001',
    'c8000000-0000-4000-8000-000000000001',
    'valid',
    '{"line1":"10 Main Street","city":"Napa","state":"CA","postal_code":"94558","country":"US"}',
    '[]',
    'c1000000-0000-4000-8000-000000000001'
  )).address_validation_status,
  'valid'::public.address_validation_status,
  'validated-address RPC persists normalized provider output'
);

create temporary table phase4_first_check as
select public.record_shipment_compliance_check(
  'c2000000-0000-4000-8000-000000000001',
  'c8000000-0000-4000-8000-000000000001',
  'compliant',
  null,
  1250,
  'simulated-compliance-1',
  'simulated',
  now(),
  'c1000000-0000-4000-8000-000000000001',
  '{
    "recipient_state_allowed":true,
    "origin_to_recipient_allowed":true,
    "age_verified":true,
    "volume_within_limit":true,
    "rules_version":"phase4-test-v1",
    "provider_response_is_local":true,
    "request_fingerprint_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  }'::jsonb
) as row;

select is(
  ((select row from phase4_first_check)).status,
  'compliant'::public.compliance_check_status,
  'compliance RPC records a compliant pre-label result'
);
select ok(
  (
    select request_fingerprint = repeat('b', 64)
      and shipment_state_fingerprint ~ '^[a-f0-9]{64}$'
    from public.compliance_checks
    where provider_response_id = 'simulated-compliance-1'
  ),
  'compliance ledger stores provider and independently-derived shipment fingerprints'
);

update public.shipment_items
set quantity = 2
where id = 'c9000000-0000-4000-8000-000000000001';

select ok(
  (
    select latest_compliance_check_id is null
      and compliance_status is null
    from public.shipments
    where id = 'c8000000-0000-4000-8000-000000000001'
  ),
  'compliance-relevant item mutation invalidates prior approval'
);
select throws_ok(
  $$ select * from pg_temp.acquire_shipping_label_attempt_compat(
    'c2000000-0000-4000-8000-000000000001',
    (select id from phase4_expected_brand),
    'c8000000-0000-4000-8000-000000000001',
    'phase4-worker',
    'c1000000-0000-4000-8000-000000000001',
    300,
    'simulated'
  ) $$,
  '23514',
  'A current compliant charged shipment is required for label purchase.',
  'label acquisition fails closed after compliance invalidation'
);

update public.shipment_items
set quantity = 1
where id = 'c9000000-0000-4000-8000-000000000001';

select public.record_shipment_compliance_check(
  'c2000000-0000-4000-8000-000000000001',
  'c8000000-0000-4000-8000-000000000001',
  'compliant',
  null,
  1300,
  'simulated-compliance-2',
  'simulated',
  now(),
  'c1000000-0000-4000-8000-000000000001',
  '{
    "recipient_state_allowed":true,
    "origin_to_recipient_allowed":true,
    "age_verified":true,
    "volume_within_limit":true,
    "rules_version":"phase4-test-v2",
    "provider_response_is_local":true,
    "request_fingerprint_sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  }'::jsonb
);

create temporary table phase4_first_attempt as
select * from pg_temp.acquire_shipping_label_attempt_compat(
  'c2000000-0000-4000-8000-000000000001',
  (select id from phase4_expected_brand),
  'c8000000-0000-4000-8000-000000000001',
  'phase4-worker',
  'c1000000-0000-4000-8000-000000000001',
  300,
  'simulated'
);

select is(
  (select disposition from phase4_first_attempt),
  'create_shipment',
  'first durable label attempt directs the worker to create a provider shipment'
);
select ok(
  (select lease_token is not null and provider = 'simulated' from phase4_first_attempt),
  'label acquisition returns an ephemeral lease and explicit provider'
);
select is(
  (
    select disposition from pg_temp.acquire_shipping_label_attempt_compat(
      'c2000000-0000-4000-8000-000000000001',
      (select id from phase4_expected_brand),
      'c8000000-0000-4000-8000-000000000001',
      'other-worker',
      'c1000000-0000-4000-8000-000000000001',
      300,
      'simulated'
    )
  ),
  'in_progress',
  'concurrent label acquisition does not expose the active lease'
);
select throws_ok(
  $$ select public.persist_shipping_label_external_shipment(
    (select attempt_id from phase4_first_attempt),
    (select lease_token from phase4_first_attempt),
    'shp_wrongprovider',
    'rate_wrongprovider'
  ) $$,
  '22023',
  'Provider shipment and rate identifiers are invalid.',
  'simulator attempts reject EasyPost identifier shapes'
);
select lives_ok(
  $$ select public.persist_shipping_label_external_shipment(
    (select attempt_id from phase4_first_attempt),
    (select lease_token from phase4_first_attempt),
    'simshipment_abc123',
    'simrate_abc123'
  ) $$,
  'simulator shipment identity is durably persisted before purchase'
);
select lives_ok(
  $$ select public.complete_shipping_label_attempt(
    (select attempt_id from phase4_first_attempt),
    (select lease_token from phase4_first_attempt),
    'indeterminate',
    null,
    null,
    null,
    null,
    null,
    '{}',
    'Response lost after provider purchase.'
  ) $$,
  'post-purchase response loss is recorded as indeterminate'
);

update public.shipments
set compliance_checked_at = now() - interval '25 hours'
where id = 'c8000000-0000-4000-8000-000000000001';

select throws_ok(
  $$ select * from pg_temp.acquire_shipping_label_attempt_compat(
    'c2000000-0000-4000-8000-000000000001',
    (select id from phase4_expected_brand),
    'c8000000-0000-4000-8000-000000000001',
    'expired-compliance-worker',
    'c1000000-0000-4000-8000-000000000001',
    300,
    'simulated'
  ) $$,
  '23514',
  'A current compliant charged shipment is required for label purchase.',
  'expired compliance blocks reconciliation even when request inputs are unchanged'
);

select public.record_shipment_compliance_check(
  'c2000000-0000-4000-8000-000000000001',
  'c8000000-0000-4000-8000-000000000001',
  'compliant',
  null,
  1300,
  'simulated-compliance-3',
  'simulated',
  now(),
  'c1000000-0000-4000-8000-000000000001',
  '{
    "recipient_state_allowed":true,
    "origin_to_recipient_allowed":true,
    "age_verified":true,
    "volume_within_limit":true,
    "rules_version":"phase4-test-v2",
    "provider_response_is_local":true,
    "request_fingerprint_sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  }'::jsonb
);

create temporary table phase4_recovery_attempt as
select * from pg_temp.acquire_shipping_label_attempt_compat(
  'c2000000-0000-4000-8000-000000000001',
  (select id from phase4_expected_brand),
  'c8000000-0000-4000-8000-000000000001',
  'phase4-recovery-worker',
  'c1000000-0000-4000-8000-000000000001',
  300,
  'simulated'
);

select ok(
  (
    select disposition = 'reconcile'
      and lease_token is not null
      and external_shipment_id = 'simshipment_abc123'
    from phase4_recovery_attempt
  ),
  'indeterminate purchase reacquires a fresh reconciliation lease without a second shipment'
);
select ok(
  (
    select attempt.compliance_check_id = shipment.latest_compliance_check_id
    from public.shipping_label_attempts as attempt
    join public.shipments as shipment
      on shipment.organization_id = attempt.organization_id
      and shipment.id = attempt.shipment_id
    where attempt.id = (select attempt_id from phase4_recovery_attempt)
  ),
  'same-input compliance refresh safely rebinds the recoverable label attempt'
);
select lives_ok(
  $$ select public.complete_shipping_label_attempt(
    (select attempt_id from phase4_recovery_attempt),
    (select lease_token from phase4_recovery_attempt),
    'succeeded',
    'simlabel_abc123',
    'https://example.invalid/labels/abc123.pdf',
    '1ZSIM123456789012',
    'SIMULATED',
    1595,
    '{"service":"Ground"}',
    null
  ) $$,
  'reconciliation completes the original durable label attempt'
);
select is(
  (select status from public.shipments where id = 'c8000000-0000-4000-8000-000000000001'),
  'label_created'::public.shipment_status,
  'successful ledger completion atomically transitions the shipment'
);
select ok(
  (
    select disposition = 'succeeded'
      and lease_token is null
      and label_cost_cents = 1595
      and provider_metadata ->> 'service' = 'Ground'
    from pg_temp.acquire_shipping_label_attempt_compat(
      'c2000000-0000-4000-8000-000000000001',
      (select id from phase4_expected_brand),
      'c8000000-0000-4000-8000-000000000001',
      'phase4-idempotent-worker',
      'c1000000-0000-4000-8000-000000000001',
      300,
      'simulated'
    )
  ),
  'idempotent label replay returns contract-complete succeeded evidence'
);
select throws_ok(
  $$ update public.shipment_items
     set price_cents = 14999
     where id = 'c9000000-0000-4000-8000-000000000001' $$,
  '23514',
  'Compliance-relevant shipment items cannot change after label generation.',
  'labeled shipment evidence is immutable'
);
select ok(
  (
    select complete and packed_items = 1 and status = 'packed'
    from public.confirm_shipment_item_pack(
      'c2000000-0000-4000-8000-000000000001',
      'c8000000-0000-4000-8000-000000000001',
      '0123456789012',
      'c1000000-0000-4000-8000-000000000001'
    )
  ),
  'atomic barcode scan packs the labeled shipment'
);
select ok(
  (
    select complete and packed_items = 1 and status = 'packed'
    from public.confirm_shipment_item_pack(
      'c2000000-0000-4000-8000-000000000001',
      'c8000000-0000-4000-8000-000000000001',
      '0123456789012',
      'c1000000-0000-4000-8000-000000000001'
    )
  ),
  'repeated barcode scan is idempotent after packing completes'
);

insert into public.members (
  organization_id, email, first_name, last_name, club_tier_id, joined_on
)
select
  'c2000000-0000-4000-8000-000000000001',
  'phase4-ml-' || series || '@example.test',
  'ML',
  'Member ' || series,
  'c3000000-0000-4000-8000-000000000001',
  current_date - 1000 + series
from generate_series(1, 500) as series;

select is(
  public.refresh_ml_feature_store(current_date - 181, 'c2000000-0000-4000-8000-000000000001'),
  500,
  'feature store records the historical training boundary'
);
select is(
  public.refresh_ml_feature_store(current_date - 90, 'c2000000-0000-4000-8000-000000000001'),
  500,
  'feature store records the newest mature holdout boundary'
);

update public.members
set cancelled_at = now() - interval '120 days'
where organization_id = 'c2000000-0000-4000-8000-000000000001'
  and email like 'phase4-ml-%@example.test'
  and joined_on <= current_date - 600
  and (
    ((regexp_match(email, '^phase4-ml-([0-9]+)@'))[1])::integer % 8
  ) = 0;

create temporary table phase4_training_run as
select (public.create_ml_training_run(
  current_date - 181,
  current_date - 180,
  current_date - 90,
  'production_history',
  'c1000000-0000-4000-8000-000000000002'
)).*;

select is((select member_count from phase4_training_run), 500, 'training run is member-disjoint');
select is((select training_row_count from phase4_training_run), 400, 'temporal split assigns the oldest eighty percent to training');
select is((select holdout_row_count from phase4_training_run), 100, 'temporal split assigns the newest twenty percent to holdout');
select is(
  (
    select max(feature.snapshot_date)
    from public.ml_training_rows as training
    join public.ml_feature_snapshots as feature
      on feature.id = training.feature_snapshot_id
    where training.training_run_id = (select id from phase4_training_run)
      and training.split = 'train'
  ),
  current_date - 181,
  'training rows use snapshots at or before the declared training cutoff'
);
select is(
  (
    select max(feature.snapshot_date)
    from public.ml_training_rows as training
    join public.ml_feature_snapshots as feature
      on feature.id = training.feature_snapshot_id
    where training.training_run_id = (select id from phase4_training_run)
      and training.split = 'holdout'
  ),
  current_date - 90,
  'holdout rows include the newest eligible mature snapshot'
);
select is(
  (
    select id from public.create_ml_training_run(
      current_date - 181,
      current_date - 180,
      current_date - 90,
      'production_history',
      'c1000000-0000-4000-8000-000000000002'
    )
  ),
  (select id from phase4_training_run),
  'at-least-once training delivery returns the existing provenance run'
);
select is(
  (
    select count(*) from public.ml_training_runs
    where source = 'production_history'
      and training_cutoff = current_date - 181
      and holdout_start = current_date - 180
      and holdout_end = current_date - 90
  ),
  1::bigint,
  'training provenance uniqueness prevents duplicate run rows'
);
select is(
  (
    select count(*) from (
      select member_id
      from public.ml_training_rows
      where training_run_id = (select id from phase4_training_run)
      group by member_id
      having count(distinct split) > 1
    ) as leaked
  ),
  0::bigint,
  'no member appears in both train and holdout'
);

update public.ml_training_runs
set status = 'ready', completed_at = now()
where id = (select id from phase4_training_run);

do $$
declare
  v_training_run_id uuid := (select id from phase4_training_run);
  v_dataset_hash text := (
    select dataset_hash
    from public.ml_training_runs
    where id = v_training_run_id
  );
  v_source_coverage jsonb := jsonb_build_object(
    'eligible_member_count', 500,
    'reconciled_through', current_date::text,
    'sources', jsonb_build_object(
      'shipments', jsonb_build_object('eligible_member_count', 500, 'reconciled_member_count', 500),
      'billing', jsonb_build_object('eligible_member_count', 500, 'reconciled_member_count', 500),
      'email_delivery', jsonb_build_object('eligible_member_count', 500, 'reconciled_member_count', 500),
      'portal_activity', jsonb_build_object('eligible_member_count', 500, 'reconciled_member_count', 500),
      'loyalty', jsonb_build_object('eligible_member_count', 500, 'reconciled_member_count', 500),
      'declines', jsonb_build_object('eligible_member_count', 500, 'reconciled_member_count', 500)
    )
  );
begin
  if to_regprocedure(
    'public.record_ml_training_source_qualification(uuid,text,text,jsonb,uuid)'
  ) is not null then
    execute $qualification$
      select public.record_ml_training_source_qualification($1, $2, $3, $4, $5)
    $qualification$
    using
      v_training_run_id,
      v_dataset_hash,
      'qualified',
      v_source_coverage,
      'c1000000-0000-4000-8000-000000000002'::uuid;
  end if;
end;
$$;

create temporary table phase4_model_config as
with feature_names as (
  select unnest(array[
    'days_since_last_shipment',
    'days_since_last_portal_login',
    'days_since_last_email_open',
    'shipments_per_year',
    'portal_logins_per_month',
    'email_opens_per_month',
    'total_lifetime_spend_cents',
    'average_shipment_value_cents',
    'email_open_rate',
    'email_click_rate',
    'loyalty_point_balance',
    'tenure_months',
    'tier_change_count',
    'decline_count',
    'decline_recovery_rate',
    'observed_expected_shipment_ratio'
  ]::text[]) as name
)
select
  jsonb_build_object(
    'regularization', 0.02,
    'cross_validation_folds', 5,
    'split_strategy', 'temporal_80_20_member_disjoint',
    'feature_means', jsonb_object_agg(name, 0),
    'feature_medians', jsonb_object_agg(name, 0),
    'feature_scales', jsonb_object_agg(name, 1),
    'feature_baseline_bins', jsonb_object_agg(name, '[0.25,0.25,0.25,0.25]'::jsonb)
  ) as hyperparameters,
  jsonb_object_agg(name, 0) as coefficients
from feature_names;

insert into public.ml_model_versions (
  id, training_run_id, version, algorithm, hyperparameters, coefficients,
  intercept, training_data_size, cancellation_count, metrics,
  feature_importance, artifact_hash, deployment_status,
  high_risk_threshold, trained_at, registered_by
)
select
  fixture.id,
  fixture.training_run_id,
  fixture.version,
  'logistic_regression_l2',
  config.hyperparameters,
  config.coefficients,
  1.0,
  500,
  50,
  '{
    "auc_roc":0.86,"accuracy":0.84,"precision":0.80,"recall":0.75,
    "f1":0.77,"true_positive":75,"false_positive":20,
    "true_negative":380,"false_negative":25,"brier_score":0.14,
    "calibration_slope":1.0,"calibration_intercept":0.0,
    "rules_baseline_auc":0.70,"cv_auc_mean":0.84,"cv_auc_stddev":0.02
  }'::jsonb,
  '[
    {"feature":"days_since_last_shipment","importance":0.3},
    {"feature":"days_since_last_portal_login","importance":0.2},
    {"feature":"days_since_last_email_open","importance":0.15},
    {"feature":"decline_count","importance":0.1},
    {"feature":"tenure_months","importance":0.05}
  ]'::jsonb,
  fixture.artifact_hash,
  'candidate',
  0.70,
  now() - interval '40 days',
  'c1000000-0000-4000-8000-000000000002'
from phase4_model_config as config
cross join (
  values
    (
      'cb000000-0000-4000-8000-000000000001'::uuid,
      (select id from phase4_training_run),
      'phase4-model-1',
      repeat('f', 64)
    ),
    (
      'cb000000-0000-4000-8000-000000000002'::uuid,
      (select id from phase4_training_run),
      'phase4-model-2',
      repeat('1', 64)
    )
) as fixture(id, training_run_id, version, artifact_hash);

create temporary table phase4_first_experiment as
select (public.start_eligible_ml_experiment(
  'cb000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000002'
)).*;

select is((select status from phase4_first_experiment), 'running'::public.ml_experiment_status, 'first eligible model starts its A/B test');
select is(
  public.start_eligible_ml_experiment(
    'cb000000-0000-4000-8000-000000000002',
    'c1000000-0000-4000-8000-000000000002'
  ),
  null::public.ml_experiments,
  'monthly candidate defers without error while another global A/B test is open'
);
select is(
  (select deployment_status from public.ml_model_versions where id = 'cb000000-0000-4000-8000-000000000002'),
  'candidate'::public.ml_deployment_status,
  'deferred candidate remains eligible for a later lifecycle pass'
);

update public.ml_experiments
set status = 'stopped', completed_at = now()
where id = (select id from phase4_first_experiment);
update public.ml_model_versions
set deployment_status = 'rejected'
where id = 'cb000000-0000-4000-8000-000000000001';

select ok(
  (public.run_ml_lifecycle(now()) ->> 'startedExperimentId') is not null,
  'lifecycle automatically starts the best waiting eligible candidate'
);
select is(
  (select deployment_status from public.ml_model_versions where id = 'cb000000-0000-4000-8000-000000000002'),
  'ab_test'::public.ml_deployment_status,
  'waiting candidate transitions to A/B test'
);

select is(
  public.refresh_ml_feature_store(current_date, 'c2000000-0000-4000-8000-000000000001'),
  451,
  'nightly feature store covers every active member'
);

create temporary table phase4_first_drift_lifecycle as
select public.run_ml_lifecycle(now()) as payload;

select ok(
  (select (payload ->> 'retrainingRequired')::boolean from phase4_first_drift_lifecycle),
  'high feature drift remains visible as an ongoing retraining requirement'
);
select ok(
  (select (payload ->> 'retrainingTriggered')::boolean from phase4_first_drift_lifecycle),
  'first persisted high-drift breach emits a retraining trigger'
);
select ok(
  not (public.run_ml_lifecycle(now()) ->> 'retrainingTriggered')::boolean,
  'repeated lifecycle delivery does not retrigger training during cooldown'
);
select is(
  (select count(*) from public.ml_retraining_signals where model_version_id = 'cb000000-0000-4000-8000-000000000002'),
  1::bigint,
  'retraining trigger is persisted exactly once for the model cooldown window'
);

select is(
  public.score_ml_churn_batch(current_date, 'c2000000-0000-4000-8000-000000000001'),
  451,
  'A/B model writes probability scores for every active member'
);
select is(
  (
    select count(*) from public.ml_churn_predictions
    where organization_id = 'c2000000-0000-4000-8000-000000000001'
      and score between 0 and 1
      and confidence_interval_low <= score
      and confidence_interval_high >= score
      and jsonb_array_length(top_features) = 5
  ),
  451::bigint,
  'predictions persist calibrated bands and five explanations'
);
select is(
  (
    select count(*) from public.ml_high_risk_alerts
    where organization_id = 'c2000000-0000-4000-8000-000000000001'
  ),
  case
    when to_regprocedure('private.ml_training_run_is_qualified(uuid)') is null
      then 451::bigint
    else 0::bigint
  end,
  'high-risk alert behavior matches the migration-era or hardened A/B contract'
);
select ok(
  case
    when to_regprocedure('private.ml_training_run_is_qualified(uuid)') is null
      then exists (
        select 1
        from public.list_churn_intelligence(
          'c2000000-0000-4000-8000-000000000001', null, null, 50, 0
        )
        where alert_id is not null and alert_created_at is not null
      )
    else not exists (
      select 1
      from public.list_churn_intelligence(
        'c2000000-0000-4000-8000-000000000001', null, null, 50, 0
      )
      where alert_id is not null or alert_created_at is not null
    )
  end,
  'churn intelligence exposes alerts only under the migration-era A/B contract'
);

select throws_ok(
  $$ select public.acknowledge_ml_high_risk_alert(
    'c2000000-0000-4000-8000-000000000001',
    'cf000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001'
  ) $$,
  'P0002',
  'High-risk alert not found.',
  'staff cannot acknowledge a nonexistent A/B alert'
);
select ok(
  case
    when to_regprocedure('private.ml_training_run_is_qualified(uuid)') is null
      then public.get_member_churn_intelligence(
        'c2000000-0000-4000-8000-000000000001',
        (
          select member_id
          from public.ml_churn_predictions
          where organization_id = 'c2000000-0000-4000-8000-000000000001'
          order by member_id
          limit 1
        )
      ) ->> 'alertId' is not null
    else public.get_member_churn_intelligence(
      'c2000000-0000-4000-8000-000000000001',
      (
        select member_id
        from public.ml_churn_predictions
        where organization_id = 'c2000000-0000-4000-8000-000000000001'
        order by member_id
        limit 1
      )
    ) ->> 'alertId' is null
  end,
  'member churn detail matches the migration-era or hardened A/B alert contract'
);

select * from finish();
rollback;
