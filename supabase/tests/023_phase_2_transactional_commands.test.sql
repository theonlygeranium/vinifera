begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(76);

insert into auth.users (id, email)
values ('c1000000-0000-4000-8000-000000000001', 'phase2-command-owner@example.test');

insert into public.organizations (id, name, plan_tier, subscription_status)
values (
  'c2000000-0000-4000-8000-000000000001',
  'Phase 2 Command Winery',
  'vine',
  'active'
);

insert into public.staff_users (id, organization_id, email, role)
values (
  'c1000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  'phase2-command-owner@example.test',
  'owner'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select ok(
  (
    select count(*) = 2
    from pg_class
    where oid in (
      'private.core_club_command_results'::regclass,
      'private.member_side_effect_outbox'::regclass
    )
      and relrowsecurity
      and relforcerowsecurity
  ),
  'command and side-effect state force row-level security'
);

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'apply_club_tier_command',
        'apply_member_command',
        'apply_member_portal_address_command',
        'apply_release_command',
        'claim_member_side_effects',
        'claim_stale_refund_attempts',
        'complete_refund_recovery_claim',
        'complete_member_side_effect',
        'get_member_side_effect_status'
      )
      and (
        not has_function_privilege(
          'service_role',
          procedure.oid,
          'EXECUTE'
        )
        or has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
        or has_function_privilege('anon', procedure.oid, 'EXECUTE')
      )
  ),
  'all public command and outbox functions are service-role-only'
);

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname in (
        'core_club_command_hash',
        'invalidate_dependent_compliance',
        'assert_release_ready',
        'load_core_club_command',
        'store_core_club_command',
        'require_core_club_staff',
        'enqueue_member_side_effect'
      )
      and (
        not has_function_privilege(
          'service_role',
          procedure.oid,
          'EXECUTE'
        )
        or has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
        or has_function_privilege('anon', procedure.oid, 'EXECUTE')
      )
  ),
  'all private command helpers are service-role-only'
);

create temporary table command_tier_result as
select public.apply_club_tier_command(
  'c2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
  'c1000000-0000-4000-8000-000000000001',
  'c3000000-0000-4000-8000-000000000001',
  'create',
  null,
  '{
    "name":"Command Reserve",
    "description":"Transactional tier",
    "price_cents":12500,
    "billing_interval":"quarterly",
    "bottle_count":3,
    "frequency":"quarterly",
    "active":true
  }'::jsonb
) as result;

select is(
  (select count(*) from public.club_tiers where name = 'Command Reserve'),
  1::bigint,
  'tier command writes business state'
);
select is(
  (select result ->> 'replayed' from command_tier_result),
  'false',
  'first command result is not a replay'
);
select is(
  (
    select count(*)
    from public.audit_log
    where action = 'club_tier.created'
      and entity_id = (select (result ->> 'entityId')::uuid from command_tier_result)
  ),
  1::bigint,
  'tier command appends one audit event'
);
select is(
  (
    select count(*)
    from private.core_club_command_results
    where command_id = 'c3000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'tier command persists one durable result'
);

create temporary table command_tier_replay as
select public.apply_club_tier_command(
  'c2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
  'c1000000-0000-4000-8000-000000000001',
  'c3000000-0000-4000-8000-000000000001',
  'create',
  null,
  '{
    "name":"Command Reserve",
    "description":"Transactional tier",
    "price_cents":12500,
    "billing_interval":"quarterly",
    "bottle_count":3,
    "frequency":"quarterly",
    "active":true
  }'::jsonb
) as result;

select is(
  (select result ->> 'replayed' from command_tier_replay),
  'true',
  'an identical command returns its stored result'
);
select is(
  (select count(*) from public.club_tiers where name = 'Command Reserve'),
  1::bigint,
  'replay does not duplicate business state'
);
select throws_ok(
  $$
    select public.apply_club_tier_command(
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      'c1000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'create',
      null,
      '{"name":"Conflicting Tier","price_cents":9999,"billing_interval":"quarterly","bottle_count":3,"frequency":"quarterly"}'::jsonb
    )
  $$,
  '23505',
  'The idempotency key was reused with different command input.',
  'idempotency key reuse with different input is rejected'
);
select throws_ok(
  $$
    select public.apply_club_tier_command(
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      'c1000000-0000-4000-8000-000000000099',
      'c3000000-0000-4000-8000-000000000002',
      'create',
      null,
      '{"name":"Unauthorized Tier","price_cents":9999,"billing_interval":"quarterly","bottle_count":3,"frequency":"quarterly"}'::jsonb
    )
  $$,
  '42501',
  'Active staff authorization is required.',
  'SQL rejects an actor outside the tenant staff roster'
);

create temporary table command_member_result as
select public.apply_member_command(
  'c2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
  'c1000000-0000-4000-8000-000000000001',
  'c3000000-0000-4000-8000-000000000003',
  'create',
  null,
  null,
  false,
  jsonb_build_object(
    'email', 'command-member@example.test',
    'first_name', 'Command',
    'last_name', 'Member',
    'club_tier_id', (select result ->> 'entityId' from command_tier_result)
  )
) as result;

select is(
  (select count(*) from public.members where email = 'command-member@example.test'),
  1::bigint,
  'member command writes the tenant member'
);
select is(
  (select result ->> 'sideEffectState' from command_member_result),
  'not_required',
  'member create reports that no external side effect is required'
);

update public.members
set stripe_customer_id = 'cus_CommandMember001'
where id = (select (result ->> 'entityId')::uuid from command_member_result);

select lives_ok(
  $$
    select public.apply_member_command(
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      'c1000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000004',
      'update',
      (select (result ->> 'entityId')::uuid from command_member_result),
      null,
      false,
      '{"phone":"+17075550123"}'::jsonb
    )
  $$,
  'member update commits provider intent without calling Stripe'
);
select is(
  (
    select count(*)
    from private.member_side_effect_outbox
    where command_id = 'c3000000-0000-4000-8000-000000000004'
      and effect_type = 'stripe_customer_sync'
  ),
  1::bigint,
  'member provider intent is committed to the private outbox'
);
select is(
  (
    select public.get_member_side_effect_status(
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      (select (result ->> 'entityId')::uuid from command_member_result)
    ) ->> 'state'
  ),
  'pending',
  'member reconciliation state exposes pending provider work'
);

