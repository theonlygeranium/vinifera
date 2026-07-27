begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(37);

insert into auth.users (id, email)
values
  ('e1000000-0000-4000-8000-000000000001', 'analytics-owner@example.test'),
  ('e1000000-0000-4000-8000-000000000002', 'analytics-restricted@example.test'),
  ('e1000000-0000-4000-8000-000000000003', 'analytics-disabled@example.test'),
  ('e1000000-0000-4000-8000-000000000004', 'analytics-platform@example.test'),
  ('e1000000-0000-4000-8000-000000000005', 'analytics-platform-disabled@example.test'),
  ('e1000000-0000-4000-8000-000000000006', 'analytics-platform-second@example.test');

insert into public.organizations (
  id,
  name,
  plan_tier,
  subscription_status,
  shipping_origin_address
)
values (
  'e2000000-0000-4000-8000-000000000001',
  'Current Stack Analytics Winery',
  'reserve',
  'active',
  '{"name":"Current Stack Analytics Winery","phone":"+17075550100","line1":"1 Winery Lane","city":"Napa","state":"CA","postal_code":"94558","country":"US"}'
);

insert into public.staff_users (id, organization_id, email, role, status)
values
  (
    'e1000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    'analytics-owner@example.test',
    'owner',
    'active'
  ),
  (
    'e1000000-0000-4000-8000-000000000002',
    'e2000000-0000-4000-8000-000000000001',
    'analytics-restricted@example.test',
    'admin',
    'active'
  ),
  (
    'e1000000-0000-4000-8000-000000000003',
    'e2000000-0000-4000-8000-000000000001',
    'analytics-disabled@example.test',
    'staff',
    'suspended'
  );

insert into public.platform_users (id, email, role, active)
values
  (
    'e1000000-0000-4000-8000-000000000004',
    'analytics-platform@example.test',
    'super_admin',
    true
  ),
  (
    'e1000000-0000-4000-8000-000000000005',
    'analytics-platform-disabled@example.test',
    'super_admin',
    false
  ),
  (
    'e1000000-0000-4000-8000-000000000006',
    'analytics-platform-second@example.test',
    'super_admin',
    true
  );

update public.organization_staff_access
set scope = 'brand_restricted'
where organization_id = 'e2000000-0000-4000-8000-000000000001'
  and staff_user_id = 'e1000000-0000-4000-8000-000000000002';

update public.brands
set time_zone = 'America/Los_Angeles'
where organization_id = 'e2000000-0000-4000-8000-000000000001'
  and id = (
    select default_brand_id
    from public.organizations
    where id = 'e2000000-0000-4000-8000-000000000001'
  );

insert into public.members (
  id,
  organization_id,
  brand_id,
  email,
  first_name,
  last_name,
  joined_on
)
select
  'e3000000-0000-4000-8000-000000000001',
  organization.id,
  organization.default_brand_id,
  'analytics-member@example.test',
  'Analytics',
  'Member',
  date '2010-01-15'
from public.organizations as organization
where organization.id = 'e2000000-0000-4000-8000-000000000001';

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

insert into public.email_log (
  id,
  organization_id,
  brand_id,
  member_id,
  trigger_type,
  idempotency_key,
  to_email,
  subject,
  body,
  status,
  scheduled_for,
  sent_at
)
select
  fixture.id,
  organization.id,
  organization.default_brand_id,
  'e3000000-0000-4000-8000-000000000001',
  're_engagement',
  fixture.idempotency_key,
  'analytics-member@example.test',
  'Analytics fixture',
  'Analytics fixture body',
  'sent',
  fixture.sent_at,
  fixture.sent_at
from public.organizations as organization
cross join (
  values
    (
      'e4000000-0000-4000-8000-000000000001'::uuid,
      'phase4:local-day:one',
      timestamptz '2026-07-26 07:30:00+00'
    ),
    (
      'e4000000-0000-4000-8000-000000000002'::uuid,
      'phase4:prior-local-day',
      timestamptz '2026-07-26 06:30:00+00'
    )
) as fixture(id, idempotency_key, sent_at)
where organization.id = 'e2000000-0000-4000-8000-000000000001';

