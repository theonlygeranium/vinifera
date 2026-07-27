begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(61);

insert into auth.users (id, email)
values
  ('d1000000-0000-4000-8000-000000000001', 'retention-owner@example.test'),
  ('d1000000-0000-4000-8000-000000000002', 'retention-member-1@example.test'),
  ('d1000000-0000-4000-8000-000000000003', 'retention-member-2@example.test'),
  ('d1000000-0000-4000-8000-000000000004', 'retention-member-3@example.test'),
  ('d1000000-0000-4000-8000-000000000005', 'retention-member-4@example.test'),
  ('d1000000-0000-4000-8000-000000000006', 'retention-default-1@example.test'),
  ('d1000000-0000-4000-8000-000000000007', 'retention-default-2@example.test');

insert into public.organizations (
  id,
  name,
  plan_tier,
  subscription_status,
  loyalty_enabled
)
values (
  'd2000000-0000-4000-8000-000000000001',
  'Retention Architecture Winery',
  'vine',
  'active',
  true
);

insert into public.staff_users (id, organization_id, email, role)
values (
  'd1000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'retention-owner@example.test',
  'owner'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

insert into public.brands (
  id,
  organization_id,
  name,
  slug,
  active
)
values (
  'd3000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'Retention Reserve',
  'retention-reserve',
  true
);

select is(
  (
    select count(*)
    from public.email_templates
    where organization_id = 'd2000000-0000-4000-8000-000000000001'
      and brand_id = 'd3000000-0000-4000-8000-000000000001'
  ),
  6::bigint,
  'new brands receive all Phase 3 email templates'
);

select is(
  (
    select count(*)
    from public.cancel_flow_steps
    where organization_id = 'd2000000-0000-4000-8000-000000000001'
      and brand_id = 'd3000000-0000-4000-8000-000000000001'
  ),
  4::bigint,
  'new brands receive all cancel flow steps'
);

select ok(
  exists (
    select 1
    from public.cancel_flow_steps
    where organization_id = 'd2000000-0000-4000-8000-000000000001'
      and brand_id = 'd3000000-0000-4000-8000-000000000001'
      and step_type = 'confirm'
      and position = 4
      and enabled
  ),
  'new brand confirmation is enabled and last'
);

select ok(
  (
    select condeferrable
    from pg_constraint
    where conname = 'cancel_flow_steps_org_position_key'
  ),
  'cancel step position uniqueness is deferrable'
);

select lives_ok(
  $statement$
    select *
    from public.update_cancel_flow_configuration(
      'd2000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000001',
      '[
        {"step_type":"downgrade","position":1,"enabled":true,"headline":"Lower tier","body":"Choose a lower tier.","configuration":{}},
        {"step_type":"pause","position":2,"enabled":true,"headline":"Pause","body":"Pause membership.","configuration":{"pause_months":[1,3]}},
        {"step_type":"swap","position":3,"enabled":true,"headline":"Swap","body":"Swap a wine.","configuration":{}},
        {"step_type":"confirm","position":4,"enabled":true,"headline":"Confirm","body":"Confirm cancellation.","configuration":{}}
      ]'::jsonb,
      'd1000000-0000-4000-8000-000000000001'
    )
  $statement$,
  'brand cancel configuration can reorder through the deferrable constraint'
);

select throws_ok(
  $statement$
    select *
    from public.update_cancel_flow_configuration(
      'd2000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000001',
      '[
        {"step_type":"pause","position":1,"enabled":true,"headline":"Pause","body":"Pause membership.","configuration":{}},
        {"step_type":"downgrade","position":2,"enabled":true,"headline":"Lower","body":"Lower tier.","configuration":{}},
        {"step_type":"swap","position":3,"enabled":true,"headline":"Swap","body":"Swap wine.","configuration":{}},
        {"step_type":"confirm","position":4,"enabled":false,"headline":"Confirm","body":"Confirm.","configuration":{}}
      ]'::jsonb,
      'd1000000-0000-4000-8000-000000000001'
    )
  $statement$,
  '22023',
  'The confirmation step must be enabled and last.',
  'cancel configuration rejects a disabled confirmation'
);