update private.member_side_effect_outbox
set max_attempts = 1
where command_id = 'c3000000-0000-4000-8000-000000000004';

create temporary table claimed_member_effect as
select *
from public.claim_member_side_effects('pgtap-command-worker', 10, 300);

select is(
  (select count(*) from claimed_member_effect),
  1::bigint,
  'the leased worker claims the provider intent once'
);
select is(
  (
    select public.complete_member_side_effect(
      outbox_id,
      lease_token,
      false,
      'PROVIDER_ERROR'
    )
    from claimed_member_effect
  ),
  'dead_letter',
  'exhausted provider work moves to the dead-letter state'
);
select is(
  (
    select public.get_member_side_effect_status(
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      (select (result ->> 'entityId')::uuid from command_member_result)
    ) ->> 'state'
  ),
  'reconciliation_required',
  'dead-letter provider work is visible for reconciliation'
);

select lives_ok(
  $$
    select public.apply_member_command(
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      'c1000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000007',
      'update',
      (select (result ->> 'entityId')::uuid from command_member_result),
      null,
      false,
      '{"phone":"+17075550124"}'::jsonb
    )
  $$,
  'a second provider intent is available for expired-lease recovery'
);

update private.member_side_effect_outbox
set max_attempts = 1
where command_id = 'c3000000-0000-4000-8000-000000000007';

create temporary table expired_member_effect as
select *
from public.claim_member_side_effects('pgtap-expired-worker', 10, 300);

update private.member_side_effect_outbox
set lease_expires_at = now() - interval '1 second'
where id = (select outbox_id from expired_member_effect);

create temporary table expired_member_reclaim as
select *
from public.claim_member_side_effects('pgtap-expired-sweeper', 10, 300);

select is(
  (select count(*) from expired_member_reclaim),
  0::bigint,
  'an exhausted expired lease is not reclaimed'
);
select ok(
  (
    select
      status = 'dead_letter'
      and completed_at is not null
      and last_error_code = 'LEASE_EXPIRED'
    from private.member_side_effect_outbox
    where command_id = 'c3000000-0000-4000-8000-000000000007'
  ),
  'an exhausted expired lease becomes a visible dead letter'
);

create temporary table command_release_result as
select public.apply_release_command(
  'c2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
  'c1000000-0000-4000-8000-000000000001',
  'c3000000-0000-4000-8000-000000000005',
  'create',
  null,
  jsonb_build_object(
    'name', 'Command Release',
    'description', 'Aggregate release',
    'processing_date', (current_date + 7)::text,
    'embargo_date', (current_date + 1)::text,
    'initial_status', 'scheduled',
    'tiers', jsonb_build_array(jsonb_build_object(
      'tier_id', (select result ->> 'entityId' from command_tier_result),
      'price_cents', 12500
    )),
    'wines', jsonb_build_array(jsonb_build_object(
      'wine_name', 'Estate Cabernet',
      'quantity', 3,
      'price_cents', 4000
    ))
  )
) as result;

select is(
  (select result ->> 'status' from command_release_result),
  'scheduled',
  'release aggregate can be created directly in its scheduled state'
);
select ok(
  (
    select
      (select count(*) from public.release_tiers where release_id = (command_release_result.result ->> 'entityId')::uuid) = 1
      and (select count(*) from public.release_wines where release_id = (command_release_result.result ->> 'entityId')::uuid) = 1
      and (select count(*) from public.release_tier_items where release_id = (command_release_result.result ->> 'entityId')::uuid) = 1
    from command_release_result
  ),
  'release command commits the complete child aggregate'
);
select throws_ok(
  $$
    select public.apply_release_command(
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      'c1000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000006',
      'create',
      null,
      jsonb_build_object(
        'name', 'Invalid Command Release',
        'processing_date', (current_date + 8)::text,
        'embargo_date', (current_date + 2)::text,
        'tiers', jsonb_build_array(jsonb_build_object(
          'tier_id', (select result ->> 'entityId' from command_tier_result),
          'price_cents', 12500
        )),
        'wines', '[]'::jsonb
      )
    )
  $$,
  '22023',
  'The release aggregate payload is incomplete.',
  'an incomplete release aggregate is rejected'
);
select is(
  (
    select count(*)
    from private.core_club_command_results
    where command_id = 'c3000000-0000-4000-8000-000000000006'
  ),
  0::bigint,
  'a rejected release does not persist a command result'
);

