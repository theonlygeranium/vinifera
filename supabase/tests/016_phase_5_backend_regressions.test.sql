begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(50);

insert into auth.users (id, email)
values (
  'a1000000-0000-4000-8000-000000000001',
  'phase5-suspended-member@example.test'
);

insert into public.organizations (id, name, plan_tier, subscription_status)
values (
  'a2000000-0000-4000-8000-000000000001',
  'Phase 5 Backend Regression Winery',
  'reserve',
  'active'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

insert into public.brands (
  id,
  organization_id,
  name,
  slug,
  portal_title,
  billing_mode,
  access_status
)
values (
  'a3000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000001',
  'Suspended Independent Label',
  'suspended-independent-label',
  'Suspended Independent Label Club',
  'independent',
  'restricted'
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
values
  (
    'a4000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    (
      select default_brand_id
      from public.organizations
      where id = 'a2000000-0000-4000-8000-000000000001'
    ),
    'Active Estate',
    10000,
    3,
    'quarterly'
  ),
  (
    'a4000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000002',
    'Suspended Estate',
    10000,
    3,
    'quarterly'
  );

insert into public.members (
  id,
  auth_user_id,
  organization_id,
  brand_id,
  email,
  first_name,
  last_name,
  club_tier_id
)
values
  (
    'a5000000-0000-4000-8000-000000000001',
    null,
    'a2000000-0000-4000-8000-000000000001',
    (
      select default_brand_id
      from public.organizations
      where id = 'a2000000-0000-4000-8000-000000000001'
    ),
    'phase5-active-member@example.test',
    'Active',
    'Member',
    'a4000000-0000-4000-8000-000000000001'
  ),
  (
    'a5000000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000002',
    'phase5-suspended-member@example.test',
    'Suspended',
    'Member',
    'a4000000-0000-4000-8000-000000000002'
  );

insert into public.releases (
  id,
  organization_id,
  brand_id,
  name,
  processing_date,
  embargo_date,
  status
)
values
  (
    'a6000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    (
      select default_brand_id
      from public.organizations
      where id = 'a2000000-0000-4000-8000-000000000001'
    ),
    'Active Due Release',
    current_date - 1,
    current_date - 2,
    'scheduled'
  ),
  (
    'a6000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000002',
    'Suspended Due Release',
    current_date - 1,
    current_date - 2,
    'scheduled'
  );

insert into public.release_tiers (
  id,
  organization_id,
  release_id,
  tier_id
)
values
  (
    'a7000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a6000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001'
  ),
  (
    'a7000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000001',
    'a6000000-0000-4000-8000-000000000002',
    'a4000000-0000-4000-8000-000000000002'
  );

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
  retry_count,
  next_retry_at
)
values
  (
    'a8000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    (
      select default_brand_id
      from public.organizations
      where id = 'a2000000-0000-4000-8000-000000000001'
    ),
    'a5000000-0000-4000-8000-000000000001',
    'a6000000-0000-4000-8000-000000000001',
    'a7000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001',
    'declined',
    '{"line1":"1 Active Way"}',
    10000,
    725,
    0,
    now() - interval '1 minute'
  ),
  (
    'a8000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000002',
    'a5000000-0000-4000-8000-000000000002',
    'a6000000-0000-4000-8000-000000000002',
    'a7000000-0000-4000-8000-000000000002',
    'a4000000-0000-4000-8000-000000000002',
    'declined',
    '{"line1":"2 Suspended Way"}',
    10000,
    725,
    0,
    now() - interval '1 minute'
  );

insert into public.loyalty_redemptions (
  id,
  organization_id,
  member_id,
  shipment_id,
  idempotency_key,
  points,
  discount_cents,
  points_per_unit,
  discount_unit_cents,
  status,
  expires_at,
  applied_at
)
values (
  'ab000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000001',
  'a8000000-0000-4000-8000-000000000001',
  'phase5-loyalty-tax-branch',
  100,
  1000,
  100,
  1000,
  'applied',
  now() + interval '1 day',
  now()
);

update public.shipments
set
  loyalty_discount_cents = 1000,
  loyalty_redemption_id = 'ab000000-0000-4000-8000-000000000001'
where id = 'a8000000-0000-4000-8000-000000000001';

create temporary table claimed_releases as
select *
from public.claim_due_releases(current_date, 25);