insert into public.email_delivery_events (
  organization_id,
  brand_id,
  email_log_id,
  provider_event_id,
  event_type,
  occurred_at
)
select
  organization.id,
  organization.default_brand_id,
  'e4000000-0000-4000-8000-000000000001',
  fixture.provider_event_id,
  'opened',
  fixture.occurred_at
from public.organizations as organization
cross join (
  values
    ('phase4-open-1', timestamptz '2026-07-26 08:00:00+00'),
    ('phase4-open-2', timestamptz '2026-07-26 09:00:00+00')
) as fixture(provider_event_id, occurred_at)
where organization.id = 'e2000000-0000-4000-8000-000000000001';

select is(
  public.refresh_brand_analytics_snapshots(
    date '2026-07-26',
    'e2000000-0000-4000-8000-000000000001',
    (
      select default_brand_id
      from public.organizations
      where id = 'e2000000-0000-4000-8000-000000000001'
    )
  ),
  1,
  'brand analytics refreshes one explicitly targeted brand'
);

select is(
  (
    select emails_sent
    from public.brand_analytics_daily_metrics
    where organization_id = 'e2000000-0000-4000-8000-000000000001'
      and metric_date = date '2026-07-26'
  ),
  1,
  'brand-local midnight excludes a prior Los Angeles calendar-day email'
);

select is(
  (
    select email_opens
    from public.brand_analytics_daily_metrics
    where organization_id = 'e2000000-0000-4000-8000-000000000001'
      and metric_date = date '2026-07-26'
  ),
  1,
  'repeated opens count the delivered message once'
);

select is(
  (
    public.get_brand_analytics_dashboard(
      'e2000000-0000-4000-8000-000000000001',
      (
        select default_brand_id
        from public.organizations
        where id = 'e2000000-0000-4000-8000-000000000001'
      ),
      null,
      date '2026-07-26'
    ) #>> '{summary,from}'
  ),
  '2010-01-15',
  'all-time dashboard resolves beyond the former ten-year cap'
);

select is(
  (
    public.get_brand_analytics_dashboard(
      'e2000000-0000-4000-8000-000000000001',
      (
        select default_brand_id
        from public.organizations
        where id = 'e2000000-0000-4000-8000-000000000001'
      ),
      null,
      date '2026-07-26'
    ) #>> '{summary,emailOpenRate}'
  )::numeric,
  1::numeric,
  'dashboard email-open rate remains bounded at one'
);

select lives_ok(
  $statement$
    select public.get_benchmark_comparison(
      'e2000000-0000-4000-8000-000000000001',
      date '2026-07-01',
      'e1000000-0000-4000-8000-000000000001'
    )
  $statement$,
  'active all-brand owner can load organization-wide benchmarks through the BFF RPC'
);

select throws_ok(
  $statement$
    select public.get_benchmark_comparison(
      'e2000000-0000-4000-8000-000000000001',
      date '2026-07-01',
      'e1000000-0000-4000-8000-000000000002'
    )
  $statement$,
  '42501',
  'Active all-brand staff authorization is required.',
  'brand-restricted admin cannot read organization-wide benchmarks through service role'
);

select throws_ok(
  $statement$
    select public.set_orgwide_benchmark_preferences(
      'e2000000-0000-4000-8000-000000000001',
      true,
      false,
      'e1000000-0000-4000-8000-000000000002'
    )
  $statement$,
  '42501',
  'Active all-brand staff authorization is required.',
  'brand-restricted admin cannot mutate organization-wide benchmark consent'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.get_brand_analytics_dashboard(uuid,uuid,date,date)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.get_brand_analytics_dashboard(uuid,uuid,date,date)',
    'EXECUTE'
  ),
  'brand dashboard RPC is BFF-only'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.refresh_brand_analytics_snapshots(date,uuid,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.refresh_brand_analytics_snapshots(date,uuid,uuid)',
    'EXECUTE'
  ),
  'brand refresh RPC is service-only'
);

