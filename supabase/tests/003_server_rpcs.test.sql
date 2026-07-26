begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(30);

insert into auth.users (id, email)
values
  (
    'aaaaaaaa-0000-4000-8000-000000000001',
    'owner-rpc@example.test'
  ),
  (
    'aaaaaaaa-0000-4000-8000-000000000002',
    'invitee-rpc@example.test'
  );

select ok(
  public.bootstrap_organization(
    'aaaaaaaa-0000-4000-8000-000000000001',
    'OWNER-RPC@EXAMPLE.TEST',
    'RPC Winery',
    'vine',
    'cus_rpcTest'
  ) is not null,
  'bootstrap returns the organization ID'
);

select is(
  (select count(*) from public.organizations where name = 'RPC Winery'),
  1::bigint,
  'bootstrap creates exactly one organization'
);

select is(
  (select count(*) from public.staff_users where email = 'owner-rpc@example.test' and role = 'owner'),
  1::bigint,
  'bootstrap creates the owner profile with normalized email'
);

select is(
  public.bootstrap_organization(
    'aaaaaaaa-0000-4000-8000-000000000001',
    'owner-rpc@example.test',
    'RPC Winery',
    'vine',
    'cus_rpcTest'
  ),
  (
    select organization_id
    from public.staff_users
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'
  ),
  'bootstrap retries are idempotent for an existing owner'
);

insert into public.organization_invites (
  organization_id,
  email,
  role,
  token_hash,
  invited_by,
  expires_at
)
values (
  (
    select organization_id
    from public.staff_users
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'
  ),
  'invitee-rpc@example.test',
  'admin',
  encode(
    extensions.digest(
      convert_to('00000000-0000-4000-8000-000000000001', 'UTF8'),
      'sha256'
    ),
    'hex'
  ),
  'aaaaaaaa-0000-4000-8000-000000000001',
  now() + interval '1 day'
);

select is(
  public.complete_staff_invite(
    'invitee-rpc@example.test',
    '00000000-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000002'
  ),
  (
    select organization_id
    from public.staff_users
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'
  ),
  'invite completion returns the organization ID'
);
select is(
  (
    select count(*)
    from public.staff_users
    where id = 'aaaaaaaa-0000-4000-8000-000000000002'
      and role = 'admin'
  ),
  1::bigint,
  'invite completion creates the invited staff profile'
);
select is(
  (
    select status
    from public.organization_invites
    where email = 'invitee-rpc@example.test'
  ),
  'accepted'::public.invite_status,
  'invite completion atomically consumes the invitation'
);

select is(
  (select allowed from public.record_magic_link_request(
    'MEMBER@EXAMPLE.TEST',
    repeat('1', 64)
  )),
  true,
  'magic-link request 1 is allowed'
);
select is(
  (select allowed from public.record_magic_link_request(
    'member@example.test',
    repeat('1', 64)
  )),
  true,
  'magic-link request 2 is allowed'
);
select is(
  (select allowed from public.record_magic_link_request(
    'member@example.test',
    repeat('1', 64)
  )),
  true,
  'magic-link request 3 is allowed'
);
select is(
  (select allowed from public.record_magic_link_request(
    'member@example.test',
    repeat('1', 64)
  )),
  true,
  'magic-link request 4 is allowed'
);
select is(
  (select allowed from public.record_magic_link_request(
    'member@example.test',
    repeat('1', 64)
  )),
  true,
  'magic-link request 5 is allowed'
);
select is(
  (select allowed from public.record_magic_link_request(
    'member@example.test',
    repeat('1', 64)
  )),
  false,
  'magic-link request 6 is rate limited'
);
select is(
  (select count(*) from public.member_magic_link_requests),
  6::bigint,
  'rate limiter records allowed and denied attempts without plaintext email'
);