select is(
  (select count(*) from claimed_releases),
  1::bigint,
  'release workers claim only operational brands'
);
select is(
  (
    select status::text
    from public.releases
    where id = 'a6000000-0000-4000-8000-000000000001'
  ),
  'processing',
  'the operational release advances to processing'
);
select is(
  (
    select status::text
    from public.releases
    where id = 'a6000000-0000-4000-8000-000000000002'
  ),
  'scheduled',
  'the restricted-brand release remains scheduled'
);

create temporary table claimed_retries as
select *
from public.schedule_due_shipment_retries(now(), 100);

select is(
  (select count(*) from claimed_retries),
  1::bigint,
  'retry workers claim only operational brands'
);
select is(
  (select shipment_id from claimed_retries),
  'a8000000-0000-4000-8000-000000000001'::uuid,
  'the retry belongs to the operational brand shipment'
);
select is(
  (select amount_cents from claimed_retries),
  9725,
  'automatic retry amount nets loyalty and includes tax'
);
select is(
  (
    select brand_id
    from public.billing_attempts
    where id = (select billing_attempt_id from claimed_retries)
  ),
  (
    select default_brand_id
    from public.organizations
    where id = 'a2000000-0000-4000-8000-000000000001'
  ),
  'the retry billing attempt persists an explicit brand'
);

update public.shipments
set status = 'charged', paid_at = now(), next_retry_at = null
where id = 'a8000000-0000-4000-8000-000000000001';

insert into public.integration_connections (
  id,
  organization_id,
  brand_id,
  integration_type,
  status,
  opted_in,
  consented_at
)
values
  (
    'a9000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    (
      select default_brand_id
      from public.organizations
      where id = 'a2000000-0000-4000-8000-000000000001'
    ),
    'quickbooks',
    'active',
    true,
    now()
  ),
  (
    'a9000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000001',
    (
      select default_brand_id
      from public.organizations
      where id = 'a2000000-0000-4000-8000-000000000001'
    ),
    'avalara',
    'active',
    true,
    now()
  ),
  (
    'a9000000-0000-4000-8000-000000000003',
    'a2000000-0000-4000-8000-000000000001',
    (
      select default_brand_id
      from public.organizations
      where id = 'a2000000-0000-4000-8000-000000000001'
    ),
    'meta',
    'active',
    true,
    now()
  );

select lives_ok(
  $$
    insert into public.meta_conversion_events (
      connection_id,
      organization_id,
      brand_id,
      member_id,
      event_id,
      event_name,
      event_time,
      user_data_hashes
    )
    select
      'a9000000-0000-4000-8000-000000000003',
      'a2000000-0000-4000-8000-000000000001',
      organization.default_brand_id,
      'a5000000-0000-4000-8000-000000000001',
      'phase5-db-birthday',
      'Lead',
      now(),
      jsonb_build_object('db', repeat('c', 64))
    from public.organizations as organization
    where organization.id = 'a2000000-0000-4000-8000-000000000001'
  $$,
  'Meta conversion storage accepts the normalized db birthday hash field'
);

select is(
  (
    select charge_amount_cents - loyalty_discount_cents + tax_amount_cents
    from public.get_quickbooks_transaction_source(
      'a9000000-0000-4000-8000-000000000001',
      100,
      null
    )
    where shipment_id = 'a8000000-0000-4000-8000-000000000001'
  ),
  9725::bigint,
  'QuickBooks source exposes the tax-inclusive loyalty-net amount'
);

insert into public.billing_attempts (
  id,
  organization_id,
  brand_id,
  shipment_id,
  idempotency_key,
  attempt_number,
  attempt_kind,
  status,
  amount_cents
)
values (
  'aa000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000001',
  (
    select default_brand_id
    from public.organizations
    where id = 'a2000000-0000-4000-8000-000000000001'
  ),
  'a8000000-0000-4000-8000-000000000001',
  'phase5-refund-partial',
  2,
  'refund',
  'processing',
  4863
);

select is(
  public.apply_shipment_payment_event(
    'a2000000-0000-4000-8000-000000000001',
    (
      select default_brand_id
      from public.organizations
      where id = 'a2000000-0000-4000-8000-000000000001'
    ),
    'a8000000-0000-4000-8000-000000000001',
    'aa000000-0000-4000-8000-000000000002',
    'evt_phase5partial',
    now(),
    'refunded',
    null,
    null,
    null,
    're_phase5partial'
  )::text,
  'charged',
  'a partial tax-inclusive refund does not mark the shipment fully refunded'
);
select is(
  (
    select refund_amount_cents
    from public.shipments
    where id = 'a8000000-0000-4000-8000-000000000001'
  ),
  4863,
  'the partial refund total is persisted'
);

