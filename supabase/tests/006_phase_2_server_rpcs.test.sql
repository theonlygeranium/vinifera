begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(72);

select ok(
  to_regclass('public.billing_attempts_stripe_refund_id_uidx') is not null,
  'Stripe refund identifiers map to one durable billing attempt'
);

insert into auth.users (id, email)
values
  ('31000000-0000-4000-8000-000000000001', 'phase2-rpc-owner@example.test'),
  ('31000000-0000-4000-8000-000000000002', 'phase2-link@example.test');

insert into public.organizations (
  id,
  name,
  plan_tier,
  shipping_origin_address
)
values (
  '32000000-0000-4000-8000-000000000001',
  'Phase 2 RPC Winery',
  'vine',
  '{
    "company":"Phase 2 RPC Winery",
    "name":"Fulfillment",
    "phone":"+17075550100",
    "line1":"1 Winery Lane",
    "city":"Napa",
    "state":"CA",
    "postal_code":"94558",
    "country":"US"
  }'::jsonb
);

insert into public.staff_users (id, organization_id, email, role)
values (
  '31000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  'phase2-rpc-owner@example.test',
  'owner'
);

insert into public.club_tiers (
  id,
  organization_id,
  name,
  price_cents,
  bottle_count,
  frequency
)
values (
  '33000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  'RPC Reserve',
  12000,
  3,
  'quarterly'
);

insert into public.members (
  id,
  organization_id,
  email,
  first_name,
  last_name,
  phone,
  shipping_address_line1,
  shipping_city,
  shipping_region,
  shipping_postal_code,
  club_tier_id
)
values
  (
    '34000000-0000-4000-8000-000000000001',
    '32000000-0000-4000-8000-000000000001',
    'phase2-charge@example.test',
    'Charge',
    'Member',
    '+17075550101',
    '10 Main Street',
    'Napa',
    'CA',
    '94558',
    '33000000-0000-4000-8000-000000000001'
  ),
  (
    '34000000-0000-4000-8000-000000000002',
    '32000000-0000-4000-8000-000000000001',
    'phase2-retry@example.test',
    'Retry',
    'Member',
    '+17075550102',
    '20 Main Street',
    'Napa',
    'CA',
    '94558',
    '33000000-0000-4000-8000-000000000001'
  ),
  (
    '34000000-0000-4000-8000-000000000003',
    '32000000-0000-4000-8000-000000000001',
    'phase2-link@example.test',
    'Link',
    'Member',
    null,
    null,
    null,
    null,
    null,
    null
  );

insert into public.releases (
  id,
  organization_id,
  name,
  processing_date,
  embargo_date,
  status,
  created_by
)
values (
  '35000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  'RPC Fall Release',
  current_date,
  current_date,
  'scheduled',
  '31000000-0000-4000-8000-000000000001'
);

insert into public.release_tiers (
  id,
  organization_id,
  release_id,
  tier_id
)
values (
  '36000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  '35000000-0000-4000-8000-000000000001',
  '33000000-0000-4000-8000-000000000001'
);

select is(
  (
    select price_cents
    from public.release_tiers
    where id = '36000000-0000-4000-8000-000000000001'
  ),
  12000,
  'release tier snapshots pricing'
);

update public.club_tiers
set price_cents = 15000
where id = '33000000-0000-4000-8000-000000000001';

select is(
  (
    select price_cents
    from public.release_tiers
    where id = '36000000-0000-4000-8000-000000000001'
  ),
  12000,
  'future tier edits do not rewrite a release snapshot'
);

insert into public.release_wines (
  id,
  organization_id,
  release_id,
  wine_name,
  vintage,
  sku
)
values (
  '37000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  '35000000-0000-4000-8000-000000000001',
  'RPC Cabernet',
  2024,
  'RPC-CAB-24'
);

insert into public.release_tier_items (
  organization_id,
  release_id,
  release_tier_id,
  release_wine_id,
  quantity,
  unit_price_cents
)
values (
  '32000000-0000-4000-8000-000000000001',
  '35000000-0000-4000-8000-000000000001',
  '36000000-0000-4000-8000-000000000001',
  '37000000-0000-4000-8000-000000000001',
  3,
  4000
);