-- Phase 5 added sibling brands after the original Phase 2 relationships were
-- created. These fixtures prove every inherited relationship now carries the
-- brand label in addition to the organization label.
insert into public.brands (
  id,
  organization_id,
  name,
  slug
)
values (
  'c2100000-0000-4000-8000-000000000002',
  'c2000000-0000-4000-8000-000000000001',
  'Phase 2 Sibling Brand',
  'phase-2-sibling'
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
values (
  'c3100000-0000-4000-8000-000000000002',
  'c2000000-0000-4000-8000-000000000001',
  'c2100000-0000-4000-8000-000000000002',
  'Sibling Reserve',
  18000,
  6,
  'quarterly'
);

insert into public.members (
  id,
  organization_id,
  brand_id,
  email,
  first_name,
  last_name,
  club_tier_id
)
values (
  'c4100000-0000-4000-8000-000000000002',
  'c2000000-0000-4000-8000-000000000001',
  'c2100000-0000-4000-8000-000000000002',
  'sibling-member@example.test',
  'Sibling',
  'Member',
  'c3100000-0000-4000-8000-000000000002'
);

insert into public.releases (
  id,
  organization_id,
  brand_id,
  name,
  processing_date,
  embargo_date,
  status
)
values (
  'c5100000-0000-4000-8000-000000000002',
  'c2000000-0000-4000-8000-000000000001',
  'c2100000-0000-4000-8000-000000000002',
  'Sibling Release',
  current_date + 30,
  current_date + 20,
  'draft'
);

insert into public.release_wines (
  id,
  organization_id,
  brand_id,
  release_id,
  wine_name
)
values (
  'c6100000-0000-4000-8000-000000000002',
  'c2000000-0000-4000-8000-000000000001',
  'c2100000-0000-4000-8000-000000000002',
  'c5100000-0000-4000-8000-000000000002',
  'Sibling Cabernet'
);

-- Draft aggregate updates must preserve wine identity so an exact retry can
-- reach the durable command replay after a lost first response.
create temporary table release_identity_create_result as
select public.apply_release_command(
  'c2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
  'c1000000-0000-4000-8000-000000000001',
  'c3600000-0000-4000-8000-000000000001',
  'create',
  null,
  jsonb_build_object(
    'name', 'Release Identity Draft',
    'description', 'Stable release-wine identity fixture',
    'processing_date', (current_date + 70)::text,
    'embargo_date', (current_date + 60)::text,
    'initial_status', 'draft',
    'tiers', jsonb_build_array(jsonb_build_object(
      'tier_id', (select result ->> 'entityId' from command_tier_result),
      'price_cents', 12500
    )),
    'wines', jsonb_build_array(jsonb_build_object(
      'wine_name', 'Identity Cabernet',
      'quantity', 3,
      'price_cents', 4000
    ))
  )
) as result;

create temporary table release_identity_original_wine as
select wine.id
from public.release_wines as wine
where wine.release_id = (
  select (result ->> 'entityId')::uuid
  from release_identity_create_result
);

create temporary table release_identity_update_payload as
select jsonb_build_object(
  'name', 'Release Identity Draft Updated',
  'description', 'Stable release-wine identity update',
  'processing_date', (current_date + 71)::text,
  'embargo_date', (current_date + 61)::text,
  'tiers', jsonb_build_array(jsonb_build_object(
    'tier_id', (select result ->> 'entityId' from command_tier_result),
    'price_cents', 12750
  )),
  'wines', jsonb_build_array(jsonb_build_object(
    'wine_id', (select id from release_identity_original_wine),
    'wine_name', 'Identity Cabernet Renamed',
    'quantity', 3,
    'price_cents', 4250
  ))
) as payload;

create temporary table release_identity_update_result as
select public.apply_release_command(
  'c2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
  'c1000000-0000-4000-8000-000000000001',
  'c3600000-0000-4000-8000-000000000002',
  'update',
  (select (result ->> 'entityId')::uuid from release_identity_create_result),
  (select payload from release_identity_update_payload)
) as result;

select is(
  (
    select wine.id
    from public.release_wines as wine
    where wine.release_id = (
      select (result ->> 'entityId')::uuid
      from release_identity_create_result
    )
  ),
  (select id from release_identity_original_wine),
  'release update preserves the supplied release-wine identifier'
);

create temporary table release_identity_update_replay as
select public.apply_release_command(
  'c2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
  'c1000000-0000-4000-8000-000000000001',
  'c3600000-0000-4000-8000-000000000002',
  'update',
  (select (result ->> 'entityId')::uuid from release_identity_create_result),
  (select payload from release_identity_update_payload)
) as result;

select is(
  (select result ->> 'replayed' from release_identity_update_replay),
  'true',
  'an exact release update retry returns the durable replay result'
);

select ok(
  (
    select count(*) = 1
    from private.core_club_command_results
    where command_id = 'c3600000-0000-4000-8000-000000000002'
  )
  and (
    select count(*) = 1
    from public.audit_log
    where action = 'release.updated'
      and entity_id = (
        select (result ->> 'entityId')::uuid
        from release_identity_create_result
      )
  )
  and (
    select count(*) = 1
    from public.release_wines
    where release_id = (
      select (result ->> 'entityId')::uuid
      from release_identity_create_result
    )
  )
  and (
    select count(*) = 1
    from public.release_tier_items
    where release_id = (
      select (result ->> 'entityId')::uuid
      from release_identity_create_result
    )
  ),
  'release update replay does not duplicate command, audit, or child rows'
);

select throws_ok(
  $$
    select public.apply_release_command(
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      'c1000000-0000-4000-8000-000000000001',
      'c3600000-0000-4000-8000-000000000002',
      'update',
      (select (result ->> 'entityId')::uuid from release_identity_create_result),
      (select payload || jsonb_build_object('description', 'Changed retry input') from release_identity_update_payload)
    )
  $$,
  '23505',
  'The idempotency key was reused with different command input.',
  'a release update retry cannot change its payload'
);

select throws_ok(
  $$
    select public.apply_release_command(
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      'c1000000-0000-4000-8000-000000000001',
      'c3600000-0000-4000-8000-000000000003',
      'update',
      (select (result ->> 'entityId')::uuid from release_identity_create_result),
      (
        select jsonb_set(
          payload,
          '{wines,0,wine_id}',
          to_jsonb('c6100000-0000-4000-8000-000000000002'::uuid)
        )
        from release_identity_update_payload
      )
    )
  $$,
  'P0002',
  'One or more release wines were not found in this release.',
  'release update rejects a wine identifier from a sibling brand'
);

select ok(
  (
    select
      release.name = 'Release Identity Draft Updated'
      and wine.id = (select id from release_identity_original_wine)
      and wine.wine_name = 'Identity Cabernet Renamed'
    from public.releases as release
    join public.release_wines as wine
      on wine.organization_id = release.organization_id
      and wine.brand_id = release.brand_id
      and wine.release_id = release.id
    where release.id = (
      select (result ->> 'entityId')::uuid
      from release_identity_create_result
    )
  )
  and not exists (
    select 1
    from private.core_club_command_results
    where command_id = 'c3600000-0000-4000-8000-000000000003'
  ),
  'foreign wine rejection leaves the aggregate and command ledger unchanged'
);

select throws_ok(
  $$
    select public.apply_release_command(
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      'c1000000-0000-4000-8000-000000000001',
      'c3600000-0000-4000-8000-000000000004',
      'update',
      (select (result ->> 'entityId')::uuid from release_identity_create_result),
      (
        select jsonb_set(
          payload,
          '{wines}',
          jsonb_build_array(
            payload -> 'wines' -> 0,
            (payload -> 'wines' -> 0)
              || jsonb_build_object(
                'wine_name', 'Duplicate Identity Cabernet',
                'quantity', 1
              )
          )
        )
        from release_identity_update_payload
      )
    )
  $$,
  '22023',
  'Release wine identifiers must be unique.',
  'release update rejects duplicate non-null wine identifiers'
);

select ok(
  (
    select
      release.name = 'Release Identity Draft Updated'
      and count(wine.id) = 1
      and min(wine.id::text) = (
        select id::text
        from release_identity_original_wine
      )
    from public.releases as release
    join public.release_wines as wine
      on wine.organization_id = release.organization_id
      and wine.brand_id = release.brand_id
      and wine.release_id = release.id
    where release.id = (
      select (result ->> 'entityId')::uuid
      from release_identity_create_result
    )
    group by release.name
  )
  and not exists (
    select 1
    from private.core_club_command_results
    where command_id = 'c3600000-0000-4000-8000-000000000004'
  ),
  'duplicate wine rejection leaves the aggregate and command ledger unchanged'
);

select throws_ok(
  $$
    select public.apply_release_command(
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      'c1000000-0000-4000-8000-000000000001',
      'c3600000-0000-4000-8000-000000000005',
      'create',
      null,
      jsonb_build_object(
        'name', 'Forged Identity Create',
        'processing_date', (current_date + 72)::text,
        'embargo_date', (current_date + 62)::text,
        'initial_status', 'draft',
        'tiers', jsonb_build_array(jsonb_build_object(
          'tier_id', (select result ->> 'entityId' from command_tier_result),
          'price_cents', 12500
        )),
        'wines', jsonb_build_array(jsonb_build_object(
          'wine_id', (select id from release_identity_original_wine),
          'wine_name', 'Forged Identity Cabernet',
          'quantity', 3,
          'price_cents', 4000
        ))
      )
    )
  $$,
  '22023',
  'The release create state is invalid.',
  'release create rejects a caller-supplied wine identifier'
);

select ok(
  not exists (
    select 1
    from public.releases
    where name = 'Forged Identity Create'
  )
  and not exists (
    select 1
    from private.core_club_command_results
    where command_id = 'c3600000-0000-4000-8000-000000000005'
  ),
  'rejected release create leaves no aggregate or command result'
);

select throws_ok(
  $$
    select public.apply_release_command(
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      'c1000000-0000-4000-8000-000000000001',
      'c3600000-0000-4000-8000-000000000006',
      'update',
      (select (result ->> 'entityId')::uuid from release_identity_create_result),
      (
        select jsonb_set(payload, '{name}', 'null'::jsonb)
        from release_identity_update_payload
      )
    )
  $$,
  '22023',
  'The release aggregate payload is incomplete.',
  'release update rejects a JSON null required scalar'
);

select throws_ok(
  $$
    select public.apply_release_command(
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      'c1000000-0000-4000-8000-000000000001',
      'c3600000-0000-4000-8000-000000000007',
      'update',
      (select (result ->> 'entityId')::uuid from release_identity_create_result),
      (
        select jsonb_set(payload, '{tiers,0,price_cents}', 'null'::jsonb)
        from release_identity_update_payload
      )
    )
  $$,
  'P0002',
  'One or more release tiers were not found in this brand.',
  'release update rejects a JSON null tier price'
);

select throws_ok(
  $$
    select public.apply_release_command(
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      'c1000000-0000-4000-8000-000000000001',
      'c3600000-0000-4000-8000-000000000008',
      'update',
      (select (result ->> 'entityId')::uuid from release_identity_create_result),
      (
        select jsonb_set(payload, '{wines,0,quantity}', 'null'::jsonb)
        from release_identity_update_payload
      )
    )
  $$,
  '22023',
  'One or more release wines are invalid.',
  'release update rejects a JSON null wine quantity'
);

select throws_ok(
  $$
    select public.apply_release_command(
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      'c1000000-0000-4000-8000-000000000001',
      'c3600000-0000-4000-8000-000000000009',
      'update',
      (select (result ->> 'entityId')::uuid from release_identity_create_result),
      (
        select jsonb_set(payload, '{wines,0,price_cents}', 'null'::jsonb)
        from release_identity_update_payload
      )
    )
  $$,
  '22023',
  'One or more release wines are invalid.',
  'release update rejects a JSON null wine price'
);

select ok(
  not exists (
    select 1
    from private.core_club_command_results
    where command_id in (
      'c3600000-0000-4000-8000-000000000006',
      'c3600000-0000-4000-8000-000000000007',
      'c3600000-0000-4000-8000-000000000008',
      'c3600000-0000-4000-8000-000000000009'
    )
  ),
  'null-valued release commands leave no durable replay result'
);

select throws_ok(
  $$
    update public.members
    set club_tier_id = 'c3100000-0000-4000-8000-000000000002'
    where id = (select (result ->> 'entityId')::uuid from command_member_result)
  $$,
  '23503',
  null,
  'a member cannot reference a club tier from a sibling brand'
);
select throws_ok(
  $$
    update public.members
    set referred_by_member_id = 'c4100000-0000-4000-8000-000000000002'
    where id = (select (result ->> 'entityId')::uuid from command_member_result)
  $$,
  '23503',
  null,
  'a member cannot reference a referrer from a sibling brand'
);
select throws_ok(
  $$
    update public.club_tiers
    set upgrade_path_id = 'c3100000-0000-4000-8000-000000000002'
    where id = (select (result ->> 'entityId')::uuid from command_tier_result)
  $$,
  '23503',
  null,
  'a club tier cannot reference an upgrade path from a sibling brand'
);
select throws_ok(
  $$
    insert into public.release_tiers (
      organization_id,
      brand_id,
      release_id,
      tier_id
    )
    values (
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      (select (result ->> 'entityId')::uuid from command_release_result),
      'c3100000-0000-4000-8000-000000000002'
    )
  $$,
  '23503',
  null,
  'a release tier cannot reference a club tier from a sibling brand'
);

insert into public.member_imports (
  id,
  organization_id,
  brand_id,
  upload_token_hash,
  content_sha256,
  original_filename,
  content_type,
  file_size_bytes
)
values (
  'c7100000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
  repeat('a', 64),
  repeat('b', 64),
  'phase2-command-members.csv',
  'text/csv',
  128
);

select throws_ok(
  $$
    insert into public.member_import_rows (
      organization_id,
      brand_id,
      import_id,
      row_number,
      raw_data,
      member_id
    )
    values (
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      'c7100000-0000-4000-8000-000000000001',
      1,
      '{"email":"sibling-member@example.test"}'::jsonb,
      'c4100000-0000-4000-8000-000000000002'
    )
  $$,
  '23503',
  null,
  'an import row cannot attach a member from a sibling brand'
);

insert into public.shipments (
  id,
  organization_id,
  brand_id,
  member_id,
  release_id,
  release_tier_id,
  tier_id,
  status,
  shipping_address,
  charge_amount_cents,
  stripe_charge_id
)
values (
  'c8100000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
  (select (result ->> 'entityId')::uuid from command_member_result),
  (select (result ->> 'entityId')::uuid from command_release_result),
  (
    select id
    from public.release_tiers
    where release_id = (select (result ->> 'entityId')::uuid from command_release_result)
  ),
  (select (result ->> 'entityId')::uuid from command_tier_result),
  'charged',
  '{"line1":"1 Command Way","city":"Napa","region":"CA","postal_code":"94558"}'::jsonb,
  12500,
  'ch_CommandFixture001'
);

select throws_ok(
  $$
    insert into public.shipment_items (
      organization_id,
      brand_id,
      shipment_id,
      release_wine_id,
      wine_name,
      quantity,
      price_cents
    )
    values (
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      'c8100000-0000-4000-8000-000000000001',
      'c6100000-0000-4000-8000-000000000002',
      'Forged Sibling Wine',
      1,
      4000
    )
  $$,
  '23503',
  null,
  'a shipment item cannot reference a release wine from a sibling brand'
);

-- Preserve the original delete behavior while strengthening each relationship
-- from organization scope to brand scope.
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
    'c3200000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
    'Disposable Upgrade Target',
    9000,
    2,
    'quarterly'
  ),
  (
    'c3200000-0000-4000-8000-000000000002',
    'c2000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
    'Disposable Upgrade Source',
    9500,
    2,
    'quarterly'
  );

