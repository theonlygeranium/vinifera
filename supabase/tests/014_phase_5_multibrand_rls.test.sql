begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(26);

insert into auth.users (id, email)
values
  ('d1000000-0000-4000-8000-000000000001', 'phase5-owner@example.test'),
  ('d1000000-0000-4000-8000-000000000002', 'phase5-staff@example.test'),
  ('d1000000-0000-4000-8000-000000000003', 'phase5-member@example.test'),
  ('d1000000-0000-4000-8000-000000000004', 'phase5-other-owner@example.test');

insert into public.organizations (id, name, plan_tier)
values
  ('d2000000-0000-4000-8000-000000000001', 'Phase 5 Multi Brand', 'reserve'),
  ('d2000000-0000-4000-8000-000000000002', 'Phase 5 Other Org', 'estate');

insert into public.staff_users (id, organization_id, email, role)
values
  (
    'd1000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'phase5-owner@example.test',
    'owner'
  ),
  (
    'd1000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000001',
    'phase5-staff@example.test',
    'staff'
  ),
  (
    'd1000000-0000-4000-8000-000000000004',
    'd2000000-0000-4000-8000-000000000002',
    'phase5-other-owner@example.test',
    'owner'
  );

set local role service_role;

insert into public.brands (
  id, organization_id, name, slug, portal_title
)
values (
  'd3000000-0000-4000-8000-000000000002',
  'd2000000-0000-4000-8000-000000000001',
  'Second Label',
  'second-label',
  'Second Label Club'
);

insert into public.club_tiers (
  id, organization_id, brand_id, name, price_cents, bottle_count, frequency
)
values
  (
    'd4000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = 'd2000000-0000-4000-8000-000000000001'),
    'Estate',
    12000,
    3,
    'quarterly'
  ),
  (
    'd4000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000002',
    'Estate',
    15000,
    3,
    'quarterly'
  );

insert into public.members (
  id, auth_user_id, organization_id, brand_id, email, first_name, last_name, club_tier_id
)
values
  (
    'd5000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000003',
    'd2000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = 'd2000000-0000-4000-8000-000000000001'),
    'phase5-member@example.test',
    'Default',
    'Member',
    'd4000000-0000-4000-8000-000000000001'
  ),
  (
    'd5000000-0000-4000-8000-000000000002',
    null,
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000002',
    'second-brand-member@example.test',
    'Second',
    'Member',
    'd4000000-0000-4000-8000-000000000002'
  );

insert into public.releases (
  id, organization_id, brand_id, name, processing_date, embargo_date, status,
  created_by
)
values
  (
    'd6000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = 'd2000000-0000-4000-8000-000000000001'),
    'Default Release',
    current_date + 2,
    current_date,
    'scheduled',
    'd1000000-0000-4000-8000-000000000001'
  ),
  (
    'd6000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000002',
    'Second Release',
    current_date + 3,
    current_date,
    'scheduled',
    'd1000000-0000-4000-8000-000000000001'
  );

insert into public.release_tiers (
  id, organization_id, release_id, tier_id
)
values
  (
    'd7000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'd6000000-0000-4000-8000-000000000001',
    'd4000000-0000-4000-8000-000000000001'
  ),
  (
    'd7000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000001',
    'd6000000-0000-4000-8000-000000000002',
    'd4000000-0000-4000-8000-000000000002'
  );

insert into public.shipments (
  id, organization_id, member_id, release_id, release_tier_id, tier_id,
  shipping_address, charge_amount_cents
)
values
  (
    'd8000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'd5000000-0000-4000-8000-000000000001',
    'd6000000-0000-4000-8000-000000000001',
    'd7000000-0000-4000-8000-000000000001',
    'd4000000-0000-4000-8000-000000000001',
    '{"line1":"1 Default Way"}',
    12000
  ),
  (
    'd8000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000001',
    'd5000000-0000-4000-8000-000000000002',
    'd6000000-0000-4000-8000-000000000002',
    'd7000000-0000-4000-8000-000000000002',
    'd4000000-0000-4000-8000-000000000002',
    '{"line1":"2 Second Way"}',
    15000
  );