select is(
  (
    select count(*)
    from public.claim_due_releases(current_date, 25)
  ),
  1::bigint,
  'cron claims one due scheduled release'
);
select is(
  (
    select count(*)
    from public.claim_due_releases(current_date, 25)
  ),
  0::bigint,
  'a due release cannot be claimed twice'
);
select is(
  (
    select count(*)
    from public.create_release_shipments(
      '32000000-0000-4000-8000-000000000001',
      '35000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000001'
    )
  ),
  2::bigint,
  'release processing creates one shipment per active participating member'
);
select is(
  (
    select count(*)
    from public.create_release_shipments(
      '32000000-0000-4000-8000-000000000001',
      '35000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000001'
    )
  ),
  2::bigint,
  'release shipment creation is idempotent'
);
select is((select count(*) from public.shipments), 2::bigint, 'no duplicate shipments are inserted');
select is((select count(*) from public.shipment_items), 2::bigint, 'release items are copied into shipment snapshots');

select throws_ok(
  $$
    select public.record_billing_attempt(
      '32000000-0000-4000-8000-000000000001',
      (
        select id
        from public.shipments
        where member_id = '34000000-0000-4000-8000-000000000001'
      ),
      'retry',
      12000,
      'release:35000000:pending-retry',
      'pi_P2PendingWrongRetry',
      null,
      '{}'::jsonb
    )
  $$,
  '23514',
  'Paid or terminal shipments cannot receive a new billing attempt.',
  'a pending shipment rejects a retry-kind attempt'
);

select is(
  public.record_billing_attempt(
    '32000000-0000-4000-8000-000000000001',
    (
      select id
      from public.shipments
      where member_id = '34000000-0000-4000-8000-000000000001'
    ),
    'charge',
    12000,
    'release:35000000:member:charge',
    'pi_P2ChargeOne',
    '31000000-0000-4000-8000-000000000001',
    '{}'::jsonb
  ),
  public.record_billing_attempt(
    '32000000-0000-4000-8000-000000000001',
    (
      select id
      from public.shipments
      where member_id = '34000000-0000-4000-8000-000000000001'
    ),
    'charge',
    12000,
    'release:35000000:member:charge',
    'pi_P2ChargeOne',
    '31000000-0000-4000-8000-000000000001',
    '{}'::jsonb
  ),
  'stable billing idempotency keys return the existing attempt'
);
select is(
  (
    select count(*)
    from public.billing_attempts
    where stripe_payment_intent_id = 'pi_P2ChargeOne'
  ),
  1::bigint,
  'a PaymentIntent cannot create duplicate billing attempts'
);

select is(
  public.apply_shipment_payment_event(
    '32000000-0000-4000-8000-000000000001',
    (
      select shipment_id
      from public.billing_attempts
      where stripe_payment_intent_id = 'pi_P2ChargeOne'
    ),
    (
      select id
      from public.billing_attempts
      where stripe_payment_intent_id = 'pi_P2ChargeOne'
    ),
    null,
    now(),
    'succeeded',
    'ch_P2ChargeOne',
    null,
    null,
    null,
    '{}'::jsonb
  ),
  'charged'::public.shipment_status,
  'synchronous PaymentIntent success is recorded without an event ID'
);
select is(
  (
    select lifetime_value_cents
    from public.members
    where id = '34000000-0000-4000-8000-000000000001'
  ),
  12000::bigint,
  'first successful charge increments member LTV once'
);
select is(
  public.apply_shipment_payment_event(
    '32000000-0000-4000-8000-000000000001',
    (
      select shipment_id
      from public.billing_attempts
      where stripe_payment_intent_id = 'pi_P2ChargeOne'
    ),
    (
      select id
      from public.billing_attempts
      where stripe_payment_intent_id = 'pi_P2ChargeOne'
    ),
    'evt_P2ChargeOne',
    now(),
    'succeeded',
    'ch_P2ChargeOne',
    null,
    null,
    null,
    '{}'::jsonb
  ),
  'charged'::public.shipment_status,
  'later signed webhook reconciles the direct result'
);
select is(
  (
    select lifetime_value_cents
    from public.members
    where id = '34000000-0000-4000-8000-000000000001'
  ),
  12000::bigint,
  'webhook reconciliation does not double-count LTV'
);