-- Return pause to the first position before capturing an immutable attempt.
select lives_ok(
  $statement$
    select *
    from public.update_cancel_flow_configuration(
      'd2000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000001',
      '[
        {"step_type":"pause","position":1,"enabled":true,"headline":"Pause","body":"Pause membership.","configuration":{"pause_months":[1,3]}},
        {"step_type":"downgrade","position":2,"enabled":true,"headline":"Lower tier","body":"Choose a lower tier.","configuration":{}},
        {"step_type":"swap","position":3,"enabled":true,"headline":"Swap","body":"Swap a wine.","configuration":{}},
        {"step_type":"confirm","position":4,"enabled":true,"headline":"Confirm","body":"Confirm cancellation.","configuration":{}}
      ]'::jsonb,
      'd1000000-0000-4000-8000-000000000001'
    )
  $statement$,
  'valid cancel configuration restores pause as the first step'
);

insert into public.members (
  id,
  organization_id,
  brand_id,
  auth_user_id,
  email,
  first_name,
  last_name,
  joined_on
)
values
  (
    'd4000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000002',
    'retention-member-1@example.test',
    'Reserve',
    'One',
    current_date
  ),
  (
    'd4000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000003',
    'retention-member-2@example.test',
    'Reserve',
    'Two',
    current_date
  ),
  (
    'd4000000-0000-4000-8000-000000000003',
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000004',
    'retention-member-3@example.test',
    'Reserve',
    'Three',
    current_date
  ),
  (
    'd4000000-0000-4000-8000-000000000004',
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000005',
    'retention-member-4@example.test',
    'Reserve',
    'Four',
    current_date
  ),
  (
    'd4000000-0000-4000-8000-000000000005',
    'd2000000-0000-4000-8000-000000000001',
    (
      select default_brand_id
      from public.organizations
      where id = 'd2000000-0000-4000-8000-000000000001'
    ),
    'd1000000-0000-4000-8000-000000000006',
    'retention-default-1@example.test',
    'Default',
    'One',
    current_date
  ),
  (
    'd4000000-0000-4000-8000-000000000006',
    'd2000000-0000-4000-8000-000000000001',
    (
      select default_brand_id
      from public.organizations
      where id = 'd2000000-0000-4000-8000-000000000001'
    ),
    'd1000000-0000-4000-8000-000000000007',
    'retention-default-2@example.test',
    'Default',
    'Two',
    current_date
  );

create temporary table shared_activity_keys as
select public.record_member_activity_event(
  'd2000000-0000-4000-8000-000000000001',
  member_id,
  'portal_login',
  'member',
  member_id,
  'activity:shared-across-brands',
  now(),
  '{}'::jsonb
) as event_id
from (
  values
    ('d4000000-0000-4000-8000-000000000001'::uuid),
    ('d4000000-0000-4000-8000-000000000005'::uuid)
) as fixture(member_id);

select is(
  (select count(distinct event_id) from shared_activity_keys),
  2::bigint,
  'member activity idempotency keys are independent across brands'
);

create temporary table shared_ledger_keys as
select public.adjust_loyalty_points_command(
  'd2000000-0000-4000-8000-000000000001',
  brand_id,
  member_id,
  25,
  'Cross-brand idempotency proof',
  'd1000000-0000-4000-8000-000000000001',
  'd6000000-0000-4000-8000-000000000010',
  repeat('9', 64)
) as ledger_id
from (
  values
    (
      'd3000000-0000-4000-8000-000000000001'::uuid,
      'd4000000-0000-4000-8000-000000000001'::uuid
    ),
    (
      (
        select default_brand_id
        from public.organizations
        where id = 'd2000000-0000-4000-8000-000000000001'
      ),
      'd4000000-0000-4000-8000-000000000005'::uuid
    )
) as fixture(brand_id, member_id);

