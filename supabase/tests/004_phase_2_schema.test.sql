begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(56);

select ok(
  exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.organizations'::regclass
      and attname = 'shipping_origin_address'
      and not attisdropped
  ),
  'organizations have a structured shipping origin'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.members'::regclass
      and attname = 'phone'
      and not attisdropped
  ),
  'members have CRM phone data'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.members'::regclass
      and attname = 'club_tier_id'
      and not attisdropped
  ),
  'members can be assigned to a club tier'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.members'::regclass
      and attname = 'churn_risk_score'
      and not attnotnull
  ),
  'churn risk is nullable until Phase 3 scoring'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'members'
      and indexname = 'members_email_uidx'
  ),
  'global normalized member email uniqueness remains for magic-link identity'
);

select ok(to_regclass('public.club_tiers') is not null, 'club_tiers exists');
select ok(to_regclass('public.releases') is not null, 'releases exists');
select ok(to_regclass('public.release_tiers') is not null, 'release_tiers exists');
select ok(to_regclass('public.release_wines') is not null, 'release_wines exists');
select ok(
  to_regclass('public.release_tier_items') is not null,
  'release_tier_items exists'
);
select ok(to_regclass('public.shipments') is not null, 'shipments exists');
select ok(to_regclass('public.shipment_items') is not null, 'shipment_items exists');
select ok(to_regclass('public.billing_attempts') is not null, 'billing_attempts exists');
select ok(to_regclass('public.member_imports') is not null, 'member_imports exists');
select ok(
  to_regclass('public.member_import_rows') is not null,
  'member_import_rows exists'
);
select ok(to_regclass('public.audit_log') is not null, 'audit_log exists');

select ok(to_regtype('public.club_frequency') is not null, 'club frequency enum exists');
select ok(
  to_regtype('public.club_billing_interval') is not null,
  'club billing interval enum exists'
);
select ok(to_regtype('public.release_status') is not null, 'release status enum exists');
select ok(to_regtype('public.shipment_status') is not null, 'shipment status enum exists');
select ok(
  to_regtype('public.billing_attempt_kind') is not null,
  'billing attempt kind enum exists'
);
select ok(
  to_regtype('public.billing_attempt_status') is not null,
  'billing attempt status enum exists'
);
select ok(
  to_regtype('public.address_validation_status') is not null,
  'address validation enum exists'
);
select ok(
  to_regtype('public.member_import_source') is not null,
  'member import source enum exists'
);
select ok(
  to_regtype('public.member_import_status') is not null,
  'member import status enum exists'
);
select ok(
  to_regtype('public.member_import_row_status') is not null,
  'member import row status enum exists'
);
select ok(to_regtype('public.audit_actor_type') is not null, 'audit actor enum exists');