select is(
  public.record_billing_attempt(
    '32000000-0000-4000-8000-000000000001',
    (
      select shipment_id
      from public.billing_attempts
      where stripe_payment_intent_id = 'pi_P2ChargeOne'
    ),
    'charge',
    12000,
    'release:35000000:member:charge',
    'pi_P2ChargeOne',
    '31000000-0000-4000-8000-000000000001',
    '{}'::jsonb
  ),
  (
    select id
    from public.billing_attempts
    where stripe_payment_intent_id = 'pi_P2ChargeOne'
  ),
  'same paid attempt remains available for webhook reconciliation'
);
select throws_ok(
  $$
    select public.record_billing_attempt(
      '32000000-0000-4000-8000-000000000001',
      (
        select shipment_id
        from public.billing_attempts
        where stripe_payment_intent_id = 'pi_P2ChargeOne'
      ),
      'charge',
      12000,
      'release:35000000:member:new-charge',
      'pi_P2PaidNewCharge',
      null,
      '{}'::jsonb
    )
  $$,
  '23514',
  'Paid or terminal shipments cannot receive a new billing attempt.',
  'an already-paid shipment rejects a new charge attempt'
);
select throws_ok(
  $$
    select public.record_billing_attempt(
      '32000000-0000-4000-8000-000000000001',
      (
        select shipment_id
        from public.billing_attempts
        where stripe_payment_intent_id = 'pi_P2ChargeOne'
      ),
      'retry',
      12000,
      'release:35000000:member:new-retry',
      'pi_P2PaidNewRetry',
      null,
      '{}'::jsonb
    )
  $$,
  '23514',
  'Paid or terminal shipments cannot receive a new billing attempt.',
  'an already-paid shipment rejects a new retry attempt'
);

select ok(
  public.record_billing_attempt(
    '32000000-0000-4000-8000-000000000001',
    (
      select id
      from public.shipments
      where member_id = '34000000-0000-4000-8000-000000000002'
    ),
    'charge',
    12000,
    'release:35000000:member:decline',
    'pi_P2DeclineOne',
    null,
    '{}'::jsonb
  ) is not null,
  'decline-path billing attempt is recorded'
);
select is(
  public.apply_shipment_payment_event(
    '32000000-0000-4000-8000-000000000001',
    (
      select shipment_id
      from public.billing_attempts
      where stripe_payment_intent_id = 'pi_P2DeclineOne'
    ),
    (
      select id
      from public.billing_attempts
      where stripe_payment_intent_id = 'pi_P2DeclineOne'
    ),
    null,
    now(),
    'declined',
    null,
    'card_declined',
    'Insufficient funds.',
    null,
    '{}'::jsonb
  ),
  'declined'::public.shipment_status,
  'decline enters the recovery state'
);
select ok(
  (
    select
      next_retry_at between now() + interval '23 hours'
        and now() + interval '25 hours'
    from public.shipments
    where member_id = '34000000-0000-4000-8000-000000000002'
  ),
  'first decline schedules the day-one retry'
);
select is(
  (
    select count(*)
    from public.schedule_due_shipment_retries(now() + interval '2 days', 100)
  ),
  1::bigint,
  'retry scheduler atomically claims the due shipment'
);
select is(
  (
    select count(*)
    from public.schedule_due_shipment_retries(now() + interval '2 days', 100)
  ),
  0::bigint,
  'claimed retry is not emitted twice'
);

select is(
  public.apply_shipment_payment_event(
    '32000000-0000-4000-8000-000000000001',
    (
      select shipment_id
      from public.billing_attempts
      where attempt_kind = 'retry'
    ),
    (
      select id
      from public.billing_attempts
      where attempt_kind = 'retry'
    ),
    null,
    now() + interval '2 days',
    'succeeded',
    'ch_P2RetryOne',
    null,
    null,
    null,
    '{}'::jsonb
  ),
  'charged'::public.shipment_status,
  'automatic retry can recover a declined shipment'
);
select is(
  (
    select lifetime_value_cents
    from public.members
    where id = '34000000-0000-4000-8000-000000000002'
  ),
  12000::bigint,
  'successful retry increments LTV once'
);

insert into public.shipments (
  id,
  organization_id,
  member_id,
  release_id,
  release_tier_id,
  tier_id,
  shipping_address,
  charge_amount_cents
)
values (
  '39000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  '34000000-0000-4000-8000-000000000003',
  '35000000-0000-4000-8000-000000000001',
  '36000000-0000-4000-8000-000000000001',
  '33000000-0000-4000-8000-000000000001',
  '{"line1":"30 Main Street","city":"Napa","region":"CA","postal_code":"94558"}'::jsonb,
  12000
);

