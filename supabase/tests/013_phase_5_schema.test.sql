begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(36);

select is(
  (
    select count(*)::integer
    from pg_class
    where relnamespace = 'public'::regnamespace
      and relkind = 'r'
      and relname = any(array[
        'brands',
        'organization_staff_access',
        'staff_brand_access',
        'brand_analytics_daily_metrics',
        'integration_connections',
        'integration_secrets',
        'integration_sync_jobs',
        'integration_sync_logs',
        'integration_refund_deliveries',
        'klaviyo_field_mappings',
        'klaviyo_profile_mappings',
        'klaviyo_engagement_events',
        'quickbooks_account_mappings',
        'quickbooks_transaction_mappings',
        'quickbooks_reconciliations',
        'avalara_exemptions',
        'avalara_tax_calculations',
        'member_integration_consents',
        'meta_conversion_events',
        'brand_custom_domains',
        'brand_sender_identities',
        'mobile_devices',
        'mobile_device_secrets',
        'mobile_push_outbox',
        'mobile_offline_snapshots',
        'mobile_offline_mutations',
        'mobile_deep_link_routes',
        'mobile_auth_exchange_tokens',
        'mobile_refresh_sessions'
      ])
  ),
  29,
  'Phase 5 creates the complete multi-brand, integration, white-label, and mobile table surface'
);

select is(
  (
    select count(*)::integer
    from pg_class
    where relnamespace = 'public'::regnamespace
      and relkind = 'r'
      and relname = any(array[
        'brands',
        'organization_staff_access',
        'staff_brand_access',
        'brand_analytics_daily_metrics',
        'integration_connections',
        'integration_secrets',
        'integration_sync_jobs',
        'integration_sync_logs',
        'integration_refund_deliveries',
        'klaviyo_field_mappings',
        'klaviyo_profile_mappings',
        'klaviyo_engagement_events',
        'quickbooks_account_mappings',
        'quickbooks_transaction_mappings',
        'quickbooks_reconciliations',
        'avalara_exemptions',
        'avalara_tax_calculations',
        'member_integration_consents',
        'meta_conversion_events',
        'brand_custom_domains',
        'brand_sender_identities',
        'mobile_devices',
        'mobile_device_secrets',
        'mobile_push_outbox',
        'mobile_offline_snapshots',
        'mobile_offline_mutations',
        'mobile_deep_link_routes',
        'mobile_auth_exchange_tokens',
        'mobile_refresh_sessions'
      ])
      and relrowsecurity
      and relforcerowsecurity
  ),
  29,
  'every Phase 5 table forces row-level security'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = any(array[
        'members',
        'club_tiers',
        'releases',
        'shipments',
        'email_templates',
        'cancel_flow_attempts',
        'dashboard_layout_preferences',
        'ml_churn_predictions',
        'compliance_checks'
      ])
      and column_name = 'brand_id'
      and is_nullable = 'NO'
  ),
  9,
  'representative core, retention, analytics, and compliance rows require a brand'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'organizations_default_brand_same_org_fkey'
      and condeferrable
      and condeferred
  ),
  'the circular default-brand bootstrap is transaction-safe'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'shipments_member_same_brand_fkey'
  ),
  'shipments enforce member brand consistency'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'mobile_push_device_same_member_fkey'
      and pg_get_constraintdef(oid) =
        'FOREIGN KEY (organization_id, brand_id, member_id, device_id) REFERENCES mobile_devices(organization_id, brand_id, member_id, id) ON DELETE CASCADE'
  ),
  'push outbox rows enforce device ownership within the member and brand'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'mobile_refresh_device_same_brand_fkey'
  ),
  'mobile refresh sessions enforce device brand consistency'
);

select is(
  (
    select array_agg(enumlabel::text order by enumsortorder)
    from pg_enum
    where enumtypid = 'public.integration_connection_status'::regtype
  ),
  array[
    'activation_required',
    'configured',
    'active',
    'degraded',
    'disconnected'
  ]::text[],
  'integration lifecycle states match the backend health contract'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'integration_connections'
      and lower(column_name) ~ '(secret|token|password|credential|ciphertext|nonce|iv)'
  ),
  0,
  'browser-readable integration connections contain no credential material'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'integration_secrets'
      and column_name = any(array[
        'storage_mode',
        'envelope_version',
        'algorithm',
        'credential_ciphertext',
        'credential_iv',
        'key_version',
        'external_secret_ref'
      ])
  ),
  7,
  'integration secrets persist a versioned A256GCM envelope or external reference'
);