insert into public.email_templates (
  organization_id, brand_id, trigger_type, subject, body
)
values (
  'd2000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000002',
  'welcome',
  'Welcome second label',
  'Welcome to the second label.'
);

insert into public.cancel_flow_steps (
  organization_id, brand_id, step_type, position, headline, body
)
values (
  'd2000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000002',
  'confirm',
  1,
  'Tell us why',
  'Help the second label improve.'
);

insert into public.dashboard_layout_preferences (
  organization_id, brand_id, staff_user_id, layout
)
values
  (
    'd2000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = 'd2000000-0000-4000-8000-000000000001'),
    'd1000000-0000-4000-8000-000000000002',
    '[{"widget_id":"revenue-by-tier","order":0,"size":"half","enabled":true}]'
  ),
  (
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000002',
    '[{"widget_id":"member-growth","order":0,"size":"half","enabled":true}]'
  );

insert into public.compliance_checks (
  organization_id, shipment_id, recipient_state, status, reason,
  provider, provider_response_id, request_fingerprint,
  shipment_state_fingerprint, checked_at
)
values
  (
    'd2000000-0000-4000-8000-000000000001',
    'd8000000-0000-4000-8000-000000000001',
    'CA',
    'unknown',
    'Credential deferred',
    'simulated',
    'phase5-default-check',
    repeat('a', 64),
    repeat('b', 64),
    now()
  ),
  (
    'd2000000-0000-4000-8000-000000000001',
    'd8000000-0000-4000-8000-000000000002',
    'CA',
    'unknown',
    'Credential deferred',
    'simulated',
    'phase5-second-check',
    repeat('c', 64),
    repeat('d', 64),
    now()
  );

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated","organization_id":"d2000000-0000-4000-8000-000000000001","user_role":"staff","auth_surface":"staff","platform_role":null}';

select is((select count(*) from public.members), 1::bigint, 'restricted staff sees one brand of members');
select is((select count(*) from public.club_tiers), 1::bigint, 'restricted staff sees one brand of tiers');
select is((select count(*) from public.releases), 1::bigint, 'restricted staff sees one brand of releases');
select is((select count(*) from public.shipments), 1::bigint, 'restricted staff sees one brand of shipments');
select is((select count(distinct brand_id) from public.email_templates), 1::bigint, 'restricted staff sees one brand of email automation');
select is((select count(distinct brand_id) from public.cancel_flow_steps), 1::bigint, 'restricted staff sees one brand of retention configuration');
select is((select count(*) from public.dashboard_layout_preferences), 1::bigint, 'restricted staff sees one brand of analytics configuration');
select is((select count(*) from public.compliance_checks), 1::bigint, 'restricted staff sees one brand of compliance evidence');
select is((select count(*) from public.brands), 1::bigint, 'restricted staff sees only its granted brand');

select throws_ok(
  $$
    insert into public.members (
      organization_id, brand_id, email, first_name, last_name
    ) values (
      'd2000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000002',
      'blocked-sibling@example.test',
      'Blocked',
      'Sibling'
    )
  $$,
  '42501',
  null,
  'restricted staff cannot insert into a sibling brand'
);

select throws_ok(
  $$
    select public.adjust_loyalty_points(
      'd2000000-0000-4000-8000-000000000001',
      'd5000000-0000-4000-8000-000000000002',
      10,
      'Blocked sibling-brand adjustment',
      'phase5:blocked:sibling-adjustment',
      'd1000000-0000-4000-8000-000000000002'
    )
  $$,
  '42501',
  null,
  'restricted staff cannot bypass brand RLS through the legacy loyalty RPC'
);

select throws_ok(
  $$
    select public.get_analytics_dashboard(
      'd2000000-0000-4000-8000-000000000001',
      current_date - 30,
      current_date
    )
  $$,
  '42501',
  null,
  'restricted staff cannot bypass brand RLS through organization-wide analytics RPCs'
);

reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select lives_ok(
  $$
    insert into public.members (
      organization_id, email, first_name, last_name
    ) values (
      'd2000000-0000-4000-8000-000000000001',
      'allowed-default@example.test',
      'Allowed',
      'Default'
    )
  $$,
  'a null/omitted brand is assigned to the default brand, not treated as org-wide'
);

reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated","organization_id":"d2000000-0000-4000-8000-000000000001","user_role":"staff","auth_surface":"staff","platform_role":null}';

select is(
  (
    select count(*)
    from public.members
    where email = 'allowed-default@example.test'
      and brand_id = (
        select default_brand_id from public.organizations
        where id = 'd2000000-0000-4000-8000-000000000001'
      )
  ),
  1::bigint,
  'the compatibility trigger writes the concrete default brand'
);

reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select lives_ok(
  $$
    select public.record_analytics_event(
      'd2000000-0000-4000-8000-000000000001',
      'd5000000-0000-4000-8000-000000000001',
      'member.updated',
      '{}'::jsonb,
      'phase5:shared:analytics:key'
    );
    select public.record_analytics_event(
      'd2000000-0000-4000-8000-000000000001',
      'd5000000-0000-4000-8000-000000000002',
      'member.updated',
      '{}'::jsonb,
      'phase5:shared:analytics:key'
    )
  $$,
  'legacy analytics RPC infers member brands for identical per-brand keys'
);

select is(
  (
    select count(distinct brand_id)
    from public.analytics_events
    where idempotency_key = 'phase5:shared:analytics:key'
  ),
  2::bigint,
  'analytics events with one logical key remain isolated across two brands'
);

select lives_ok(
  $$
    select public.append_audit_entry(
      'd2000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000001',
      'shipment.brand_check',
      'shipment',
      'd8000000-0000-4000-8000-000000000002',
      '{}'::jsonb
    )
  $$,
  'legacy audit RPC accepts a non-default shipment'
);

select is(
  (
    select brand_id
    from public.audit_log
    where entity_id = 'd8000000-0000-4000-8000-000000000002'
      and action = 'shipment.brand_check'
  ),
  'd3000000-0000-4000-8000-000000000002'::uuid,
  'legacy audit RPC records the entity brand instead of the default brand'
);

select throws_ok(
  $$
    insert into public.shipments (
      organization_id, brand_id, member_id, release_id, release_tier_id,
      tier_id, shipping_address, charge_amount_cents
    ) values (
      'd2000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000002',
      'd5000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000002',
      'd7000000-0000-4000-8000-000000000002',
      'd4000000-0000-4000-8000-000000000002',
      '{"line1":"Mismatch"}',
      15000
    )
  $$,
  '23503',
  null,
  'composite foreign keys reject mislabeled cross-brand children'
);

reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated","organization_id":"d2000000-0000-4000-8000-000000000001","user_role":"owner","auth_surface":"staff","platform_role":null}';

select is((select count(*) from public.members), 3::bigint, 'explicit all-brand owner sees members across both brands');
select is((select count(*) from public.club_tiers), 2::bigint, 'explicit all-brand owner sees tiers across both brands');
select is((select count(*) from public.shipments), 2::bigint, 'explicit all-brand owner sees shipments across both brands');
select is((select count(*) from public.compliance_checks), 2::bigint, 'explicit all-brand owner sees compliance across both brands');
select is((select count(*) from public.brands), 2::bigint, 'explicit all-brand owner sees both brands');

reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"d1000000-0000-4000-8000-000000000003","role":"authenticated","organization_id":"d2000000-0000-4000-8000-000000000001","user_role":"member","auth_surface":"member","platform_role":null}';

select is(
  (select count(*) from public.members),
  1::bigint,
  'member self-access remains limited to its own profile'
);
select is(
  (select count(*) from public.shipments),
  1::bigint,
  'member shipment access remains limited to its own brand and profile'
);

select * from finish();
rollback;