select lives_ok(
  $$
    select public.record_billing_attempt(
      '32000000-0000-4000-8000-000000000001',
      '39000000-0000-4000-8000-000000000001',
      'charge',
      12000,
      'fixed-decline-initial',
      'pi_P2FixedDeclineOne',
      null,
      '{}'::jsonb
    )
  $$,
  'fixed-time decline attempt is recorded'
);
select is(
  public.apply_shipment_payment_event(
    '32000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000001',
    (
      select id
      from public.billing_attempts
      where idempotency_key = 'fixed-decline-initial'
    ),
    'evt_P2FixedDeclineOne',
    '2026-01-01 10:00:00+00'::timestamptz,
    'declined',
    null,
    'card_declined',
    'Initial fixed decline.',
    null,
    '{}'::jsonb
  ),
  'declined'::public.shipment_status,
  'first fixed-time payment failure enters decline recovery'
);
select is(
  (
    select next_retry_at
    from public.shipments
    where id = '39000000-0000-4000-8000-000000000001'
  ),
  '2026-01-02 10:00:00+00'::timestamptz,
  'first failure schedules exactly day 1 from the initial decline'
);

select lives_ok(
  $$
    select public.record_billing_attempt(
      '32000000-0000-4000-8000-000000000001',
      '39000000-0000-4000-8000-000000000001',
      'retry',
      12000,
      'fixed-decline-retry-one',
      'pi_P2FixedDeclineTwo',
      null,
      '{}'::jsonb
    )
  $$,
  'first fixed-time retry attempt is recorded'
);
select is(
  public.apply_shipment_payment_event(
    '32000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000001',
    (
      select id
      from public.billing_attempts
      where idempotency_key = 'fixed-decline-retry-one'
    ),
    'evt_P2FixedDeclineTwo',
    '2026-01-02 10:00:00+00'::timestamptz,
    'declined',
    null,
    'card_declined',
    'Second fixed decline.',
    null,
    '{}'::jsonb
  ),
  'declined'::public.shipment_status,
  'second fixed-time payment failure remains in decline recovery'
);
select is(
  (
    select next_retry_at
    from public.shipments
    where id = '39000000-0000-4000-8000-000000000001'
  ),
  '2026-01-04 10:00:00+00'::timestamptz,
  'second failure schedules exactly day 3 from the initial decline'
);

select lives_ok(
  $$
    select public.record_billing_attempt(
      '32000000-0000-4000-8000-000000000001',
      '39000000-0000-4000-8000-000000000001',
      'retry',
      12000,
      'fixed-decline-retry-two',
      'pi_P2FixedDeclineThree',
      null,
      '{}'::jsonb
    )
  $$,
  'second fixed-time retry attempt is recorded'
);
select is(
  public.apply_shipment_payment_event(
    '32000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000001',
    (
      select id
      from public.billing_attempts
      where idempotency_key = 'fixed-decline-retry-two'
    ),
    'evt_P2FixedDeclineThree',
    '2026-01-04 10:00:00+00'::timestamptz,
    'declined',
    null,
    'card_declined',
    'Third fixed decline.',
    null,
    '{}'::jsonb
  ),
  'declined'::public.shipment_status,
  'third fixed-time payment failure remains in decline recovery'
);
select is(
  (
    select next_retry_at
    from public.shipments
    where id = '39000000-0000-4000-8000-000000000001'
  ),
  '2026-01-08 10:00:00+00'::timestamptz,
  'third failure schedules exactly day 7 from the initial decline'
);

delete from public.shipments
where id = '39000000-0000-4000-8000-000000000001';