select is(
  (
    select data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'integration_secrets'
      and column_name = 'key_version'
  ),
  'text',
  'credential key versions accept backend values such as v1'
);

select ok(
  private.jsonb_has_secret_keys(
    '{"outer":{"items":[{"api_token":"unsafe"}]}}'::jsonb
  ),
  'secret key detection is recursive through objects and arrays'
);
select ok(
  private.jsonb_has_raw_pii_keys(
    '{"outer":{"items":[{"email":"unsafe@example.test"}]}}'::jsonb
  ),
  'PII key detection is recursive through objects and arrays'
);
select ok(
  private.jsonb_is_meta_hash_map(
    '{"em":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'::jsonb
  ),
  'Meta accepts normalized SHA-256 user identifiers'
);
select ok(
  not private.jsonb_is_meta_hash_map('{"em":"raw@example.test"}'::jsonb),
  'Meta rejects raw user identifiers'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'integration_sync_jobs_idempotency_uidx'
      and indexdef like '%(connection_id, idempotency_key)%'
  ),
  'integration job idempotency is scoped to one connection'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'integration_sync_jobs_claim_idx'
  ),
  'integration workers have a partial claim index'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'mobile_push_outbox_claim_idx'
  ),
  'push workers have a partial claim index'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'brand_custom_domains'
      and column_name = any(array[
        'provider_hostname_id',
        'dns_record_type',
        'dns_record_name',
        'dns_record_value',
        'hostname_status',
        'ssl_status',
        'last_checked_at'
      ])
  ),
  7,
  'custom domains persist Cloudflare hostname, DCV, and certificate state'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'brands'
      and column_name = 'portal_title'
  ),
  'brand records persist the white-label portal title'
);

select is(
  (
    select count(*)::integer
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = any(array[
        'get_integration_runtime',
        'enqueue_integration_sync_job',
        'claim_integration_sync_jobs',
        'complete_integration_sync_job',
        'get_klaviyo_member_source',
        'get_quickbooks_transaction_source',
        'get_avalara_shipment_source',
        'enqueue_meta_conversion_event',
        'consume_mobile_auth_exchange',
        'rotate_mobile_refresh_session',
        'claim_mobile_push_messages'
      ])
  ),
  11,
  'service lifecycle and provider boundary functions are installed'
);

select is(
  (
    select count(*)::integer
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = any(array[
        'append_audit_entry',
        'record_analytics_event',
        'complete_member_import'
      ])
  ),
  6,
  'legacy and explicit-brand service RPC signatures are both installed'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'analytics_events_org_idempotency_key'
      and pg_get_constraintdef(oid)
        = 'UNIQUE (organization_id, brand_id, idempotency_key)'
  ),
  'analytics idempotency is isolated per brand'
);

select is(
  (
    select count(*)::integer
    from (
      values
        ('public.get_integration_runtime(uuid,public.integration_type,uuid,boolean)'),
        ('public.append_audit_entry(uuid,uuid,uuid,text,text,uuid,jsonb)'),
        ('public.record_analytics_event(uuid,uuid,uuid,text,jsonb,text,timestamp with time zone)'),
        ('public.complete_member_import(uuid,uuid,text,jsonb,uuid)'),
        ('public.configure_integration_connection(uuid,uuid,public.integration_type,text,text,jsonb)'),
        ('public.register_mobile_auth_exchange(text,uuid,uuid,uuid,text,uuid,text,timestamp with time zone)'),
        ('public.register_mobile_refresh_session(text,uuid,uuid,uuid,uuid,uuid,timestamp with time zone,uuid)'),
        ('public.apply_brand_subscription_event(text,text,uuid,uuid,text,timestamp with time zone,jsonb,boolean,text,public.subscription_status,public.plan_tier)'),
        ('public.acknowledge_ml_high_risk_alert(uuid,uuid,uuid,uuid)'),
        ('public.list_churn_intelligence(uuid,uuid,text,text,integer,integer)'),
        ('public.get_member_churn_intelligence(uuid,uuid,uuid)'),
        ('public.get_compliance_dashboard(uuid,uuid,uuid,public.compliance_check_status,integer,integer)')
    ) as expected(signature)
    where to_regprocedure(expected.signature) is not null
  ),
  12,
  'every backend RPC payload containing p_brand_id has an exact database signature'
);

