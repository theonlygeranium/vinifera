begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(28);
set local request.jwt.claims = '{"role":"service_role"}';

insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'staff-a@example.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'staff-b@example.test'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'member-a@example.test'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'member-b@example.test'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'platform@example.test');

insert into public.organizations (
  id,
  name,
  stripe_customer_id,
  plan_tier
)
values
  (
    '11111111-1111-4111-8111-111111111111',
    'Winery A',
    'cus_testA',
    'vine'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'Winery B',
    'cus_testB',
    'cellar'
  );

insert into public.staff_users (id, organization_id, email, role)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    'staff-a@example.test',
    'owner'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '22222222-2222-4222-8222-222222222222',
    'staff-b@example.test',
    'owner'
  );

insert into public.members (
  id,
  auth_user_id,
  organization_id,
  email,
  first_name,
  last_name
)
values
  (
    '33333333-3333-4333-8333-333333333331',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '11111111-1111-4111-8111-111111111111',
    'member-a@example.test',
    'Member',
    'A'
  ),
  (
    '33333333-3333-4333-8333-333333333332',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '22222222-2222-4222-8222-222222222222',
    'member-b@example.test',
    'Member',
    'B'
  );

insert into public.platform_users (id, email)
values (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'platform@example.test'
);

insert into public.organization_invites (
  organization_id,
  email,
  role,
  token_hash,
  invited_by,
  expires_at
)
values
  (
    '11111111-1111-4111-8111-111111111111',
    'invite-a@example.test',
    'staff',
    repeat('a', 64),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    now() + interval '1 day'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'invite-b@example.test',
    'staff',
    repeat('b', 64),
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    now() + interval '1 day'
  );

insert into public.subscription_events (
  organization_id,
  event_type,
  stripe_event_id,
  stripe_created_at,
  payload,
  processing_status,
  processed_at
)
values
  (
    '11111111-1111-4111-8111-111111111111',
    'customer.subscription.created',
    'evt_tenantA',
    now(),
    '{}'::jsonb,
    'applied',
    now()
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'customer.subscription.created',
    'evt_tenantB',
    now(),
    '{}'::jsonb,
    'applied',
    now()
  );

set local request.jwt.claims =
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","organization_id":"not-a-uuid","user_role":"owner","auth_surface":"staff","platform_role":null}';
select is(private.org_id(), null::uuid, 'invalid organization claims fail closed');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","organization_id":"11111111-1111-4111-8111-111111111111","user_role":"owner","auth_surface":"staff","platform_role":null}';

select is((select count(*) from public.organizations), 1::bigint, 'Org A staff sees one org');
select is((select min(name) from public.organizations), 'Winery A', 'Org A staff sees only Org A');
select is((select count(*) from public.staff_users), 1::bigint, 'Org A staff cannot see Org B staff');
select is((select count(*) from public.members), 1::bigint, 'Org A staff cannot see Org B members');
select is((select count(*) from public.subscription_events), 1::bigint, 'Org A staff cannot see Org B billing events');
select is((select count(*) from public.organization_invites), 1::bigint, 'Org A owner cannot see Org B invites');
select is((select count(*) from public.platform_users), 0::bigint, 'Tenant staff cannot see platform operators');

set local request.jwt.claims =
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","organization_id":"22222222-2222-4222-8222-222222222222","user_role":"owner","auth_surface":"staff","platform_role":null}';

select is((select count(*) from public.organizations), 1::bigint, 'Org B staff sees one org');
select is((select min(name) from public.organizations), 'Winery B', 'Org B staff sees only Org B');
select is((select count(*) from public.members), 1::bigint, 'Org B staff cannot see Org A members');
select is((select count(*) from public.subscription_events), 1::bigint, 'Org B staff cannot see Org A billing events');
select is((select count(*) from public.organization_invites), 1::bigint, 'Org B owner cannot see Org A invites');

set local request.jwt.claims =
  '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated","organization_id":"11111111-1111-4111-8111-111111111111","user_role":"member","auth_surface":"member","platform_role":null}';

select is((select count(*) from public.organizations), 1::bigint, 'member sees one organization');
select is((select min(name) from public.organizations), 'Winery A', 'member sees only their organization');
select is((select count(*) from public.members), 1::bigint, 'member sees only their member row');
select is((select min(email) from public.members), 'member-a@example.test', 'member cannot see another member identity');
select is((select count(*) from public.staff_users), 0::bigint, 'member cannot see staff');
select is((select count(*) from public.subscription_events), 0::bigint, 'member cannot see billing events');
select is((select count(*) from public.organization_invites), 0::bigint, 'member cannot see invitations');

set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated","organization_id":null,"user_role":"super_admin","auth_surface":"platform","platform_role":"super_admin"}';

select is(
  (
    select count(*) from public.organizations
    where id in (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    )
  ),
  2::bigint,
  'super-admin sees both fixture organizations'
);
select is(
  (
    select count(*) from public.members
    where organization_id in (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    )
  ),
  2::bigint,
  'super-admin sees both fixture members'
);
select is(
  (
    select count(*) from public.staff_users
    where organization_id in (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    )
  ),
  2::bigint,
  'super-admin sees both fixture staff users'
);
select is(
  (
    select count(*) from public.subscription_events
    where organization_id in (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    )
  ),
  2::bigint,
  'super-admin sees both fixture billing events'
);

reset role;

select is(
  public.custom_access_token_hook(
    jsonb_build_object(
      'user_id',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'claims',
      '{}'::jsonb
    )
  ) -> 'claims' ->> 'organization_id',
  '11111111-1111-4111-8111-111111111111',
  'staff hook claim contains the organization'
);

select is(
  public.custom_access_token_hook(
    jsonb_build_object(
      'user_id',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'claims',
      '{}'::jsonb
    )
  ) -> 'claims' ->> 'user_role',
  'owner',
  'staff hook claim contains the staff role'
);

select is(
  public.custom_access_token_hook(
    jsonb_build_object(
      'user_id',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'claims',
      '{}'::jsonb
    )
  ) -> 'claims' ->> 'auth_surface',
  'member',
  'member hook claim selects the member surface'
);

select is(
  public.custom_access_token_hook(
    jsonb_build_object(
      'user_id',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'claims',
      '{}'::jsonb
    )
  ) -> 'claims' ->> 'platform_role',
  'super_admin',
  'platform hook claim contains the super-admin role'
);

select * from finish();
rollback;