update public.club_tiers
set upgrade_path_id = 'c3200000-0000-4000-8000-000000000001'
where id = 'c3200000-0000-4000-8000-000000000002';

insert into public.members (
  id,
  organization_id,
  brand_id,
  email,
  first_name,
  last_name,
  club_tier_id
)
values (
  'c4200000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
  'disposable-tier-member@example.test',
  'Disposable',
  'Tier Member',
  'c3200000-0000-4000-8000-000000000001'
);

delete from public.club_tiers
where id = 'c3200000-0000-4000-8000-000000000001';

select ok(
  (
    select club_tier_id is null
    from public.members
    where id = 'c4200000-0000-4000-8000-000000000001'
  )
  and (
    select upgrade_path_id is null
    from public.club_tiers
    where id = 'c3200000-0000-4000-8000-000000000002'
  ),
  'tier deletion still sets member tier and upgrade-path references to null'
);

insert into public.members (
  id,
  organization_id,
  brand_id,
  email,
  first_name,
  last_name,
  club_tier_id
)
values
  (
    'c4200000-0000-4000-8000-000000000002',
    'c2000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
    'disposable-referrer@example.test',
    'Disposable',
    'Referrer',
    (select (result ->> 'entityId')::uuid from command_tier_result)
  ),
  (
    'c4200000-0000-4000-8000-000000000003',
    'c2000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
    'disposable-referral@example.test',
    'Disposable',
    'Referral',
    (select (result ->> 'entityId')::uuid from command_tier_result)
  );