select ok(
  not has_function_privilege(
    'public',
    'public.get_benchmark_comparison(uuid,date,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.get_benchmark_comparison(uuid,date,uuid)',
    'EXECUTE'
  ),
  'actor-aware benchmark RPC has explicit service-only execute privilege'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.enforce_compliance_before_label()',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'private.enforce_label_provider_compliance()',
    'EXECUTE'
  ),
  'compliance trigger helpers are not caller-executable'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.analytics_daily_metrics',
    'SELECT'
  )
  and not has_table_privilege(
    'authenticated',
    'public.benchmark_contributions',
    'SELECT'
  ),
  'organization-wide analytics facts are not directly readable by staff clients'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'compliance_checks_live_decision_evidence'
      and not convalidated
  ),
  'new live compliance evidence is enforced without rewriting historical audit rows'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.shipping_label_attempts'::regclass
      and tgname = 'shipping_label_attempts_enforce_provider_compliance'
      and not tgisinternal
  ),
  'shipping label attempts bind label provider to compliance provider evidence'
);

select ok(
  pg_get_functiondef(
    'public.get_brand_analytics_dashboard(uuid,uuid,date,date)'::regprocedure
  ) like '%refund_amount_cents%'
  and pg_get_functiondef(
    'public.get_brand_analytics_dashboard(uuid,uuid,date,date)'::regprocedure
  ) like '%at time zone v_time_zone%',
  'brand dashboard LTV is refund-net and direct facts use brand-local boundaries'
);

select ok(
  pg_get_functiondef(
    'public.refresh_brand_analytics_snapshots(date,uuid,uuid)'::regprocedure
  ) like '%count(distinct event.email_log_id)%',
  'engagement aggregation de-duplicates delivery events by message'
);

select ok(
  pg_get_functiondef(
    'public.run_ml_lifecycle(timestamp with time zone)'::regprocedure
  ) like '%v_pending_promotion%'
  and pg_get_functiondef(
    'public.run_ml_lifecycle(timestamp with time zone)'::regprocedure
  ) like '%measured_inferior%',
  'ML lifecycle keeps evidence-pending superior candidates out of rejection'
);

select ok(
  pg_get_functiondef(
    'private.ml_model_is_authoritative(uuid,date)'::regprocedure
  ) like '%ml_training_run_is_qualified%'
  and pg_get_functiondef(
    'private.ml_model_is_authoritative(uuid,date)'::regprocedure
  ) like '%not drift.retraining_required%'
  and pg_get_functiondef(
    'private.ml_model_is_authoritative(uuid,date)'::regprocedure
  ) like '%drift.snapshot_date >= p_as_of - 7%',
  'only source-qualified, drift-stable production models are authoritative'
);

select ok(
  pg_get_functiondef(
    'public.score_ml_churn_batch(date,uuid)'::regprocedure
  ) like '%for v_model in%'
  and pg_get_functiondef(
    'public.score_ml_churn_batch(date,uuid)'::regprocedure
  ) like '%v_model.deployment_status = ''production''%',
  'scoring persists production and running candidate predictions while production alone mutates risk'
);

select ok(
  col_description(
    'public.ml_churn_predictions'::regclass,
    (
      select attnum
      from pg_attribute
      where attrelid = 'public.ml_churn_predictions'::regclass
        and attname = 'confidence_interval_low'
    )
  ) like '%not a statistical confidence interval%',
  'prediction uncertainty bounds are not represented as statistical confidence intervals'
);

select throws_ok(
  $statement$
    insert into public.ml_training_runs (
      id,
      source,
      training_cutoff,
      holdout_start,
      holdout_end,
      created_by
    )
    values (
      'e5000000-0000-4000-8000-000000000001',
      'production_history',
      current_date - 300,
      current_date - 299,
      current_date - 200,
      'e1000000-0000-4000-8000-000000000002'
    )
  $statement$,
  '42501',
  'An active platform super-admin actor is required.',
  'service role cannot attribute ML training to organization staff'
);