select ok(
  (
    select bool_and(c.relrowsecurity)
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'club_tiers',
        'releases',
        'release_tiers',
        'release_wines',
        'release_tier_items',
        'shipments',
        'shipment_items',
        'billing_attempts',
        'member_imports',
        'member_import_rows',
        'audit_log'
      )
  ),
  'RLS is enabled on every Phase 2 table'
);
select ok(
  (
    select bool_and(c.relforcerowsecurity)
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'club_tiers',
        'releases',
        'release_tiers',
        'release_wines',
        'release_tier_items',
        'shipments',
        'shipment_items',
        'billing_attempts',
        'member_imports',
        'member_import_rows',
        'audit_log'
      )
  ),
  'RLS is forced on every Phase 2 table'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_constraint as c
    join pg_catalog.pg_attribute as a
      on a.attrelid = c.conrelid
      and a.attnum = any (c.conkey)
    where c.contype = 'f'
      and c.conrelid in (
        'public.club_tiers'::regclass,
        'public.members'::regclass,
        'public.releases'::regclass,
        'public.release_tiers'::regclass,
        'public.release_wines'::regclass,
        'public.release_tier_items'::regclass,
        'public.shipments'::regclass,
        'public.shipment_items'::regclass,
        'public.billing_attempts'::regclass,
        'public.member_imports'::regclass,
        'public.member_import_rows'::regclass,
        'public.audit_log'::regclass
      )
      and not exists (
        select 1
        from pg_catalog.pg_index as i
        where i.indrelid = c.conrelid
          and a.attnum = any (i.indkey)
      )
  ),
  'every Phase 2 foreign-key column is indexed'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.release_tiers'::regclass
      and tgname = 'release_tiers_snapshot'
      and not tgisinternal
  ),
  'release tiers snapshot price and bottle configuration'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.members'::regclass
      and tgname = 'members_enforce_status_transition'
      and not tgisinternal
  ),
  'member lifecycle transitions are database-enforced'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.releases'::regclass
      and tgname = 'releases_enforce_status_transition'
      and not tgisinternal
  ),
  'release lifecycle transitions are database-enforced'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.shipments'::regclass
      and tgname = 'shipments_enforce_status_transition'
      and not tgisinternal
  ),
  'shipment lifecycle transitions are database-enforced'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_trigger
    where tgrelid = 'public.audit_log'::regclass
      and tgname in (
        'audit_log_reject_update_delete',
        'audit_log_reject_truncate'
      )
      and not tgisinternal
  ),
  2::bigint,
  'audit rows reject update, delete, and truncate'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.audit_log'::regclass
      and attname = 'previous_hash'
      and not attisdropped
  ),
  'audit entries retain the previous chain hash'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.audit_log'::regclass
      and attname = 'entry_hash'
      and attnotnull
  ),
  'audit entries require their own chain hash'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'audit_log'
      and indexname = 'audit_log_organization_entry_hash_uidx'
  ),
  'audit entry hashes are unique per organization'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'billing_attempts'
      and indexname = 'billing_attempts_stripe_event_id_uidx'
  ),
  'Stripe payment event IDs have a unique idempotency index'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'billing_attempts'
      and indexname = 'billing_attempts_shipment_payment_intent_uidx'
  ),
  'charge and retry PaymentIntent IDs are unique within each shipment'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.billing_attempts'::regclass
      and conname = 'billing_attempts_shipment_idempotency_key'
  ),
  'billing attempts require a stable shipment idempotency key'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'member_imports'
      and indexname = 'member_imports_upload_token_hash_uidx'
  ),
  'import upload token hashes are unique'
);
select ok(
  (
    select count(*) = 4
    from pg_catalog.pg_attribute
    where attrelid = 'public.member_imports'::regclass
      and attname in (
        'upload_token_hash',
        'content_sha256',
        'expires_at',
        'committed_at'
      )
      and not attisdropped
  ),
  'import batches are durable, expiring, and one-time consumable'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.record_billing_attempt(uuid,uuid,public.billing_attempt_kind,integer,text,text,uuid,jsonb)',
    'execute'
  ),
  'service role can record billing attempts'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.apply_shipment_payment_event(uuid,uuid,uuid,text,timestamptz,public.billing_attempt_status,text,text,text,text,jsonb)',
    'execute'
  ),
  'service role can apply signed payment results'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.complete_member_import(uuid,text,jsonb,uuid)',
    'execute'
  ),
  'service role can atomically consume a staged import'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.link_member_auth_user(uuid,text)',
    'execute'
  ),
  'service role can atomically link a member auth identity'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.append_audit_entry(uuid,uuid,text,text,uuid,jsonb)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.verify_audit_chain(uuid)',
    'execute'
  ),
  'service role can append and verify tamper-evident audit entries'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_release_shipments(uuid,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.record_billing_attempt(uuid,uuid,public.billing_attempt_kind,integer,text,text,uuid,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.complete_member_import(uuid,text,jsonb,uuid)',
    'execute'
  ),
  'authenticated clients cannot invoke server orchestration RPCs'
);
select ok(
  not has_table_privilege('service_role', 'public.audit_log', 'update')
  and not has_table_privilege('service_role', 'public.audit_log', 'delete')
  and not has_table_privilege('service_role', 'public.audit_log', 'truncate'),
  'service role cannot mutate or truncate the audit ledger'
);
select ok(
  has_column_privilege('authenticated', 'public.members', 'phone', 'update'),
  'members can update approved contact columns'
);
select ok(
  not has_column_privilege('authenticated', 'public.members', 'status', 'update'),
  'members cannot directly change lifecycle status'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.organizations'::regclass
      and conname = 'organizations_shipping_origin_address_valid'
      and position('company' in pg_get_constraintdef(oid)) > 0
      and position('name' in pg_get_constraintdef(oid)) > 0
      and position('phone' in pg_get_constraintdef(oid)) > 0
      and position('btrim' in pg_get_constraintdef(oid)) > 0
  ),
  'shipping origins require contact identity, phone, and address fields'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.members'::regclass
      and conname = 'members_churn_risk_range'
  ),
  'future churn scores are constrained without inventing a Phase 2 score'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.shipments'::regclass
      and attname = 'refund_amount_cents'
      and attnotnull
  ),
  'shipments track cumulative refunds for partial-refund correctness'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.claim_due_releases(date,integer)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.claim_due_releases(date,integer)',
    'execute'
  ),
  'only the service role can claim due scheduled releases'
);

select * from finish();
rollback;
