begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(9);

select ok(
  to_regprocedure(
    'public.set_brand_sender_identity_verification(uuid,uuid,text,public.sender_identity_status)'
  ) is not null,
  'brand sender provider state has a service-owned activation seam'
);

select ok(
  to_regprocedure(
    'public.claim_email_outbox_batch(text,integer,integer)'
  ) is not null,
  'email workers claim the Phase 5 brand-aware outbox function'
);

select ok(
  (
    select proargnames @> array[
      'brand_id',
      'sender_identity_id',
      'sender_from_name',
      'sender_from_email',
      'sender_status'
    ]
    from pg_proc
    where oid = 'public.claim_email_outbox_batch(text,integer,integer)'::regprocedure
  ),
  'claimed email jobs carry brand and sender identity state'
);

select ok(
  (
    select pg_get_constraintdef(oid) like
      '%env://VINIFERA_INTEGRATION_SECRET_[A-Z0-9_]{1,96}%'
    from pg_constraint
    where conrelid = 'public.integration_secrets'::regclass
      and conname = 'integration_secrets_envelope_consistent'
  ),
  'external integration references are narrowed to allowlisted env bindings'
);

insert into auth.users (id, email)
values (
  'a1100000-0000-4000-8000-000000000001',
  'provider-activation-owner@example.test'
);

insert into public.organizations (id, name, plan_tier)
values (
  'a1200000-0000-4000-8000-000000000001',
  'Provider Activation Winery',
  'reserve'
);

insert into public.staff_users (id, organization_id, email, role)
values (
  'a1100000-0000-4000-8000-000000000001',
  'a1200000-0000-4000-8000-000000000001',
  'provider-activation-owner@example.test',
  'owner'
);

insert into public.brand_sender_identities (
  organization_id,
  brand_id,
  from_name,
  from_email
)
values (
  'a1200000-0000-4000-8000-000000000001',
  (
    select default_brand_id
    from public.organizations
    where id = 'a1200000-0000-4000-8000-000000000001'
  ),
  'Provider Activation Club',
  'club@provider-activation.example'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select lives_ok(
  $$
    select public.set_brand_sender_identity_verification(
      'a1200000-0000-4000-8000-000000000001',
      (
        select default_brand_id
        from public.organizations
        where id = 'a1200000-0000-4000-8000-000000000001'
      ),
      'resend_domain_123',
      'verified'
    )
  $$,
  'service runtime can activate a provider-verified brand sender'
);

select is(
  (
    select status::text
    from public.brand_sender_identities
    where organization_id = 'a1200000-0000-4000-8000-000000000001'
  ),
  'verified',
  'verified sender state is persisted'
);

select ok(
  (
    select verified_at is not null
    from public.brand_sender_identities
    where organization_id = 'a1200000-0000-4000-8000-000000000001'
  ),
  'verified sender activation records its verification time'
);

insert into public.integration_connections (
  id,
  organization_id,
  brand_id,
  integration_type,
  status,
  opted_in
)
values (
  'a1300000-0000-4000-8000-000000000001',
  'a1200000-0000-4000-8000-000000000001',
  (
    select default_brand_id
    from public.organizations
    where id = 'a1200000-0000-4000-8000-000000000001'
  ),
  'meta',
  'activation_required',
  false
);

select lives_ok(
  $$
    select public.store_integration_credentials(
      'a1300000-0000-4000-8000-000000000001',
      'external_reference',
      null,
      null,
      null,
      null,
      null,
      'env://VINIFERA_INTEGRATION_SECRET_META_REHEARSAL'
    )
  $$,
  'service runtime stores an allowlisted environment binding reference'
);

select throws_ok(
  $$
    select public.store_integration_credentials(
      'a1300000-0000-4000-8000-000000000001',
      'external_reference',
      null,
      null,
      null,
      null,
      null,
      'vault://unsafe/provider-secret'
    )
  $$,
  '23514',
  null,
  'legacy arbitrary external secret schemes are rejected'
);

select * from finish();
rollback;