select throws_ok(
  $statement$
    insert into public.ml_training_runs (
      source,
      training_cutoff,
      holdout_start,
      holdout_end,
      created_by
    )
    values (
      'production_history',
      current_date - 310,
      current_date - 309,
      current_date - 210,
      'e1000000-0000-4000-8000-000000000005'
    )
  $statement$,
  '42501',
  'An active platform super-admin actor is required.',
  'inactive platform administrator cannot be used for ML attribution'
);

select lives_ok(
  $statement$
    insert into public.ml_training_runs (
      id,
      source,
      training_cutoff,
      holdout_start,
      holdout_end,
      created_by
    )
    values (
      'e5000000-0000-4000-8000-000000000001',
      'production_history',
      current_date - 320,
      current_date - 319,
      current_date - 220,
      'e1000000-0000-4000-8000-000000000004'
    )
  $statement$,
  'active platform super-admin can own an immutable ML training run'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.ml_model_versions'::regclass
      and tgname = 'ml_model_versions_require_active_actor'
      and not tgisinternal
  )
  and exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.ml_experiments'::regclass
      and tgname = 'ml_experiments_require_active_actor'
      and not tgisinternal
  ),
  'model registration and experiment start retain active platform actor integrity'
);

update public.ml_training_runs
set
  status = 'ready',
  completed_at = now(),
  dataset_hash = repeat('a', 64)
where id = 'e5000000-0000-4000-8000-000000000001';

select lives_ok(
  $statement$
    select public.record_ml_training_source_qualification(
      'e5000000-0000-4000-8000-000000000001',
      (
        select dataset_hash
        from public.ml_training_runs
        where id = 'e5000000-0000-4000-8000-000000000001'
      ),
      'qualified',
      jsonb_build_object(
        'eligible_member_count', 0,
        'reconciled_through', (current_date - 130)::text,
        'sources', jsonb_build_object(
          'shipments', jsonb_build_object('eligible_member_count', 0, 'reconciled_member_count', 0),
          'billing', jsonb_build_object('eligible_member_count', 0, 'reconciled_member_count', 0),
          'email_delivery', jsonb_build_object('eligible_member_count', 0, 'reconciled_member_count', 0),
          'portal_activity', jsonb_build_object('eligible_member_count', 0, 'reconciled_member_count', 0),
          'loyalty', jsonb_build_object('eligible_member_count', 0, 'reconciled_member_count', 0),
          'declines', jsonb_build_object('eligible_member_count', 0, 'reconciled_member_count', 0)
        )
      ),
      'e1000000-0000-4000-8000-000000000004'
    )
  $statement$,
  'service records canonical source-reconciliation evidence without a caller-supplied evidence hash'
);

select public.record_ml_training_source_qualification(
  'e5000000-0000-4000-8000-000000000001',
  (
    select dataset_hash
    from public.ml_training_runs
    where id = 'e5000000-0000-4000-8000-000000000001'
  ),
  'qualified',
  jsonb_build_object(
    'eligible_member_count', 0,
    'reconciled_through', (current_date - 130)::text,
    'sources', jsonb_build_object(
      'shipments', jsonb_build_object('eligible_member_count', 0, 'reconciled_member_count', 0),
      'billing', jsonb_build_object('eligible_member_count', 0, 'reconciled_member_count', 0),
      'email_delivery', jsonb_build_object('eligible_member_count', 0, 'reconciled_member_count', 0),
      'portal_activity', jsonb_build_object('eligible_member_count', 0, 'reconciled_member_count', 0),
      'loyalty', jsonb_build_object('eligible_member_count', 0, 'reconciled_member_count', 0),
      'declines', jsonb_build_object('eligible_member_count', 0, 'reconciled_member_count', 0)
    )
  ),
  'e1000000-0000-4000-8000-000000000004'
);

