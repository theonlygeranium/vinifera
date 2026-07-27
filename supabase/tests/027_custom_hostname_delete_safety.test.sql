begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(21);

select ok(
  to_regclass('public.custom_hostname_delete_attempts') is not null,
  'custom-hostname deletions have a durable reconciliation ledger'
);

select ok(
  has_function_privilege(
    'service_role',
    to_regprocedure(
      'public.claim_custom_hostname_delete_attempt(uuid,uuid,text,text,text,integer)'
    ),
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    to_regprocedure(
      'public.claim_custom_hostname_delete_attempt(uuid,uuid,text,text,text,integer)'
    ),
    'EXECUTE'
  ),
  'only the service role can claim a custom-hostname deletion'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.custom_hostname_delete_attempts',
    'select'
  )
  and not has_table_privilege(
    'authenticated',
    'public.custom_hostname_delete_attempts',
    'insert'
  )
  and not has_table_privilege(
    'authenticated',
    'public.custom_hostname_delete_attempts',
    'update'
  ),
  'authenticated clients cannot inspect or mutate deletion coordination'
);

select ok(
  to_regclass('public.brand_custom_domains_one_enabled_per_brand_idx')
    is not null,
  'a brand can expose only one non-disabled custom hostname'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

insert into public.organizations (id, name, plan_tier)
values (
  'd1000000-0000-4000-8000-000000000001',
  'Hostname Delete Winery',
  'reserve'
);

insert into public.brand_custom_domains (
  organization_id,
  brand_id,
  hostname,
  status,
  provider_hostname_id,
  hostname_status,
  ssl_status,
  dns_challenge_hash
)
select
  organization.id,
  organization.default_brand_id,
  'delete.hostname-safety.test',
  'pending_dns',
  'provider_hostname_delete_1',
  'pending',
  'pending',
  repeat('a', 64)
from public.organizations as organization
where organization.id = 'd1000000-0000-4000-8000-000000000001';

select throws_ok(
  $$
    insert into public.brand_custom_domains (
      organization_id,
      brand_id,
      hostname,
      status,
      provider_hostname_id,
      hostname_status,
      ssl_status,
      dns_challenge_hash
    )
    select
      organization.id,
      organization.default_brand_id,
      'second.hostname-safety.test',
      'pending_dns',
      'provider_hostname_delete_2',
      'pending',
      'pending',
      repeat('b', 64)
    from public.organizations as organization
    where organization.id = 'd1000000-0000-4000-8000-000000000001'
  $$,
  '23505',
  'duplicate key value violates unique constraint "brand_custom_domains_one_enabled_per_brand_idx"',
  'a second enabled domain for one brand is rejected'
);

insert into public.custom_hostname_write_attempts (
  organization_id,
  brand_id,
  hostname,
  status,
  provider_hostname_id,
  mutation_attempt_count,
  provider_confirmed_at,
  completed_at
)
select
  organization.id,
  organization.default_brand_id,
  'delete.hostname-safety.test',
  'completed',
  'provider_hostname_delete_1',
  1,
  now(),
  now()
from public.organizations as organization
where organization.id = 'd1000000-0000-4000-8000-000000000001';

create temporary table delete_claim_create as
select *
from public.claim_custom_hostname_delete_attempt(
  'd1000000-0000-4000-8000-000000000001',
  (
    select default_brand_id
    from public.organizations
    where id = 'd1000000-0000-4000-8000-000000000001'
  ),
  'delete.hostname-safety.test',
  'provider_hostname_delete_1',
  'pgtap:hostname-delete:create',
  120
);

select is(
  (select disposition from delete_claim_create),
  'delete',
  'the first claim authorizes one DELETE mutation'
);

select is(
  (
    select mutation_attempt_count
    from public.custom_hostname_delete_attempts
    where provider_hostname_id = 'provider_hostname_delete_1'
  ),
  1,
  'the first mutation is recorded durably'
);

create temporary table delete_claim_busy as
select *
from public.claim_custom_hostname_delete_attempt(
  'd1000000-0000-4000-8000-000000000001',
  (
    select default_brand_id
    from public.organizations
    where id = 'd1000000-0000-4000-8000-000000000001'
  ),
  'delete.hostname-safety.test',
  'provider_hostname_delete_1',
  'pgtap:hostname-delete:busy',
  120
);

select is(
  (select disposition from delete_claim_busy),
  'busy',
  'a concurrent caller cannot replay DELETE'
);

select lives_ok(
  $$
    select public.mark_custom_hostname_delete_lookup_required(
      (select attempt_id from delete_claim_create),
      (select lease_token from delete_claim_create),
      'DELETE_RESULT_UNKNOWN'
    )
  $$,
  'an ambiguous DELETE becomes durable lookup-required state'
);

select ok(
  (
    select status = 'lookup_required'
      and lease_token is null
      and mutation_attempt_count = 1
    from public.custom_hostname_delete_attempts
    where provider_hostname_id = 'provider_hostname_delete_1'
  ),
  'ambiguity releases the lease without authorizing another mutation'
);

create temporary table delete_claim_lookup as
select *
from public.claim_custom_hostname_delete_attempt(
  'd1000000-0000-4000-8000-000000000001',
  (
    select default_brand_id
    from public.organizations
    where id = 'd1000000-0000-4000-8000-000000000001'
  ),
  'delete.hostname-safety.test',
  'provider_hostname_delete_1',
  'pgtap:hostname-delete:lookup',
  120
);

select is(
  (select disposition from delete_claim_lookup),
  'lookup',
  'a retry must reconcile with a provider GET before mutation'
);

select lives_ok(
  $$
    select public.authorize_custom_hostname_delete_after_lookup(
      (select attempt_id from delete_claim_lookup),
      (select lease_token from delete_claim_lookup)
    )
  $$,
  'a confirmed-present provider object authorizes one new DELETE'
);

select ok(
  (
    select status = 'claimed' and mutation_attempt_count = 2
    from public.custom_hostname_delete_attempts
    where provider_hostname_id = 'provider_hostname_delete_1'
  ),
  'the lookup-authorized retry is counted explicitly'
);

select lives_ok(
  $$
    select public.mark_custom_hostname_delete_lookup_required(
      (select attempt_id from delete_claim_lookup),
      (select lease_token from delete_claim_lookup),
      'DELETE_RESULT_UNKNOWN'
    )
  $$,
  'a second ambiguous DELETE again requires lookup'
);

create temporary table delete_claim_lookup_again as
select *
from public.claim_custom_hostname_delete_attempt(
  'd1000000-0000-4000-8000-000000000001',
  (
    select default_brand_id
    from public.organizations
    where id = 'd1000000-0000-4000-8000-000000000001'
  ),
  'delete.hostname-safety.test',
  'provider_hostname_delete_1',
  'pgtap:hostname-delete:lookup-again',
  120
);

select is(
  (select disposition from delete_claim_lookup_again),
  'lookup',
  'repeated ambiguity never permits blind mutation replay'
);

select lives_ok(
  $$
    select public.record_custom_hostname_delete_provider_absent(
      (select attempt_id from delete_claim_lookup_again),
      (select lease_token from delete_claim_lookup_again)
    )
  $$,
  'a provider 404 durably confirms deletion'
);

select throws_ok(
  $$
    select public.complete_custom_hostname_delete_attempt(
      (select attempt_id from delete_claim_lookup_again),
      'ffffffff-ffff-4fff-8fff-ffffffffffff'
    )
  $$,
  '55000',
  'Custom-hostname deletion completion lease is unavailable.',
  'a forged lease cannot complete local deletion'
);

select lives_ok(
  $$
    select public.complete_custom_hostname_delete_attempt(
      (select attempt_id from delete_claim_lookup_again),
      (select lease_token from delete_claim_lookup_again)
    )
  $$,
  'the provider result and local disable complete atomically'
);

select ok(
  (
    select status = 'disabled'
    from public.brand_custom_domains
    where hostname = 'delete.hostname-safety.test'
  )
  and (
    select status = 'completed'
      and completed_at is not null
      and lease_token is null
    from public.custom_hostname_delete_attempts
    where provider_hostname_id = 'provider_hostname_delete_1'
  )
  and not exists (
    select 1
    from public.custom_hostname_write_attempts
    where hostname = 'delete.hostname-safety.test'
  ),
  'completion disables the domain and releases its old create generation'
);

insert into public.organizations (id, name, plan_tier)
values (
  'd1000000-0000-4000-8000-000000000002',
  'Hostname Reuse Winery',
  'reserve'
);

create temporary table recreate_hostname_claim as
select *
from public.claim_custom_hostname_write_attempt(
  'd1000000-0000-4000-8000-000000000002',
  (
    select default_brand_id
    from public.organizations
    where id = 'd1000000-0000-4000-8000-000000000002'
  ),
  'delete.hostname-safety.test',
  'pgtap:hostname:recreate',
  120
);

select is(
  (select disposition from recreate_hostname_claim),
  'create',
  'a fully deleted hostname can begin a new provider generation for another brand'
);

select lives_ok(
  $$
    update public.brand_custom_domains
    set
      organization_id = 'd1000000-0000-4000-8000-000000000002',
      brand_id = (
        select default_brand_id
        from public.organizations
        where id = 'd1000000-0000-4000-8000-000000000002'
      ),
      provider_hostname_id = 'provider_hostname_recreated_2',
      status = 'pending_dns',
      updated_at = now()
    where hostname = 'delete.hostname-safety.test'
  $$,
  'completed deletion evidence does not block safe hostname transfer'
);

select * from finish();
rollback;