select is(
  (select count(distinct ledger_id) from shared_ledger_keys),
  2::bigint,
  'loyalty ledger idempotency keys are independent across brands'
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
    'e1000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'Reserve Fixture Tier',
    10000,
    3,
    'quarterly'
  ),
  (
    'e1000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000001',
    (
      select default_brand_id
      from public.organizations
      where id = 'd2000000-0000-4000-8000-000000000001'
    ),
    'Default Fixture Tier',
    10000,
    3,
    'quarterly'
  );

insert into public.releases (
  id,
  organization_id,
  brand_id,
  name,
  processing_date,
  embargo_date
)
values
  (
    'e2000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'Reserve Fixture Release',
    current_date + 30,
    current_date + 1
  ),
  (
    'e2000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000001',
    (
      select default_brand_id
      from public.organizations
      where id = 'd2000000-0000-4000-8000-000000000001'
    ),
    'Default Fixture Release',
    current_date + 30,
    current_date + 1
  );

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
    'e3000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'Reserve Fixture Tier',
    10000,
    3
  ),
  (
    'e3000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000001',
    (
      select default_brand_id
      from public.organizations
      where id = 'd2000000-0000-4000-8000-000000000001'
    ),
    'e2000000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000002',
    'Default Fixture Tier',
    10000,
    3
  );

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
values
  (
    'e4000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'd4000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    '{}'::jsonb,
    10000
  ),
  (
    'e4000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000001',
    (
      select default_brand_id
      from public.organizations
      where id = 'd2000000-0000-4000-8000-000000000001'
    ),
    'd4000000-0000-4000-8000-000000000005',
    'e2000000-0000-4000-8000-000000000002',
    'e3000000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000002',
    '{}'::jsonb,
    10000
  );

insert into public.loyalty_redemptions (
  id,
  organization_id,
  brand_id,
  member_id,
  shipment_id,
  idempotency_key,
  points,
  discount_cents,
  points_per_unit,
  discount_unit_cents,
  expires_at
)
values
  (
    'e5000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'd4000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001',
    'redemption:shared-across-brands',
    100,
    1000,
    100,
    1000,
    now() + interval '1 hour'
  ),
  (
    'e5000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000001',
    (
      select default_brand_id
      from public.organizations
      where id = 'd2000000-0000-4000-8000-000000000001'
    ),
    'd4000000-0000-4000-8000-000000000005',
    'e4000000-0000-4000-8000-000000000002',
    'redemption:shared-across-brands',
    100,
    1000,
    100,
    1000,
    now() + interval '1 hour'
  );

select is(
  (
    select count(*)
    from public.loyalty_redemptions
    where organization_id = 'd2000000-0000-4000-8000-000000000001'
      and idempotency_key = 'redemption:shared-across-brands'
  ),
  2::bigint,
  'loyalty redemption idempotency keys are independent across brands'
);

create temporary table attempt_one as
select (
  public.start_cancel_flow(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'd4000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'd5000000-0000-4000-8000-000000000001',
    repeat('a', 64)
  )
).*;

select is(
  (select brand_id from attempt_one),
  'd3000000-0000-4000-8000-000000000001'::uuid,
  'cancel attempt is explicitly brand scoped'
);

select is(
  (select jsonb_array_length(configuration_snapshot) from attempt_one),
  4,
  'cancel attempt captures all four immutable steps'
);