select is(
  (
    select count(*)
    from public.ml_training_source_qualifications
    where training_run_id = 'e5000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'identical canonical reconciliation evidence is idempotent'
);

select public.record_ml_training_source_qualification(
  'e5000000-0000-4000-8000-000000000001',
  (
    select dataset_hash
    from public.ml_training_runs
    where id = 'e5000000-0000-4000-8000-000000000001'
  ),
  'qualified',
  jsonb_build_object(
    'eligible_member_count', 0,
    'reconciled_through', (current_date - 129)::text,
    'sources', jsonb_build_object(
      'shipments', jsonb_build_object('eligible_member_count', 0, 'reconciled_member_count', 0),
      'billing', jsonb_build_object('eligible_member_count', 0, 'reconciled_member_count', 0),
      'email_delivery', jsonb_build_object('eligible_member_count', 0, 'reconciled_member_count', 0),
      'portal_activity', jsonb_build_object('eligible_member_count', 0, 'reconciled_member_count', 0),
      'loyalty', jsonb_build_object('eligible_member_count', 0, 'reconciled_member_count', 0),
      'declines', jsonb_build_object('eligible_member_count', 0, 'reconciled_member_count', 0)
    )
  ),
  'e1000000-0000-4000-8000-000000000004'
);

select ok(
  (
    select count(*)
    from public.ml_training_source_qualifications
    where training_run_id = 'e5000000-0000-4000-8000-000000000001'
  ) = 2
  and (
    select count(distinct evidence_hash)
    from public.ml_training_source_qualifications
    where training_run_id = 'e5000000-0000-4000-8000-000000000001'
  ) = 2,
  'changed source coverage produces a distinct server-computed evidence hash'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ml_model_versions'
      and column_name = 'promoted_by'
  )
  and pg_get_functiondef(
    'public.promote_ml_model_version(uuid,uuid)'::regprocedure
  ) like '%promoted_by = p_actor_user_id%'
  and pg_get_functiondef(
    'public.promote_ml_model_version(uuid,uuid)'::regprocedure
  ) like '%v_experiment.id is null%'
  and pg_get_functiondef(
    'public.promote_ml_model_version(uuid,uuid)'::regprocedure
  ) like '%v_experiment.ml_auc is null%'
  and pg_get_functiondef(
    'public.promote_ml_model_version(uuid,uuid)'::regprocedure
  ) like '%v_drift.retraining_required is distinct from false%',
  'production promotion persists its active platform actor'
);

reset role;
set local session_replication_role = replica;

with feature(name) as (
  select unnest(array[
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
  ]::text[])
)
insert into public.ml_model_versions (
  id,
  training_run_id,
  version,
  algorithm,
  hyperparameters,
  coefficients,
  intercept,
  training_data_size,
  cancellation_count,
  metrics,
  feature_importance,
  artifact_hash,
  deployment_status,
  trained_at,
  registered_by
)
select
  'e6000000-0000-4000-8000-000000000001',
  'e5000000-0000-4000-8000-000000000001',
  'phase4-null-metrics',
  'logistic_regression_l2',
  jsonb_build_object(
    'regularization', 1,
    'cross_validation_folds', 5,
    'split_strategy', 'temporal_80_20_member_disjoint',
    'feature_medians', jsonb_object_agg(feature.name, 0),
    'feature_baseline_bins',
      jsonb_object_agg(feature.name, jsonb_build_array(.25, .25, .25, .25))
  ),
  jsonb_object_agg(feature.name, 0),
  0,
  1,
  0,
  jsonb_build_object(
    'auc_roc', .90,
    'accuracy', .80,
    'precision', .80,
    'recall', .80,
    'f1', .80,
    'true_positive', 1,
    'false_positive', 0,
    'true_negative', 1,
    'false_negative', 0,
    'brier_score', .10,
    'calibration_slope', 1,
    'calibration_intercept', 0,
    'rules_baseline_auc', .70,
    'cv_auc_mean', .85,
    'cv_auc_stddev', .01
  ),
  '[{"feature":"a"},{"feature":"b"},{"feature":"c"},{"feature":"d"},{"feature":"e"}]'::jsonb,
  repeat('b', 64),
  'ab_test',
  now(),
  'e1000000-0000-4000-8000-000000000004'
from feature;

