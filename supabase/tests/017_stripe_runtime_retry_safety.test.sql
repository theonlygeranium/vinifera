begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(25);

select ok(
  to_regclass('public.stripe_customer_provisioning') is not null,
  'Stripe customer provisioning lease table exists'
);

select ok(
  to_regclass('public.stripe_billing_attempts') is not null,
  'Stripe billing attempt table exists'
);

select ok(
  to_regtype('public.stripe_customer_scope') is not null
  and to_regtype('public.stripe_billing_operation') is not null
  and to_regtype('public.stripe_billing_attempt_status') is not null,
  'Stripe runtime state enums exist'
);

select is(
  (
    select count(*)::integer
    from pg_class
    where oid in (
      'public.stripe_customer_provisioning'::regclass,
      'public.stripe_billing_attempts'::regclass
    )
      and relrowsecurity
      and relforcerowsecurity
  ),
  2,
  'Stripe runtime tables force row-level security'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'stripe_billing_attempts_one_open_checkout_idx'
      and indexdef like '%organization_id, billing_subject_id%'
      and indexdef like '%awaiting_webhook%'
  ),
  'only one nonterminal checkout can exist for the actual billing subject'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stripe_billing_attempts'
      and column_name = 'billing_subject_id'
      and is_nullable = 'NO'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stripe_billing_attempts'
      and column_name = 'stripe_subscription_id'
  ),
  'billing attempts durably bind the billing subject and reconciled subscription'
);

select ok(
  exists (
    select 1
    from pg_enum
    where enumtypid = 'public.stripe_billing_attempt_status'::regtype
      and enumlabel = 'awaiting_webhook'
  ),
  'completed Checkout Sessions have a nonterminal webhook reconciliation state'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.stripe_customer_provisioning'::regclass
      and conname = 'stripe_customer_provisioning_scope_target'
  ),
  'customer provisioning scope is bound to one database target'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.stripe_billing_attempts'::regclass
      and conname = 'stripe_billing_attempts_fingerprint_format'
  ),
  'billing attempts require a PII-free fixed-length request fingerprint'
);

select ok(
  to_regprocedure(
    'public.claim_stripe_customer_provisioning(uuid,public.stripe_customer_scope,uuid,uuid,uuid,uuid)'
  ) is not null,
  'atomic customer provisioning claim exists'
);

select ok(
  to_regprocedure(
    'public.finalize_stripe_customer_provisioning(uuid,public.stripe_customer_scope,uuid,uuid,text)'
  ) is not null,
  'idempotent customer provisioning finalize exists'
);