select ok(
  public.record_billing_attempt(
    '32000000-0000-4000-8000-000000000001',
    (
      select id
      from public.shipments
      where member_id = '34000000-0000-4000-8000-000000000001'
    ),
    'refund',
    4000,
    'refund:35000000:member:partial',
    null,
    '31000000-0000-4000-8000-000000000001',
    '{}'::jsonb
  ) is not null,
  'partial refund attempt is recorded'
);
select is(
  public.apply_shipment_payment_event(
    '32000000-0000-4000-8000-000000000001',
    (
      select shipment_id
      from public.billing_attempts
      where idempotency_key = 'refund:35000000:member:partial'
    ),
    (
      select id
      from public.billing_attempts
      where idempotency_key = 'refund:35000000:member:partial'
    ),
    null,
    now() + interval '3 days',
    'refunded',
    'ch_P2ChargeOne',
    null,
    null,
    're_P2PartialOne',
    '{}'::jsonb
  ),
  'charged'::public.shipment_status,
  'partial refund preserves fulfillment state'
);
select is(
  (
    select refund_amount_cents
    from public.shipments
    where member_id = '34000000-0000-4000-8000-000000000001'
  ),
  4000,
  'partial refund is accumulated on the shipment'
);
select is(
  (
    select lifetime_value_cents
    from public.members
    where id = '34000000-0000-4000-8000-000000000001'
  ),
  8000::bigint,
  'partial refund subtracts from LTV once'
);
select is(
  public.apply_shipment_payment_event(
    '32000000-0000-4000-8000-000000000001',
    (
      select shipment_id
      from public.billing_attempts
      where idempotency_key = 'refund:35000000:member:partial'
    ),
    (
      select id
      from public.billing_attempts
      where idempotency_key = 'refund:35000000:member:partial'
    ),
    'evt_P2PartialRefund',
    now() + interval '3 days',
    'refunded',
    'ch_P2ChargeOne',
    null,
    null,
    're_P2PartialOne',
    '{}'::jsonb
  ),
  'charged'::public.shipment_status,
  'refund webhook attaches without replaying the partial refund'
);
select is(
  (
    select lifetime_value_cents
    from public.members
    where id = '34000000-0000-4000-8000-000000000001'
  ),
  8000::bigint,
  'refund webhook replay does not double-subtract LTV'
);
select is(
  (
    select count(*)
    from public.billing_attempts
    where shipment_id = (
      select id
      from public.shipments
      where member_id = '34000000-0000-4000-8000-000000000001'
    )
      and stripe_refund_id = 're_P2PartialOne'
  ),
  1::bigint,
  'staff refund and webhook share one refund attempt'
);
select is(
  (
    select stripe_event_id
    from public.billing_attempts
    where stripe_refund_id = 're_P2PartialOne'
  ),
  'evt_P2PartialRefund',
  'the Stripe refund event is durably attached to the staff attempt'
);
select is(
  public.apply_shipment_payment_event(
    '32000000-0000-4000-8000-000000000001',
    (
      select shipment_id
      from public.billing_attempts
      where stripe_refund_id = 're_P2PartialOne'
    ),
    (
      select id
      from public.billing_attempts
      where stripe_refund_id = 're_P2PartialOne'
    ),
    'evt_P2PartialRefund',
    now() + interval '3 days',
    'refunded',
    'ch_P2ChargeOne',
    null,
    null,
    're_P2PartialOne',
    '{}'::jsonb
  ),
  'charged'::public.shipment_status,
  'Stripe refund event replay is idempotent'
);
select is(
  (
    select refund_amount_cents
    from public.shipments
    where member_id = '34000000-0000-4000-8000-000000000001'
  ),
  4000,
  'refund event replay leaves the partial refund total unchanged'
);
select is(
  (
    select lifetime_value_cents
    from public.members
    where id = '34000000-0000-4000-8000-000000000001'
  ),
  8000::bigint,
  'refund event replay leaves LTV unchanged'
);