insert into public.ml_experiments (
  id,
  model_version_id,
  status,
  started_at,
  planned_end_at,
  completed_at,
  evaluated_outcomes,
  created_by
)
values (
  'e7000000-0000-4000-8000-000000000001',
  'e6000000-0000-4000-8000-000000000001',
  'completed',
  now() - interval '31 days',
  now() - interval '1 day',
  now(),
  50,
  'e1000000-0000-4000-8000-000000000004'
);

insert into public.ml_drift_reports (
  model_version_id,
  snapshot_date,
  population_size,
  population_stability_index,
  feature_drift,
  retraining_required
)
values (
  'e6000000-0000-4000-8000-000000000001',
  current_date,
  1,
  .10,
  '{}'::jsonb,
  false
);

set local session_replication_role = origin;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select throws_ok(
  $statement$
    select public.promote_ml_model_version(
      'e6000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004'
    )
  $statement$,
  '23514',
  'Production model promotion gates are not satisfied.',
  'completed experiments with missing comparison metrics fail promotion closed'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_ml_training_run(date,date,date,ml_training_source,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.register_ml_model_version(uuid,text,text,jsonb,jsonb,numeric,jsonb,jsonb,text,numeric,timestamp with time zone,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.promote_ml_model_version(uuid,uuid)',
    'EXECUTE'
  ),
  'training creation, model registration, and promotion are service-only'
);

set local role authenticated;
set local request.jwt.claims =
  '{"role":"authenticated","sub":"e1000000-0000-4000-8000-000000000004","auth_surface":"platform"}';

select throws_ok(
  $statement$
    select public.create_ml_training_run(
      current_date - 330,
      current_date - 329,
      current_date - 230,
      'production_history',
      'e1000000-0000-4000-8000-000000000006'
    )
  $statement$,
  '42501',
  'permission denied for function create_ml_training_run',
  'authenticated platform administrator cannot attribute a service-only training run to another actor'
);

set local request.jwt.claims =
  '{"role":"authenticated","sub":"e1000000-0000-4000-8000-000000000003","organization_id":"e2000000-0000-4000-8000-000000000001","auth_surface":"staff","user_role":"staff"}';

select throws_ok(
  'select public.get_ml_operations_status()',
  '42501',
  'Staff authorization is required.',
  'deactivated staff JWT cannot call ML operations through cached auth-surface claims'
);

set local request.jwt.claims =
  '{"role":"authenticated","sub":"e1000000-0000-4000-8000-000000000001","organization_id":"e2000000-0000-4000-8000-000000000001","auth_surface":"staff","user_role":"owner"}';

select lives_ok(
  'select public.get_ml_operations_status()',
  'active organization staff can read the guarded ML operations projection'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.record_ml_training_source_qualification(uuid,text,text,jsonb,text,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.record_ml_training_source_qualification(uuid,text,text,jsonb,text,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.record_ml_training_source_qualification(uuid,text,text,jsonb,text,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.record_ml_training_source_qualification(uuid,text,text,jsonb,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.record_ml_training_source_qualification(uuid,text,text,jsonb,uuid)',
    'EXECUTE'
  ),
  'arbitrary evidence hashes are not injectable and canonical qualification is BFF-only'
);

select ok(
  pg_get_functiondef(
    'private.ml_training_temporal_contract_valid(uuid)'::regprocedure
  ) like '%temporal_order_at%'
  and pg_get_functiondef(
    'private.ml_training_temporal_contract_valid(uuid)'::regprocedure
  ) like '%count(distinct fold)%'
  and pg_get_functiondef(
    'private.ml_training_temporal_contract_valid(uuid)'::regprocedure
  ) like '%) = 6%',
  'training qualification enforces persisted temporal order and all six train/holdout partitions'
);

select ok(
  pg_get_functiondef(
    'private.enforce_active_ml_platform_actor()'::regprocedure
  ) like '%auth.uid() is distinct from v_actor_user_id%',
  'authenticated ML actor attribution cannot spoof another active platform user'
);

select * from finish();
rollback;