select ok(
  (
    select bool_and(
      has_function_privilege(
        'service_role',
        to_regprocedure(expected.signature),
        'EXECUTE'
      )
    )
    from (
      values
        ('public.get_integration_runtime(uuid,public.integration_type,uuid,boolean)'),
        ('public.append_audit_entry(uuid,uuid,uuid,text,text,uuid,jsonb)'),
        ('public.record_analytics_event(uuid,uuid,uuid,text,jsonb,text,timestamp with time zone)'),
        ('public.complete_member_import(uuid,uuid,text,jsonb,uuid)'),
        ('public.configure_integration_connection(uuid,uuid,public.integration_type,text,text,jsonb)'),
        ('public.register_mobile_auth_exchange(text,uuid,uuid,uuid,text,uuid,text,timestamp with time zone)'),
        ('public.register_mobile_refresh_session(text,uuid,uuid,uuid,uuid,uuid,timestamp with time zone,uuid)'),
        ('public.apply_brand_subscription_event(text,text,uuid,uuid,text,timestamp with time zone,jsonb,boolean,text,public.subscription_status,public.plan_tier)'),
        ('public.acknowledge_ml_high_risk_alert(uuid,uuid,uuid,uuid)'),
        ('public.list_churn_intelligence(uuid,uuid,text,text,integer,integer)'),
        ('public.get_member_churn_intelligence(uuid,uuid,uuid)'),
        ('public.get_compliance_dashboard(uuid,uuid,uuid,public.compliance_check_status,integer,integer)')
    ) as expected(signature)
  ),
  'service role may execute every exact brand-scoped backend RPC'
);

select is(
  (
    select count(*)::integer
    from (
      values
        ('public.claim_integration_refund_delivery(uuid,uuid,bigint,text,integer)'),
        ('public.release_integration_refund_delivery(uuid,uuid,text)'),
        ('public.complete_quickbooks_refund_delivery(uuid,uuid,text,text,bigint,bigint,text,numeric,date)'),
        ('public.complete_avalara_refund_delivery(uuid,uuid,text,text,text,bigint,bigint,jsonb,text,text)')
    ) as expected(signature)
    where to_regprocedure(expected.signature) is not null
  ),
  4,
  'all four cumulative refund-delivery RPCs have exact database signatures'
);

select ok(
  (
    select bool_and(
      has_function_privilege(
        'service_role',
        to_regprocedure(expected.signature),
        'EXECUTE'
      )
      and not has_function_privilege(
        'authenticated',
        to_regprocedure(expected.signature),
        'EXECUTE'
      )
    )
    from (
      values
        ('public.claim_integration_refund_delivery(uuid,uuid,bigint,text,integer)'),
        ('public.release_integration_refund_delivery(uuid,uuid,text)'),
        ('public.complete_quickbooks_refund_delivery(uuid,uuid,text,text,bigint,bigint,text,numeric,date)'),
        ('public.complete_avalara_refund_delivery(uuid,uuid,text,text,text,bigint,bigint,jsonb,text,text)')
    ) as expected(signature)
  ),
  'cumulative refund-delivery RPCs are executable by service_role only'
);

select lives_ok(
  $$
    insert into public.organizations (
      id, name, plan_tier
    ) values (
      'c1000000-0000-4000-8000-000000000001',
      'Phase 5 Bootstrap Winery',
      'estate'
    )
  $$,
  'a new organization bootstraps without a circular foreign-key failure'
);
select is(
  (
    select count(*)::integer
    from public.brands as b
    join public.organizations as o
      on o.id = b.organization_id
     and o.default_brand_id = b.id
    where o.id = 'c1000000-0000-4000-8000-000000000001'
      and b.is_default
  ),
  1,
  'new organizations receive exactly one linked default brand'
);

