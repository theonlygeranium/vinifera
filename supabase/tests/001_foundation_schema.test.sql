begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(34);

select ok(to_regclass('public.organizations') is not null, 'organizations exists');
select ok(to_regclass('public.staff_users') is not null, 'staff_users exists');
select ok(to_regclass('public.members') is not null, 'members exists');
select ok(to_regclass('public.platform_users') is not null, 'platform_users exists');
select ok(to_regclass('public.organization_invites') is not null, 'organization_invites exists');
select ok(
  to_regclass('public.member_magic_link_requests') is not null,
  'member magic-link rate-limit ledger exists'
);
select ok(to_regclass('public.subscription_events') is not null, 'subscription_events exists');

select ok(to_regtype('public.plan_tier') is not null, 'plan_tier enum exists');
select ok(to_regtype('public.staff_role') is not null, 'staff_role enum exists');
select ok(to_regtype('public.staff_user_status') is not null, 'staff status enum exists');
select ok(to_regtype('public.member_status') is not null, 'member_status enum exists');
select ok(to_regtype('public.platform_role') is not null, 'platform_role enum exists');
select ok(to_regtype('public.auth_surface') is not null, 'auth_surface enum exists');
select ok(
  to_regtype('public.subscription_status') is not null,
  'subscription_status enum exists'
);
select ok(
  to_regtype('public.organization_access_status') is not null,
  'organization access enum exists'
);
select ok(to_regtype('public.invite_status') is not null, 'invite_status enum exists');

select ok(
  (
    select bool_and(c.relrowsecurity)
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'organizations',
        'staff_users',
        'members',
        'platform_users',
        'organization_invites',
        'member_magic_link_requests',
        'subscription_events'
      )
  ),
  'RLS is enabled on every Phase 1 table'
);

select ok(
  (
    select bool_and(c.relforcerowsecurity)
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'organizations',
        'staff_users',
        'members',
        'platform_users',
        'organization_invites',
        'member_magic_link_requests',
        'subscription_events'
      )
  ),
  'RLS is forced on every Phase 1 table'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.staff_users'::regclass
      and confrelid = 'public.organizations'::regclass
      and contype = 'f'
  ),
  'staff organization foreign key exists'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.members'::regclass
      and confrelid = 'public.organizations'::regclass
      and contype = 'f'
  ),
  'member organization foreign key exists'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.members'::regclass
      and confrelid = 'auth.users'::regclass
      and contype = 'f'
  ),
  'member auth-user foreign key exists'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.subscription_events'::regclass
      and confrelid = 'public.organizations'::regclass
      and contype = 'f'
  ),
  'subscription event organization foreign key exists'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_constraint as c
    join pg_catalog.pg_attribute as a
      on a.attrelid = c.conrelid
      and a.attnum = any (c.conkey)
    where c.contype = 'f'
      and c.connamespace = 'public'::regnamespace
      and not exists (
        select 1
        from pg_catalog.pg_index as i
        where i.indrelid = c.conrelid
          and a.attnum = any (i.indkey)
      )
  ),
  'every Phase 1 foreign-key column is indexed'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'subscription_events'
      and indexname = 'subscription_events_stripe_event_id_uidx'
  ),
  'Stripe event IDs have a unique idempotency index'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'organizations'
      and indexname = 'organizations_stripe_customer_id_uidx'
  ),
  'Stripe customer IDs have a unique lookup index'
);

select ok(
  has_function_privilege(
    'supabase_auth_admin',
    'public.custom_access_token_hook(jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.custom_access_token_hook(jsonb)',
    'execute'
  ),
  'only the Auth hook role can invoke the custom token hook'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.bootstrap_organization(uuid,text,text,public.plan_tier,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.bootstrap_organization(uuid,text,text,public.plan_tier,text)',
    'execute'
  ),
  'organization bootstrap is server-only'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.record_magic_link_request(text,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.record_magic_link_request(text,text)',
    'execute'
  ),
  'magic-link rate limiting is server-only'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.complete_staff_invite(text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.complete_staff_invite(text,text,uuid)',
    'execute'
  ),
  'staff invite completion is server-only'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.apply_subscription_event(text,text,text,timestamptz,jsonb,boolean,text,public.subscription_status,public.plan_tier)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.apply_subscription_event(text,text,text,timestamptz,jsonb,boolean,text,public.subscription_status,public.plan_tier)',
    'execute'
  ),
  'subscription webhook application is server-only'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.reconcile_subscription_access(timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.reconcile_subscription_access(timestamptz)',
    'execute'
  ),
  'subscription access reconciliation is server-only'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.member_magic_link_requests',
    'select'
  ),
  'authenticated clients cannot read the magic-link ledger'
);

select ok(
  (
    select count(*) = 2
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'members'
      and policyname in ('members_staff_select', 'members_member_select')
  ),
  'members have distinct staff and member policies'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = 'org_id'
      and p.prorettype = 'uuid'::regtype
  ),
  'private.org_id safely exposes the tenant claim'
);

select * from finish();
rollback;