select ok(
  public.record_billing_attempt(
    '32000000-0000-4000-8000-000000000001',
    (
      select id
      from public.shipments
      where member_id = '34000000-0000-4000-8000-000000000001'
    ),
    'refund',
    8000,
    'refund:35000000:member:final',
    null,
    '31000000-0000-4000-8000-000000000001',
    '{}'::jsonb
  ) is not null,
  'remaining refund attempt is recorded'
);
select is(
  public.apply_shipment_payment_event(
    '32000000-0000-4000-8000-000000000001',
    (
      select shipment_id
      from public.billing_attempts
      where idempotency_key = 'refund:35000000:member:final'
    ),
    (
      select id
      from public.billing_attempts
      where idempotency_key = 'refund:35000000:member:final'
    ),
    'evt_P2FinalRefund',
    now() + interval '4 days',
    'refunded',
    'ch_P2ChargeOne',
    null,
    null,
    're_P2FinalOne',
    '{}'::jsonb
  ),
  'refunded'::public.shipment_status,
  'cumulative full refund transitions the shipment'
);
select is(
  (
    select lifetime_value_cents
    from public.members
    where id = '34000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'full cumulative refund reduces LTV without going negative'
);
select throws_ok(
  $$
    select public.record_billing_attempt(
      '32000000-0000-4000-8000-000000000001',
      (
        select id
        from public.shipments
        where member_id = '34000000-0000-4000-8000-000000000001'
      ),
      'retry',
      12000,
      'refund-terminal-new-retry',
      'pi_P2RefundedNewRetry',
      null,
      '{}'::jsonb
    )
  $$,
  '23514',
  'Paid or terminal shipments cannot receive a new billing attempt.',
  'a fully refunded terminal shipment rejects a new retry'
);

select is(
  public.transition_shipment(
    '32000000-0000-4000-8000-000000000001',
    (
      select id
      from public.shipments
      where member_id = '34000000-0000-4000-8000-000000000002'
    ),
    'label_created',
    '31000000-0000-4000-8000-000000000001',
    '1ZP2TEST',
    'UPS',
    '{
      "shipping_provider":"easypost",
      "external_shipment_id":"shp_test",
      "external_rate_id":"rate_test",
      "external_label_id":"tracker_test",
      "label_url":"https://example.test/label.pdf",
      "label_format":"PDF",
      "label_cost_cents":1299,
      "address_validation_status":"valid",
      "address_validation_messages":[],
      "validated_shipping_address":{"line1":"20 Main Street"},
      "provider_metadata":{"mode":"test"}
    }'::jsonb
  ),
  'label_created'::public.shipment_status,
  'validated EasyPost label metadata is recorded'
);
select is(
  public.transition_shipment(
    '32000000-0000-4000-8000-000000000001',
    (
      select id
      from public.shipments
      where member_id = '34000000-0000-4000-8000-000000000002'
    ),
    'packed',
    '31000000-0000-4000-8000-000000000001'
  ),
  'packed'::public.shipment_status,
  'shipment transitions to packed'
);
select is(
  public.transition_shipment(
    '32000000-0000-4000-8000-000000000001',
    (
      select id
      from public.shipments
      where member_id = '34000000-0000-4000-8000-000000000002'
    ),
    'shipped',
    '31000000-0000-4000-8000-000000000001'
  ),
  'shipped'::public.shipment_status,
  'shipment transitions to shipped'
);
select is(
  public.transition_shipment(
    '32000000-0000-4000-8000-000000000001',
    (
      select id
      from public.shipments
      where member_id = '34000000-0000-4000-8000-000000000002'
    ),
    'delivered',
    '31000000-0000-4000-8000-000000000001'
  ),
  'delivered'::public.shipment_status,
  'shipment transitions to delivered'
);
select is(
  (
    select status
    from public.releases
    where id = '35000000-0000-4000-8000-000000000001'
  ),
  'completed'::public.release_status,
  'release completes when every shipment is terminal'
);

select is(
  (
    select member_id
    from public.link_member_auth_user(
      '31000000-0000-4000-8000-000000000002',
      'PHASE2-LINK@EXAMPLE.TEST'
    )
  ),
  '34000000-0000-4000-8000-000000000003'::uuid,
  'magic-link auth user is atomically linked by normalized email'
);
select is(
  (
    select member_id
    from public.link_member_auth_user(
      '31000000-0000-4000-8000-000000000002',
      'phase2-link@example.test'
    )
  ),
  '34000000-0000-4000-8000-000000000003'::uuid,
  'member auth linking is idempotent'
);

