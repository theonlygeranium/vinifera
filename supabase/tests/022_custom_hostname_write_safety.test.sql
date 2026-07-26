begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(16);

select ok(
  to_regclass('public.custom_hostname_write_attempts') is not null,
  'custom-hostname writes have a durable external-write ledger'
);

select ok(
  has_function_privilege(
    'service_role',
    to_regprocedure('public.claim_custom_hostname_write_attempt(uuid,uuid,text,text,integer)'),
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    to_regprocedure('public.claim_custom_hostname_write_attempt(uuid,uuid,text,text,integer)'),
    'EXECUTE'
  ),
  'only the service role can claim a custom-hostname write'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.custom_hostname_write_attempts',
    'select'
  )
  and not has_table_privilege(
    'authenticated',
    'public.custom_hostname_write_attempts',
    'insert'
  )
  and not has_table_privilege(
    'authenticated',
    'public.custom_hostname_write_attempts',
    'update'
  ),
  'authenticated clients cannot inspect or mutate the external-write ledger'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

insert into public.organizations (id, name, plan_tier)
values
  (
    'a1000000-0000-4000-8000-000000000001',
    'Hostname Safety Winery',
    'reserve'
  ),
  (
    'a1000000-0000-4000-8000-000000000002',
    'Hostname Collision Winery',
    'reserve'
  );

create temporary table hostname_claim_create as
select *
from public.claim_custom_hostname_write_attempt(
  'a1000000-0000-4000-8000-000000000001',
  (
    select default_brand_id
    from public.organizations
    where id = 'a1000000-0000-4000-8000-000000000001'
  ),
  'club.hostname-safety.test',
  'pgtap:hostname:create',
  120
);

select is(
  (select disposition from hostname_claim_create),
  'create',
  'the first stable hostname claim authorizes exactly one create mutation'
);

create temporary table hostname_claim_busy as
select *
from public.claim_custom_hostname_write_attempt(
  'a1000000-0000-4000-8000-000000000001',
  (
    select default_brand_id
    from public.organizations
    where id = 'a1000000-0000-4000-8000-000000000001'
  ),
  'club.hostname-safety.test',
  'pgtap:hostname:concurrent',
  120
);

select is(
  (select disposition from hostname_claim_busy),
  'busy',
  'a concurrent replay cannot acquire a second mutation lease'
);

select is(
  (
    select mutation_attempt_count
    from public.custom_hostname_write_attempts
    where hostname = 'club.hostname-safety.test'
  ),
  1,
  'the durable ledger fixes the provider mutation count at one'
);

select lives_ok(
  $$
    select public.mark_custom_hostname_lookup_required(
      (select attempt_id from hostname_claim_create),
      (select lease_token from hostname_claim_create),
      'CREATE_RESULT_UNKNOWN'
    )
  $$,
  'an ambiguous create transitions durably to lookup-required'
);

create temporary table hostname_claim_lookup as
select *
from public.claim_custom_hostname_write_attempt(
  'a1000000-0000-4000-8000-000000000001',
  (
    select default_brand_id
    from public.organizations
    where id = 'a1000000-0000-4000-8000-000000000001'
  ),
  'club.hostname-safety.test',
  'pgtap:hostname:lookup',
  120
);

select is(
  (select disposition from hostname_claim_lookup),
  'lookup',
  'replay after ambiguity authorizes provider lookup rather than create'
);

select lives_ok(
  $$
    select public.release_custom_hostname_lookup(
      (select attempt_id from hostname_claim_lookup),
      (select lease_token from hostname_claim_lookup),
      'PROVIDER_HOSTNAME_NOT_FOUND'
    )
  $$,
  'a lookup miss releases only the lookup lease'
);

create temporary table hostname_claim_lookup_retry as
select *
from public.claim_custom_hostname_write_attempt(
  'a1000000-0000-4000-8000-000000000001',
  (
    select default_brand_id
    from public.organizations
    where id = 'a1000000-0000-4000-8000-000000000001'
  ),
  'club.hostname-safety.test',
  'pgtap:hostname:lookup-retry',
  120
);

select is(
  (select disposition from hostname_claim_lookup_retry),
  'lookup',
  'subsequent retries remain permanently lookup-only'
);

select lives_ok(
  $$
    select public.record_custom_hostname_provider_result(
      (select attempt_id from hostname_claim_lookup_retry),
      (select lease_token from hostname_claim_lookup_retry),
      'hostname_123'
    )
  $$,
  'provider identity is recorded before local domain persistence'
);

select is(
  (
    select status
    from public.custom_hostname_write_attempts
    where hostname = 'club.hostname-safety.test'
  ),
  'provider_confirmed',
  'the provider-confirmed state survives local persistence failures'
);

select lives_ok(
  $$
    select public.complete_custom_hostname_write_attempt(
      (select attempt_id from hostname_claim_lookup_retry),
      (select lease_token from hostname_claim_lookup_retry)
    )
  $$,
  'the write is completed only after provider reconciliation and persistence'
);

select is(
  (
    select status
    from public.custom_hostname_write_attempts
    where hostname = 'club.hostname-safety.test'
  ),
  'completed',
  'the durable write reaches completed state'
);

select is(
  (
    select disposition
    from public.claim_custom_hostname_write_attempt(
      'a1000000-0000-4000-8000-000000000001',
      (
        select default_brand_id
        from public.organizations
        where id = 'a1000000-0000-4000-8000-000000000001'
      ),
      'club.hostname-safety.test',
      'pgtap:hostname:completed',
      120
    )
  ),
  'completed',
  'completed replays reconcile the existing provider identity without mutation'
);

select throws_ok(
  $$
    select *
    from public.claim_custom_hostname_write_attempt(
      'a1000000-0000-4000-8000-000000000002',
      (
        select default_brand_id
        from public.organizations
        where id = 'a1000000-0000-4000-8000-000000000002'
      ),
      'club.hostname-safety.test',
      'pgtap:hostname:collision',
      120
    )
  $$,
  '23505',
  'The custom hostname is already claimed by another brand.',
  'a stable hostname claim cannot move between tenants or brands'
);

select * from finish();
rollback;