select is(
  (
    select count(*)
    from private.retention_command_results
    where command_id = 'd5000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'cancel start persists one durable command result'
);

update public.cancel_flow_steps
set enabled = false, headline = 'Changed after attempt'
where organization_id = 'd2000000-0000-4000-8000-000000000001'
  and brand_id = 'd3000000-0000-4000-8000-000000000001'
  and step_type = 'pause';

create temporary table continued_one as
select (
  public.record_cancel_flow_step(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    (select id from attempt_one),
    (select current_step_id from attempt_one),
    'continued',
    '{}'::jsonb,
    'd1000000-0000-4000-8000-000000000001',
    'd5000000-0000-4000-8000-000000000002',
    repeat('b', 64)
  )
).*;

select is(
  (
    select snapshot.position
    from continued_one as attempt
    cross join lateral jsonb_to_recordset(attempt.configuration_snapshot)
      as snapshot(id uuid, position integer)
    where snapshot.id = attempt.current_step_id
  ),
  2,
  'cancel progression uses the snapshot after live configuration changes'
);

select is(
  (
    select (
      public.start_cancel_flow(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000001',
        'd4000000-0000-4000-8000-000000000001',
        'd1000000-0000-4000-8000-000000000001',
        'd5000000-0000-4000-8000-000000000001',
        repeat('a', 64)
      )
    ).id
  ),
  (select id from attempt_one),
  'cancel start replay converges on the original attempt'
);

select throws_ok(
  $statement$
    select public.start_cancel_flow(
      'd2000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000001',
      'd4000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000001',
      'd5000000-0000-4000-8000-000000000001',
      repeat('c', 64)
    )
  $statement$,
  '23505',
  'Command ID was already used for a different request.',
  'cancel start rejects command fingerprint conflicts'
);

create temporary table abandoned_one as
select (
  public.record_cancel_flow_step(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    (select id from continued_one),
    (select current_step_id from continued_one),
    'abandoned',
    '{}'::jsonb,
    'd1000000-0000-4000-8000-000000000001',
    'd5000000-0000-4000-8000-000000000003',
    repeat('c', 64)
  )
).*;

select is(
  (select status::text from abandoned_one),
  'abandoned',
  'cancel command records terminal abandonment'
);

select throws_ok(
  $statement$
    select public.record_cancel_flow_step(
      'd2000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000001',
      (select id from abandoned_one),
      (select current_step_id from abandoned_one),
      'abandoned',
      '{}'::jsonb,
      'd1000000-0000-4000-8000-000000000003',
      'd5000000-0000-4000-8000-000000000004',
      repeat('d', 64)
    )
  $statement$,
  '42501',
  'Actor cannot manage this brand member.',
  'actor validation runs before terminal attempt handling'
);

create temporary table stale_attempt as
select (
  public.start_cancel_flow(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'd4000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000001',
    'd5000000-0000-4000-8000-000000000005',
    repeat('e', 64)
  )
).*;

update public.cancel_flow_attempts
set
  started_at = now() - interval '2 days',
  expires_at = now() - interval '1 day'
where id = (select id from stale_attempt);

select is(
  public.expire_stale_cancel_flow_attempts(now(), 10),
  1,
  'bounded stale-attempt job expires one attempt'
);

select is(
  (
    select status::text
    from public.cancel_flow_attempts
    where id = (select id from stale_attempt)
  ),
  'abandoned',
  'stale attempt becomes abandoned'
);

update public.cancel_flow_steps
set enabled = true
where organization_id = 'd2000000-0000-4000-8000-000000000001'
  and brand_id = 'd3000000-0000-4000-8000-000000000001'
  and step_type = 'pause';

create temporary table pause_attempt as
select (
  public.start_cancel_flow(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'd4000000-0000-4000-8000-000000000003',
    'd1000000-0000-4000-8000-000000000001',
    'd5000000-0000-4000-8000-000000000006',
    repeat('f', 64)
  )
).*;

create temporary table paused_result as
select (
  public.record_cancel_flow_step(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    (select id from pause_attempt),
    (select current_step_id from pause_attempt),
    'paused',
    '{"pause_months":1}'::jsonb,
    'd1000000-0000-4000-8000-000000000001',
    'd5000000-0000-4000-8000-000000000007',
    repeat('1', 64)
  )
).*;

select is(
  (select status::text from paused_result),
  'intercepted',
  'pause outcome intercepts cancellation'
);

select is(
  (
    select status::text
    from public.members
    where id = 'd4000000-0000-4000-8000-000000000003'
  ),
  'paused',
  'pause outcome persists member pause state'
);

update public.members
set paused_until = current_date
where id = 'd4000000-0000-4000-8000-000000000003';

select is(
  public.resume_due_paused_members(current_date, 10),
  1,
  'bounded pause-resume job reactivates one member'
);

select is(
  (
    select status::text
    from public.members
    where id = 'd4000000-0000-4000-8000-000000000003'
  ),
  'active',
  'pause-resume job clears the paused state'
);

select lives_ok(
  $statement$
    do $do$
    begin
      begin
        update public.cancel_flow_attempts
        set current_step_id = (
          select step.id
          from public.cancel_flow_steps as step
          where step.organization_id = 'd2000000-0000-4000-8000-000000000001'
            and step.brand_id = (
              select default_brand_id
              from public.organizations
              where id = 'd2000000-0000-4000-8000-000000000001'
            )
          limit 1
        )
        where id = (select id from abandoned_one);
        raise exception 'cross-brand step unexpectedly accepted';
      exception when foreign_key_violation then
        null;
      end;
    end
    $do$
  $statement$,
  'same-brand cancel step FK rejects a sibling brand step'
);

create temporary table email_target as
select id
from public.email_log
where organization_id = 'd2000000-0000-4000-8000-000000000001'
  and brand_id = 'd3000000-0000-4000-8000-000000000001'
  and member_id = 'd4000000-0000-4000-8000-000000000004'
  and trigger_type = 'welcome';

insert into public.brand_sender_identities (
  organization_id,
  brand_id,
  from_name,
  from_email,
  status
)
values (
  'd2000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001',
  'Retention Reserve',
  'club@retention-reserve.example.test',
  'pending'
);

create temporary table pending_sender_claim as
select *
from public.claim_email_outbox_batch(
  'retention-pending-sender-worker',
  100,
  300
);

select ok(
  not exists (
    select 1
    from pending_sender_claim
    where email_log_id = (select id from email_target)
  ),
  'pending sender identity is not claimable'
);

select is(
  (
    select outbox.attempt_count
    from public.email_outbox as outbox
    where outbox.email_log_id = (select id from email_target)
  ),
  0,
  'activation-blocked sender does not consume an outbox attempt'
);

update public.brand_sender_identities
set status = 'verified', verified_at = now()
where organization_id = 'd2000000-0000-4000-8000-000000000001'
  and brand_id = 'd3000000-0000-4000-8000-000000000001';

select is(
  (
    select matched
    from public.record_email_provider_event(
      'provider-event-early-1',
      'provider-email-early-1',
      'delivered',
      now(),
      '{"source":"test"}'::jsonb
    )
  ),
  false,
  'early provider webhook is durably accepted as unmatched'
);

create temporary table claimed_email as
select *
from public.claim_email_outbox_batch('retention-test-worker', 100, 300);

select ok(
  exists (
    select 1
    from claimed_email
    where email_log_id = (select id from email_target)
      and completion_token is not null
      and unsubscribe_signed_at is not null
      and unsubscribe_expires_at > unsubscribe_signed_at
  ),
  'email claim persists token ownership and deterministic unsubscribe timestamps'
);

select is(
  public.complete_email_outbox_claim(
    (select outbox_id from claimed_email where email_log_id = (select id from email_target)),
    gen_random_uuid(),
    'sent',
    'provider-email-early-1',
    null
  ),
  false,
  'stale email completion token cannot finalize a claim'
);

select is(
  public.complete_email_outbox_claim(
    (select outbox_id from claimed_email where email_log_id = (select id from email_target)),
    (select completion_token from claimed_email where email_log_id = (select id from email_target)),
    'sent',
    'provider-email-early-1',
    null
  ),
  true,
  'claim owner can finalize an email delivery'
);

select ok(
  exists (
    select 1
    from public.email_provider_event_inbox
    where provider_event_id = 'provider-event-early-1'
      and email_log_id = (select id from email_target)
      and reconciled_at is not null
  ),
  'provider ID attachment reconciles an earlier webhook'
);

select is(
  (
    select status::text
    from public.email_log
    where id = (select id from email_target)
  ),
  'delivered',
  'delivery convergence does not regress delivered to sent'
);

select is(
  (
    select duplicate
    from public.record_email_provider_event(
      'provider-event-early-1',
      'provider-email-early-1',
      'delivered',
      (select occurred_at from public.email_provider_event_inbox where provider_event_id = 'provider-event-early-1'),
      '{"source":"test"}'::jsonb
    )
  ),
  true,
  'identical provider event replay is acknowledged as duplicate'
);

select is(
  public.enqueue_email_trigger(
    'd2000000-0000-4000-8000-000000000001',
    'd4000000-0000-4000-8000-000000000004',
    'welcome',
    'email:welcome:d4000000-0000-4000-8000-000000000004',
    '{"member_id":"d4000000-0000-4000-8000-000000000004"}'::jsonb,
    now() + interval '1 hour'
  ),
  (select id from email_target),
  'logical email replay ignores a different worker scheduling timestamp'
);

select throws_ok(
  $statement$
    select *
    from public.record_email_provider_event(
      'provider-event-early-1',
      'provider-email-conflict',
      'bounced',
      now(),
      '{"source":"conflict"}'::jsonb
    )
  $statement$,
  '23505',
  'Provider event ID was reused with conflicting content.',
  'provider event ID conflicts are rejected'
);

select throws_ok(
  $statement$
    select public.enqueue_email_trigger(
      'd2000000-0000-4000-8000-000000000001',
      'd4000000-0000-4000-8000-000000000004',
      'welcome',
      'email:welcome:d4000000-0000-4000-8000-000000000004',
      '{"changed":true}'::jsonb,
      now()
    )
  $statement$,
  '23505',
  'Email idempotency key was already used for a different request.',
  'email idempotency replay validates request intent'
);

create temporary table loyalty_adjustment as
select public.adjust_loyalty_points_command(
  'd2000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001',
  'd4000000-0000-4000-8000-000000000001',
  50,
  'Architecture test credit',
  'd1000000-0000-4000-8000-000000000001',
  'd6000000-0000-4000-8000-000000000001',
  repeat('2', 64)
) as ledger_id;

select ok(
  (select ledger_id is not null from loyalty_adjustment),
  'loyalty adjustment command writes a ledger entry'
);

select is(
  public.adjust_loyalty_points_command(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'd4000000-0000-4000-8000-000000000001',
    50,
    'Architecture test credit',
    'd1000000-0000-4000-8000-000000000001',
    'd6000000-0000-4000-8000-000000000001',
    repeat('2', 64)
  ),
  (select ledger_id from loyalty_adjustment),
  'loyalty command replay returns the original ledger entry'
);

select throws_ok(
  $statement$
    select public.adjust_loyalty_points_command(
      'd2000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000001',
      'd4000000-0000-4000-8000-000000000001',
      75,
      'Conflicting architecture credit',
      'd1000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      repeat('3', 64)
    )
  $statement$,
  '23505',
  'Command ID was already used for a different request.',
  'loyalty command replay rejects a different fingerprint'
);

select throws_ok(
  $statement$
    select public.adjust_loyalty_points_command(
      'd2000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000001',
      'd4000000-0000-4000-8000-000000000001',
      -9999,
      'Overdraw test',
      'd1000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000002',
      repeat('4', 64)
    )
  $statement$,
  '40001',
  'Loyalty availability changed; retry.',
  'negative adjustment performs a post-lock exhaustion check'
);

select ok(
  pg_get_functiondef('private.capture_shipment_retention_events()'::regprocedure)
    like '%pg_advisory_xact_lock%'
  and pg_get_functiondef('private.capture_shipment_retention_events()'::regprocedure)
    like '%activity:referral_completed:member:%',
  'referral first-delivery award is serialized with a member-stable key'
);

create temporary table near_boundary_attempt as
select (
  public.start_cancel_flow(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'd4000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000001',
    'd5000000-0000-4000-8000-000000000020',
    repeat('8', 64)
  )
).*;

update public.cancel_flow_attempts
set expires_at = clock_timestamp() + interval '1 hour'
where id = (select id from near_boundary_attempt);

update public.loyalty_point_lots
set expires_at = clock_timestamp() + interval '1 hour'
where organization_id = 'd2000000-0000-4000-8000-000000000001'
  and brand_id = 'd3000000-0000-4000-8000-000000000001'
  and award_ledger_id = (
    select ledger_id
    from shared_ledger_keys
    where ledger_id in (
      select id
      from public.loyalty_ledger
      where brand_id = 'd3000000-0000-4000-8000-000000000001'
    )
  );

update public.brands
set time_zone = case
  when id = 'd3000000-0000-4000-8000-000000000001'
    then 'Pacific/Kiritimati'
  else 'Pacific/Pago_Pago'
end
where organization_id = 'd2000000-0000-4000-8000-000000000001';

update public.members
set
  status = 'paused',
  paused_until = (
    clock_timestamp() at time zone 'Pacific/Kiritimati'
  )::date
where id = 'd4000000-0000-4000-8000-000000000001';

update public.members
set
  status = 'paused',
  paused_until = (
    clock_timestamp() at time zone 'Pacific/Pago_Pago'
  )::date + 1
where id = 'd4000000-0000-4000-8000-000000000005';

update public.members
set birthday = make_date(
  2000,
  extract(
    month from (
      clock_timestamp() at time zone 'Pacific/Kiritimati'
    )::date
  )::integer,
  extract(
    day from (
      clock_timestamp() at time zone 'Pacific/Kiritimati'
    )::date
  )::integer
)
where id = 'd4000000-0000-4000-8000-000000000004';

update public.members
set birthday = make_date(
  2000,
  extract(
    month from (
      (clock_timestamp() at time zone 'Pacific/Pago_Pago')::date + 1
    )
  )::integer,
  extract(
    day from (
      (clock_timestamp() at time zone 'Pacific/Pago_Pago')::date + 1
    )
  )::integer
)
where id = 'd4000000-0000-4000-8000-000000000006';

select is(
  (public.run_retention_daily_jobs(current_date) ->> 'replayed'),
  'false',
  'first daily retention job execution persists a durable result'
);

select is(
  (public.run_retention_daily_jobs(current_date) ->> 'replayed'),
  'true',
  'daily retention job replay returns the persisted result'
);

select ok(
  public.run_retention_daily_jobs(current_date)
    ?& array[
      'cancelAttemptsExpired',
      'churnScoresWritten',
      'loyaltyAwardsWritten',
      'loyaltyLotsExpired',
      'membersResumed'
    ],
  'daily retention result exposes the service normalization contract'
);

select is(
  (
    select status::text
    from public.cancel_flow_attempts
    where id = (select id from near_boundary_attempt)
  ),
  'in_progress',
  'first daily run does not expire an attempt due after its execution cutoff'
);

select ok(
  exists (
    select 1
    from public.loyalty_point_lots as lot
    where lot.organization_id = 'd2000000-0000-4000-8000-000000000001'
      and lot.brand_id = 'd3000000-0000-4000-8000-000000000001'
      and lot.expires_at > clock_timestamp()
      and lot.remaining_points > 0
  ),
  'first daily run does not expire a loyalty lot due after its execution cutoff'
);

select is(
  (
    select status::text
    from public.members
    where id = 'd4000000-0000-4000-8000-000000000001'
  ),
  'active',
  'UTC+14 brand resumes a member on its current local date'
);

select is(
  (
    select status::text
    from public.members
    where id = 'd4000000-0000-4000-8000-000000000005'
  ),
  'paused',
  'UTC-11 brand does not resume a member before its next local date'
);

select is(
  (
    select count(*)
    from private.retention_brand_daily_job_runs as job
    join public.brands as brand
      on brand.organization_id = job.organization_id
      and brand.id = job.brand_id
    where job.organization_id = 'd2000000-0000-4000-8000-000000000001'
      and job.job_date = (
        clock_timestamp() at time zone brand.time_zone
      )::date
  ),
  2::bigint,
  'each timezone brand records exactly its own local calendar date'
);

select is(
  (
    select count(*)
    from public.member_activity_events
    where organization_id = 'd2000000-0000-4000-8000-000000000001'
      and event_type = 'birthday'
      and member_id in (
        'd4000000-0000-4000-8000-000000000004',
        'd4000000-0000-4000-8000-000000000006'
      )
  ),
  1::bigint,
  'daily loyalty awards use each brand local date instead of one UTC date'
);

select ok(
  public.get_cancel_flow_analytics_snapshot(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    '1970-01-01T00:00:00Z',
    now() + interval '1 minute',
    100
  ) ?& array['attemptCount', 'retainedCount', 'steps', 'recentOutcomes'],
  'brand analytics snapshot exposes aggregate and recent outcome contracts'
);

select is(
  (
    public.get_cancel_flow_analytics_snapshot(
      'd2000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000001',
      '1970-01-01T00:00:00Z',
      now() + interval '1 minute',
      100
    ) ->> 'retentionRate'
  )::numeric,
  1.0000::numeric,
  'retention KPI excludes open and abandoned attempts from completed decisions'
);

select ok(
  (
    select analytics.viewed_count
    from public.get_cancel_flow_analytics(
      'd2000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000001',
      '1970-01-01T00:00:00Z',
      now() + interval '1 minute'
    ) as analytics
    where analytics.step_type = 'pause'
  ) > 0,
  'step reach is populated by real continued and intercepted decisions'
);

select ok(
  not exists (
    select 1
    from jsonb_array_elements(
      public.get_cancel_flow_analytics_snapshot(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000001',
        '1970-01-01T00:00:00Z',
        now() + interval '1 minute',
        100
      ) -> 'recentOutcomes'
    ) as outcome
    where coalesce(outcome ->> 'step', '') = ''
  ),
  'recent cancel outcomes include the completed snapshot step'
);

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'complete_email_outbox_claim',
        'record_email_provider_event',
        'run_retention_daily_jobs',
        'update_cancel_flow_configuration',
        'start_cancel_flow',
        'record_cancel_flow_step',
        'get_cancel_flow_analytics',
        'get_cancel_flow_analytics_snapshot',
        'reserve_loyalty_discount',
        'adjust_loyalty_points',
        'reserve_loyalty_discount_command',
        'adjust_loyalty_points_command',
        'finalize_loyalty_redemption_command'
      )
      and has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
  ),
  'retention worker and command RPCs remain service-role-only'
);