insert into public.billing_attempts (
  id,
  organization_id,
  brand_id,
  shipment_id,
  idempotency_key,
  attempt_number,
  attempt_kind,
  status,
  amount_cents
)
values (
  'aa000000-0000-4000-8000-000000000003',
  'a2000000-0000-4000-8000-000000000001',
  (
    select default_brand_id
    from public.organizations
    where id = 'a2000000-0000-4000-8000-000000000001'
  ),
  'a8000000-0000-4000-8000-000000000001',
  'phase5-refund-full',
  3,
  'refund',
  'processing',
  4862
);

select is(
  public.apply_shipment_payment_event(
    'a2000000-0000-4000-8000-000000000001',
    (
      select default_brand_id
      from public.organizations
      where id = 'a2000000-0000-4000-8000-000000000001'
    ),
    'a8000000-0000-4000-8000-000000000001',
    'aa000000-0000-4000-8000-000000000003',
    'evt_phase5full',
    now() + interval '1 second',
    'refunded',
    null,
    null,
    null,
    're_phase5full'
  )::text,
  'refunded',
  'the shipment becomes refunded only at the tax-inclusive payable total'
);
select is(
  (
    select refund_amount_cents
    from public.shipments
    where id = 'a8000000-0000-4000-8000-000000000001'
  ),
  9725,
  'a full refund may include collected tax above the pre-tax charge'
);
select is(
  (
    select count(*)
    from public.integration_sync_jobs
    where integration_type = 'avalara'
      and sync_type = 'avalara.tax.refund'
      and entity_id = 'a8000000-0000-4000-8000-000000000001'
  ),
  2::bigint,
  'each cumulative refund change durably queues Avalara return work'
);
select is(
  (
    select count(*)
    from public.integration_sync_jobs
    where integration_type = 'quickbooks'
      and sync_type = 'quickbooks.transaction.upsert'
      and entity_id = 'a8000000-0000-4000-8000-000000000001'
      and payload ->> 'change_type' = 'refund'
  ),
  2::bigint,
  'partial refunds queue distinct QuickBooks refund jobs even before final status'
);
select is(
  (
    select array_agg(
      (payload ->> 'refund_amount_cents')::integer
      order by (payload ->> 'refund_amount_cents')::integer
    )
    from public.integration_sync_jobs
    where integration_type = 'quickbooks'
      and sync_type = 'quickbooks.transaction.upsert'
      and entity_id = 'a8000000-0000-4000-8000-000000000001'
      and payload ->> 'change_type' = 'refund'
  ),
  array[4863, 9725]::integer[],
  'QuickBooks refund jobs persist each cumulative refund target'
);
select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quickbooks_transaction_mappings'
      and column_name = 'source_cumulative_amount_cents'
  ),
  'QuickBooks refund mappings retain their source cumulative amount'
);
select ok(
  (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.shipments'::regclass
      and conname = 'shipments_refund_amount_range'
  ) like '%tax_amount_cents%',
  'the refund range constraint uses the tax-inclusive payable amount'
);
select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'avalara_tax_calculations'
      and column_name = 'document_type'
      and column_default like '%SalesInvoice%'
  ),
  'Avalara calculations distinguish sales and return documents'
);

create temporary table quickbooks_refund_claim_4863 as
select *
from public.claim_integration_refund_delivery(
  'a9000000-0000-4000-8000-000000000001',
  'a8000000-0000-4000-8000-000000000001',
  4863,
  'job:qbo-refund-4863',
  120
);
select is(
  (select outcome from quickbooks_refund_claim_4863),
  'claimed',
  'QuickBooks atomically claims the first cumulative refund target'
);
select is(
  (select delta_amount_cents from quickbooks_refund_claim_4863),
  4863::bigint,
  'the first QuickBooks provider delta is 4,863 cents'
);

