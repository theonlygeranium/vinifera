begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select plan(11);

select ok(
  to_regprocedure(
    'public.create_brand_with_profile(uuid,text,text,public.brand_billing_mode,text,integer)'
  ) is not null,
  'atomic brand profile creation RPC exists'
);

select ok(
  to_regprocedure(
    'public.upsert_brand_sender_identity(uuid,uuid,text,text)'
  ) is not null,
  'tenant-scoped sender identity upsert exists'
);

select ok(
  to_regprocedure(
    'public.upsert_brand_sender_identity(uuid,uuid,text,text,text,public.sender_identity_status,timestamptz)'
  ) is null,
  'staff-callable sender upsert exposes no provider verification arguments'
);

insert into public.organizations (id, name, plan_tier)
values (
  'f2800000-0000-4000-8000-000000000001',
  'Tenant Write Safety Winery',
  'reserve'
);

select lives_ok(
  $$
    select public.create_brand_with_profile(
      'f2800000-0000-4000-8000-000000000001',
      'Atomic Reserve',
      'atomic-reserve',
      'shared',
      'Created in one statement',
      2500
    )
  $$,
  'brand and optional profile fields are created atomically'
);

select is(
  (
    select description || ':' || default_shipping_charge_cents::text
    from public.brands
    where organization_id = 'f2800000-0000-4000-8000-000000000001'
      and slug = 'atomic-reserve'
  ),
  'Created in one statement:2500',
  'atomic brand creation persists the complete requested profile'
);

select throws_ok(
  $$
    select public.create_brand_with_profile(
      'f2800000-0000-4000-8000-000000000001',
      'Rollback Reserve',
      'rollback-reserve',
      'shared',
      'Must not survive',
      -1
    )
  $$,
  '23514',
  null,
  'invalid optional profile state aborts the entire brand creation statement'
);

select is(
  (
    select count(*)::integer
    from public.brands
    where organization_id = 'f2800000-0000-4000-8000-000000000001'
      and slug = 'rollback-reserve'
  ),
  0,
  'failed profile updates leave no partially created brand'
);

insert into public.brand_sender_identities (
  organization_id,
  brand_id,
  from_name,
  from_email,
  provider_identity_id,
  status,
  verified_at
)
select
  organization_id,
  id,
  'Atomic Reserve',
  'club@atomic-reserve.example',
  'provider_verified_28',
  'verified',
  '2026-08-06T12:00:00Z'
from public.brands
where organization_id = 'f2800000-0000-4000-8000-000000000001'
  and slug = 'atomic-reserve';

select lives_ok(
  $$
    select public.upsert_brand_sender_identity(
      'f2800000-0000-4000-8000-000000000001',
      (
        select id from public.brands
        where organization_id = 'f2800000-0000-4000-8000-000000000001'
          and slug = 'atomic-reserve'
      ),
      'Atomic Reserve',
      'club@atomic-reserve.example'
    )
  $$,
  'unchanged sender identity can be saved without caller-controlled verification fields'
);

select is(
  (
    select status::text || ':' || provider_identity_id || ':' || (verified_at is not null)::text
    from public.brand_sender_identities
    where organization_id = 'f2800000-0000-4000-8000-000000000001'
      and from_email = 'club@atomic-reserve.example'
  ),
  'verified:provider_verified_28:true',
  'unchanged sender identity preserves service-owned verification state'
);

select lives_ok(
  $$
    select public.upsert_brand_sender_identity(
      'f2800000-0000-4000-8000-000000000001',
      (
        select id from public.brands
        where organization_id = 'f2800000-0000-4000-8000-000000000001'
          and slug = 'atomic-reserve'
      ),
      'Atomic Reserve',
      'new@atomic-reserve.example'
    )
  $$,
  'changed sender identity is accepted as an unverified provider candidate'
);

select is(
  (
    select status::text || ':' || (provider_identity_id is null)::text || ':' || (verified_at is null)::text
    from public.brand_sender_identities
    where organization_id = 'f2800000-0000-4000-8000-000000000001'
      and from_email = 'new@atomic-reserve.example'
  ),
  'pending:true:true',
  'changed sender identity resets all service-owned verification state'
);

select * from finish();
rollback;
