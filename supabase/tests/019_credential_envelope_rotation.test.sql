begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(12);

select ok(
  to_regclass('public.credential_envelope_rotation_runs') is not null,
  'credential-envelope rotation has a durable run ledger'
);

select ok(
  to_regclass('public.credential_envelope_rotation_items') is not null,
  'credential-envelope rotation has durable resumable item leases'
);

select ok(
  (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.credential_envelope_rotation_items'::regclass
      and conname = 'credential_rotation_item_kind_valid'
  ) like '%meta_attribution%',
  'rotation leases include encrypted Meta attribution touchpoints'
);

select ok(
  (
    select pg_get_functiondef(function.oid)
    from pg_proc as function
    join pg_namespace as namespace on namespace.oid = function.pronamespace
    where namespace.nspname = 'private'
      and function.proname = 'refresh_credential_envelope_rotation_items'
  ) like '%meta_attribution_touchpoints%',
  'rotation discovery continuously claims old-key Meta attribution envelopes'
);

select ok(
  has_function_privilege(
    'service_role',
    to_regprocedure('public.start_credential_envelope_rotation(text,text,integer,text)'),
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    to_regprocedure('public.start_credential_envelope_rotation(text,text,integer,text)'),
    'EXECUTE'
  ),
  'only the service role can start an envelope rotation'
);

select ok(
  has_function_privilege(
    'service_role',
    to_regprocedure('public.claim_credential_envelope_rotation_batch(uuid,text,integer)'),
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    to_regprocedure('public.claim_credential_envelope_rotation_batch(uuid,text,integer)'),
    'EXECUTE'
  ),
  'only the service role can claim envelope batches'
);

select ok(
  has_function_privilege(
    'service_role',
    to_regprocedure('public.complete_credential_envelope_rotation_item(uuid,text,uuid,uuid,integer,text,text,text,text,text,text)'),
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    to_regprocedure('public.complete_credential_envelope_rotation_item(uuid,text,uuid,uuid,integer,text,text,text,text,text,text)'),
    'EXECUTE'
  ),
  'only the service role can persist replacement envelopes'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.credential_envelope_rotation_runs',
    'select'
  )
  and not has_table_privilege(
    'authenticated',
    'public.credential_envelope_rotation_items',
    'select'
  ),
  'authenticated clients cannot inspect credential rotation ledgers'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

create temporary table credential_rotation_test_run as
select public.start_credential_envelope_rotation(
  'key-old',
  'key-new',
  25,
  repeat('a', 40)
) as id;

select is(
  (
    select status
    from public.credential_envelope_rotation_runs
    where id = (select id from credential_rotation_test_run)
  ),
  'running',
  'a service-only rotation starts as a durable running job'
);

select is(
  (
    select count(*)::integer
    from public.claim_credential_envelope_rotation_batch(
      (select id from credential_rotation_test_run),
      'pgtap:rotation',
      120
    )
  ),
  0,
  'an empty source keyset produces an empty bounded claim'
);

select is(
  (
    public.verify_credential_envelope_rotation(
      (select id from credential_rotation_test_run)
    )->>'oldKeyCountVerifiedZero'
  )::boolean,
  true,
  'verification records that the old-key count is zero'
);

select is(
  (
    select status
    from public.credential_envelope_rotation_runs
    where id = (select id from credential_rotation_test_run)
  ),
  'verified',
  'the durable run becomes verified only after the zero-count gate'
);

select * from finish();
rollback;