insert into public.member_imports (
  id,
  organization_id,
  upload_token_hash,
  content_sha256,
  source,
  original_filename,
  content_type,
  file_size_bytes,
  headers,
  column_mapping,
  status,
  imported_by
)
values (
  '38000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  encode(
    extensions.digest(
      convert_to('phase2-import-token-abcdefghijklmnopqrstuvwxyz', 'UTF8'),
      'sha256'
    ),
    'hex'
  ),
  repeat('e', 64),
  'commerce7',
  'commerce7-members.csv',
  'text/csv',
  1024,
  '[
    "Email",
    "First",
    "Last",
    "Phone",
    "Club",
    "Joined",
    "Address",
    "Address2",
    "City",
    "State",
    "Zip",
    "Country"
  ]'::jsonb,
  '{
    "email":"Email",
    "first_name":"First",
    "last_name":"Last",
    "phone":"Phone",
    "club_tier_id":"Club",
    "joined_on":"Joined",
    "shipping_address_line1":"Address",
    "shipping_address_line2":"Address2",
    "shipping_city":"City",
    "shipping_region":"State",
    "shipping_postal_code":"Zip",
    "shipping_country_code":"Country"
  }'::jsonb,
  'previewed',
  '31000000-0000-4000-8000-000000000001'
);

insert into public.member_import_rows (
  organization_id,
  import_id,
  row_number,
  raw_data,
  normalized_data,
  status,
  validation_errors
)
values
  (
    '32000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    1,
    '{
      "Email":"new-import@example.test",
      "First":"New",
      "Last":"Member",
      "Phone":"+17075550199",
      "Club":"RPC Reserve",
      "Joined":"2026-01-05",
      "Address":"99 Import Lane",
      "Address2":"Suite 2",
      "City":"Napa",
      "State":"CA",
      "Zip":"94558",
      "Country":"US"
    }'::jsonb,
    '{
      "email":"new-import@example.test",
      "first_name":"New",
      "last_name":"Member",
      "phone":"+17075550199",
      "club_tier_id":"33000000-0000-4000-8000-000000000001",
      "joined_on":"2026-01-05",
      "shipping_address_line1":"99 Import Lane",
      "shipping_address_line2":"Suite 2",
      "shipping_city":"Napa",
      "shipping_region":"CA",
      "shipping_postal_code":"94558",
      "shipping_country_code":"US",
      "status":"active"
    }'::jsonb,
    'valid',
    '[]'::jsonb
  ),
  (
    '32000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    2,
    '{"Email":"preview-invalid@example.test","First":"Missing","Last":""}'::jsonb,
    '{"email":"preview-invalid@example.test","first_name":"Missing","last_name":"","status":"active"}'::jsonb,
    'invalid',
    '["Last name is required."]'::jsonb
  ),
  (
    '32000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    3,
    '{"Email":"phase2-charge@example.test","First":"Existing","Last":"Member"}'::jsonb,
    '{"email":"phase2-charge@example.test","first_name":"Existing","last_name":"Member","status":"active"}'::jsonb,
    'invalid',
    '["Duplicate member email."]'::jsonb
  ),
  (
    '32000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001',
    4,
    '{"Email":"new-import@example.test","First":"Batch","Last":"Duplicate"}'::jsonb,
    '{"email":"new-import@example.test","first_name":"Batch","last_name":"Duplicate","status":"active"}'::jsonb,
    'invalid',
    '["Duplicate email in this file."]'::jsonb
  );

select throws_ok(
  $$
    select *
    from public.complete_member_import(
      '32000000-0000-4000-8000-000000000001',
      'phase2-import-token-abcdefghijklmnopqrstuvwxyz',
      '{"email":"Email","first_name":"First","last_name":"Wrong"}'::jsonb,
      '31000000-0000-4000-8000-000000000001'
    )
  $$,
  '22023',
  'Column mapping changed after preview. Preview the file again.',
  'commit rejects a mapping that was not approved by preview'
);