create temporary table quickbooks_refund_blocked_9725 as
select *
from public.claim_integration_refund_delivery(
  'a9000000-0000-4000-8000-000000000001',
  'a8000000-0000-4000-8000-000000000001',
  9725,
  'job:qbo-refund-9725-concurrent',
  120
);
select is(
  (select outcome from quickbooks_refund_blocked_9725),
  'blocked',
  'a concurrent later QuickBooks target is blocked behind the first delivery'
);
select is(
  (select target_cumulative_amount_cents from quickbooks_refund_blocked_9725),
  4863::bigint,
  'the blocked QuickBooks claim exposes the unresolved earlier target'
);
select is(
  public.release_integration_refund_delivery(
    'a9000000-0000-4000-8000-000000000001',
    'a8000000-0000-4000-8000-000000000001',
    (select lease_token from quickbooks_refund_claim_4863)
  ),
  true,
  'a pre-provider QuickBooks failure can explicitly release its exact lease'
);

create temporary table quickbooks_refund_reclaim_4863 as
select *
from public.claim_integration_refund_delivery(
  'a9000000-0000-4000-8000-000000000001',
  'a8000000-0000-4000-8000-000000000001',
  4863,
  'job:qbo-refund-4863-after-release',
  120
);
select is(
  (select provider_request_key from quickbooks_refund_reclaim_4863),
  (select provider_request_key from quickbooks_refund_claim_4863),
  'a released QuickBooks target reconstructs the same provider idempotency key'
);
select is(
  public.complete_quickbooks_refund_delivery(
    'a9000000-0000-4000-8000-000000000001',
    'a8000000-0000-4000-8000-000000000001',
    (select lease_token from quickbooks_refund_reclaim_4863),
    'qbo-refund-4863',
    4863,
    363,
    'USD',
    1,
    current_date
  ),
  4863::bigint,
  'QuickBooks completion atomically records and advances the first target'
);

create temporary table quickbooks_refund_claim_9725 as
select *
from public.claim_integration_refund_delivery(
  'a9000000-0000-4000-8000-000000000001',
  'a8000000-0000-4000-8000-000000000001',
  9725,
  'job:qbo-refund-9725',
  120
);
select is(
  (select delta_amount_cents from quickbooks_refund_claim_9725),
  4862::bigint,
  'the later QuickBooks cumulative target produces only the 4,862-cent delta'
);
select is(
  public.complete_quickbooks_refund_delivery(
    'a9000000-0000-4000-8000-000000000001',
    'a8000000-0000-4000-8000-000000000001',
    (select lease_token from quickbooks_refund_claim_9725),
    'qbo-refund-9725',
    4862,
    362,
    'USD',
    1,
    current_date
  ),
  9725::bigint,
  'QuickBooks completion advances to the final cumulative target'
);
select is(
  (
    select array_agg(amount_cents order by source_cumulative_amount_cents)
    from public.quickbooks_transaction_mappings
    where connection_id = 'a9000000-0000-4000-8000-000000000001'
      and shipment_id = 'a8000000-0000-4000-8000-000000000001'
      and transaction_type = 'refund'
  ),
  array[4863, 4862]::bigint[],
  'QuickBooks persists 4,863 plus 4,862 rather than over-refunding'
);
select is(
  (
    select sum(amount_cents)
    from public.quickbooks_transaction_mappings
    where connection_id = 'a9000000-0000-4000-8000-000000000001'
      and shipment_id = 'a8000000-0000-4000-8000-000000000001'
      and transaction_type = 'refund'
  ),
  9725::numeric,
  'QuickBooks provider refund deliveries total the authoritative cumulative refund'
);
select is(
  (
    select outcome
    from public.claim_integration_refund_delivery(
      'a9000000-0000-4000-8000-000000000001',
      'a8000000-0000-4000-8000-000000000001',
      9725,
      'job:qbo-refund-replay',
      120
    )
  ),
  'already_delivered',
  'a replay of the final QuickBooks target performs no provider work'
);

create temporary table avalara_refund_claim_4863 as
select *
from public.claim_integration_refund_delivery(
  'a9000000-0000-4000-8000-000000000002',
  'a8000000-0000-4000-8000-000000000001',
  4863,
  'job:avalara-refund-4863',
  30
);
select is(
  (select outcome from avalara_refund_claim_4863),
  'claimed',
  'Avalara atomically claims the first cumulative ReturnInvoice target'
);
select is(
  (select delta_amount_cents from avalara_refund_claim_4863),
  4863::bigint,
  'the first Avalara ReturnInvoice delta is 4,863 cents'
);