update public.members
set referred_by_member_id = 'c4200000-0000-4000-8000-000000000002'
where id = 'c4200000-0000-4000-8000-000000000003';

insert into public.member_import_rows (
  organization_id,
  brand_id,
  import_id,
  row_number,
  raw_data,
  member_id
)
values (
  'c2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
  'c7100000-0000-4000-8000-000000000001',
  2,
  '{"email":"disposable-referrer@example.test"}'::jsonb,
  'c4200000-0000-4000-8000-000000000002'
);

delete from public.email_log
where member_id = 'c4200000-0000-4000-8000-000000000002';

delete from public.members
where id = 'c4200000-0000-4000-8000-000000000002';

select ok(
  (
    select referred_by_member_id is null
    from public.members
    where id = 'c4200000-0000-4000-8000-000000000003'
  )
  and (
    select member_id is null
    from public.member_import_rows
    where import_id = 'c7100000-0000-4000-8000-000000000001'
      and row_number = 2
  ),
  'member deletion still sets referrer and import-row references to null'
);

select throws_ok(
  $$
    delete from public.club_tiers
    where id = (select (result ->> 'entityId')::uuid from command_tier_result)
  $$,
  '23001',
  null,
  'release-tier references retain restrictive club-tier deletion'
);

insert into public.shipment_items (
  id,
  organization_id,
  brand_id,
  shipment_id,
  release_wine_id,
  wine_name,
  quantity,
  price_cents
)
select
  'c9100000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  organization.default_brand_id,
  'c8100000-0000-4000-8000-000000000001',
  wine.id,
  wine.wine_name,
  3,
  4000