select is(
  (
    select duplicate
    from public.apply_subscription_event(
      'evt_rpcActive',
      'customer.subscription.created',
      'cus_rpcTest',
      now(),
      '{}'::jsonb,
      false,
      'sub_rpcTest',
      'active',
      'vine'
    )
  ),
  false,
  'first Stripe event is applied'
);
select is(
  (select access_status from public.organizations where stripe_customer_id = 'cus_rpcTest'),
  'active'::public.organization_access_status,
  'active subscription enables access'
);
select is(
  (
    select duplicate
    from public.apply_subscription_event(
      'evt_rpcActive',
      'customer.subscription.created',
      'cus_rpcTest',
      now(),
      '{}'::jsonb,
      false,
      'sub_rpcTest',
      'active',
      'vine'
    )
  ),
  true,
  'duplicate Stripe event is acknowledged without reapplication'
);
select is(
  (select count(*) from public.subscription_events where stripe_event_id = 'evt_rpcActive'),
  1::bigint,
  'duplicate Stripe delivery has one ledger row'
);

select is(
  (
    select duplicate
    from public.apply_subscription_event(
      'evt_rpcFailed',
      'invoice.payment_failed',
      'cus_rpcTest',
      now(),
      '{}'::jsonb,
      false,
      'sub_rpcTest',
      'past_due',
      null
    )
  ),
  false,
  'payment failure event is applied'
);
select is(
  (select access_status from public.organizations where stripe_customer_id = 'cus_rpcTest'),
  'grace'::public.organization_access_status,
  'payment failure starts in grace'
);
select is(
  (
    select grace_period_ends_at - payment_failed_at
    from public.organizations
    where stripe_customer_id = 'cus_rpcTest'
  ),
  interval '7 days',
  'grace window is seven days'
);
select is(
  (
    select suspension_at - payment_failed_at
    from public.organizations
    where stripe_customer_id = 'cus_rpcTest'
  ),
  interval '14 days',
  'suspension window is fourteen days'
);

select is(
  public.reconcile_subscription_access(
    (select payment_failed_at + interval '8 days' from public.organizations where stripe_customer_id = 'cus_rpcTest')
  ),
  1,
  'hourly reconciliation advances grace to restricted after day seven'
);
select is(
  (select access_status from public.organizations where stripe_customer_id = 'cus_rpcTest'),
  'restricted'::public.organization_access_status,
  'organization is restricted after day seven'
);
select is(
  public.reconcile_subscription_access(
    (select payment_failed_at + interval '15 days' from public.organizations where stripe_customer_id = 'cus_rpcTest')
  ),
  1,
  'hourly reconciliation advances restricted to suspended after day fourteen'
);
select is(
  (select access_status from public.organizations where stripe_customer_id = 'cus_rpcTest'),
  'suspended'::public.organization_access_status,
  'organization is suspended after day fourteen'
);

select is(
  (
    select duplicate
    from public.apply_subscription_event(
      'evt_rpcSucceeded',
      'invoice.payment_succeeded',
      'cus_rpcTest',
      now() + interval '16 days',
      '{}'::jsonb,
      false,
      'sub_rpcTest',
      'active',
      null
    )
  ),
  false,
  'payment success is applied'
);
select ok(
  (
    select
      access_status = 'active'
      and payment_failed_at is null
      and grace_period_ends_at is null
      and suspension_at is null
    from public.organizations
    where stripe_customer_id = 'cus_rpcTest'
  ),
  'payment success restores access and clears failure windows'
);

select is(
  (
    select duplicate
    from public.apply_subscription_event(
      'evt_rpcOlder',
      'customer.subscription.updated',
      'cus_rpcTest',
      now() - interval '1 day',
      '{}'::jsonb,
      false,
      'sub_rpcTest',
      'past_due',
      'reserve'
    )
  ),
  false,
  'out-of-order event is recorded but not a duplicate'
);
select ok(
  (
    select
      o.plan_tier = 'vine'
      and e.processing_status = 'ignored'
      and e.ignored_reason = 'older_than_current_stripe_state'
    from public.organizations as o
    join public.subscription_events as e on e.organization_id = o.id
    where o.stripe_customer_id = 'cus_rpcTest'
      and e.stripe_event_id = 'evt_rpcOlder'
  ),
  'out-of-order Stripe state cannot overwrite newer billing state'
);

select * from finish();
rollback;