update public.integration_refund_deliveries
set lease_expires_at = now() - interval '1 second'
where connection_id = 'a9000000-0000-4000-8000-000000000002'
  and shipment_id = 'a8000000-0000-4000-8000-000000000001';

create temporary table avalara_refund_blocked_9725 as
select *
from public.claim_integration_refund_delivery(
  'a9000000-0000-4000-8000-000000000002',
  'a8000000-0000-4000-8000-000000000001',
  9725,
  'job:avalara-refund-9725-concurrent',
  30
);
select is(
  (select outcome from avalara_refund_blocked_9725),
  'blocked',
  'an expired but unresolved Avalara target still blocks a different target'
);

create temporary table avalara_refund_reclaim_4863 as
select *
from public.claim_integration_refund_delivery(
  'a9000000-0000-4000-8000-000000000002',
  'a8000000-0000-4000-8000-000000000001',
  4863,
  'job:avalara-refund-4863-recovery',
  30
);
select is(
  (select reclaimed from avalara_refund_reclaim_4863),
  true,
  'the same Avalara target reclaims an expired lease for crash recovery'
);
select is(
  (select provider_request_key from avalara_refund_reclaim_4863),
  (select provider_request_key from avalara_refund_claim_4863),
  'Avalara crash recovery preserves the immutable provider request key'
);
select is(
  public.complete_avalara_refund_delivery(
    'a9000000-0000-4000-8000-000000000002',
    'a8000000-0000-4000-8000-000000000001',
    (select lease_token from avalara_refund_reclaim_4863),
    'VINR-4863',
    'USD',
    4500,
    363,
    '[]'::jsonb,
    repeat('a', 64),
    repeat('b', 64)
  ),
  4863::bigint,
  'Avalara recovery atomically persists and advances the first ReturnInvoice'
);

create temporary table avalara_refund_claim_9725 as
select *
from public.claim_integration_refund_delivery(
  'a9000000-0000-4000-8000-000000000002',
  'a8000000-0000-4000-8000-000000000001',
  9725,
  'job:avalara-refund-9725',
  120
);
select is(
  (select delta_amount_cents from avalara_refund_claim_9725),
  4862::bigint,
  'the later Avalara cumulative target produces only the 4,862-cent delta'
);
select is(
  public.complete_avalara_refund_delivery(
    'a9000000-0000-4000-8000-000000000002',
    'a8000000-0000-4000-8000-000000000001',
    (select lease_token from avalara_refund_claim_9725),
    'VINR-9725',
    'USD',
    4500,
    362,
    '[]'::jsonb,
    repeat('c', 64),
    repeat('d', 64)
  ),
  9725::bigint,
  'Avalara completion advances to the final cumulative target'
);
select is(
  (
    select array_agg(
      taxable_basis_cents + tax_amount_cents
      order by document_code
    )
    from public.avalara_tax_calculations
    where connection_id = 'a9000000-0000-4000-8000-000000000002'
      and shipment_id = 'a8000000-0000-4000-8000-000000000001'
      and document_type = 'ReturnInvoice'
      and document_status = 'committed'
  ),
  array[4863, 4862]::bigint[],
  'Avalara persists 4,863 plus 4,862 rather than over-refunding'
);
select is(
  (
    select sum(taxable_basis_cents + tax_amount_cents)
    from public.avalara_tax_calculations
    where connection_id = 'a9000000-0000-4000-8000-000000000002'
      and shipment_id = 'a8000000-0000-4000-8000-000000000001'
      and document_type = 'ReturnInvoice'
      and document_status = 'committed'
  ),
  9725::numeric,
  'Avalara ReturnInvoices total the authoritative cumulative refund'
);
select is(
  (
    select inflight_target_amount_cents
    from public.integration_refund_deliveries
    where connection_id = 'a9000000-0000-4000-8000-000000000002'
      and shipment_id = 'a8000000-0000-4000-8000-000000000001'
  ),
  null::bigint,
  'Avalara completion clears the delivery lease for later work'
);

