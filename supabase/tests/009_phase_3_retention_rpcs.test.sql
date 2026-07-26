begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(54);

insert into auth.users (id, email)
values
  ('81000000-0000-4000-8000-000000000001', 'phase3-rpc-owner@example.test'),
  ('81000000-0000-4000-8000-000000000002', 'phase3-rpc-member@example.test'),
  ('81000000-0000-4000-8000-000000000003', 'phase3-rpc-referrer@example.test'),
  ('81000000-0000-4000-8000-000000000004', 'phase3-rpc-cancel@example.test');

insert into public.organizations (id, name, plan_tier)
values (
  '82000000-0000-4000-8000-000000000001',
  'Phase 3 RPC Winery',
  'estate'
);

insert into public.staff_users (id, organization_id, email, role)
values (
  '81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  'phase3-rpc-owner@example.test',
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
values
  ('83000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'Estate', 15000, 3, 'quarterly'),
  ('83000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', 'Cellar', 10000, 2, 'quarterly'),
  ('83000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000001', 'Vine', 5000, 1, 'quarterly');

insert into public.members (
  id,
  auth_user_id,
  organization_id,
  email,
  first_name,
  last_name,
  club_tier_id,
  joined_on,
  birthday,
  shipping_address_line1,
  shipping_city,
  shipping_region,
  shipping_postal_code
)
values
  (
    '84000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000003',
    '82000000-0000-4000-8000-000000000001',
    'phase3-rpc-referrer@example.test',
    'Referral',
    'Member',
    '83000000-0000-4000-8000-000000000003',
    current_date - 730,
    null,
    '2 Vine Way',
    'Napa',
    'CA',
    '94558'
  ),
  (
    '84000000-0000-4000-8000-000000000003',
    '81000000-0000-4000-8000-000000000004',
    '82000000-0000-4000-8000-000000000001',
    'phase3-rpc-cancel@example.test',
    'Cancel',
    'Member',
    '83000000-0000-4000-8000-000000000003',
    current_date - 100,
    null,
    '3 Vine Way',
    'Napa',
    'CA',
    '94558'
  );

insert into public.members (
  id,
  auth_user_id,
  organization_id,
  email,
  first_name,
  last_name,
  club_tier_id,
  referred_by_member_id,
  joined_on,
  birthday,
  shipping_address_line1,
  shipping_city,
  shipping_region,
  shipping_postal_code
)
values (
  '84000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000002',
  '82000000-0000-4000-8000-000000000001',
  'phase3-rpc-member@example.test',
  'Estate',
  'Member',
  '83000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000002',
  current_date - 365,
  current_date,
  '1 Estate Way',
  'Napa',
  'CA',
  '94558'
);

select is((select count(*) from public.email_log), 3::bigint, 'member signup enqueues three welcome logs');
select is((select count(*) from public.email_outbox), 3::bigint, 'welcome messages have durable outbox jobs');
select is(
  (
    select payload ->> 'organization_name'
    from public.email_log
    where member_id = '84000000-0000-4000-8000-000000000001'
  ),
  'Phase 3 RPC Winery',
  'email payload contains organization rendering context'
);
select is(
  (
    select payload ->> 'member_first_name'
    from public.email_log
    where member_id = '84000000-0000-4000-8000-000000000001'
  ),
  'Estate',
  'email payload contains member rendering context'
);
select is(
  public.enqueue_email_trigger(
    '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    'welcome',
    'email:welcome:84000000-0000-4000-8000-000000000001',
    '{}'::jsonb,
    now()
  ),
  (
    select id from public.email_log
    where idempotency_key = 'email:welcome:84000000-0000-4000-8000-000000000001'
  ),
  'email enqueue returns the original exact-once record'
);
select is(
  (select count(*) from public.claim_email_outbox_batch('phase3-rpc-worker', 100, 300)),
  3::bigint,
  'email worker atomically claims all due jobs'
);
select is(
  (
    select count(*) from public.email_outbox
    where status = 'processing' and worker_id = 'phase3-rpc-worker'
  ),
  3::bigint,
  'claimed jobs persist their lease owner'
);
select ok(
  public.mark_email_delivery(
    '82000000-0000-4000-8000-000000000001',
    (
      select id from public.email_log
      where member_id = '84000000-0000-4000-8000-000000000001'
        and trigger_type = 'welcome'
    ),
    'sent',
    'email_phase3rpcwelcome',
    null
  ),
  'provider send result converges email state'
);
select ok(
  public.record_email_delivery_event(
    '82000000-0000-4000-8000-000000000001',
    (
      select id from public.email_log
      where member_id = '84000000-0000-4000-8000-000000000001'
        and trigger_type = 'welcome'
    ),
    'resend-event-open-1',
    'opened',
    now(),
    '{}'::jsonb
  ),
  'open event is recorded'
);
select ok(
  public.record_email_delivery_event(
    '82000000-0000-4000-8000-000000000001',
    (
      select id from public.email_log
      where member_id = '84000000-0000-4000-8000-000000000001'
        and trigger_type = 'welcome'
    ),
    'resend-event-click-1',
    'clicked',
    now(),
    '{}'::jsonb
  ),
  'click event is recorded separately'
);
select ok(
  not public.record_email_delivery_event(
    '82000000-0000-4000-8000-000000000001',
    (
      select id from public.email_log
      where member_id = '84000000-0000-4000-8000-000000000001'
        and trigger_type = 'welcome'
    ),
    'resend-event-click-1',
    'clicked',
    now(),
    '{}'::jsonb
  ),
  'provider event replay is ignored'
);
select ok(
  public.enqueue_test_email(
    '82000000-0000-4000-8000-000000000001',
    (
      select id from public.email_templates
      where organization_id = '82000000-0000-4000-8000-000000000001'
        and trigger_type = 'welcome'
    ),
    'staff-test@example.test',
    'Test subject',
    '<p>Test body</p>',
    'email:test:phase3-rpc',
    '81000000-0000-4000-8000-000000000001'
  ) is not null,
  'staff test email is queued safely'
);
select ok(
  exists (
    select 1 from public.email_log
    where idempotency_key = 'email:test:phase3-rpc'
      and is_test
      and member_id is null
      and requested_by = '81000000-0000-4000-8000-000000000001'
  ),
  'test delivery is logged without a fake member'
);

select ok(
  public.issue_email_unsubscribe_token(
    '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    'welcome',
    repeat('signed-token-', 4),
    'key-v1',
    now() - interval '1 minute',
    now() + interval '1 day'
  ) is not null,
  'signed unsubscribe token state is issued'
);
select is(
  (
    select count(*) from public.apply_email_unsubscribe(repeat('signed-token-', 4))
  ),
  1::bigint,
  'valid unsubscribe token is consumed once'
);
select ok(
  exists (
    select 1 from public.member_email_preferences
    where member_id = '84000000-0000-4000-8000-000000000001'
      and trigger_type = 'welcome'
      and not enabled
  ),
  'unsubscribe disables only the selected trigger'
);
select throws_ok(
  $$ select * from public.apply_email_unsubscribe(repeat('signed-token-', 4)) $$,
  '22023',
  'Unsubscribe token is expired or already used.',
  'unsubscribe token cannot be replayed'
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
  '85000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  'Swap Release',
  current_date + 3,
  current_date,
  'scheduled',
  '81000000-0000-4000-8000-000000000001'
);

insert into public.release_tiers (
  id,
  organization_id,
  release_id,
  tier_id
)
values (
  '86000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001'
);

select is(
  public.enqueue_due_email_triggers(now()),
  2,
  'birthday and three-day pre-shipment jobs enqueue deterministically'
);
select is(
  public.enqueue_due_email_triggers(now()),
  2,
  'scheduled email rerun returns the same two idempotent message records'
);
select is(
  (
    select count(*) from public.email_log
    where trigger_type in ('birthday', 'pre_shipment')
  ),
  2::bigint,
  'scheduled email rerun does not duplicate logs'
);

select is(
  public.calculate_nightly_churn_scores(now(), '82000000-0000-4000-8000-000000000001'),
  3,
  'nightly churn scoring covers every non-deleted member'
);
select ok(
  (
    select bool_and(score between 0 and 100)
    from public.churn_scores
  ),
  'all churn scores remain bounded'
);
select ok(
  (
    select contributing_factors
      ?& array[
        'shipment_inactivity',
        'declined_charges_12m',
        'membership_tenure',
        'email_open_rate_90d',
        'email_click_rate_90d',
        'portal_activity',
        'tier_downgrades_12m'
      ]
    from public.churn_scores
    where member_id = '84000000-0000-4000-8000-000000000001'
  ),
  'churn snapshot explains every specified rule independently'
);
select is(
  (
    select count(*) from public.churn_scores
    where score_date = current_date
  ),
  3::bigint,
  'nightly reruns keep one snapshot per member and day'
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
values
  ('85000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', 'Redeem Release', current_date + 60, current_date, 'scheduled', '81000000-0000-4000-8000-000000000001'),
  ('85000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000001', 'Zero Net Release', current_date + 90, current_date, 'scheduled', '81000000-0000-4000-8000-000000000001');

insert into public.release_tiers (
  id,
  organization_id,
  release_id,
  tier_id
)
values
  ('86000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000001'),
  ('86000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000003', '83000000-0000-4000-8000-000000000001');

insert into public.release_wines (
  id,
  organization_id,
  release_id,
  wine_name,
  vintage,
  sku
)
values
  ('87000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'Original Cabernet', 2024, 'ORIGINAL-24'),
  ('87000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'Alternative Merlot', 2024, 'ALTERNATIVE-24');

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
values
  ('88000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', '{"line1":"1 Estate Way","state":"CA"}', 15000),
  ('88000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000002', '86000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000001', '{"line1":"1 Estate Way","state":"CA"}', 15000),
  ('88000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000003', '86000000-0000-4000-8000-000000000003', '83000000-0000-4000-8000-000000000001', '{"line1":"1 Estate Way","state":"CA"}', 1000);

insert into public.shipment_items (
  id,
  organization_id,
  shipment_id,
  release_wine_id,
  wine_name,
  vintage,
  sku,
  quantity,
  price_cents
)
values (
  '89000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  '88000000-0000-4000-8000-000000000001',
  '87000000-0000-4000-8000-000000000001',
  'Original Cabernet',
  2024,
  'ORIGINAL-24',
  3,
  5000
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated","organization_id":"82000000-0000-4000-8000-000000000001","user_role":"member","auth_surface":"member","platform_role":null}';

select ok(
  (public.start_cancel_flow(
    '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001'
  )).id is not null,
  'authenticated member starts their own cancel attempt'
);
select is(
  jsonb_array_length((
    select configuration_snapshot from public.cancel_flow_attempts
    where member_id = '84000000-0000-4000-8000-000000000001'
      and status = 'in_progress'
  )),
  4,
  'cancel attempt snapshots all configured steps'
);
select lives_ok(
  $$ select public.record_cancel_flow_step(
    '82000000-0000-4000-8000-000000000001',
    (select id from public.cancel_flow_attempts where member_id = '84000000-0000-4000-8000-000000000001' and status = 'in_progress'),
    (select id from public.cancel_flow_steps where organization_id = '82000000-0000-4000-8000-000000000001' and step_type = 'pause'),
    'continued',
    '{}'::jsonb
  ) $$,
  'member continues past pause'
);
select lives_ok(
  $$ select public.record_cancel_flow_step(
    '82000000-0000-4000-8000-000000000001',
    (select id from public.cancel_flow_attempts where member_id = '84000000-0000-4000-8000-000000000001' and status = 'in_progress'),
    (select id from public.cancel_flow_steps where organization_id = '82000000-0000-4000-8000-000000000001' and step_type = 'downgrade'),
    'continued',
    '{}'::jsonb
  ) $$,
  'member continues past downgrade'
);
select lives_ok(
  $$ select public.record_cancel_flow_step(
    '82000000-0000-4000-8000-000000000001',
    (select id from public.cancel_flow_attempts where member_id = '84000000-0000-4000-8000-000000000001' and status = 'in_progress'),
    (select id from public.cancel_flow_steps where organization_id = '82000000-0000-4000-8000-000000000001' and step_type = 'swap'),
    'swapped',
    '{"shipment_id":"88000000-0000-4000-8000-000000000001","shipment_item_id":"89000000-0000-4000-8000-000000000001","target_release_wine_id":"87000000-0000-4000-8000-000000000002"}'::jsonb
  ) $$,
  'swap offer atomically changes an eligible unpacked shipment'
);
select is(
  (
    select status from public.cancel_flow_attempts
    where member_id = '84000000-0000-4000-8000-000000000001'
  ),
  'intercepted'::public.cancel_attempt_status,
  'accepted swap intercepts cancellation'
);

reset role;
set local request.jwt.claims = '{}';

select is(
  (
    select release_wine_id from public.shipment_items
    where id = '89000000-0000-4000-8000-000000000001'
  ),
  '87000000-0000-4000-8000-000000000002'::uuid,
  'swap persists the alternative release wine'
);
select ok(
  (
    select quantity = 3 and price_cents = 5000
    from public.shipment_items
    where id = '89000000-0000-4000-8000-000000000001'
  ),
  'swap preserves shipment quantity and snapshot price'
);
select ok(
  exists (
    select 1 from public.audit_log
    where action = 'cancel_flow.swapped'
      and metadata -> 'details' ->> 'source_release_wine_id'
        = '87000000-0000-4000-8000-000000000001'
  ),
  'swap audit records old and new identifiers'
);

update public.shipments
set status = 'charged', paid_at = now()
where id = '88000000-0000-4000-8000-000000000001';

-- Phase 4 adds a fail-closed pre-label compliance gate. Keep this Phase 3
-- regression runnable both before and after that migration without creating a
-- compile-time dependency on the later RPC.
set local request.jwt.claims = '{"role":"service_role"}';
do $$
begin
  if to_regproc('public.record_shipment_compliance_check') is not null then
    execute $phase4$
      select public.record_shipment_compliance_check(
        '82000000-0000-4000-8000-000000000001',
        '88000000-0000-4000-8000-000000000001',
        'compliant',
        null,
        0,
        'simulated-phase3-label-gate',
        'simulated',
        now(),
        '81000000-0000-4000-8000-000000000001',
        '{"recipient_state_allowed":true,"origin_to_recipient_allowed":true,"age_verified":true,"volume_within_limit":true,"rules_version":"phase3-regression","request_fingerprint_sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}'::jsonb
      )
    $phase4$;
  end if;
end;
$$;
set local request.jwt.claims = '{}';

update public.shipments
set
  status = 'label_created',
  tracking_number = 'TRACK-PHASE3',
  carrier = 'UPS',
  shipping_provider = 'easypost',
  external_label_id = 'label_phase3',
  label_url = 'https://example.test/label',
  label_created_at = now()
where id = '88000000-0000-4000-8000-000000000001';

select ok(
  exists (
    select 1 from public.email_log
    where trigger_type = 'shipped'
      and payload ->> 'tracking_number' = 'TRACK-PHASE3'
  ),
  'label creation enqueues tracking email'
);

update public.shipment_items
set packed_quantity = quantity
where shipment_id = '88000000-0000-4000-8000-000000000001';
update public.shipments set status = 'packed', packed_at = now()
where id = '88000000-0000-4000-8000-000000000001';
update public.shipments set status = 'shipped', shipped_at = now()
where id = '88000000-0000-4000-8000-000000000001';
update public.shipments set status = 'delivered', delivered_at = now()
where id = '88000000-0000-4000-8000-000000000001';

select is(
  (
    select points from public.loyalty_ledger
    where member_id = '84000000-0000-4000-8000-000000000001'
      and source_event_type = 'shipment_delivered'
  ),
  150,
  'Estate multiplier awards 150 points for delivery'
);
select is(
  (
    select points from public.loyalty_ledger
    where member_id = '84000000-0000-4000-8000-000000000002'
      and source_event_type = 'referral_completed'
  ),
  200,
  'referrer receives exact first-shipment award'
);
select is(
  (
    select count(*) from public.member_activity_events
    where source_entity_id = '88000000-0000-4000-8000-000000000001'
      and event_type in ('shipment_delivered', 'referral_completed')
  ),
  2::bigint,
  'delivery creates one member and one referral event'
);

update public.members
set club_tier_id = '83000000-0000-4000-8000-000000000002'
where id = '84000000-0000-4000-8000-000000000001';
select is(
  (
    select count(*) from public.member_activity_events
    where member_id = '84000000-0000-4000-8000-000000000001'
      and event_type = 'tier_downgrade'
  ),
  1::bigint,
  'lower-priced tier update records one canonical downgrade'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated","organization_id":"82000000-0000-4000-8000-000000000001","user_role":"member","auth_surface":"member","platform_role":null}';
select is(
  (public.reserve_loyalty_discount(
    '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    '88000000-0000-4000-8000-000000000002',
    100,
    'loyalty:reserve:rpc-one'
  )).discount_cents,
  1000,
  'member reserves a configured discount'
);

reset role;
set local request.jwt.claims = '{}';
select is(
  public.net_shipment_charge_cents(
    '82000000-0000-4000-8000-000000000001',
    '88000000-0000-4000-8000-000000000002'
  ),
  14000,
  'net charge subtracts the held loyalty discount'
);
select throws_ok(
  $$ select public.record_billing_attempt(
    '82000000-0000-4000-8000-000000000001',
    '88000000-0000-4000-8000-000000000002',
    'charge',
    15000,
    'billing:gross:rejected',
    'pi_GrossRejected'
  ) $$,
  '22023',
  'Charge amount must match the net shipment amount.',
  'gross billing amount is rejected after loyalty reservation'
);
select ok(
  public.record_billing_attempt(
    '82000000-0000-4000-8000-000000000001',
    '88000000-0000-4000-8000-000000000002',
    'charge',
    14000,
    'billing:net:accepted',
    'pi_NetAccepted'
  ) is not null,
  'net billing amount is accepted'
);
update public.shipments set status = 'charged'
where id = '88000000-0000-4000-8000-000000000002';
select is(
  (
    select status from public.loyalty_redemptions
    where shipment_id = '88000000-0000-4000-8000-000000000002'
  ),
  'applied'::public.loyalty_redemption_status,
  'charged shipment atomically applies held redemption'
);
select is(
  (
    select sum(remaining_points - reserved_points)::integer
    from public.loyalty_point_lots
    where member_id = '84000000-0000-4000-8000-000000000001'
  ),
  50,
  'FIFO application consumes reserved points'
);
update public.shipments set status = 'refunded'
where id = '88000000-0000-4000-8000-000000000002';
select is(
  (
    select status from public.loyalty_redemptions
    where shipment_id = '88000000-0000-4000-8000-000000000002'
  ),
  'reversed'::public.loyalty_redemption_status,
  'refunded shipment restores applied loyalty points'
);
select is(
  (
    select sum(remaining_points - reserved_points)::integer
    from public.loyalty_point_lots
    where member_id = '84000000-0000-4000-8000-000000000001'
  ),
  150,
  'refund reversal restores lot availability'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated","organization_id":"82000000-0000-4000-8000-000000000001","user_role":"member","auth_surface":"member","platform_role":null}';
select ok(
  (public.reserve_loyalty_discount(
    '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    '88000000-0000-4000-8000-000000000003',
    100,
    'loyalty:reserve:zero-net'
  )).id is not null,
  'full redemption can reserve a zero-net shipment'
);
reset role;
set local request.jwt.claims = '{}';
select is(
  public.net_shipment_charge_cents(
    '82000000-0000-4000-8000-000000000001',
    '88000000-0000-4000-8000-000000000003'
  ),
  0,
  'full loyalty discount produces an explicit zero net'
);
select ok(
  public.record_billing_attempt(
    '82000000-0000-4000-8000-000000000001',
    '88000000-0000-4000-8000-000000000003',
    'charge',
    0,
    'billing:zero:accepted',
    null,
    null,
    '{"zero_net":true}'::jsonb
  ) is not null,
  'zero-net settlement has an auditable billing attempt'
);

set local request.jwt.claims =
  '{"sub":"81000000-0000-4000-8000-000000000001","role":"service_role","organization_id":"82000000-0000-4000-8000-000000000001","user_role":"owner","auth_surface":"staff","platform_role":null}';
select ok(
  public.adjust_loyalty_points(
    '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    25,
    'Service recovery adjustment',
    'loyalty:manual:rpc',
    '81000000-0000-4000-8000-000000000001'
  ) is not null,
  'staff manual adjustment succeeds with reason'
);
select ok(
  exists (
    select 1 from public.audit_log
    where action = 'loyalty.manually_adjusted'
      and metadata ->> 'reason' = 'Service recovery adjustment'
  ),
  'manual loyalty adjustment is audit logged'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"81000000-0000-4000-8000-000000000003","role":"authenticated","organization_id":"82000000-0000-4000-8000-000000000001","user_role":"member","auth_surface":"member","platform_role":null}';
select ok(
  (public.start_cancel_flow(
    '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000002'
  )).id is not null,
  'second member starts pause path'
);
select lives_ok(
  $$ select public.record_cancel_flow_step(
    '82000000-0000-4000-8000-000000000001',
    (select id from public.cancel_flow_attempts where member_id = '84000000-0000-4000-8000-000000000002' and status = 'in_progress'),
    (select id from public.cancel_flow_steps where organization_id = '82000000-0000-4000-8000-000000000001' and step_type = 'pause'),
    'paused',
    '{"pause_months":1}'::jsonb
  ) $$,
  'pause offer applies member lifecycle change'
);
select is(
  (
    select status from public.members
    where id = '84000000-0000-4000-8000-000000000002'
  ),
  'paused'::public.member_status,
  'accepted pause keeps member from cancellation'
);

select * from finish();
rollback;