select ok(
  to_regprocedure(
    'public.claim_stripe_billing_attempt(uuid,uuid,uuid,uuid,uuid,public.stripe_billing_operation,public.plan_tier,text,text,text,uuid)'
  ) is not null,
  'atomic billing attempt claim exists'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.claim_stripe_billing_attempt(uuid,uuid,uuid,uuid,uuid,public.stripe_billing_operation,public.plan_tier,text,text,text,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.claim_stripe_billing_attempt(uuid,uuid,uuid,uuid,uuid,public.stripe_billing_operation,public.plan_tier,text,text,text,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.claim_stripe_billing_attempt(uuid,uuid,uuid,uuid,uuid,public.stripe_billing_operation,public.plan_tier,text,text,text,uuid)',
    'EXECUTE'
  ),
  'billing claims are service-role-only'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.reconcile_stripe_subscription_target(uuid,uuid,text,public.subscription_status)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.reconcile_stripe_subscription_target(uuid,uuid,text,public.subscription_status)',
    'EXECUTE'
  ),
  'subscription reconciliation is service-role-only'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.reconcile_stripe_billing_attempt(uuid,uuid,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.reconcile_stripe_billing_attempt(uuid,uuid,text)',
    'EXECUTE'
  ),
  'only the service role can complete checkout reconciliation from a durable webhook'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

insert into public.organizations (id, name, plan_tier)
values (
  'd1000000-0000-4000-8000-000000000001',
  'Stripe Runtime Winery',
  'reserve'
);

insert into public.brands (
  id, organization_id, name, slug, billing_mode
)
values (
  'd2000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000001',
  'Shared Secondary Brand',
  'shared-secondary-brand',
  'shared'
);

select throws_ok(
  $$
    select *
    from public.claim_stripe_billing_attempt(
      'd3000000-0000-4000-8000-000000000003',
      'd1000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'd1000000-0000-4000-8000-000000000001'),
      null,
      (select default_brand_id from public.organizations where id = 'd1000000-0000-4000-8000-000000000001'),
      'checkout',
      'vine',
      'price_runtime_wrong_subject',
      repeat('a', 64),
      'cus_runtime1',
      'd4000000-0000-4000-8000-000000000004'
    )
  $$,
  '23514',
  'The billing subject does not match the configured billing mode.',
  'a shared brand cannot claim checkout ownership as an independent brand'
);

select is(
  (
    select state
    from public.claim_stripe_billing_attempt(
      'd3000000-0000-4000-8000-000000000005',
      'd1000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'd1000000-0000-4000-8000-000000000001'),
      null,
      'd1000000-0000-4000-8000-000000000001',
      'checkout',
      'vine',
      'price_runtime_shared',
      repeat('b', 64),
      'cus_runtime1',
      'd4000000-0000-4000-8000-000000000006'
    )
  ),
  'claimed',
  'the organization billing subject atomically claims a shared checkout'
);

select is(
  (
    select state
    from public.claim_stripe_billing_attempt(
      'd3000000-0000-4000-8000-000000000007',
      'd1000000-0000-4000-8000-000000000001',
      'd2000000-0000-4000-8000-000000000002',
      null,
      'd1000000-0000-4000-8000-000000000001',
      'checkout',
      'cellar',
      'price_runtime_shared_secondary',
      repeat('c', 64),
      'cus_runtime1',
      'd4000000-0000-4000-8000-000000000008'
    )
  ),
  'busy',
  'another shared brand cannot create a parallel checkout for the organization'
);

select lives_ok(
  $$
    select public.finalize_stripe_billing_attempt(
      'd3000000-0000-4000-8000-000000000005',
      'd4000000-0000-4000-8000-000000000006',
      'cus_runtime1',
      'cs_runtime_shared1',
      'open'
    )
  $$,
  'the claimed checkout can be durably finalized as open'
);

select is(
  (
    select state
    from public.claim_stripe_billing_attempt(
      'd3000000-0000-4000-8000-000000000007',
      'd1000000-0000-4000-8000-000000000001',
      'd2000000-0000-4000-8000-000000000002',
      null,
      'd1000000-0000-4000-8000-000000000001',
      'checkout',
      'cellar',
      'price_runtime_shared_secondary',
      repeat('c', 64),
      'cus_runtime1',
      'd4000000-0000-4000-8000-000000000008'
    )
  ),
  'open_attempt',
  'the organization checkout remains shared across brand routes'
);

select lives_ok(
  $$
    select public.close_stripe_billing_attempt(
      'd3000000-0000-4000-8000-000000000005',
      'awaiting_webhook'
    )
  $$,
  'a remotely completed Checkout Session enters webhook reconciliation'
);

select is(
  (
    select state
    from public.claim_stripe_billing_attempt(
      'd3000000-0000-4000-8000-000000000009',
      'd1000000-0000-4000-8000-000000000001',
      'd2000000-0000-4000-8000-000000000002',
      null,
      'd1000000-0000-4000-8000-000000000001',
      'checkout',
      'estate',
      'price_runtime_awaiting',
      repeat('d', 64),
      'cus_runtime1',
      'd4000000-0000-4000-8000-000000000010'
    )
  ),
  'awaiting_reconciliation',
  'new checkouts stay blocked until durable subscription webhook reconciliation'
);

select lives_ok(
  $$
    select public.reconcile_stripe_subscription_target(
      'd1000000-0000-4000-8000-000000000001',
      (select default_brand_id from public.organizations where id = 'd1000000-0000-4000-8000-000000000001'),
      'sub_runtime1',
      'active'
    )
  $$,
  'the subscription webhook reconciles the shared billing target'
);

select lives_ok(
  $$
    select public.reconcile_stripe_billing_attempt(
      'd3000000-0000-4000-8000-000000000005',
      'd1000000-0000-4000-8000-000000000001',
      'sub_runtime1'
    )
  $$,
  'the subscription webhook completes the matching checkout attempt'
);

select is(
  (
    select state
    from public.claim_stripe_billing_attempt(
      'd3000000-0000-4000-8000-000000000011',
      'd1000000-0000-4000-8000-000000000001',
      'd2000000-0000-4000-8000-000000000002',
      null,
      'd1000000-0000-4000-8000-000000000001',
      'checkout',
      'reserve',
      'price_runtime_after_reconcile',
      repeat('e', 64),
      'cus_runtime1',
      'd4000000-0000-4000-8000-000000000012'
    )
  ),
  'subscription_exists',
  'reconciled billing targets must use the portal instead of a new checkout'
);

select * from finish();
rollback;
