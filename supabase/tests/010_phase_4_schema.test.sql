begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(46);

select is(
  (
    select count(*)::integer
    from pg_class
    where relnamespace = 'public'::regnamespace
      and relname = any(array[
        'analytics_events',
        'analytics_daily_metrics',
        'analytics_cohort_retention',
        'dashboard_layout_preferences',
        'analytics_report_schedules',
        'ml_feature_snapshots',
        'ml_training_runs',
        'ml_training_rows',
        'ml_model_versions',
        'ml_experiments',
        'ml_churn_predictions',
        'ml_drift_reports',
        'ml_retraining_signals',
        'ml_high_risk_alerts',
        'benchmark_preferences',
        'benchmark_contributions',
        'benchmark_aggregates',
        'compliance_checks',
        'shipping_label_attempts'
      ])
      and relkind = 'r'
  ),
  19,
  'Phase 4 creates the complete analytics, ML, benchmark, and compliance table surface'
);

select is(
  (
    select count(*)::integer
    from pg_class
    where relnamespace = 'public'::regnamespace
      and relname = any(array[
        'analytics_events',
        'analytics_daily_metrics',
        'analytics_cohort_retention',
        'dashboard_layout_preferences',
        'analytics_report_schedules',
        'ml_feature_snapshots',
        'ml_training_runs',
        'ml_training_rows',
        'ml_model_versions',
        'ml_experiments',
        'ml_churn_predictions',
        'ml_drift_reports',
        'ml_retraining_signals',
        'ml_high_risk_alerts',
        'benchmark_preferences',
        'benchmark_contributions',
        'benchmark_aggregates',
        'compliance_checks',
        'shipping_label_attempts'
      ])
      and relrowsecurity
      and relforcerowsecurity
  ),
  19,
  'every Phase 4 table forces row-level security'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'analytics_events_member_same_organization_fkey'
      and contype = 'f'
  ),
  'analytics events use a tenant-scoped member foreign key'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'dashboard_layout_preferences_staff_same_organization_fkey'
      and contype = 'f'
  ),
  'dashboard layouts use a tenant-scoped staff foreign key'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'analytics_report_schedules_staff_same_organization_fkey'
      and contype = 'f'
  ),
  'report schedules use a tenant-scoped staff foreign key'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'ml_feature_snapshots_member_same_organization_fkey'
      and contype = 'f'
  ),
  'feature snapshots use a tenant-scoped member foreign key'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'ml_churn_predictions_feature_same_organization_fkey'
      and contype = 'f'
  ),
  'predictions cannot reference another tenant feature snapshot'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'compliance_checks_shipment_same_organization_fkey'
      and contype = 'f'
  ),
  'compliance checks cannot reference another tenant shipment'
);