from public.release_wines as wine
join public.organizations as organization
  on organization.id = wine.organization_id
where wine.release_id = (select (result ->> 'entityId')::uuid from command_release_result);

select throws_ok(
  $$
    delete from public.release_wines
    where release_id = (select (result ->> 'entityId')::uuid from command_release_result)
  $$,
  '23001',
  null,
  'shipment-item references retain restrictive release-wine deletion'
);

-- The command result must point to audit evidence from the exact same brand.
select throws_ok(
  $$
    insert into private.core_club_command_results (
      organization_id,
      brand_id,
      command_id,
      actor_user_id,
      operation,
      payload_sha256,
      entity_type,
      result,
      audit_id
    )
    values (
      'c2000000-0000-4000-8000-000000000001',
      'c2100000-0000-4000-8000-000000000002',
      'c3300000-0000-4000-8000-000000000001',
      'c1000000-0000-4000-8000-000000000001',
      'club_tier.create',
      repeat('c', 64),
      'club_tier',
      '{"status":"forged"}'::jsonb,
      (
        select audit_id
        from private.core_club_command_results
        where command_id = 'c3000000-0000-4000-8000-000000000001'
      )
    )
  $$,
  '23503',
  null,
  'a command result cannot cite audit evidence from a sibling brand'
);

reset role;

create or replace function pg_temp.reject_phase2_command_audit()
returns trigger
language plpgsql
as $trigger$
begin
  if current_setting('vinifera.force_audit_failure', true) = 'on' then
    raise exception using
      errcode = 'P0001',
      message = 'forced command audit failure';
  end if;
  return new;
end;
$trigger$;

create trigger phase2_force_command_audit_failure
before insert on public.audit_log
for each row execute function pg_temp.reject_phase2_command_audit();

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('vinifera.force_audit_failure', 'on', true);

select throws_ok(
  $$
    select public.apply_club_tier_command(
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      'c1000000-0000-4000-8000-000000000001',
      'c3300000-0000-4000-8000-000000000002',
      'create',
      null,
      '{
        "name":"Audit Rollback Tier",
        "price_cents":11000,
        "billing_interval":"quarterly",
        "bottle_count":3,
        "frequency":"quarterly"
      }'::jsonb
    )
  $$,
  'P0001',
  'forced command audit failure',
  'a forced audit failure aborts the command'
);

