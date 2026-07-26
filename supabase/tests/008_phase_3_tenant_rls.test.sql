begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(39);

insert into auth.users (id, email)
values
  ('71000000-0000-4000-8000-000000000001', 'phase3-staff-a@example.test'),
  ('71000000-0000-4000-8000-000000000002', 'phase3-staff-b@example.test'),
  ('71000000-0000-4000-8000-000000000003', 'phase3-member-a@example.test'),
  ('71000000-0000-4000-8000-000000000004', 'phase3-member-b@example.test'),
  ('71000000-0000-4000-8000-000000000005', 'phase3-platform@example.test');

insert into public.organizations (id, name, plan_tier)
values
  ('72000000-0000-4000-8000-000000000001', 'Phase 3 Winery A', 'vine'),
  ('72000000-0000-4000-8000-000000000002', 'Phase 3 Winery B', 'cellar');

insert into public.staff_users (id, organization_id, email, role)
values
  (
    '71000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'phase3-staff-a@example.test',
    'owner'
  ),
  (
    '71000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000002',
    'phase3-staff-b@example.test',
    'owner'
  );

insert into public.platform_users (id, email)
values (
  '71000000-0000-4000-8000-000000000005',
  'phase3-platform@example.test'
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
  (
    '73000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'A Cellar',
    10000,
    2,
    'quarterly'
  ),
  (
    '73000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000002',
    'B Estate',
    15000,
    3,
    'quarterly'
  );

insert into public.members (
  id,
  auth_user_id,
  organization_id,
  email,
  first_name,
  last_name,
  club_tier_id
)
values
  (
    '74000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000003',
    '72000000-0000-4000-8000-000000000001',
    'phase3-member-a@example.test',
    'Member',
    'A',
    '73000000-0000-4000-8000-000000000001'
  ),
  (
    '74000000-0000-4000-8000-000000000002',
    '71000000-0000-4000-8000-000000000004',
    '72000000-0000-4000-8000-000000000002',
    'phase3-member-b@example.test',
    'Member',
    'B',
    '73000000-0000-4000-8000-000000000002'
  );

insert into public.member_email_preferences (
  organization_id,
  member_id,
  trigger_type
)
values
  ('72000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', 'birthday'),
  ('72000000-0000-4000-8000-000000000002', '74000000-0000-4000-8000-000000000002', 'birthday');

insert into public.email_delivery_events (
  organization_id,
  email_log_id,
  provider_event_id,
  event_type,
  occurred_at
)
select organization_id, id, 'rls-delivery-' || id::text, 'delivered', now()
from public.email_log;

select public.issue_email_unsubscribe_token(
  '72000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001',
  'birthday',
  repeat('a', 64),
  'rls-key',
  now() - interval '1 minute',
  now() + interval '1 day'
);
select public.issue_email_unsubscribe_token(
  '72000000-0000-4000-8000-000000000002',
  '74000000-0000-4000-8000-000000000002',
  'birthday',
  repeat('b', 64),
  'rls-key',
  now() - interval '1 minute',
  now() + interval '1 day'
);

insert into public.churn_scores (
  organization_id,
  member_id,
  score,
  risk_level,
  contributing_factors,
  score_date,
  calculated_at
)
values
  ('72000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', 20, 'low', '{"rules_version":1}', current_date, now()),
  ('72000000-0000-4000-8000-000000000002', '74000000-0000-4000-8000-000000000002', 70, 'high', '{"rules_version":1}', current_date, now());

insert into public.member_activity_events (
  id,
  organization_id,
  member_id,
  event_type,
  source_entity_type,
  source_entity_id,
  idempotency_key,
  occurred_at
)
values
  ('75000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', 'portal_login', 'member', '74000000-0000-4000-8000-000000000001', 'rls:activity:a', now()),
  ('75000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000002', '74000000-0000-4000-8000-000000000002', 'portal_login', 'member', '74000000-0000-4000-8000-000000000002', 'rls:activity:b', now());

insert into public.loyalty_ledger (
  id,
  organization_id,
  member_id,
  entry_type,
  points,
  reason,
  idempotency_key,
  expires_at
)
values
  ('76000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', 'award', 100, 'RLS award A', 'rls:loyalty:a', now() + interval '24 months'),
  ('76000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000002', '74000000-0000-4000-8000-000000000002', 'award', 100, 'RLS award B', 'rls:loyalty:b', now() + interval '24 months');

insert into public.loyalty_point_lots (
  organization_id,
  member_id,
  award_ledger_id,
  awarded_points,
  remaining_points,
  expires_at
)
values
  ('72000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', '76000000-0000-4000-8000-000000000001', 100, 100, now() + interval '24 months'),
  ('72000000-0000-4000-8000-000000000002', '74000000-0000-4000-8000-000000000002', '76000000-0000-4000-8000-000000000002', 100, 100, now() + interval '24 months');

insert into public.cancel_flow_attempts (
  id,
  organization_id,
  member_id,
  actor_user_id,
  actor_type,
  status,
  current_step_id,
  configuration_snapshot
)
select
  fixture.id,
  fixture.organization_id,
  fixture.member_id,
  fixture.actor_user_id,
  'member',
  'in_progress',
  step.id,
  '[]'::jsonb
from (
  values
    ('77000000-0000-4000-8000-000000000001'::uuid, '72000000-0000-4000-8000-000000000001'::uuid, '74000000-0000-4000-8000-000000000001'::uuid, '71000000-0000-4000-8000-000000000003'::uuid),
    ('77000000-0000-4000-8000-000000000002'::uuid, '72000000-0000-4000-8000-000000000002'::uuid, '74000000-0000-4000-8000-000000000002'::uuid, '71000000-0000-4000-8000-000000000004'::uuid)
) as fixture(id, organization_id, member_id, actor_user_id)
join public.cancel_flow_steps as step
  on step.organization_id = fixture.organization_id
  and step.position = 1;

insert into public.cancel_flow_events (
  organization_id,
  member_id,
  attempt_id,
  step_id,
  step_position,
  outcome,
  actor_user_id,
  actor_type
)
select
  attempt.organization_id,
  attempt.member_id,
  attempt.id,
  attempt.current_step_id,
  1,
  'viewed',
  attempt.actor_user_id,
  'member'
from public.cancel_flow_attempts as attempt;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated","organization_id":"72000000-0000-4000-8000-000000000001","user_role":"owner","auth_surface":"staff","platform_role":null}';

select is((select count(*) from public.email_templates), 6::bigint, 'Org A staff sees six templates');
select is((select count(*) from public.member_email_preferences), 1::bigint, 'Org A staff sees one email preference');
select is((select count(*) from public.email_log), 1::bigint, 'Org A staff sees one email log');
select is((select count(*) from public.email_outbox), 1::bigint, 'Org A staff sees one outbox row');
select is((select count(*) from public.email_delivery_events), 1::bigint, 'Org A staff sees one delivery event');
select is((select count(*) from public.email_unsubscribe_tokens), 0::bigint, 'staff cannot read unsubscribe token hashes');
select is((select count(*) from public.churn_scores), 1::bigint, 'Org A staff sees one churn score');
select is((select count(*) from public.cancel_flow_steps), 4::bigint, 'Org A staff sees four cancel steps');
select is((select count(*) from public.cancel_flow_attempts), 1::bigint, 'Org A staff sees one cancel attempt');
select is((select count(*) from public.cancel_flow_events), 1::bigint, 'Org A staff sees one cancel event');
select is((select count(*) from public.member_activity_events), 1::bigint, 'Org A staff sees one activity event');
select is((select count(*) from public.loyalty_tier_multipliers), 1::bigint, 'Org A staff sees one tier multiplier');
select is((select count(*) from public.loyalty_ledger), 1::bigint, 'Org A staff sees one ledger row');
select is((select count(*) from public.loyalty_point_lots), 1::bigint, 'Org A staff sees one point lot');

set local request.jwt.claims =
  '{"sub":"71000000-0000-4000-8000-000000000002","role":"authenticated","organization_id":"72000000-0000-4000-8000-000000000002","user_role":"owner","auth_surface":"staff","platform_role":null}';

select is((select count(*) from public.email_templates), 6::bigint, 'Org B staff cannot see Org A templates');
select is((select count(*) from public.email_log), 1::bigint, 'Org B staff cannot see Org A email');
select is((select count(*) from public.churn_scores), 1::bigint, 'Org B staff cannot see Org A churn');
select is((select count(*) from public.loyalty_ledger), 1::bigint, 'Org B staff cannot see Org A loyalty');

set local request.jwt.claims =
  '{"sub":"71000000-0000-4000-8000-000000000003","role":"authenticated","organization_id":"72000000-0000-4000-8000-000000000001","user_role":"member","auth_surface":"member","platform_role":null}';

select is((select count(*) from public.email_templates), 0::bigint, 'member cannot read template internals');
select is((select count(*) from public.member_email_preferences), 1::bigint, 'member sees their email preferences');
select is((select count(*) from public.email_log), 1::bigint, 'member sees their email history');
select is((select count(*) from public.email_outbox), 0::bigint, 'member cannot read delivery queue internals');
select is((select count(*) from public.email_delivery_events), 0::bigint, 'member cannot read provider webhook payloads');
select is((select count(*) from public.email_unsubscribe_tokens), 0::bigint, 'member cannot read unsubscribe hashes');
select is((select count(*) from public.churn_scores), 1::bigint, 'member sees their own explainable churn score');
select is((select count(*) from public.cancel_flow_steps), 4::bigint, 'member sees their winery cancel steps');
select is((select count(*) from public.cancel_flow_attempts), 1::bigint, 'member sees their own cancel attempt');
select is((select count(*) from public.cancel_flow_events), 1::bigint, 'member sees their own cancel events');
select is((select count(*) from public.member_activity_events), 1::bigint, 'member sees their own activity history');
select is((select count(*) from public.loyalty_tier_multipliers), 1::bigint, 'member sees their assigned tier multiplier');
select is((select count(*) from public.loyalty_ledger), 1::bigint, 'member sees their own loyalty ledger');
select is((select count(*) from public.loyalty_point_lots), 0::bigint, 'member cannot read mutable lot internals');

set local request.jwt.claims =
  '{"sub":"71000000-0000-4000-8000-000000000004","role":"authenticated","organization_id":"72000000-0000-4000-8000-000000000002","user_role":"member","auth_surface":"member","platform_role":null}';

select is((select count(*) from public.email_log), 1::bigint, 'Org B member cannot see Org A email');
select is((select count(*) from public.cancel_flow_attempts), 1::bigint, 'Org B member cannot see Org A cancellation');
select is((select count(*) from public.loyalty_ledger), 1::bigint, 'Org B member cannot see Org A ledger');

set local request.jwt.claims =
  '{"sub":"71000000-0000-4000-8000-000000000005","role":"authenticated","organization_id":null,"user_role":"super_admin","auth_surface":"platform","platform_role":"super_admin"}';

select is((select count(*) from public.email_templates), 12::bigint, 'super-admin sees all templates');
select is((select count(*) from public.email_unsubscribe_tokens), 2::bigint, 'super-admin sees token state');
select is((select count(*) from public.churn_scores), 2::bigint, 'super-admin sees all churn scores');
select is((select count(*) from public.loyalty_ledger), 2::bigint, 'super-admin sees all loyalty entries');

select * from finish();
rollback;