select ok(
  private.analytics_payload_is_minimized(
    '{"page":"dashboard","email_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'::jsonb
  ),
  'minimized analytics payloads allow non-identifying attributes and irreversible email hashes'
);
select ok(
  not private.analytics_payload_is_minimized(
    '{"email":"member@example.test"}'::jsonb
  ),
  'minimized analytics payloads reject direct identifiers'
);
select ok(
  private.dashboard_layout_is_valid(
    '[{"widget_id":"revenue-by-tier","order":0,"size":"half","enabled":true}]'::jsonb
  ),
  'dashboard layout validation accepts the canonical widget schema'
);
select ok(
  not private.dashboard_layout_is_valid(
    '[{"widget_id":"unknown","order":0,"size":"half","enabled":true}]'::jsonb
  ),
  'dashboard layout validation rejects unrecognized widgets'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'analytics_report_schedules_widgets_valid'
  ),
  'report schedules constrain selected widgets'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'analytics_report_schedules_type_frequency_valid'
  ),
  'benchmark reports can only be scheduled quarterly'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ml_feature_snapshots'
      and column_name = any(array[
        'days_since_last_shipment',
        'days_since_last_portal_login',
        'days_since_last_email_open',
        'shipments_per_year',
        'portal_logins_per_month',
        'email_opens_per_month',
        'total_lifetime_spend_cents',
        'average_shipment_value_cents',
        'email_open_rate',
        'email_click_rate',
        'loyalty_point_balance',
        'tenure_months',
        'tier_change_count',
        'decline_count',
        'decline_recovery_rate',
        'observed_expected_shipment_ratio'
      ])
  ),
  16,
  'the explicit churn feature store contains all sixteen versioned features'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'ml_training_runs_method_fixed'
  ),
  'training provenance fixes temporal splitting and five folds'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'ml_training_rows_run_member_split_key'
  ),
  'training rows prevent member leakage within a split'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'ml_model_versions_algorithm_regularized'
  ),
  'the model registry only accepts regularized logistic regression'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'ml_model_versions_metrics_complete'
  ),
  'the model registry requires full validation and calibration metrics'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'ml_model_versions_one_production_uidx'
  ),
  'only one production model can exist'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'ml_model_versions_one_ab_test_uidx'
  ),
  'only one A/B model can exist'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'ml_churn_predictions_top_features_valid'
  ),
  'each ML prediction stores exactly five explanations'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'ml_drift_reports_values_valid'
  ),
  'drift reports fail closed at the declared PSI threshold'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'ml_model_versions_protect_artifact'
      and not tgisinternal
  ),
  'registered model artifacts and validation metrics are immutable'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'benchmark_aggregates_privacy_threshold'
  ),
  'benchmark aggregates enforce k at least ten and expose only count bands'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'benchmark_preferences_consent_consistent'
  ),
  'benchmark participation and reports require explicit consent'
);
select ok(
  has_table_privilege('authenticated', 'public.benchmark_aggregates', 'select') = false,
  'authenticated clients cannot read exact benchmark aggregate counts'
);
select ok(
  has_table_privilege('service_role', 'public.benchmark_contributions', 'select'),
  'authenticated clients can read only their own contribution through forced RLS'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'shipments'
      and column_name = any(array[
        'latest_compliance_check_id',
        'compliance_status',
        'compliance_reason',
        'compliance_tax_estimate_cents',
        'compliance_checked_at'
      ])
  ),
  5,
  'shipments retain the latest durable compliance result'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'compliance_checks_provider_response_key'
  ),
  'provider compliance responses are idempotent'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'compliance_checks_compliant_evidence'
  ),
  'compliant results require tax and auditable rule evidence'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'compliance_checks_reject_update_delete'
      and not tgisinternal
  ),
  'compliance history is append-only'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'shipments_enforce_compliance_before_label'
      and not tgisinternal
  ),
  'label creation is fail-closed behind a current compliant result'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.get_analytics_dashboard(uuid,date,date)',
    'execute'
  ),
  'authenticated staff can use the tenant-safe analytics dashboard RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.list_churn_intelligence(uuid,text,text,integer,integer)',
    'execute'
  ),
  'authenticated staff can use the tenant-safe churn intelligence RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.get_benchmark_comparison(uuid,date)',
    'execute'
  ),
  'authenticated staff can use the k-anonymous benchmark RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.get_compliance_dashboard(uuid,uuid,public.compliance_check_status,integer,integer)',
    'execute'
  ),
  'authenticated staff can use the tenant-safe compliance dashboard RPC'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.refresh_analytics_snapshots(date,uuid)',
    'execute'
  ),
  'analytics aggregation is service-only'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.create_ml_training_run(date,date,date,public.ml_training_source,uuid)',
    'execute'
  ),
  'authenticated super admins can reach the internally guarded training RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.promote_ml_model_version(uuid,uuid)',
    'execute'
  ),
  'authenticated super admins can reach the internally guarded promotion RPC'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.refresh_benchmark_aggregates(date)',
    'execute'
  ),
  'peer aggregation is service-only'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.record_shipment_compliance_check(uuid,uuid,public.compliance_check_status,text,integer,text,text,timestamptz,uuid,jsonb)',
    'execute'
  ),
  'provider compliance recording is service-only'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.confirm_shipment_item_pack(uuid,uuid,text,uuid)',
    'execute'
  ),
  'atomic barcode packing is available only through the trusted application service'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ml_training_rows'
      and policyname = 'ml_training_rows_super_admin_all'
  ),
  'only privileged operators receive an ML training-row read policy'
);
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'analytics_events'
      and policyname = 'analytics_events_super_admin_all'
  ),
  'raw analytics events are restricted to privileged operators'
);
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'compliance_checks'
      and policyname = 'compliance_checks_member_select'
  ),
  'members can read only their own shipment compliance history'
);

select * from finish();
rollback;