reset role;
insert into auth.users (id, email)
values (
  'a1000000-0000-4000-8000-000000000002',
  'phase5-duplicate@example.test'
);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
update public.members
set email = 'phase5-duplicate@example.test'
where id = 'a5000000-0000-4000-8000-000000000001';
insert into public.brands (
  id,
  organization_id,
  name,
  slug,
  portal_title
)
values (
  'a3000000-0000-4000-8000-000000000003',
  'a2000000-0000-4000-8000-000000000001',
  'Duplicate Email Sibling',
  'duplicate-email-sibling',
  'Duplicate Email Sibling Club'
);
insert into public.members (
  id,
  organization_id,
  brand_id,
  email,
  first_name,
  last_name
)
values (
  'a5000000-0000-4000-8000-000000000003',
  'a2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000003',
  'phase5-duplicate@example.test',
  'Duplicate',
  'Sibling'
);

select public.register_member_auth_link_context(
  repeat('1', 64),
  'a2000000-0000-4000-8000-000000000001',
  (
    select default_brand_id
    from public.organizations
    where id = 'a2000000-0000-4000-8000-000000000001'
  ),
  'a5000000-0000-4000-8000-000000000001',
  encode(
    extensions.digest(
      convert_to('phase5-duplicate@example.test', 'UTF8'),
      'sha256'
    ),
    'hex'
  ),
  'vinifera.test',
  now() + interval '15 minutes'
);

select is(
  (
    select member_id
    from public.link_member_auth_user(
      'a1000000-0000-4000-8000-000000000002',
      'phase5-duplicate@example.test',
      'a2000000-0000-4000-8000-000000000001',
      (
        select default_brand_id
        from public.organizations
        where id = 'a2000000-0000-4000-8000-000000000001'
      ),
      'a5000000-0000-4000-8000-000000000001',
      repeat('1', 64),
      'vinifera.test'
    )
  ),
  'a5000000-0000-4000-8000-000000000001'::uuid,
  'web auth linking selects the exact signed member among duplicate emails'
);
select is(
  (
    select auth_user_id
    from public.members
    where id = 'a5000000-0000-4000-8000-000000000003'
  ),
  null::uuid,
  'exact web auth linking leaves the duplicate-email sibling untouched'
);
select throws_ok(
  $$
    select public.link_member_auth_user(
      'a1000000-0000-4000-8000-000000000002',
      'phase5-duplicate@example.test',
      'a2000000-0000-4000-8000-000000000001',
      (
        select default_brand_id
        from public.organizations
        where id = 'a2000000-0000-4000-8000-000000000001'
      ),
      'a5000000-0000-4000-8000-000000000001',
      repeat('1', 64),
      'vinifera.test'
    )
  $$,
  '22023',
  'Member auth-link context is invalid or already used.',
  'a consumed web auth-link context cannot be replayed'
);

select public.register_member_auth_link_context(
  repeat('2', 64),
  'a2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000003',
  'a5000000-0000-4000-8000-000000000003',
  encode(
    extensions.digest(
      convert_to('phase5-duplicate@example.test', 'UTF8'),
      'sha256'
    ),
    'hex'
  ),
  'club.example.test',
  now() + interval '15 minutes'
);
select throws_ok(
  $$
    select public.link_member_auth_user(
      'a1000000-0000-4000-8000-000000000002',
      'phase5-duplicate@example.test',
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000003',
      'a5000000-0000-4000-8000-000000000003',
      repeat('2', 64),
      'other.example.test'
    )
  $$,
  '22023',
  'Member auth-link context is invalid or already used.',
  'a web auth-link context cannot cross callback hosts'
);
select is(
  (
    select consumed_at
    from public.member_auth_link_contexts
    where token_hash = repeat('2', 64)
  ),
  null::timestamptz,
  'a host mismatch does not consume or link the signed context'
);

update public.brands
set access_status = 'suspended'
where id = 'a3000000-0000-4000-8000-000000000002'
  and organization_id = 'a2000000-0000-4000-8000-000000000001';

reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","organization_id":"a2000000-0000-4000-8000-000000000001","user_role":"member","auth_surface":"member","platform_role":null}';

select throws_ok(
  $$
    select *
    from public.claim_integration_refund_delivery(
      'a9000000-0000-4000-8000-000000000001',
      'a8000000-0000-4000-8000-000000000001',
      9725,
      'member-forbidden',
      120
    )
  $$,
  '42501',
  'permission denied for function claim_integration_refund_delivery',
  'member sessions cannot claim provider refund delivery leases'
);
select is(
  (select count(*) from public.members),
  0::bigint,
  'a suspended independent-brand member cannot read member data'
);
select is(
  (select count(*) from public.brands),
  0::bigint,
  'a suspended independent-brand member cannot read its brand'
);

select * from finish();
rollback;