select ok(
  (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conname = 'loyalty_reservation_allocations_redemption_same_brand_fkey'
  ) like '%organization_id, brand_id, member_id, redemption_id%',
  'loyalty allocations enforce organization, brand, and member identity'
);

select throws_ok(
  $statement$
    update public.brands
    set time_zone = 'Not/A_Time_Zone'
    where id = 'd3000000-0000-4000-8000-000000000001'
  $statement$,
  '22023',
  'Brand time zone is invalid.',
  'brand scheduler time zones are validated'
);

select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('email_log', 'member_activity_events', 'loyalty_ledger', 'loyalty_redemptions')
      and column_name = 'request_fingerprint_sha256'
  ),
  4::bigint,
  'all Phase 3 idempotent business records persist request fingerprints'
);

select ok(
  not exists (
    select 1
    from public.loyalty_ledger
    where ledger_sequence is null
  )
  and (
    select count(*)
    from public.loyalty_ledger
  ) = (
    select count(distinct ledger_sequence)
    from public.loyalty_ledger
  )
  and exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'loyalty_ledger_member_sequence_idx'
      and indexdef like '%organization_id, brand_id, member_id, ledger_sequence DESC%'
  )
  and exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.loyalty_ledger'::regclass
      and tgname = 'loyalty_ledger_reject_update_delete'
      and not tgisinternal
  ),
  'loyalty ledger exposes a unique immutable insertion sequence for keyset pagination'
);

select ok(
  pg_get_functiondef(
    'public.claim_email_outbox_batch(text,integer,integer)'::regprocedure
  ) like '%limit p_limit%'
  and pg_get_functiondef(
    'public.claim_email_outbox_batch(text,integer,integer)'::regprocedure
  ) like '%completion_token = gen_random_uuid()%',
  'email claim bounds stale reclaim and assigns a completion token'
);

select * from finish();
rollback;