select ok(
  (
    select count(*) = 0
    from information_schema.role_column_grants
    where table_schema = 'public'
      and table_name in (
        'integration_secrets',
        'mobile_device_secrets',
        'mobile_auth_exchange_tokens',
        'mobile_refresh_sessions'
      )
      and grantee in ('anon', 'authenticated')
  ),
  'credential and mobile auth ledgers expose no client column privileges'
);

select ok(
  not has_table_privilege('authenticated', 'public.mobile_push_outbox', 'select')
  and not has_table_privilege('authenticated', 'public.mobile_push_outbox', 'insert')
  and not has_table_privilege('authenticated', 'public.mobile_push_outbox', 'update')
  and not has_table_privilege('authenticated', 'public.mobile_push_outbox', 'delete'),
  'authenticated clients cannot forge or mutate the push delivery queue'
);

select ok(
  (
    select bool_and(
      not has_function_privilege(
        'authenticated',
        to_regprocedure(expected.signature),
        'EXECUTE'
      )
    )
    from (
      values
        ('public.enqueue_email_trigger(uuid,uuid,public.email_trigger_type,text,jsonb,timestamptz)'),
        ('public.enqueue_test_email(uuid,uuid,text,text,text,text,uuid)'),
        ('public.update_cancel_flow_configuration(uuid,jsonb,uuid)'),
        ('public.start_cancel_flow(uuid,uuid,uuid)'),
        ('public.record_cancel_flow_step(uuid,uuid,uuid,public.cancel_flow_outcome,jsonb,uuid)'),
        ('public.reserve_loyalty_discount(uuid,uuid,uuid,integer,text,uuid)'),
        ('public.adjust_loyalty_points(uuid,uuid,integer,text,text,uuid)'),
        ('public.get_loyalty_balance(uuid,uuid,uuid)'),
        ('public.get_analytics_dashboard(uuid,date,date)'),
        ('public.get_analytics_series(uuid,text,date,date)'),
        ('public.get_shipment_compliance_check(uuid,uuid)')
    ) as expected(signature)
  ),
  'legacy organization-only security-definer RPCs are server-only after multi-brand activation'
);

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname in (
        'jsonb_has_secret_keys',
        'jsonb_has_raw_pii_keys',
        'jsonb_is_meta_hash_map',
        'slugify_brand_name',
        'seed_default_brand',
        'seed_staff_brand_access',
        'default_brand_for_org',
        'brand_accepts_operational_charges',
        'assign_and_validate_brand',
        'seed_phase3_organization_defaults',
        'seed_phase4_organization_defaults',
        'enforce_avalara_before_charge',
        'enqueue_active_integration_job',
        'enqueue_consented_meta_job',
        'enqueue_connection_bootstrap',
        'enqueue_member_integration_changes',
        'enqueue_meta_consent_activation',
        'enqueue_shipment_integration_changes',
        'enqueue_referral_conversion',
        'reject_append_only_mutation',
        'require_brand_context',
        'entity_brand_id'
      )
      and has_function_privilege(
        'authenticated',
        procedure.oid,
        'EXECUTE'
      )
  ),
  'authenticated clients cannot invoke Phase 5 private service helpers'
);

select ok(
  has_function_privilege(
    'authenticated',
    'private.can_access_brand(uuid,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'private.can_manage_brand(uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated RLS evaluation retains only the required brand predicates'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.claim_due_releases(date,integer)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.schedule_due_shipment_retries(timestamptz,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.claim_due_releases(date,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.schedule_due_shipment_retries(timestamptz,integer)',
    'EXECUTE'
  ),
  'release and retry scheduling remains service-role-only after Phase 5 recreation'
);

select ok(
  (
    select count(*) >= 35
    from pg_policies
    where schemaname = 'public'
      and policyname like '%brand_boundary'
      and permissive = 'RESTRICTIVE'
  ),
  'legacy organization policies are narrowed by restrictive brand boundaries'
);

select * from finish();
rollback;