select is(
  (
    select inserted_count
    from public.complete_member_import(
      '32000000-0000-4000-8000-000000000001',
      'phase2-import-token-abcdefghijklmnopqrstuvwxyz',
      '{
        "email":"Email",
        "first_name":"First",
        "last_name":"Last",
        "phone":"Phone",
        "club_tier_id":"Club",
        "joined_on":"Joined",
        "shipping_address_line1":"Address",
        "shipping_address_line2":"Address2",
        "shipping_city":"City",
        "shipping_region":"State",
        "shipping_postal_code":"Zip",
        "shipping_country_code":"Country"
      }'::jsonb,
      '31000000-0000-4000-8000-000000000001'
    )
  ),
  1,
  'durable staged import inserts the valid row'
);
select is(
  (
    select invalid_rows
    from public.member_imports
    where id = '38000000-0000-4000-8000-000000000001'
  ),
  3,
  'import preserves preview-invalid, existing, and within-file duplicate rows'
);
select is(
  (
    select failed_rows
    from public.member_imports
    where id = '38000000-0000-4000-8000-000000000001'
  ),
  3,
  'import batch reports every skipped row'
);
select is(
  (
    select inserted_count
    from public.complete_member_import(
      '32000000-0000-4000-8000-000000000001',
      'phase2-import-token-abcdefghijklmnopqrstuvwxyz',
      '{
        "email":"Email",
        "first_name":"First",
        "last_name":"Last",
        "phone":"Phone",
        "club_tier_id":"Club",
        "joined_on":"Joined",
        "shipping_address_line1":"Address",
        "shipping_address_line2":"Address2",
        "shipping_city":"City",
        "shipping_region":"State",
        "shipping_postal_code":"Zip",
        "shipping_country_code":"Country"
      }'::jsonb,
      '31000000-0000-4000-8000-000000000001'
    )
  ),
  1,
  'committed import token replay returns the prior result without reinserting'
);
select is(
  (
    select failed_count
    from public.complete_member_import(
      '32000000-0000-4000-8000-000000000001',
      'phase2-import-token-abcdefghijklmnopqrstuvwxyz',
      '{
        "email":"Email",
        "first_name":"First",
        "last_name":"Last",
        "phone":"Phone",
        "club_tier_id":"Club",
        "joined_on":"Joined",
        "shipping_address_line1":"Address",
        "shipping_address_line2":"Address2",
        "shipping_city":"City",
        "shipping_region":"State",
        "shipping_postal_code":"Zip",
        "shipping_country_code":"Country"
      }'::jsonb,
      '31000000-0000-4000-8000-000000000001'
    )
  ),
  3,
  'committed import replay returns the prior skipped count'
);
select is(
  (
    select count(*)
    from public.members
    where email = 'new-import@example.test'
  ),
  1::bigint,
  'idempotent import produces one member row'
);
select is(
  (
    select club_tier_id
    from public.members
    where email = 'new-import@example.test'
  ),
  '33000000-0000-4000-8000-000000000001'::uuid,
  'validated tier name is committed as the canonical tier ID'
);
select is(
  (
    select joined_on
    from public.members
    where email = 'new-import@example.test'
  ),
  '2026-01-05'::date,
  'preview-normalized join date is preserved'
);
select is(
  (
    select jsonb_build_object(
      'line1', shipping_address_line1,
      'line2', shipping_address_line2,
      'city', shipping_city,
      'region', shipping_region,
      'postal_code', shipping_postal_code,
      'country_code', shipping_country_code
    )
    from public.members
    where email = 'new-import@example.test'
  ),
  '{
    "line1":"99 Import Lane",
    "line2":"Suite 2",
    "city":"Napa",
    "region":"CA",
    "postal_code":"94558",
    "country_code":"US"
  }'::jsonb,
  'preview-normalized address fields are preserved'
);
select is(
  (
    select jsonb_build_object(
      'status', status,
      'errors', validation_errors
    )
    from public.member_import_rows
    where import_id = '38000000-0000-4000-8000-000000000001'
      and row_number = 2
  ),
  '{
    "status":"invalid",
    "errors":["Last name is required."]
  }'::jsonb,
  'a preview-invalid row is not reclassified during commit'
);

select ok(
  (
    select valid
    from public.verify_audit_chain(
      '32000000-0000-4000-8000-000000000001'
    )
  ),
  'per-organization audit hash chain verifies'
);
select ok(
  (
    select bool_and(
      previous_hash is null
      or previous_hash = lagged_hash
    )
    from (
      select
        previous_hash,
        lag(entry_hash) over (order by sequence_number) as lagged_hash
      from public.audit_log
      where organization_id = '32000000-0000-4000-8000-000000000001'
    ) as chained
  ),
  'each audit entry points to the preceding organization hash'
);
select throws_ok(
  $$ update public.audit_log set action = 'tampered' where organization_id = '32000000-0000-4000-8000-000000000001' $$,
  '55000',
  'audit_log is append-only',
  'audit ledger rejects mutation'
);
select throws_ok(
  $$ update public.releases set status = 'draft' where id = '35000000-0000-4000-8000-000000000001' $$,
  '23514',
  'Invalid release status transition.',
  'completed releases cannot transition backward'
);

select * from finish();
rollback;