select set_config('vinifera.force_audit_failure', 'off', true);
reset role;
drop trigger phase2_force_command_audit_failure on public.audit_log;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(
  (
    select count(*)
    from public.club_tiers
    where name = 'Audit Rollback Tier'
  ),
  0::bigint,
  'audit failure rolls back the business mutation atomically'
);
select is(
  (
    select count(*)
    from private.core_club_command_results
    where command_id = 'c3300000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'audit failure does not leave a replay result'
);

-- Legacy drafts can predate the aggregate command. Scheduling must validate
-- every tier, not merely the existence of one tier and one item.
insert into public.club_tiers (
  id,
  organization_id,
  brand_id,
  name,
  price_cents,
  bottle_count,
  frequency
)
values (
  'c3400000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
  'Legacy Six Bottle',
  21000,
  6,
  'quarterly'
);

insert into public.releases (
  id,
  organization_id,
  brand_id,
  name,
  processing_date,
  embargo_date,
  status,
  created_by
)
values (
  'c5200000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
  'Legacy Two Tier Draft',
  current_date + 40,
  current_date + 30,
  'draft',
  'c1000000-0000-4000-8000-000000000001'
);

insert into public.release_tiers (
  id,
  organization_id,
  brand_id,
  release_id,
  tier_id
)
values
  (
    'c5300000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
    'c5200000-0000-4000-8000-000000000001',
    (select (result ->> 'entityId')::uuid from command_tier_result)
  ),
  (
    'c5300000-0000-4000-8000-000000000002',
    'c2000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
    'c5200000-0000-4000-8000-000000000001',
    'c3400000-0000-4000-8000-000000000001'
  );

insert into public.release_wines (
  id,
  organization_id,
  brand_id,
  release_id,
  wine_name
)
values (
  'c5400000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
  'c5200000-0000-4000-8000-000000000001',
  'Legacy Cabernet'
);

insert into public.release_tier_items (
  organization_id,
  brand_id,
  release_id,
  release_tier_id,
  release_wine_id,
  quantity,
  unit_price_cents
)
values (
  'c2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
  'c5200000-0000-4000-8000-000000000001',
  'c5300000-0000-4000-8000-000000000001',
  'c5400000-0000-4000-8000-000000000001',
  3,
  4000
);

select throws_ok(
  $$
    select public.apply_release_command(
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      'c1000000-0000-4000-8000-000000000001',
      'c3500000-0000-4000-8000-000000000001',
      'schedule',
      'c5200000-0000-4000-8000-000000000001',
      '{}'::jsonb
    )
  $$,
  '23514',
  'Every release tier must contain its snapshotted bottle count before scheduling.',
  'scheduling rejects a two-tier draft when one tier has no items'
);

insert into public.release_tier_items (
  organization_id,
  brand_id,
  release_id,
  release_tier_id,
  release_wine_id,
  quantity,
  unit_price_cents
)
values (
  'c2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
  'c5200000-0000-4000-8000-000000000001',
  'c5300000-0000-4000-8000-000000000002',
  'c5400000-0000-4000-8000-000000000001',
  5,
  4000
);

select throws_ok(
  $$
    select public.apply_release_command(
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      'c1000000-0000-4000-8000-000000000001',
      'c3500000-0000-4000-8000-000000000002',
      'schedule',
      'c5200000-0000-4000-8000-000000000001',
      '{}'::jsonb
    )
  $$,
  '23514',
  'Every release tier must contain its snapshotted bottle count before scheduling.',
  'scheduling rejects a tier whose item quantity misses its bottle snapshot'
);

select throws_ok(
  $$
    select public.apply_release_command(
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      'c1000000-0000-4000-8000-000000000001',
      'c3500000-0000-4000-8000-000000000003',
      'create',
      null,
      jsonb_build_object(
        'name', 'Invalid Direct Scheduled Release',
        'processing_date', (current_date + 50)::text,
        'embargo_date', (current_date + 40)::text,
        'initial_status', 'scheduled',
        'tiers', jsonb_build_array(jsonb_build_object(
          'tier_id', 'c3400000-0000-4000-8000-000000000001',
          'price_cents', 21000
        )),
        'wines', jsonb_build_array(jsonb_build_object(
          'wine_name', 'Short Direct Scheduled Cabernet',
          'quantity', 5,
          'price_cents', 4000
        ))
      )
    )
  $$,
  '23514',
  'Every release tier must contain its snapshotted bottle count before scheduling.',
  'direct scheduled creation rejects an aggregate below its bottle snapshot'
);
select ok(
  not exists (
    select 1
    from public.releases
    where name = 'Invalid Direct Scheduled Release'
  )
  and not exists (
    select 1
    from private.core_club_command_results
    where command_id = 'c3500000-0000-4000-8000-000000000003'
  ),
  'a rejected direct scheduled aggregate rolls back release and command state'
);

-- Seed independent shipment aggregates for refund recovery and direct payment
-- convergence. No provider call occurs; these are database state machines.
insert into public.members (
  id,
  organization_id,
  brand_id,
  email,
  first_name,
  last_name,
  club_tier_id
)
values
  (
    'c4300000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
    'fresh-refund@example.test',
    'Fresh',
    'Refund',
    (select (result ->> 'entityId')::uuid from command_tier_result)
  ),
  (
    'c4300000-0000-4000-8000-000000000002',
    'c2000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
    'stale-refund@example.test',
    'Stale',
    'Refund',
    (select (result ->> 'entityId')::uuid from command_tier_result)
  ),
  (
    'c4300000-0000-4000-8000-000000000003',
    'c2000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
    'direct-charge@example.test',
    'Direct',
    'Charge',
    (select (result ->> 'entityId')::uuid from command_tier_result)
  );

insert into public.shipments (
  id,
  organization_id,
  brand_id,
  member_id,
  release_id,
  release_tier_id,
  tier_id,
  status,
  shipping_address,
  charge_amount_cents,
  stripe_charge_id
)
values
  (
    'c8200000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
    'c4300000-0000-4000-8000-000000000001',
    (select (result ->> 'entityId')::uuid from command_release_result),
    (select id from public.release_tiers where release_id = (select (result ->> 'entityId')::uuid from command_release_result)),
    (select (result ->> 'entityId')::uuid from command_tier_result),
    'charged',
    '{"line1":"2 Command Way","city":"Napa","region":"CA","postal_code":"94558"}'::jsonb,
    12500,
    'ch_CommandRefundFresh'
  ),
  (
    'c8200000-0000-4000-8000-000000000002',
    'c2000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
    'c4300000-0000-4000-8000-000000000002',
    (select (result ->> 'entityId')::uuid from command_release_result),
    (select id from public.release_tiers where release_id = (select (result ->> 'entityId')::uuid from command_release_result)),
    (select (result ->> 'entityId')::uuid from command_tier_result),
    'charged',
    '{"line1":"3 Command Way","city":"Napa","region":"CA","postal_code":"94558"}'::jsonb,
    12500,
    'ch_CommandRefundStale'
  ),
  (
    'c8200000-0000-4000-8000-000000000003',
    'c2000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
    'c4300000-0000-4000-8000-000000000003',
    (select (result ->> 'entityId')::uuid from command_release_result),
    (select id from public.release_tiers where release_id = (select (result ->> 'entityId')::uuid from command_release_result)),
    (select (result ->> 'entityId')::uuid from command_tier_result),
    'pending',
    '{"line1":"4 Command Way","city":"Napa","region":"CA","postal_code":"94558"}'::jsonb,
    12500,
    null
  );

create temporary table fresh_refund_attempt as
select public.record_billing_attempt(
  'c2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
  'c8200000-0000-4000-8000-000000000001',
  'refund',
  5000,
  'shipment:c8200000:fresh-refund',
  null,
  'c1000000-0000-4000-8000-000000000001',
  '{}'::jsonb
) as id;

select is(
  (
    select count(*)
    from public.claim_stale_refund_attempts(
      now(),
      'phase2-fresh-worker',
      10,
      300,
      300
    )
  ),
  0::bigint,
  'a fresh processing refund is not recovered prematurely'
);

select throws_ok(
  $$
    select public.record_billing_attempt(
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      'c8200000-0000-4000-8000-000000000001',
      'refund',
      2500,
      'shipment:c8200000:second-refund',
      null,
      'c1000000-0000-4000-8000-000000000001',
      '{}'::jsonb
    )
  $$,
  '23505',
  null,
  'a shipment cannot have two active refund attempts'
);

create temporary table stale_refund_attempt as
select public.record_billing_attempt(
  'c2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
  'c8200000-0000-4000-8000-000000000002',
  'refund',
  5000,
  'shipment:c8200000:stale-refund',
  null,
  'c1000000-0000-4000-8000-000000000001',
  '{}'::jsonb
) as id;

update public.billing_attempts
set started_at = now() - interval '10 minutes'
where id = (select id from stale_refund_attempt);

create temporary table first_refund_claim as
select *
from public.claim_stale_refund_attempts(
  now(),
  'phase2-refund-worker-one',
  10,
  300,
  300
);

select is(
  (
    select count(*)
    from first_refund_claim
    where billing_attempt_id = (select id from stale_refund_attempt)
  ),
  1::bigint,
  'a stale processing refund is leased exactly once'
);
select is(
  (
    select count(*)
    from public.claim_stale_refund_attempts(
      now(),
      'phase2-refund-worker-two',
      10,
      300,
      300
    )
    where billing_attempt_id = (select id from stale_refund_attempt)
  ),
  0::bigint,
  'a second worker cannot claim an unexpired refund lease'
);
select is(
  (
    select public.complete_refund_recovery_claim(
      billing_attempt_id,
      lease_token,
      true,
      'STRIPE_TIMEOUT'
    )::text
    from first_refund_claim
    where billing_attempt_id = (select id from stale_refund_attempt)
  ),
  'processing',
  'a retryable recovery failure requeues the processing refund'
);
select is(
  (
    select count(*)
    from public.claim_stale_refund_attempts(
      now(),
      'phase2-refund-worker-early',
      10,
      300,
      300
    )
    where billing_attempt_id = (select id from stale_refund_attempt)
  ),
  0::bigint,
  'refund recovery backoff prevents an immediate reclaim'
);

create temporary table second_refund_claim as
select *
from public.claim_stale_refund_attempts(
  now() + interval '31 seconds',
  'phase2-refund-worker-retry',
  10,
  300,
  300
);

select is(
  (
    select count(*)
    from second_refund_claim
    where billing_attempt_id = (select id from stale_refund_attempt)
  ),
  1::bigint,
  'a requeued refund becomes claimable after its backoff'
);

update public.billing_attempts
set
  status = 'failed',
  completed_at = now(),
  recovery_lease_expires_at = now() - interval '1 second'
where id = (select id from stale_refund_attempt);

select is(
  (
    select public.complete_refund_recovery_claim(
      billing_attempt_id,
      lease_token,
      false,
      null
    )::text
    from second_refund_claim
    where billing_attempt_id = (select id from stale_refund_attempt)
  ),
  'failed',
  'a finalized refund clears its matching recovery lease after expiry'
);
select is(
  (
    select count(*)
    from public.claim_stale_refund_attempts(
      now() + interval '1 hour',
      'phase2-refund-worker-terminal',
      10,
      300,
      300
    )
    where billing_attempt_id = (select id from stale_refund_attempt)
  ),
  0::bigint,
  'a terminal refund is never reclaimed'
);

create temporary table direct_charge_attempt as
select public.record_billing_attempt(
  'c2000000-0000-4000-8000-000000000001',
  (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
  'c8200000-0000-4000-8000-000000000003',
  'charge',
  12500,
  'shipment:c8200000:direct-charge',
  'pi_CommandDirect001',
  'c1000000-0000-4000-8000-000000000001',
  '{}'::jsonb
) as id;

select throws_ok(
  $$
    select public.record_billing_attempt(
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      'c8200000-0000-4000-8000-000000000003',
      'charge',
      12500,
      'shipment:c8200000:direct-charge',
      'pi_CommandDirect999',
      'c1000000-0000-4000-8000-000000000001',
      '{}'::jsonb
    )
  $$,
  '23505',
  'Billing idempotency key was reused with different parameters.',
  'a billing idempotency key cannot be reused for a different PaymentIntent'
);

select is(
  public.apply_shipment_payment_event(
    'c2000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
    'c8200000-0000-4000-8000-000000000003',
    (select id from direct_charge_attempt),
    null,
    '2026-07-26 10:00:00+00'::timestamptz,
    'succeeded',
    'ch_CommandDirect001',
    null,
    null,
    null,
    '{"source":"direct"}'::jsonb
  )::text,
  'charged',
  'a direct PaymentIntent result charges the shipment'
);
select ok(
  (
    select
      status = 'succeeded'
      and stripe_event_id is null
      and stripe_event_created_at = '2026-07-26 10:00:00+00'::timestamptz
    from public.billing_attempts
    where id = (select id from direct_charge_attempt)
  ),
  'the direct result persists terminal state without inventing an event ID'
);

select is(
  public.apply_shipment_payment_event(
    'c2000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
    'c8200000-0000-4000-8000-000000000003',
    (select id from direct_charge_attempt),
    'evt_CommandDirect001',
    '2026-07-26 10:05:00+00'::timestamptz,
    'succeeded',
    'ch_CommandDirect001',
    null,
    null,
    null,
    '{"source":"webhook"}'::jsonb
  )::text,
  'charged',
  'a later webhook converges on the direct result'
);
select ok(
  (
    select
      stripe_event_id = 'evt_CommandDirect001'
      and stripe_event_created_at = '2026-07-26 10:05:00+00'::timestamptz
      and metadata ->> 'webhook_reconciled' = 'true'
    from public.billing_attempts
    where id = (select id from direct_charge_attempt)
  ),
  'the webhook event ID and provider timestamp attach to the direct result'
);
select is(
  public.apply_shipment_payment_event(
    'c2000000-0000-4000-8000-000000000001',
    (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
    'c8200000-0000-4000-8000-000000000003',
    (select id from direct_charge_attempt),
    'evt_CommandDirect001',
    '2026-07-26 10:05:00+00'::timestamptz,
    'succeeded',
    'ch_CommandDirect001',
    null,
    null,
    null,
    '{"source":"webhook"}'::jsonb
  )::text,
  'charged',
  'an identical billing event replay returns the current shipment state'
);
select is(
  (
    select lifetime_value_cents
    from public.members
    where id = 'c4300000-0000-4000-8000-000000000003'
  ),
  12500::bigint,
  'direct result plus webhook replay increments lifetime value once'
);
select throws_ok(
  $$
    select public.apply_shipment_payment_event(
      'c2000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'c2000000-0000-4000-8000-000000000001'),
      'c8200000-0000-4000-8000-000000000003',
      (select id from direct_charge_attempt),
      'evt_CommandDirect001',
      '2026-07-26 10:06:00+00'::timestamptz,
      'succeeded',
      'ch_CommandDirect001',
      null,
      null,
      null,
      '{"source":"mutated-replay"}'::jsonb
    )
  $$,
  '23505',
  'Stripe event identifier was reused with different parameters.',
  'a Stripe event replay cannot mutate its provider timestamp'
);

select * from finish();
rollback;
