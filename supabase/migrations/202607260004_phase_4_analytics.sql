alter type public.email_trigger_type add value if not exists 'analytics_report';
alter type public.email_trigger_type add value if not exists 'compliance_hold';
alter type public.email_trigger_type add value if not exists 'high_risk_alert';

commit;
begin;

create type public.analytics_report_frequency as enum (
  'weekly',
  'monthly',
  'quarterly'
);

create type public.analytics_report_type as enum (
  'analytics_summary',
  'benchmark'
);

create type public.ml_training_status as enum (
  'building',
  'insufficient_data',
  'ready',
  'failed'
);

create type public.ml_training_source as enum (
  'production_history',
  'synthetic_fixture'
);

create type public.ml_deployment_status as enum (
  'candidate',
  'ab_test',
  'production',
  'retired',
  'rejected'
);

create type public.ml_experiment_status as enum (
  'scheduled',
  'running',
  'completed',
  'stopped'
);

create type public.ml_prediction_source as enum (
  'rules',
  'ml'
);

create type public.compliance_check_status as enum (
  'compliant',
  'non_compliant',
  'unknown'
);

create type public.shipping_label_attempt_status as enum (
  'claimed',
  'shipment_created',
  'succeeded',
  'failed',
  'indeterminate'
);

create or replace function private.analytics_payload_is_minimized(
  p_payload jsonb
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_key text;
  v_value jsonb;
begin
  if jsonb_typeof(p_payload) <> 'object'
    or pg_column_size(p_payload) > 8192
  then
    return false;
  end if;

  for v_key, v_value in
    select entry.key, entry.value
    from jsonb_each(p_payload) as entry
  loop
    if lower(v_key) ~
      '(^|_)(email|e_mail|first_name|last_name|full_name|name|phone|address|street|city|postal|zip|birth|dob|password|secret|token|cookie|authorization|ip|user_agent)($|_)'
      and lower(v_key) <> 'email_hash'
    then
      return false;
    end if;

    if lower(v_key) = 'email_hash'
      and (
        jsonb_typeof(v_value) <> 'string'
        or trim(both '"' from v_value::text) !~ '^[a-f0-9]{64}$'
      )
    then
      return false;
    end if;

    if jsonb_typeof(v_value) = 'string'
      and trim(both '"' from v_value::text) ~
        '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    then
      return false;
    end if;

    if jsonb_typeof(v_value) = 'object'
      and not private.analytics_payload_is_minimized(v_value)
    then
      return false;
    end if;

    if jsonb_typeof(v_value) = 'array'
      and exists (
        select 1
        from jsonb_array_elements(v_value) as element
        where (
          jsonb_typeof(element) = 'object'
          and not private.analytics_payload_is_minimized(element)
        )
        or (
          jsonb_typeof(element) = 'string'
          and trim(both '"' from element::text) ~
            '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        )
      )
    then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create or replace function private.dashboard_layout_is_valid(
  p_layout jsonb
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select
    jsonb_typeof(p_layout) = 'array'
    and jsonb_array_length(p_layout) between 1 and 7
    and not exists (
      select 1
      from jsonb_array_elements(p_layout) as item(value)
      where jsonb_typeof(item.value) <> 'object'
        or coalesce(item.value ->> 'widget_id', '') not in (
          'revenue-by-tier',
          'member-growth',
          'member-cohorts',
          'ltv-by-tier',
          'shipment-operations',
          'engagement',
          'acquisition'
        )
        or coalesce(item.value ->> 'order', '') !~ '^[0-6]$'
        or coalesce(item.value ->> 'size', '') not in ('half', 'full')
        or jsonb_typeof(item.value -> 'enabled') <> 'boolean'
    )
    and (
      select count(distinct item.value ->> 'widget_id')
      from jsonb_array_elements(p_layout) as item(value)
    ) = jsonb_array_length(p_layout)
    and (
      select count(distinct item.value ->> 'order')
      from jsonb_array_elements(p_layout) as item(value)
    ) = jsonb_array_length(p_layout);
$$;

create or replace function private.ml_metrics_are_complete(
  p_metrics jsonb
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select
    jsonb_typeof(p_metrics) = 'object'
    and p_metrics ?& array[
      'auc_roc',
      'accuracy',
      'precision',
      'recall',
      'f1',
      'true_positive',
      'false_positive',
      'true_negative',
      'false_negative',
      'brier_score',
      'calibration_slope',
      'calibration_intercept',
      'rules_baseline_auc',
      'cv_auc_mean',
      'cv_auc_stddev'
    ]
    and (p_metrics ->> 'auc_roc')::numeric between 0 and 1
    and (p_metrics ->> 'accuracy')::numeric between 0 and 1
    and (p_metrics ->> 'precision')::numeric between 0 and 1
    and (p_metrics ->> 'recall')::numeric between 0 and 1
    and (p_metrics ->> 'f1')::numeric between 0 and 1
    and (p_metrics ->> 'brier_score')::numeric between 0 and 1
    and (p_metrics ->> 'rules_baseline_auc')::numeric between 0 and 1
    and (p_metrics ->> 'cv_auc_mean')::numeric between 0 and 1
    and (p_metrics ->> 'cv_auc_stddev')::numeric between 0 and 1
    and (p_metrics ->> 'true_positive')::integer >= 0
    and (p_metrics ->> 'false_positive')::integer >= 0
    and (p_metrics ->> 'true_negative')::integer >= 0
    and (p_metrics ->> 'false_negative')::integer >= 0;
$$;

create or replace function private.ml_feature_baselines_are_valid(
  p_baselines jsonb
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_feature text;
  v_bins jsonb;
  v_sum numeric;
begin
  if jsonb_typeof(p_baselines) <> 'object'
    or (select count(*) from jsonb_object_keys(p_baselines)) <> 16
  then
    return false;
  end if;
  foreach v_feature in array array[
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
  ]::text[]
  loop
    v_bins := p_baselines -> v_feature;
    if jsonb_typeof(v_bins) <> 'array'
      or jsonb_array_length(v_bins) <> 4
      or exists (
        select 1
        from jsonb_array_elements_text(v_bins) as bin(value)
        where bin.value::numeric <= 0 or bin.value::numeric >= 1
      )
    then
      return false;
    end if;
    select sum(bin.value::numeric) into v_sum
    from jsonb_array_elements_text(v_bins) as bin(value);
    if v_sum not between 0.999 and 1.001 then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function private.text_array_is_unique(
  p_values text[]
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select cardinality(p_values) = (
    select count(distinct value)
    from unnest(p_values) as item(value)
  );
$$;

create or replace function private.is_ml_training_actor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or private.is_super_admin();
$$;

revoke execute on function private.analytics_payload_is_minimized(jsonb)
from public, anon;
revoke execute on function private.dashboard_layout_is_valid(jsonb)
from public, anon;
revoke execute on function private.ml_metrics_are_complete(jsonb)
from public, anon;
revoke execute on function private.ml_feature_baselines_are_valid(jsonb)
from public, anon;
revoke execute on function private.is_ml_training_actor()
from public, anon;
grant execute on function private.analytics_payload_is_minimized(jsonb)
to authenticated, service_role;
grant execute on function private.dashboard_layout_is_valid(jsonb)
to authenticated, service_role;
grant execute on function private.ml_metrics_are_complete(jsonb)
to authenticated, service_role;
grant execute on function private.ml_feature_baselines_are_valid(jsonb)
to authenticated, service_role;
revoke execute on function private.text_array_is_unique(text[])
from public, anon;
grant execute on function private.text_array_is_unique(text[])
to authenticated, service_role;
grant execute on function private.is_ml_training_actor()
to authenticated, service_role;

create table public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  member_id uuid,
  event_type text not null,
  event_data jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint analytics_events_event_type_format
    check (
      char_length(event_type) between 3 and 80
      and event_type ~ '^[a-z][a-z0-9_.-]+$'
      and event_type = any(array[
        'analytics.dashboard_viewed',
        'analytics.widget_exported',
        'analytics.report_scheduled',
        'benchmark.dashboard_viewed',
        'benchmark.opted_in',
        'benchmark.report_generated',
        'churn.dashboard_viewed',
        'churn.alert_acknowledged',
        'compliance.dashboard_viewed',
        'member.created',
        'member.updated',
        'member.cancelled',
        'release.created',
        'release.scheduled',
        'release.processed',
        'shipment.charged',
        'shipment.declined',
        'shipment.compliance_checked',
        'shipment.label_created',
        'shipment.shipped',
        'shipment.delivered',
        'email.sent',
        'email.opened',
        'email.clicked',
        'portal.login',
        'loyalty.redeemed'
      ]::text[])
    ),
  constraint analytics_events_idempotency_format
    check (
      char_length(idempotency_key) between 8 and 255
      and idempotency_key ~ '^[A-Za-z0-9_.:/-]+$'
    ),
  constraint analytics_events_minimized_payload
    check (private.analytics_payload_is_minimized(event_data)),
  constraint analytics_events_organization_id_id_key
    unique (organization_id, id),
  constraint analytics_events_org_idempotency_key
    unique (organization_id, idempotency_key),
  constraint analytics_events_member_same_organization_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete restrict
);

create index analytics_events_org_type_occurred_idx
  on public.analytics_events (organization_id, event_type, occurred_at desc);
create index analytics_events_org_member_occurred_idx
  on public.analytics_events (organization_id, member_id, occurred_at desc)
  where member_id is not null;

create table public.analytics_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  metric_date date not null,
  mrr_cents bigint not null default 0,
  active_members integer not null default 0,
  new_members integer not null default 0,
  cancelled_members integer not null default 0,
  downgraded_members integer not null default 0,
  gross_revenue_cents bigint not null default 0,
  refunds_cents bigint not null default 0,
  net_revenue_cents bigint not null default 0,
  revenue_churn_cents bigint not null default 0,
  attempted_shipments integer not null default 0,
  fulfilled_shipments integer not null default 0,
  declined_attempts integer not null default 0,
  shipment_value_cents bigint not null default 0,
  shipping_cost_cents bigint not null default 0,
  emails_sent integer not null default 0,
  email_opens integer not null default 0,
  email_clicks integer not null default 0,
  portal_logins integer not null default 0,
  loyalty_points_earned bigint not null default 0,
  loyalty_points_redeemed bigint not null default 0,
  refreshed_at timestamptz not null default now(),
  constraint analytics_daily_metrics_nonnegative
    check (
      mrr_cents >= 0
      and active_members >= 0
      and new_members >= 0
      and cancelled_members >= 0
      and downgraded_members >= 0
      and gross_revenue_cents >= 0
      and refunds_cents >= 0
      and revenue_churn_cents >= 0
      and attempted_shipments >= 0
      and fulfilled_shipments >= 0
      and declined_attempts >= 0
      and shipment_value_cents >= 0
      and shipping_cost_cents >= 0
      and emails_sent >= 0
      and email_opens >= 0
      and email_clicks >= 0
      and portal_logins >= 0
      and loyalty_points_earned >= 0
      and loyalty_points_redeemed >= 0
    ),
  constraint analytics_daily_metrics_org_date_key
    unique (organization_id, metric_date)
);

create index analytics_daily_metrics_org_date_idx
  on public.analytics_daily_metrics (organization_id, metric_date desc);

create table public.analytics_cohort_retention (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  cohort_month date not null,
  observation_month date not null,
  months_since_join integer not null,
  cohort_size integer not null,
  retained_members integer not null,
  retention_rate numeric(7, 6) not null,
  refreshed_at timestamptz not null default now(),
  constraint analytics_cohort_months_normalized
    check (
      cohort_month = date_trunc('month', cohort_month)::date
      and observation_month = date_trunc('month', observation_month)::date
      and observation_month >= cohort_month
    ),
  constraint analytics_cohort_values_valid
    check (
      months_since_join between 0 and 600
      and cohort_size > 0
      and retained_members between 0 and cohort_size
      and retention_rate between 0 and 1
    ),
  constraint analytics_cohort_org_month_key
    unique (organization_id, cohort_month, observation_month)
);

create index analytics_cohort_org_observation_idx
  on public.analytics_cohort_retention (
    organization_id,
    observation_month desc,
    cohort_month
  );

create table public.dashboard_layout_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  staff_user_id uuid not null,
  layout jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dashboard_layout_preferences_valid
    check (private.dashboard_layout_is_valid(layout)),
  constraint dashboard_layout_preferences_org_staff_key
    unique (organization_id, staff_user_id),
  constraint dashboard_layout_preferences_staff_same_organization_fkey
    foreign key (organization_id, staff_user_id)
    references public.staff_users (organization_id, id)
    on delete cascade
);

create index dashboard_layout_preferences_staff_idx
  on public.dashboard_layout_preferences (staff_user_id);

create table public.analytics_report_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  staff_user_id uuid not null,
  report_type public.analytics_report_type not null default 'analytics_summary',
  frequency public.analytics_report_frequency not null,
  day_of_week smallint,
  day_of_month smallint,
  send_hour_utc smallint not null default 8,
  widget_ids text[] not null default array[
    'revenue-by-tier',
    'member-growth',
    'member-cohorts',
    'ltv-by-tier',
    'shipment-operations',
    'engagement',
    'acquisition'
  ]::text[],
  enabled boolean not null default true,
  next_report_at timestamptz not null,
  last_enqueued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint analytics_report_schedules_calendar_valid
    check (
      send_hour_utc between 0 and 23
      and (
        frequency = 'weekly'
        and day_of_week between 0 and 6
        and day_of_month is null
      )
      or (
        frequency in ('monthly', 'quarterly')
        and day_of_week is null
        and day_of_month between 1 and 28
      )
    ),
  constraint analytics_report_schedules_type_frequency_valid
    check (
      report_type = 'analytics_summary'
      or frequency = 'quarterly'
    ),
  constraint analytics_report_schedules_widgets_valid
    check (
      cardinality(widget_ids) between 1 and 7
      and widget_ids <@ array[
        'revenue-by-tier',
        'member-growth',
        'member-cohorts',
        'ltv-by-tier',
        'shipment-operations',
        'engagement',
        'acquisition'
      ]::text[]
      and private.text_array_is_unique(widget_ids)
    ),
  constraint analytics_report_schedules_org_staff_type_key
    unique (organization_id, staff_user_id, report_type),
  constraint analytics_report_schedules_staff_same_organization_fkey
    foreign key (organization_id, staff_user_id)
    references public.staff_users (organization_id, id)
    on delete cascade
);

create index analytics_report_schedules_due_idx
  on public.analytics_report_schedules (next_report_at, id)
  where enabled;

create table public.ml_feature_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  member_id uuid not null,
  snapshot_date date not null,
  days_since_last_shipment numeric(12, 4) not null,
  days_since_last_portal_login numeric(12, 4) not null,
  days_since_last_email_open numeric(12, 4) not null,
  shipments_per_year numeric(12, 6) not null,
  portal_logins_per_month numeric(12, 6) not null,
  email_opens_per_month numeric(12, 6) not null,
  total_lifetime_spend_cents numeric(18, 2) not null,
  average_shipment_value_cents numeric(18, 2) not null,
  email_open_rate numeric(9, 8) not null,
  email_click_rate numeric(9, 8) not null,
  loyalty_point_balance numeric(18, 2) not null,
  tenure_months numeric(12, 4) not null,
  tier_change_count numeric(12, 4) not null,
  decline_count numeric(12, 4) not null,
  decline_recovery_rate numeric(9, 8) not null,
  observed_expected_shipment_ratio numeric(12, 8) not null,
  rules_score numeric(5, 2) not null,
  computed_at timestamptz not null default now(),
  constraint ml_feature_snapshots_nonnegative
    check (
      days_since_last_shipment >= 0
      and days_since_last_portal_login >= 0
      and days_since_last_email_open >= 0
      and shipments_per_year >= 0
      and portal_logins_per_month >= 0
      and email_opens_per_month >= 0
      and total_lifetime_spend_cents >= 0
      and average_shipment_value_cents >= 0
      and loyalty_point_balance >= 0
      and tenure_months >= 0
      and tier_change_count >= 0
      and decline_count >= 0
      and observed_expected_shipment_ratio >= 0
    ),
  constraint ml_feature_snapshots_rates_bounded
    check (
      email_open_rate between 0 and 1
      and email_click_rate between 0 and 1
      and decline_recovery_rate between 0 and 1
      and rules_score between 0 and 100
    ),
  constraint ml_feature_snapshots_organization_id_id_key
    unique (organization_id, id),
  constraint ml_feature_snapshots_member_date_key
    unique (organization_id, member_id, snapshot_date),
  constraint ml_feature_snapshots_member_same_organization_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade
);

create index ml_feature_snapshots_org_date_idx
  on public.ml_feature_snapshots (organization_id, snapshot_date desc);
create index ml_feature_snapshots_member_date_idx
  on public.ml_feature_snapshots (member_id, snapshot_date desc);

create table public.ml_training_runs (
  id uuid primary key default gen_random_uuid(),
  source public.ml_training_source not null,
  status public.ml_training_status not null default 'building',
  training_cutoff date not null,
  holdout_start date not null,
  holdout_end date not null,
  member_count integer not null default 0,
  cancellation_count integer not null default 0,
  training_row_count integer not null default 0,
  holdout_row_count integer not null default 0,
  temporal_split boolean not null default true,
  cross_validation_folds integer not null default 5,
  split_strategy text not null default 'temporal_80_20_member_disjoint',
  target_training_ratio numeric(5, 4) not null default 0.8000,
  actual_training_ratio numeric(7, 6),
  feature_schema_version text not null default 'vinifera-churn-v1',
  dataset_hash text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  failure_reason text,
  constraint ml_training_runs_windows_valid
    check (
      training_cutoff < holdout_start
      and holdout_start <= holdout_end
    ),
  constraint ml_training_runs_counts_nonnegative
    check (
      member_count >= 0
      and cancellation_count >= 0
      and cancellation_count <= member_count
      and training_row_count >= 0
      and holdout_row_count >= 0
    ),
  constraint ml_training_runs_method_fixed
    check (
      temporal_split
      and cross_validation_folds = 5
      and split_strategy = 'temporal_80_20_member_disjoint'
      and target_training_ratio = 0.8000
      and (
        actual_training_ratio is null
        or actual_training_ratio between 0.79 and 0.81
      )
    ),
  constraint ml_training_runs_hash_format
    check (
      dataset_hash is null
      or dataset_hash ~ '^[a-f0-9]{64}$'
    ),
  constraint ml_training_runs_completion_consistent
    check (
      (status = 'building' and completed_at is null)
      or (
        status <> 'building'
        and completed_at is not null
      )
    )
);

create index ml_training_runs_status_created_idx
  on public.ml_training_runs (status, created_at desc);
create unique index ml_training_runs_provenance_uidx
  on public.ml_training_runs (
    source,
    training_cutoff,
    holdout_start,
    holdout_end,
    feature_schema_version
  );

create table public.ml_training_rows (
  id uuid primary key default gen_random_uuid(),
  training_run_id uuid not null
    references public.ml_training_runs (id) on delete cascade,
  organization_id uuid not null,
  member_id uuid not null,
  feature_snapshot_id uuid not null,
  split text not null,
  fold smallint,
  churned_within_90_days boolean not null,
  outcome_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ml_training_rows_split_valid
    check (
      (split = 'train' and fold between 0 and 5)
      or (split = 'holdout' and fold is null)
    ),
  constraint ml_training_rows_outcome_consistent
    check (
      churned_within_90_days
      or outcome_at is null
    ),
  constraint ml_training_rows_run_member_split_key
    unique (training_run_id, member_id, split),
  constraint ml_training_rows_feature_same_organization_fkey
    foreign key (organization_id, feature_snapshot_id)
    references public.ml_feature_snapshots (organization_id, id)
    on delete restrict,
  constraint ml_training_rows_member_same_organization_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete restrict
);

create index ml_training_rows_run_split_idx
  on public.ml_training_rows (training_run_id, split, churned_within_90_days);
create index ml_training_rows_org_member_idx
  on public.ml_training_rows (organization_id, member_id);

create table public.ml_model_versions (
  id uuid primary key default gen_random_uuid(),
  training_run_id uuid not null
    references public.ml_training_runs (id) on delete restrict,
  version text not null unique,
  algorithm text not null,
  hyperparameters jsonb not null,
  coefficients jsonb not null,
  intercept numeric(18, 10) not null,
  training_data_size integer not null,
  cancellation_count integer not null,
  metrics jsonb not null,
  feature_importance jsonb not null,
  artifact_hash text not null,
  deployment_status public.ml_deployment_status not null default 'candidate',
  high_risk_threshold numeric(7, 6) not null default 0.700000,
  trained_at timestamptz not null,
  registered_by uuid references auth.users (id) on delete set null,
  registered_at timestamptz not null default now(),
  promoted_at timestamptz,
  retired_at timestamptz,
  constraint ml_model_versions_version_format
    check (
      char_length(version) between 3 and 80
      and version ~ '^[A-Za-z0-9_.-]+$'
    ),
  constraint ml_model_versions_algorithm_regularized
    check (algorithm = 'logistic_regression_l2'),
  constraint ml_model_versions_hyperparameters_object
    check (
      jsonb_typeof(hyperparameters) = 'object'
      and (hyperparameters ->> 'regularization')::numeric > 0
      and (hyperparameters ->> 'cross_validation_folds')::integer = 5
      and hyperparameters ->> 'split_strategy' =
        'temporal_80_20_member_disjoint'
      and jsonb_typeof(hyperparameters -> 'feature_medians') = 'object'
      and private.ml_feature_baselines_are_valid(
        hyperparameters -> 'feature_baseline_bins'
      )
    ),
  constraint ml_model_versions_coefficients_object
    check (
      jsonb_typeof(coefficients) = 'object'
      and coefficients ?& array[
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
      ]
    ),
  constraint ml_model_versions_metrics_complete
    check (private.ml_metrics_are_complete(metrics)),
  constraint ml_model_versions_feature_importance_valid
    check (
      jsonb_typeof(feature_importance) = 'array'
      and jsonb_array_length(feature_importance) >= 5
    ),
  constraint ml_model_versions_training_counts_valid
    check (
      training_data_size > 0
      and cancellation_count between 0 and training_data_size
    ),
  constraint ml_model_versions_artifact_hash_format
    check (artifact_hash ~ '^[a-f0-9]{64}$'),
  constraint ml_model_versions_threshold_valid
    check (high_risk_threshold between 0.50 and 0.95),
  constraint ml_model_versions_lifecycle_valid
    check (
      (deployment_status in ('candidate', 'ab_test', 'rejected')
        and promoted_at is null)
      or (deployment_status = 'production' and promoted_at is not null)
      or (
        deployment_status = 'retired'
        and promoted_at is not null
        and retired_at is not null
      )
    )
);

create unique index ml_model_versions_one_production_uidx
  on public.ml_model_versions ((deployment_status))
  where deployment_status = 'production';
create unique index ml_model_versions_one_ab_test_uidx
  on public.ml_model_versions ((deployment_status))
  where deployment_status = 'ab_test';
create unique index ml_model_versions_artifact_hash_uidx
  on public.ml_model_versions (artifact_hash);

create table public.ml_experiments (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid not null
    references public.ml_model_versions (id) on delete restrict,
  status public.ml_experiment_status not null default 'scheduled',
  started_at timestamptz not null,
  planned_end_at timestamptz not null,
  completed_at timestamptz,
  evaluated_outcomes integer not null default 0,
  ml_auc numeric(7, 6),
  rules_auc numeric(7, 6),
  ml_brier_score numeric(7, 6),
  rules_brier_score numeric(7, 6),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint ml_experiments_duration_valid
    check (planned_end_at >= started_at + interval '30 days'),
  constraint ml_experiments_metrics_valid
    check (
      evaluated_outcomes >= 0
      and (ml_auc is null or ml_auc between 0 and 1)
      and (rules_auc is null or rules_auc between 0 and 1)
      and (ml_brier_score is null or ml_brier_score between 0 and 1)
      and (rules_brier_score is null or rules_brier_score between 0 and 1)
    ),
  constraint ml_experiments_completion_consistent
    check (
      (
        status in ('scheduled', 'running')
        and completed_at is null
        and ml_auc is null
        and rules_auc is null
      )
      or (
        status in ('completed', 'stopped')
        and completed_at is not null
      )
    )
);

create unique index ml_experiments_one_open_uidx
  on public.ml_experiments ((status))
  where status in ('scheduled', 'running');
create index ml_experiments_model_created_idx
  on public.ml_experiments (model_version_id, created_at desc);

create table public.ml_churn_predictions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  member_id uuid not null,
  feature_snapshot_id uuid not null,
  model_version_id uuid not null
    references public.ml_model_versions (id) on delete restrict,
  experiment_id uuid references public.ml_experiments (id) on delete set null,
  experiment_arm public.ml_prediction_source not null,
  score numeric(7, 6) not null,
  rules_score numeric(5, 2) not null,
  confidence_interval_low numeric(7, 6) not null,
  confidence_interval_high numeric(7, 6) not null,
  probability_band_method text not null
    default 'heldout_brier_calibration_v1',
  top_features jsonb not null,
  predicted_at timestamptz not null,
  prediction_date date not null,
  created_at timestamptz not null default now(),
  constraint ml_churn_predictions_scores_valid
    check (
      score between 0 and 1
      and rules_score between 0 and 100
      and confidence_interval_low between 0 and score
      and confidence_interval_high between score and 1
    ),
  constraint ml_churn_predictions_top_features_valid
    check (
      jsonb_typeof(top_features) = 'array'
      and jsonb_array_length(top_features) = 5
    ),
  constraint ml_churn_predictions_probability_band_method
    check (probability_band_method = 'heldout_brier_calibration_v1'),
  constraint ml_churn_predictions_organization_id_id_key
    unique (organization_id, id),
  constraint ml_churn_predictions_member_model_date_key
    unique (
      organization_id,
      member_id,
      model_version_id,
      prediction_date
    ),
  constraint ml_churn_predictions_member_same_organization_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade,
  constraint ml_churn_predictions_feature_same_organization_fkey
    foreign key (organization_id, feature_snapshot_id)
    references public.ml_feature_snapshots (organization_id, id)
    on delete restrict
);

create index ml_churn_predictions_org_date_score_idx
  on public.ml_churn_predictions (
    organization_id,
    prediction_date desc,
    score desc
  );
create index ml_churn_predictions_member_date_idx
  on public.ml_churn_predictions (member_id, prediction_date desc);

create table public.ml_drift_reports (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid not null
    references public.ml_model_versions (id) on delete cascade,
  snapshot_date date not null,
  population_size integer not null,
  population_stability_index numeric(18, 8) not null,
  feature_drift jsonb not null,
  retraining_required boolean not null,
  recorded_at timestamptz not null default now(),
  constraint ml_drift_reports_values_valid
    check (
      population_size > 0
      and population_stability_index >= 0
      and retraining_required = (population_stability_index >= 0.20)
      and jsonb_typeof(feature_drift) = 'object'
    ),
  constraint ml_drift_reports_model_date_key
    unique (model_version_id, snapshot_date)
);

create index ml_drift_reports_retraining_idx
  on public.ml_drift_reports (snapshot_date desc)
  where retraining_required;

create table public.ml_retraining_signals (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid not null
    references public.ml_model_versions (id) on delete cascade,
  first_breach_date date not null,
  population_stability_index numeric(18, 8) not null,
  training_run_id uuid
    references public.ml_training_runs (id) on delete set null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ml_retraining_signals_values_valid
    check (
      population_stability_index >= 0.20
      and (
        (training_run_id is null and consumed_at is null)
        or (training_run_id is not null and consumed_at is not null)
      )
    ),
  constraint ml_retraining_signals_model_breach_key
    unique (model_version_id, first_breach_date)
);

create index ml_retraining_signals_model_created_idx
  on public.ml_retraining_signals (model_version_id, created_at desc);

create table public.ml_high_risk_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  member_id uuid not null,
  prediction_id uuid not null,
  score numeric(7, 6) not null,
  threshold numeric(7, 6) not null,
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ml_high_risk_alerts_score_valid
    check (
      score between 0 and 1
      and threshold between 0 and 1
      and score >= threshold
    ),
  constraint ml_high_risk_alerts_ack_consistent
    check (
      (acknowledged_by is null and acknowledged_at is null)
      or (acknowledged_by is not null and acknowledged_at is not null)
    ),
  constraint ml_high_risk_alerts_org_prediction_key
    unique (organization_id, prediction_id),
  constraint ml_high_risk_alerts_prediction_same_organization_fkey
    foreign key (organization_id, prediction_id)
    references public.ml_churn_predictions (organization_id, id)
    on delete cascade,
  constraint ml_high_risk_alerts_member_same_organization_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade,
  constraint ml_high_risk_alerts_ack_staff_same_organization_fkey
    foreign key (organization_id, acknowledged_by)
    references public.staff_users (organization_id, id)
    on delete restrict
);

create index ml_high_risk_alerts_org_unacknowledged_idx
  on public.ml_high_risk_alerts (organization_id, created_at desc)
  where acknowledged_at is null;

create table public.benchmark_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique
    references public.organizations (id) on delete cascade,
  opted_in boolean not null default false,
  region_group text,
  quarterly_report_enabled boolean not null default false,
  opted_in_at timestamptz,
  opted_out_at timestamptz,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint benchmark_preferences_region_format
    check (
      region_group is null
      or (
        char_length(region_group) between 2 and 80
        and region_group ~ '^[A-Za-z0-9 .&/-]+$'
      )
    ),
  constraint benchmark_preferences_consent_consistent
    check (
      (not quarterly_report_enabled or opted_in)
      and (
      (
        opted_in
        and region_group is not null
        and opted_in_at is not null
        and opted_out_at is null
      )
      or (
        not opted_in
        and opted_in_at is null
        and not quarterly_report_enabled
      )
      )
    ),
  constraint benchmark_preferences_updated_by_same_organization_fkey
    foreign key (organization_id, updated_by)
    references public.staff_users (organization_id, id)
    on delete set null (updated_by)
);

create table public.benchmark_contributions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  period date not null,
  region_group text not null,
  tier_distribution_band text not null,
  member_count_band text not null,
  metrics jsonb not null,
  opted_in boolean not null,
  created_at timestamptz not null default now(),
  constraint benchmark_contributions_period_month
    check (period = date_trunc('month', period)::date),
  constraint benchmark_contributions_groups_valid
    check (
      char_length(region_group) between 2 and 80
      and region_group ~ '^[A-Za-z0-9 .&/-]+$'
      and tier_distribution_band in (
        'vine_heavy',
        'cellar_heavy',
        'estate_heavy',
        'reserve_heavy',
        'balanced'
      )
      and member_count_band in (
        'under_250',
        '250_499',
        '500_999',
        '1000_2499',
        '2500_plus'
      )
    ),
  constraint benchmark_contributions_metrics_complete
    check (
      jsonb_typeof(metrics) = 'object'
      and metrics ?& array[
        'retention_rate',
        'average_shipment_value_cents',
        'decline_rate',
        'mrr_growth_rate',
        'email_engagement_rate'
      ]
      and (metrics ->> 'retention_rate')::numeric between 0 and 1
      and (metrics ->> 'average_shipment_value_cents')::numeric >= 0
      and (metrics ->> 'decline_rate')::numeric between 0 and 1
      and (metrics ->> 'email_engagement_rate')::numeric between 0 and 1
    ),
  constraint benchmark_contributions_org_period_key
    unique (organization_id, period)
);

create index benchmark_contributions_period_opted_group_idx
  on public.benchmark_contributions (
    period,
    region_group,
    tier_distribution_band,
    member_count_band
  )
  where opted_in;

create table public.benchmark_aggregates (
  id uuid primary key default gen_random_uuid(),
  period date not null,
  coarsening_level smallint not null,
  region_group text not null,
  tier_distribution_band text not null,
  member_count_band text not null,
  participant_count integer not null,
  participant_count_band text not null,
  metric_percentiles jsonb not null,
  computed_at timestamptz not null default now(),
  constraint benchmark_aggregates_period_month
    check (period = date_trunc('month', period)::date),
  constraint benchmark_aggregates_privacy_threshold
    check (
      coarsening_level between 0 and 3
      and participant_count >= 10
      and participant_count_band in ('10-19', '20-49', '50+')
      and participant_count_band = case
        when participant_count between 10 and 19 then '10-19'
        when participant_count between 20 and 49 then '20-49'
        else '50+'
      end
    ),
  constraint benchmark_aggregates_percentiles_valid
    check (
      jsonb_typeof(metric_percentiles) = 'object'
      and metric_percentiles ?& array[
        'retention_rate',
        'average_shipment_value_cents',
        'decline_rate',
        'mrr_growth_rate',
        'email_engagement_rate'
      ]
    ),
  constraint benchmark_aggregates_group_key
    unique (
      period,
      coarsening_level,
      region_group,
      tier_distribution_band,
      member_count_band
    )
);

create index benchmark_aggregates_lookup_idx
  on public.benchmark_aggregates (
    period,
    region_group,
    tier_distribution_band,
    member_count_band,
    coarsening_level
  );

create table public.compliance_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shipment_id uuid not null,
  recipient_state text not null,
  status public.compliance_check_status not null,
  reason text,
  tax_estimate_cents integer,
  provider text not null,
  provider_response_id text not null,
  request_fingerprint text not null,
  shipment_state_fingerprint text not null,
  checked_at timestamptz not null,
  actor_user_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint compliance_checks_recipient_state_format
    check (recipient_state ~ '^[A-Z]{2}$'),
  constraint compliance_checks_reason_consistent
    check (
      (
        status = 'compliant'
        and (reason is null or char_length(btrim(reason)) between 1 and 1000)
      )
      or (
        status in ('non_compliant', 'unknown')
        and reason is not null
        and char_length(btrim(reason)) between 1 and 1000
      )
    ),
  constraint compliance_checks_tax_nonnegative
    check (tax_estimate_cents is null or tax_estimate_cents >= 0),
  constraint compliance_checks_provider_format
    check (
      provider in ('shipcompliant', 'simulated')
      and char_length(provider_response_id) between 3 and 255
    ),
  constraint compliance_checks_request_fingerprint_format
    check (
      request_fingerprint ~ '^[a-f0-9]{64}$'
      and shipment_state_fingerprint ~ '^[a-f0-9]{64}$'
    ),
  constraint compliance_checks_metadata_minimized
    check (private.analytics_payload_is_minimized(metadata)),
  constraint compliance_checks_compliant_evidence
    check (
      status <> 'compliant'
      or (
        tax_estimate_cents is not null
        and metadata @> '{
          "recipient_state_allowed": true,
          "origin_to_recipient_allowed": true,
          "age_verified": true,
          "volume_within_limit": true
        }'::jsonb
        and char_length(coalesce(metadata ->> 'rules_version', ''))
          between 1 and 120
      )
    ),
  constraint compliance_checks_organization_id_id_key
    unique (organization_id, id),
  constraint compliance_checks_provider_response_key
    unique (provider, provider_response_id),
  constraint compliance_checks_shipment_same_organization_fkey
    foreign key (organization_id, shipment_id)
    references public.shipments (organization_id, id)
    on delete cascade,
  constraint compliance_checks_actor_staff_same_organization_fkey
    foreign key (organization_id, actor_user_id)
    references public.staff_users (organization_id, id)
    on delete set null (actor_user_id)
);

create table public.shipping_label_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shipment_id uuid not null,
  compliance_check_id uuid not null,
  request_fingerprint text not null,
  correlation_reference text not null,
  provider text not null default 'easypost',
  status public.shipping_label_attempt_status not null default 'claimed',
  worker_id text,
  lease_token_hash text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 1,
  external_shipment_id text,
  external_rate_id text,
  external_label_id text,
  label_url text,
  tracking_number text,
  carrier text,
  label_cost_cents integer,
  provider_metadata jsonb not null default '{}'::jsonb,
  error_message text,
  claimed_at timestamptz not null default now(),
  external_shipment_persisted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipping_label_attempts_fingerprint_format
    check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint shipping_label_attempts_reference_format
    check (
      char_length(correlation_reference) between 16 and 255
      and correlation_reference ~ '^[A-Za-z0-9_.:/-]+$'
    ),
  constraint shipping_label_attempts_provider_fixed
    check (provider in ('easypost', 'simulated')),
  constraint shipping_label_attempts_lease_consistent
    check (
      (
        status in ('claimed', 'shipment_created')
        and worker_id is not null
        and lease_token_hash ~ '^[a-f0-9]{64}$'
        and lease_expires_at is not null
      )
      or (
        status in ('succeeded', 'failed', 'indeterminate')
        and worker_id is null
        and lease_token_hash is null
        and lease_expires_at is null
      )
    ),
  constraint shipping_label_attempts_external_shipment_consistent
    check (
      (
        status in ('claimed', 'failed')
        and (
          (external_shipment_id is null and external_shipment_persisted_at is null)
          or (
            (
              (provider = 'easypost' and external_shipment_id ~ '^shp_[A-Za-z0-9]+$')
              or (
                provider = 'simulated'
                and external_shipment_id ~ '^simshipment_[A-Za-z0-9]+$'
              )
            )
            and external_shipment_persisted_at is not null
          )
        )
      )
      or (
        status in ('shipment_created', 'succeeded', 'indeterminate')
        and (
          (provider = 'easypost' and external_shipment_id ~ '^shp_[A-Za-z0-9]+$')
          or (
            provider = 'simulated'
            and external_shipment_id ~ '^simshipment_[A-Za-z0-9]+$'
          )
        )
        and external_shipment_persisted_at is not null
      )
    ),
  constraint shipping_label_attempts_completion_consistent
    check (
      (status in ('claimed', 'shipment_created') and completed_at is null)
      or (status in ('succeeded', 'failed', 'indeterminate') and completed_at is not null)
    ),
  constraint shipping_label_attempts_success_consistent
    check (
      status <> 'succeeded'
      or (
        (
          (
            provider = 'easypost'
            and external_label_id ~ '^(pl_|easypost_label_)[A-Za-z0-9]+$'
          )
          or (
            provider = 'simulated'
            and external_label_id ~ '^simlabel_[A-Za-z0-9]+$'
          )
        )
        and label_url ~ '^https://'
        and tracking_number is not null
        and carrier is not null
        and label_cost_cents >= 0
      )
    ),
  constraint shipping_label_attempts_attempt_count
    check (attempt_count between 1 and 20),
  constraint shipping_label_attempts_metadata_minimized
    check (private.analytics_payload_is_minimized(provider_metadata)),
  constraint shipping_label_attempts_org_id_key
    unique (organization_id, id),
  constraint shipping_label_attempts_shipment_fingerprint_key
    unique (organization_id, shipment_id, request_fingerprint),
  constraint shipping_label_attempts_reference_key
    unique (organization_id, correlation_reference),
  constraint shipping_label_attempts_shipment_same_organization_fkey
    foreign key (organization_id, shipment_id)
    references public.shipments (organization_id, id)
    on delete restrict,
  constraint shipping_label_attempts_compliance_same_organization_fkey
    foreign key (organization_id, compliance_check_id)
    references public.compliance_checks (organization_id, id)
    on delete restrict
);

create unique index shipping_label_attempts_external_shipment_uidx
  on public.shipping_label_attempts (external_shipment_id)
  where external_shipment_id is not null;
create unique index shipping_label_attempts_one_active_per_shipment_uidx
  on public.shipping_label_attempts (organization_id, shipment_id)
  where status in ('claimed', 'shipment_created');
create index shipping_label_attempts_recovery_idx
  on public.shipping_label_attempts (lease_expires_at, id)
  where status in ('claimed', 'shipment_created');

create index compliance_checks_shipment_checked_idx
  on public.compliance_checks (
    organization_id,
    shipment_id,
    checked_at desc
  );
create index compliance_checks_org_status_checked_idx
  on public.compliance_checks (
    organization_id,
    status,
    checked_at desc
  );

alter table public.shipments
  add column latest_compliance_check_id uuid,
  add column latest_compliance_request_fingerprint text,
  add column latest_compliance_state_fingerprint text,
  add column compliance_status public.compliance_check_status,
  add column compliance_reason text,
  add column compliance_tax_estimate_cents integer,
  add column compliance_checked_at timestamptz,
  add constraint shipments_compliance_state_consistent
    check (
      (
        latest_compliance_check_id is null
        and latest_compliance_request_fingerprint is null
        and latest_compliance_state_fingerprint is null
        and compliance_status is null
        and compliance_reason is null
        and compliance_tax_estimate_cents is null
        and compliance_checked_at is null
      )
      or (
        latest_compliance_check_id is not null
        and latest_compliance_request_fingerprint ~ '^[a-f0-9]{64}$'
        and latest_compliance_state_fingerprint ~ '^[a-f0-9]{64}$'
        and compliance_status is not null
        and compliance_checked_at is not null
        and compliance_tax_estimate_cents >= 0
        and (
          compliance_status = 'compliant'
          or (
            compliance_reason is not null
            and char_length(btrim(compliance_reason)) between 1 and 1000
          )
        )
      )
    ),
  add constraint shipments_latest_compliance_same_organization_fkey
    foreign key (organization_id, latest_compliance_check_id)
    references public.compliance_checks (organization_id, id)
    on delete restrict;

create index shipments_org_compliance_queue_idx
  on public.shipments (
    organization_id,
    release_id,
    compliance_status,
    created_at
  )
  where status in ('pending', 'declined', 'charged');

alter table public.email_log
  drop constraint email_log_test_recipient_consistent,
  add constraint email_log_recipient_consistent
    check (
      (is_test and member_id is null and requested_by is not null)
      or (
        not is_test
        and member_id is not null
        and requested_by is null
      )
      or (
        not is_test
        and member_id is null
        and requested_by is not null
        and trigger_type in ('analytics_report', 'high_risk_alert')
      )
    );

create or replace function private.seed_phase4_organization_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.email_templates (
    organization_id,
    trigger_type,
    subject,
    body,
    days_before
  )
  values
    (
      new.id,
      'analytics_report',
      '{{organization_name}} analytics report',
      '<p>Your Vinifera analytics report is attached.</p>',
      null
    ),
    (
      new.id,
      'compliance_hold',
      'Action needed before your wine shipment',
      '<p>Your shipment is on hold while we resolve a compliance requirement: {{compliance_reason}}</p>',
      null
    ),
    (
      new.id,
      'high_risk_alert',
      'High churn-risk member needs attention',
      '<p>A member crossed your configured high-risk threshold. Review the churn dashboard and acknowledge the alert.</p>',
      null
    )
  on conflict (organization_id, trigger_type) do nothing;

  insert into public.benchmark_preferences (organization_id)
  values (new.id)
  on conflict (organization_id) do nothing;

  return new;
end;
$$;

create trigger organizations_seed_phase4_defaults
after insert on public.organizations
for each row execute function private.seed_phase4_organization_defaults();

insert into public.email_templates (
  organization_id,
  trigger_type,
  subject,
  body,
  days_before
)
select
  organization.id,
  fixture.trigger_type::public.email_trigger_type,
  fixture.subject,
  fixture.body,
  null
from public.organizations as organization
cross join (
  values
    (
      'analytics_report',
      '{{organization_name}} analytics report',
      '<p>Your Vinifera analytics report is attached.</p>'
    ),
    (
      'compliance_hold',
      'Action needed before your wine shipment',
      '<p>Your shipment is on hold while we resolve a compliance requirement: {{compliance_reason}}</p>'
    ),
    (
      'high_risk_alert',
      'High churn-risk member needs attention',
      '<p>A member crossed your configured high-risk threshold. Review the churn dashboard and acknowledge the alert.</p>'
    )
) as fixture(trigger_type, subject, body)
on conflict (organization_id, trigger_type) do nothing;

insert into public.benchmark_preferences (organization_id)
select organization.id
from public.organizations as organization
on conflict (organization_id) do nothing;

create trigger dashboard_layout_preferences_touch_updated_at
before update on public.dashboard_layout_preferences
for each row execute function private.touch_updated_at();

create trigger analytics_report_schedules_touch_updated_at
before update on public.analytics_report_schedules
for each row execute function private.touch_updated_at();

create trigger benchmark_preferences_touch_updated_at
before update on public.benchmark_preferences
for each row execute function private.touch_updated_at();

create or replace function private.enqueue_high_risk_staff_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff record;
  v_template public.email_templates%rowtype;
  v_email_log_id uuid;
begin
  select template.*
  into v_template
  from public.email_templates as template
  where template.organization_id = new.organization_id
    and template.trigger_type = 'high_risk_alert'
    and template.enabled;

  for v_staff in
    select staff.id, staff.email
    from public.staff_users as staff
    where staff.organization_id = new.organization_id
      and staff.status = 'active'
      and staff.role in ('owner', 'admin', 'manager')
    order by staff.id
  loop
    insert into public.email_log (
      organization_id,
      member_id,
      template_id,
      trigger_type,
      is_test,
      requested_by,
      idempotency_key,
      to_email,
      subject,
      body,
      payload,
      status,
      scheduled_for
    ) values (
      new.organization_id,
      null,
      v_template.id,
      'high_risk_alert',
      false,
      v_staff.id,
      'email:high_risk_alert:' || new.id::text || ':' || v_staff.id::text,
      v_staff.email,
      coalesce(
        v_template.subject,
        'High churn-risk member needs attention'
      ),
      coalesce(
        v_template.body,
        '<p>Review and acknowledge the new high-risk member alert.</p>'
      ),
      jsonb_build_object(
        'alert_id', new.id,
        'member_id', new.member_id,
        'prediction_id', new.prediction_id,
        'score', new.score,
        'threshold', new.threshold
      ),
      'queued',
      now()
    )
    on conflict on constraint email_log_org_idempotency_key
    do update set idempotency_key = excluded.idempotency_key
    returning id into v_email_log_id;

    insert into public.email_outbox (
      organization_id,
      email_log_id,
      status,
      available_at
    ) values (
      new.organization_id,
      v_email_log_id,
      'pending',
      now()
    )
    on conflict on constraint email_outbox_email_log_key do nothing;
  end loop;
  return new;
end;
$$;

create trigger ml_high_risk_alerts_notify_staff
after insert on public.ml_high_risk_alerts
for each row execute function private.enqueue_high_risk_staff_notifications();

create or replace function private.reject_phase4_append_only_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%I is append-only.', tg_table_name);
end;
$$;

create trigger analytics_events_reject_update_delete
before update or delete on public.analytics_events
for each row execute function private.reject_phase4_append_only_mutation();

create trigger ml_feature_snapshots_reject_update_delete
before update or delete on public.ml_feature_snapshots
for each row execute function private.reject_phase4_append_only_mutation();

create trigger ml_training_rows_reject_update_delete
before update or delete on public.ml_training_rows
for each row execute function private.reject_phase4_append_only_mutation();

create or replace function private.enforce_ml_training_member_split()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.ml_training_rows as existing
    where existing.training_run_id = new.training_run_id
      and existing.member_id = new.member_id
      and existing.split <> new.split
  ) then
    raise exception using
      errcode = '23514',
      message = 'A member cannot appear in both temporal training splits.';
  end if;
  return new;
end;
$$;

create trigger ml_training_rows_enforce_member_split
before insert on public.ml_training_rows
for each row execute function private.enforce_ml_training_member_split();

create trigger ml_churn_predictions_reject_update_delete
before update or delete on public.ml_churn_predictions
for each row execute function private.reject_phase4_append_only_mutation();

create trigger compliance_checks_reject_update_delete
before update or delete on public.compliance_checks
for each row execute function private.reject_phase4_append_only_mutation();

create or replace function private.protect_ml_model_artifact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.training_run_id is distinct from old.training_run_id
    or new.version is distinct from old.version
    or new.algorithm is distinct from old.algorithm
    or new.hyperparameters is distinct from old.hyperparameters
    or new.coefficients is distinct from old.coefficients
    or new.intercept is distinct from old.intercept
    or new.training_data_size is distinct from old.training_data_size
    or new.cancellation_count is distinct from old.cancellation_count
    or new.metrics is distinct from old.metrics
    or new.feature_importance is distinct from old.feature_importance
    or new.artifact_hash is distinct from old.artifact_hash
    or new.high_risk_threshold is distinct from old.high_risk_threshold
    or new.trained_at is distinct from old.trained_at
    or new.registered_by is distinct from old.registered_by
    or new.registered_at is distinct from old.registered_at
  then
    raise exception using
      errcode = '55000',
      message = 'ML model artifacts and evaluation metrics are immutable.';
  end if;
  return new;
end;
$$;

create trigger ml_model_versions_protect_artifact
before update on public.ml_model_versions
for each row execute function private.protect_ml_model_artifact();

create or replace function public.record_analytics_event(
  p_organization_id uuid,
  p_member_id uuid,
  p_event_type text,
  p_event_data jsonb,
  p_idempotency_key text,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_existing public.analytics_events%rowtype;
begin
  if p_event_type <> all(array[
    'analytics.dashboard_viewed',
    'analytics.widget_exported',
    'analytics.report_scheduled',
    'benchmark.dashboard_viewed',
    'benchmark.opted_in',
    'benchmark.report_generated',
    'churn.dashboard_viewed',
    'churn.alert_acknowledged',
    'compliance.dashboard_viewed',
    'member.created',
    'member.updated',
    'member.cancelled',
    'release.created',
    'release.scheduled',
    'release.processed',
    'shipment.charged',
    'shipment.declined',
    'shipment.compliance_checked',
    'shipment.label_created',
    'shipment.shipped',
    'shipment.delivered',
    'email.sent',
    'email.opened',
    'email.clicked',
    'portal.login',
    'loyalty.redeemed'
  ]::text[]) then
    raise exception using
      errcode = '22023',
      message = 'Unsupported analytics event type.';
  end if;
  if not private.analytics_payload_is_minimized(p_event_data) then
    raise exception using
      errcode = '22023',
      message = 'Analytics payload contains prohibited or excessive data.';
  end if;

  insert into public.analytics_events (
    organization_id,
    member_id,
    event_type,
    event_data,
    idempotency_key,
    occurred_at
  )
  values (
    p_organization_id,
    p_member_id,
    p_event_type,
    p_event_data,
    p_idempotency_key,
    p_occurred_at
  )
  on conflict on constraint analytics_events_org_idempotency_key
  do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select event.*
    into v_existing
    from public.analytics_events as event
    where event.organization_id = p_organization_id
      and event.idempotency_key = p_idempotency_key;
    if v_existing.member_id is distinct from p_member_id
      or v_existing.event_type is distinct from p_event_type
      or v_existing.event_data is distinct from p_event_data
    then
      raise exception using
        errcode = '23505',
        message = 'Analytics idempotency key was already used for another event.';
    end if;
    v_event_id := v_existing.id;
  end if;

  return v_event_id;
end;
$$;

create or replace function public.refresh_analytics_snapshots(
  p_as_of date default current_date,
  p_organization_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization record;
  v_refreshed integer := 0;
  v_start timestamptz := p_as_of::timestamptz;
  v_end timestamptz := (p_as_of + 1)::timestamptz;
begin
  for v_organization in
    select organization.id
    from public.organizations as organization
    where p_organization_id is null
      or organization.id = p_organization_id
    order by organization.id
  loop
    insert into public.analytics_daily_metrics (
      organization_id,
      metric_date,
      mrr_cents,
      active_members,
      new_members,
      cancelled_members,
      downgraded_members,
      gross_revenue_cents,
      refunds_cents,
      net_revenue_cents,
      revenue_churn_cents,
      attempted_shipments,
      fulfilled_shipments,
      declined_attempts,
      shipment_value_cents,
      shipping_cost_cents,
      emails_sent,
      email_opens,
      email_clicks,
      portal_logins,
      loyalty_points_earned,
      loyalty_points_redeemed,
      refreshed_at
    )
    select
      v_organization.id,
      p_as_of,
      (
        select coalesce(sum(
          case tier.frequency
            when 'monthly' then tier.price_cents
            when 'bi_monthly' then tier.price_cents / 2.0
            when 'quarterly' then tier.price_cents / 3.0
            when 'semi_annual' then tier.price_cents / 6.0
            when 'annual' then tier.price_cents / 12.0
          end
        ), 0)::bigint
        from public.members as member
        join public.club_tiers as tier
          on tier.organization_id = member.organization_id
          and tier.id = member.club_tier_id
        where member.organization_id = v_organization.id
          and member.joined_on <= p_as_of
          and member.deleted_at is null
          and (
            member.cancelled_at is null
            or member.cancelled_at >= v_end
          )
      ),
      (
        select count(*)::integer
        from public.members as member
        where member.organization_id = v_organization.id
          and member.joined_on <= p_as_of
          and member.deleted_at is null
          and (
            member.cancelled_at is null
            or member.cancelled_at >= v_end
          )
      ),
      (
        select count(*)::integer
        from public.members as member
        where member.organization_id = v_organization.id
          and member.joined_on = p_as_of
          and member.deleted_at is null
      ),
      (
        select count(*)::integer
        from public.members as member
        where member.organization_id = v_organization.id
          and member.cancelled_at >= v_start
          and member.cancelled_at < v_end
      ),
      (
        select count(*)::integer
        from public.member_activity_events as activity
        where activity.organization_id = v_organization.id
          and activity.event_type = 'tier_downgrade'
          and activity.occurred_at >= v_start
          and activity.occurred_at < v_end
      ),
      (
        select coalesce(sum(attempt.amount_cents), 0)::bigint
        from public.billing_attempts as attempt
        where attempt.organization_id = v_organization.id
          and attempt.status = 'succeeded'
          and attempt.attempt_kind in ('charge', 'retry')
          and attempt.completed_at >= v_start
          and attempt.completed_at < v_end
      ),
      (
        select coalesce(sum(attempt.amount_cents), 0)::bigint
        from public.billing_attempts as attempt
        where attempt.organization_id = v_organization.id
          and attempt.status = 'refunded'
          and attempt.completed_at >= v_start
          and attempt.completed_at < v_end
      ),
      (
        select
          coalesce(sum(attempt.amount_cents) filter (
            where attempt.status = 'succeeded'
              and attempt.attempt_kind in ('charge', 'retry')
          ), 0)
          - coalesce(sum(attempt.amount_cents) filter (
            where attempt.status = 'refunded'
          ), 0)
        from public.billing_attempts as attempt
        where attempt.organization_id = v_organization.id
          and attempt.completed_at >= v_start
          and attempt.completed_at < v_end
      ),
      (
        select coalesce(sum(churn.monthly_loss_cents), 0)::bigint
        from (
          select case tier.frequency
            when 'monthly' then tier.price_cents
            when 'bi_monthly' then tier.price_cents / 2.0
            when 'quarterly' then tier.price_cents / 3.0
            when 'semi_annual' then tier.price_cents / 6.0
            when 'annual' then tier.price_cents / 12.0
          end as monthly_loss_cents
          from public.members as member
          join public.club_tiers as tier
            on tier.organization_id = member.organization_id
            and tier.id = member.club_tier_id
          where member.organization_id = v_organization.id
            and member.cancelled_at >= v_start
            and member.cancelled_at < v_end

          union all

          select greatest(
            case previous_tier.frequency
              when 'monthly' then previous_tier.price_cents
              when 'bi_monthly' then previous_tier.price_cents / 2.0
              when 'quarterly' then previous_tier.price_cents / 3.0
              when 'semi_annual' then previous_tier.price_cents / 6.0
              when 'annual' then previous_tier.price_cents / 12.0
            end
            -
            case target_tier.frequency
              when 'monthly' then target_tier.price_cents
              when 'bi_monthly' then target_tier.price_cents / 2.0
              when 'quarterly' then target_tier.price_cents / 3.0
              when 'semi_annual' then target_tier.price_cents / 6.0
              when 'annual' then target_tier.price_cents / 12.0
            end,
            0
          ) as monthly_loss_cents
          from public.member_activity_events as activity
          join public.club_tiers as previous_tier
            on previous_tier.organization_id = activity.organization_id
            and previous_tier.id =
              (activity.metadata ->> 'previous_tier_id')::uuid
          join public.club_tiers as target_tier
            on target_tier.organization_id = activity.organization_id
            and target_tier.id =
              (activity.metadata ->> 'target_tier_id')::uuid
          where activity.organization_id = v_organization.id
            and activity.event_type = 'tier_downgrade'
            and activity.occurred_at >= v_start
            and activity.occurred_at < v_end
        ) as churn
      ),
      (
        select count(distinct attempt.shipment_id)::integer
        from public.billing_attempts as attempt
        where attempt.organization_id = v_organization.id
          and attempt.attempt_kind in ('charge', 'retry')
          and attempt.created_at >= v_start
          and attempt.created_at < v_end
      ),
      (
        select count(*)::integer
        from public.shipments as shipment
        where shipment.organization_id = v_organization.id
          and shipment.paid_at >= v_start
          and shipment.paid_at < v_end
      ),
      (
        select count(*)::integer
        from public.billing_attempts as attempt
        where attempt.organization_id = v_organization.id
          and attempt.status = 'declined'
          and attempt.completed_at >= v_start
          and attempt.completed_at < v_end
      ),
      (
        select coalesce(sum(
          shipment.charge_amount_cents - shipment.loyalty_discount_cents
        ), 0)::bigint
        from public.shipments as shipment
        where shipment.organization_id = v_organization.id
          and shipment.paid_at >= v_start
          and shipment.paid_at < v_end
      ),
      (
        select coalesce(sum(shipment.label_cost_cents), 0)::bigint
        from public.shipments as shipment
        where shipment.organization_id = v_organization.id
          and shipment.label_created_at >= v_start
          and shipment.label_created_at < v_end
      ),
      (
        select count(*)::integer
        from public.email_log as email
        where email.organization_id = v_organization.id
          and email.sent_at >= v_start
          and email.sent_at < v_end
      ),
      (
        select count(*)::integer
        from public.email_delivery_events as event
        where event.organization_id = v_organization.id
          and event.event_type = 'opened'
          and event.occurred_at >= v_start
          and event.occurred_at < v_end
      ),
      (
        select count(*)::integer
        from public.email_delivery_events as event
        where event.organization_id = v_organization.id
          and event.event_type = 'clicked'
          and event.occurred_at >= v_start
          and event.occurred_at < v_end
      ),
      (
        select count(*)::integer
        from public.member_activity_events as activity
        where activity.organization_id = v_organization.id
          and activity.event_type = 'portal_login'
          and activity.occurred_at >= v_start
          and activity.occurred_at < v_end
      ),
      (
        select coalesce(sum(ledger.points), 0)::bigint
        from public.loyalty_ledger as ledger
        where ledger.organization_id = v_organization.id
          and ledger.entry_type = 'award'
          and ledger.points > 0
          and ledger.created_at >= v_start
          and ledger.created_at < v_end
      ),
      (
        select coalesce(sum(redemption.points), 0)::bigint
        from public.loyalty_redemptions as redemption
        where redemption.organization_id = v_organization.id
          and redemption.applied_at >= v_start
          and redemption.applied_at < v_end
      ),
      now()
    on conflict on constraint analytics_daily_metrics_org_date_key
    do update set
      mrr_cents = excluded.mrr_cents,
      active_members = excluded.active_members,
      new_members = excluded.new_members,
      cancelled_members = excluded.cancelled_members,
      downgraded_members = excluded.downgraded_members,
      gross_revenue_cents = excluded.gross_revenue_cents,
      refunds_cents = excluded.refunds_cents,
      net_revenue_cents = excluded.net_revenue_cents,
      revenue_churn_cents = excluded.revenue_churn_cents,
      attempted_shipments = excluded.attempted_shipments,
      fulfilled_shipments = excluded.fulfilled_shipments,
      declined_attempts = excluded.declined_attempts,
      shipment_value_cents = excluded.shipment_value_cents,
      shipping_cost_cents = excluded.shipping_cost_cents,
      emails_sent = excluded.emails_sent,
      email_opens = excluded.email_opens,
      email_clicks = excluded.email_clicks,
      portal_logins = excluded.portal_logins,
      loyalty_points_earned = excluded.loyalty_points_earned,
      loyalty_points_redeemed = excluded.loyalty_points_redeemed,
      refreshed_at = excluded.refreshed_at;

    delete from public.analytics_cohort_retention
    where organization_id = v_organization.id
      and observation_month = date_trunc('month', p_as_of)::date;

    insert into public.analytics_cohort_retention (
      organization_id,
      cohort_month,
      observation_month,
      months_since_join,
      cohort_size,
      retained_members,
      retention_rate
    )
    select
      v_organization.id,
      cohort.cohort_month,
      date_trunc('month', p_as_of)::date,
      (
        extract(year from age(
          date_trunc('month', p_as_of),
          cohort.cohort_month
        )) * 12
        + extract(month from age(
          date_trunc('month', p_as_of),
          cohort.cohort_month
        ))
      )::integer,
      count(*)::integer,
      count(*) filter (
        where member.cancelled_at is null
          or member.cancelled_at >= (date_trunc('month', p_as_of) + interval '1 month')
      )::integer,
      (
        count(*) filter (
          where member.cancelled_at is null
            or member.cancelled_at >= (date_trunc('month', p_as_of) + interval '1 month')
        )::numeric
        / count(*)::numeric
      )::numeric(7, 6)
    from public.members as member
    cross join lateral (
      select date_trunc('month', member.joined_on)::date as cohort_month
    ) as cohort
    where member.organization_id = v_organization.id
      and member.joined_on <= p_as_of
      and member.deleted_at is null
    group by cohort.cohort_month;

    v_refreshed := v_refreshed + 1;
  end loop;

  return v_refreshed;
end;
$$;

create or replace function public.backfill_analytics_snapshots(
  p_from date,
  p_to date,
  p_organization_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date;
  v_count integer := 0;
begin
  if p_from > p_to or p_to - p_from > 3660 then
    raise exception using
      errcode = '22023',
      message = 'Analytics backfill range must be between zero and 3,660 days.';
  end if;

  for v_date in
    select generate_series(p_from, p_to, interval '1 day')::date
  loop
    v_count := v_count
      + public.refresh_analytics_snapshots(v_date, p_organization_id);
  end loop;
  return v_count;
end;
$$;

create or replace function private.can_read_org_analytics(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or private.is_super_admin()
    or private.is_staff_for_org(p_organization_id);
$$;

create or replace function private.is_service_role()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role';
$$;

create or replace function private.get_analytics_dashboard_raw(
  p_organization_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.can_read_org_analytics(p_organization_id) then
    raise exception using
      errcode = '42501',
      message = 'Staff authorization is required.';
  end if;
  if p_from > p_to or p_to - p_from > 3660 then
    raise exception using
      errcode = '22023',
      message = 'Analytics date range must be between zero and 3,660 days.';
  end if;

  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'revenue', jsonb_build_object(
      'mrr_cents', coalesce((
        select metric.mrr_cents
        from public.analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.metric_date between p_from and p_to
        order by metric.metric_date desc
        limit 1
      ), 0),
      'arr_cents', coalesce((
        select metric.mrr_cents * 12
        from public.analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.metric_date between p_from and p_to
        order by metric.metric_date desc
        limit 1
      ), 0),
      'arpm_cents', coalesce((
        select round(metric.mrr_cents::numeric / nullif(metric.active_members, 0), 2)
        from public.analytics_daily_metrics as metric
        where metric.organization_id = p_organization_id
          and metric.metric_date between p_from and p_to
        order by metric.metric_date desc
        limit 1
      ), 0),
      'gross_revenue_cents', coalesce(sum(metric.gross_revenue_cents), 0),
      'refunds_cents', coalesce(sum(metric.refunds_cents), 0),
      'net_revenue_cents', coalesce(sum(metric.net_revenue_cents), 0),
      'revenue_churn_cents', coalesce(sum(metric.revenue_churn_cents), 0)
    ),
    'members', jsonb_build_object(
      'active', coalesce((
        select latest.active_members
        from public.analytics_daily_metrics as latest
        where latest.organization_id = p_organization_id
          and latest.metric_date between p_from and p_to
        order by latest.metric_date desc
        limit 1
      ), 0),
      'new', coalesce(sum(metric.new_members), 0),
      'cancelled', coalesce(sum(metric.cancelled_members), 0),
      'downgraded', coalesce(sum(metric.downgraded_members), 0),
      'net_growth', coalesce(
        sum(metric.new_members) - sum(metric.cancelled_members),
        0
      ),
      'average_ltv_cents', coalesce((
        select round(avg(member_spend.ltv_cents), 2)
        from public.members as member
        left join lateral (
          select coalesce(sum(
            shipment.charge_amount_cents - shipment.loyalty_discount_cents
          ), 0)::numeric as ltv_cents
          from public.shipments as shipment
          where shipment.organization_id = member.organization_id
            and shipment.member_id = member.id
            and shipment.paid_at < (p_to + 1)::timestamptz
        ) as member_spend on true
        where member.organization_id = p_organization_id
          and member.joined_on <= p_to
          and (
            member.cancelled_at is null
            or member.cancelled_at >= (p_to + 1)::timestamptz
          )
          and (
            member.deleted_at is null
            or member.deleted_at >= (p_to + 1)::timestamptz
          )
      ), 0)
    ),
    'shipments', jsonb_build_object(
      'attempted', coalesce(sum(metric.attempted_shipments), 0),
      'fulfilled', coalesce(sum(metric.fulfilled_shipments), 0),
      'fulfillment_rate', coalesce(
        sum(metric.fulfilled_shipments)::numeric
          / nullif(sum(metric.attempted_shipments), 0),
        0
      ),
      'average_value_cents', coalesce(
        sum(metric.shipment_value_cents)::numeric
          / nullif(sum(metric.fulfilled_shipments), 0),
        0
      ),
      'decline_rate', coalesce(
        sum(metric.declined_attempts)::numeric
          / nullif(sum(metric.attempted_shipments), 0),
        0
      ),
      'shipping_cost_ratio', coalesce(
        sum(metric.shipping_cost_cents)::numeric
          / nullif(sum(metric.gross_revenue_cents), 0),
        0
      )
    ),
    'engagement', jsonb_build_object(
      'email_open_rate', coalesce(
        sum(metric.email_opens)::numeric / nullif(sum(metric.emails_sent), 0),
        0
      ),
      'email_click_rate', coalesce(
        sum(metric.email_clicks)::numeric / nullif(sum(metric.emails_sent), 0),
        0
      ),
      'portal_logins', coalesce(sum(metric.portal_logins), 0),
      'loyalty_points_earned', coalesce(sum(metric.loyalty_points_earned), 0),
      'loyalty_points_redeemed', coalesce(sum(metric.loyalty_points_redeemed), 0),
      'loyalty_redemption_rate', coalesce(
        sum(metric.loyalty_points_redeemed)::numeric
          / nullif(sum(metric.loyalty_points_earned), 0),
        0
      )
    ),
    'series', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date', daily.metric_date,
          'mrr_cents', daily.mrr_cents,
          'active_members', daily.active_members,
          'new_members', daily.new_members,
          'cancelled_members', daily.cancelled_members,
          'net_revenue_cents', daily.net_revenue_cents,
          'revenue_churn_cents', daily.revenue_churn_cents,
          'attempted_shipments', daily.attempted_shipments,
          'fulfilled_shipments', daily.fulfilled_shipments,
          'declined_attempts', daily.declined_attempts,
          'shipment_value_cents', daily.shipment_value_cents,
          'shipping_cost_cents', daily.shipping_cost_cents,
          'emails_sent', daily.emails_sent,
          'email_opens', daily.email_opens,
          'email_clicks', daily.email_clicks,
          'portal_logins', daily.portal_logins,
          'loyalty_points_earned', daily.loyalty_points_earned,
          'loyalty_points_redeemed', daily.loyalty_points_redeemed,
          'loyalty_redemption_rate', coalesce(
            daily.loyalty_points_redeemed::numeric
              / nullif(daily.loyalty_points_earned, 0),
            0
          )
        )
        order by daily.metric_date
      )
      from public.analytics_daily_metrics as daily
      where daily.organization_id = p_organization_id
        and daily.metric_date between p_from and p_to
    ), '[]'::jsonb),
    'tier_distribution', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'tier_id', tier.id,
          'tier_name', tier.name,
          'active_members', tier_member.active_members,
          'monthly_revenue_cents', tier_member.monthly_revenue_cents,
          'average_ltv_cents', tier_member.average_ltv_cents
        )
        order by tier.name
      )
      from public.club_tiers as tier
      cross join lateral (
        select
          count(*)::integer as active_members,
          (
            count(*) * case tier.frequency
              when 'monthly' then tier.price_cents
              when 'bi_monthly' then tier.price_cents / 2.0
              when 'quarterly' then tier.price_cents / 3.0
              when 'semi_annual' then tier.price_cents / 6.0
              when 'annual' then tier.price_cents / 12.0
            end
          )::bigint as monthly_revenue_cents,
          coalesce(round(avg(member_spend.ltv_cents), 2), 0)
            as average_ltv_cents
        from public.members as member
        left join lateral (
          select coalesce(sum(
            shipment.charge_amount_cents - shipment.loyalty_discount_cents
          ), 0)::numeric as ltv_cents
          from public.shipments as shipment
          where shipment.organization_id = member.organization_id
            and shipment.member_id = member.id
            and shipment.paid_at < (p_to + 1)::timestamptz
        ) as member_spend on true
        where member.organization_id = p_organization_id
          and member.club_tier_id = tier.id
          and member.joined_on <= p_to
          and (
            member.cancelled_at is null
            or member.cancelled_at >= (p_to + 1)::timestamptz
          )
          and (
            member.deleted_at is null
            or member.deleted_at >= (p_to + 1)::timestamptz
          )
      ) as tier_member
      where tier.organization_id = p_organization_id
        and tier_member.active_members > 0
    ), '[]'::jsonb),
    'tenure_distribution', coalesce((
      select jsonb_agg(
        jsonb_build_object('bucket', distribution.bucket, 'members', distribution.members)
        order by distribution.bucket_order
      )
      from (
        select
          case
            when p_to - member.joined_on < 90 then '0-3 months'
            when p_to - member.joined_on < 180 then '3-6 months'
            when p_to - member.joined_on < 365 then '6-12 months'
            when p_to - member.joined_on < 730 then '1-2 years'
            else '2+ years'
          end as bucket,
          case
            when p_to - member.joined_on < 90 then 1
            when p_to - member.joined_on < 180 then 2
            when p_to - member.joined_on < 365 then 3
            when p_to - member.joined_on < 730 then 4
            else 5
          end as bucket_order,
          count(*)::integer as members
        from public.members as member
        where member.organization_id = p_organization_id
          and member.joined_on <= p_to
          and (
            member.cancelled_at is null
            or member.cancelled_at >= (p_to + 1)::timestamptz
          )
          and (
            member.deleted_at is null
            or member.deleted_at >= (p_to + 1)::timestamptz
          )
        group by 1, 2
      ) as distribution
    ), '[]'::jsonb),
    'cohort_retention', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'cohort_month', cohort.cohort_month,
          'observation_month', cohort.observation_month,
          'months_since_join', cohort.months_since_join,
          'cohort_size', cohort.cohort_size,
          'retained_members', cohort.retained_members,
          'retention_rate', cohort.retention_rate
        )
        order by cohort.cohort_month, cohort.observation_month
      )
      from public.analytics_cohort_retention as cohort
      where cohort.organization_id = p_organization_id
        and cohort.observation_month between
          date_trunc('month', p_from)::date
          and date_trunc('month', p_to)::date
    ), '[]'::jsonb),
    'decline_reasons', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'reason', reason.decline_reason,
          'attempts', reason.attempts
        )
        order by reason.attempts desc, reason.decline_reason
      )
      from (
        select
          coalesce(nullif(attempt.decline_reason, ''), 'Unknown') as decline_reason,
          count(*)::integer as attempts
        from public.billing_attempts as attempt
        where attempt.organization_id = p_organization_id
          and attempt.status = 'declined'
          and attempt.completed_at >= p_from::timestamptz
          and attempt.completed_at < (p_to + 1)::timestamptz
        group by 1
      ) as reason
    ), '[]'::jsonb)
  )
  into v_result
  from public.analytics_daily_metrics as metric
  where metric.organization_id = p_organization_id
    and metric.metric_date between p_from and p_to;

  return coalesce(v_result, jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'empty', true
  ));
end;
$$;

create or replace function public.get_analytics_dashboard(
  p_organization_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_raw jsonb;
  v_layout jsonb;
begin
  v_raw := private.get_analytics_dashboard_raw(
    p_organization_id,
    p_from,
    p_to
  );

  select preference.layout
  into v_layout
  from public.dashboard_layout_preferences as preference
  where preference.organization_id = p_organization_id
    and preference.staff_user_id = auth.uid();

  return jsonb_build_object(
    'summary', (v_raw -> 'period') || jsonb_build_object(
      'empty', coalesce((v_raw ->> 'empty')::boolean, false),
      'activeMembers', coalesce(v_raw #> '{members,active}', '0'::jsonb),
      'mrrCents', coalesce(v_raw #> '{revenue,mrr_cents}', '0'::jsonb),
      'arrCents', coalesce(v_raw #> '{revenue,arr_cents}', '0'::jsonb),
      'arpmCents', coalesce(v_raw #> '{revenue,arpm_cents}', '0'::jsonb),
      'averageLtvCents',
        coalesce(v_raw #> '{members,average_ltv_cents}', '0'::jsonb),
      'averageShipmentValueCents',
        coalesce(v_raw #> '{shipments,average_value_cents}', '0'::jsonb),
      'revenueChurnCents',
        coalesce(v_raw #> '{revenue,revenue_churn_cents}', '0'::jsonb),
      'declineRate',
        coalesce(v_raw #> '{shipments,decline_rate}', '0'::jsonb),
      'fulfillmentRate',
        coalesce(v_raw #> '{shipments,fulfillment_rate}', '0'::jsonb),
      'shippingCostRatio',
        coalesce(v_raw #> '{shipments,shipping_cost_ratio}', '0'::jsonb),
      'emailOpenRate',
        coalesce(v_raw #> '{engagement,email_open_rate}', '0'::jsonb),
      'emailClickRate',
        coalesce(v_raw #> '{engagement,email_click_rate}', '0'::jsonb),
      'portalLogins',
        coalesce(v_raw #> '{engagement,portal_logins}', '0'::jsonb),
      'loyaltyPointsRedeemed',
        coalesce(
          v_raw #> '{engagement,loyalty_points_redeemed}',
          '0'::jsonb
        ),
      'loyaltyRedemptionRate',
        coalesce(
          v_raw #> '{engagement,loyalty_redemption_rate}',
          '0'::jsonb
        )
    ),
    'revenue', coalesce(v_raw -> 'revenue', '{}'::jsonb)
      || jsonb_build_object(
        'byTier', coalesce(v_raw -> 'tier_distribution', '[]'::jsonb),
        'trend', coalesce(v_raw -> 'series', '[]'::jsonb)
      ),
    'members', coalesce(v_raw -> 'members', '{}'::jsonb)
      || jsonb_build_object(
        'trend', coalesce(v_raw -> 'series', '[]'::jsonb),
        'ltvByTier', coalesce(v_raw -> 'tier_distribution', '[]'::jsonb),
        'tenureDistribution',
          coalesce(v_raw -> 'tenure_distribution', '[]'::jsonb),
        'cohortRetention',
          coalesce(v_raw -> 'cohort_retention', '[]'::jsonb)
      ),
    'shipments', coalesce(v_raw -> 'shipments', '{}'::jsonb)
      || jsonb_build_object(
        'trend', coalesce(v_raw -> 'series', '[]'::jsonb),
        'declineReasons',
          coalesce(v_raw -> 'decline_reasons', '[]'::jsonb)
      ),
    'engagement', coalesce(v_raw -> 'engagement', '{}'::jsonb)
      || jsonb_build_object(
        'trend', coalesce(v_raw -> 'series', '[]'::jsonb)
      ),
    'layout', coalesce(v_layout, '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_analytics_series(
  p_organization_id uuid,
  p_metric text,
  p_from date,
  p_to date
)
returns table (
  metric_date date,
  metric_value numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_read_org_analytics(p_organization_id) then
    raise exception using
      errcode = '42501',
      message = 'Staff authorization is required.';
  end if;
  if p_metric not in (
    'mrr_cents',
    'active_members',
    'new_members',
    'cancelled_members',
    'net_revenue_cents',
    'fulfilled_shipments',
    'declined_attempts',
    'email_open_rate',
    'email_click_rate'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Unsupported analytics export metric.';
  end if;

  return query
  select
    metric.metric_date,
    case p_metric
      when 'mrr_cents' then metric.mrr_cents::numeric
      when 'active_members' then metric.active_members::numeric
      when 'new_members' then metric.new_members::numeric
      when 'cancelled_members' then metric.cancelled_members::numeric
      when 'net_revenue_cents' then metric.net_revenue_cents::numeric
      when 'fulfilled_shipments' then metric.fulfilled_shipments::numeric
      when 'declined_attempts' then metric.declined_attempts::numeric
      when 'email_open_rate' then
        coalesce(metric.email_opens::numeric / nullif(metric.emails_sent, 0), 0)
      when 'email_click_rate' then
        coalesce(metric.email_clicks::numeric / nullif(metric.emails_sent, 0), 0)
    end
  from public.analytics_daily_metrics as metric
  where metric.organization_id = p_organization_id
    and metric.metric_date between p_from and p_to
  order by metric.metric_date;
end;
$$;

create or replace function public.save_dashboard_layout(
  p_organization_id uuid,
  p_staff_user_id uuid,
  p_layout jsonb
)
returns public.dashboard_layout_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_layout public.dashboard_layout_preferences%rowtype;
begin
  if not exists (
    select 1
    from public.staff_users as staff
    where staff.organization_id = p_organization_id
      and staff.id = p_staff_user_id
      and staff.status = 'active'
  )
    or (
      not private.is_service_role()
      and (
        not private.is_staff_for_org(p_organization_id)
        or auth.uid() is distinct from p_staff_user_id
      )
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Staff may update only their own dashboard layout.';
  end if;
  if not private.dashboard_layout_is_valid(p_layout) then
    raise exception using
      errcode = '22023',
      message = 'Dashboard layout is invalid.';
  end if;

  insert into public.dashboard_layout_preferences (
    organization_id,
    staff_user_id,
    layout
  )
  values (p_organization_id, p_staff_user_id, p_layout)
  on conflict on constraint dashboard_layout_preferences_org_staff_key
  do update set layout = excluded.layout
  returning * into v_layout;

  return v_layout;
end;
$$;

create or replace function private.next_analytics_report_at(
  p_frequency public.analytics_report_frequency,
  p_day_of_week smallint,
  p_day_of_month smallint,
  p_send_hour_utc smallint,
  p_after timestamptz
)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_candidate timestamptz;
  v_days integer;
begin
  if p_frequency = 'weekly' then
    v_days := (p_day_of_week - extract(dow from p_after)::integer + 7) % 7;
    v_candidate :=
      date_trunc('day', p_after)
      + make_interval(days => v_days, hours => p_send_hour_utc);
    if v_candidate <= p_after then
      v_candidate := v_candidate + interval '7 days';
    end if;
  elsif p_frequency = 'monthly' then
    v_candidate :=
      date_trunc('month', p_after)
      + make_interval(days => p_day_of_month - 1, hours => p_send_hour_utc);
    if v_candidate <= p_after then
      v_candidate := v_candidate + interval '1 month';
    end if;
  else
    v_candidate :=
      date_trunc('quarter', p_after)
      + make_interval(days => p_day_of_month - 1, hours => p_send_hour_utc);
    if v_candidate <= p_after then
      v_candidate := v_candidate + interval '3 months';
    end if;
  end if;
  return v_candidate;
end;
$$;

create or replace function public.upsert_analytics_report_schedule(
  p_organization_id uuid,
  p_staff_user_id uuid,
  p_frequency public.analytics_report_frequency,
  p_day_of_week smallint,
  p_day_of_month smallint,
  p_send_hour_utc smallint,
  p_widget_ids text[],
  p_enabled boolean,
  p_report_type public.analytics_report_type default 'analytics_summary'
)
returns public.analytics_report_schedules
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule public.analytics_report_schedules%rowtype;
begin
  if not exists (
    select 1
    from public.staff_users as staff
    where staff.organization_id = p_organization_id
      and staff.id = p_staff_user_id
      and staff.status = 'active'
  )
    or (
      not private.is_service_role()
      and (
        not private.is_staff_for_org(p_organization_id)
        or auth.uid() is distinct from p_staff_user_id
      )
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Staff may update only their own report schedule.';
  end if;

  insert into public.analytics_report_schedules (
    organization_id,
    staff_user_id,
    report_type,
    frequency,
    day_of_week,
    day_of_month,
    send_hour_utc,
    widget_ids,
    enabled,
    next_report_at
  )
  values (
    p_organization_id,
    p_staff_user_id,
    p_report_type,
    p_frequency,
    p_day_of_week,
    p_day_of_month,
    p_send_hour_utc,
    p_widget_ids,
    p_enabled,
    private.next_analytics_report_at(
      p_frequency,
      p_day_of_week,
      p_day_of_month,
      p_send_hour_utc,
      now()
    )
  )
  on conflict on constraint analytics_report_schedules_org_staff_type_key
  do update set
    frequency = excluded.frequency,
    day_of_week = excluded.day_of_week,
    day_of_month = excluded.day_of_month,
    send_hour_utc = excluded.send_hour_utc,
    widget_ids = excluded.widget_ids,
    enabled = excluded.enabled,
    next_report_at = excluded.next_report_at
  returning * into v_schedule;

  return v_schedule;
end;
$$;

create or replace function public.save_analytics_dashboard_layout(
  p_organization_id uuid,
  p_staff_user_id uuid,
  p_layout jsonb
)
returns public.dashboard_layout_preferences
language sql
security definer
set search_path = ''
as $$
  select public.save_dashboard_layout(
    p_organization_id,
    p_staff_user_id,
    p_layout
  );
$$;

create or replace function public.get_analytics_dashboard_layout(
  p_organization_id uuid,
  p_staff_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_layout jsonb;
  v_updated_at timestamptz;
begin
  if not private.can_read_org_analytics(p_organization_id)
    or (
      not private.is_service_role()
      and auth.uid() is distinct from p_staff_user_id
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Staff may read only their own dashboard layout.';
  end if;

  select preference.layout, preference.updated_at
  into v_layout, v_updated_at
  from public.dashboard_layout_preferences as preference
  where preference.organization_id = p_organization_id
    and preference.staff_user_id = p_staff_user_id;

  return jsonb_build_object(
    'layout', coalesce(v_layout, '[]'::jsonb),
    'updatedAt', v_updated_at
  );
end;
$$;

create or replace function public.list_analytics_report_schedules(
  p_organization_id uuid,
  p_staff_user_id uuid
)
returns table (
  id uuid,
  report_type public.analytics_report_type,
  frequency public.analytics_report_frequency,
  day_of_week smallint,
  day_of_month smallint,
  send_hour_utc smallint,
  widget_ids text[],
  enabled boolean,
  recipient_email text,
  next_send_at timestamptz,
  last_enqueued_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_read_org_analytics(p_organization_id)
    or (
      not private.is_service_role()
      and auth.uid() is distinct from p_staff_user_id
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Staff may read only their own report schedules.';
  end if;

  return query
  select
    schedule.id,
    schedule.report_type,
    schedule.frequency,
    schedule.day_of_week,
    schedule.day_of_month,
    schedule.send_hour_utc,
    schedule.widget_ids,
    schedule.enabled,
    staff.email,
    schedule.next_report_at,
    schedule.last_enqueued_at
  from public.analytics_report_schedules as schedule
  join public.staff_users as staff
    on staff.organization_id = schedule.organization_id
    and staff.id = schedule.staff_user_id
  where schedule.organization_id = p_organization_id
    and schedule.staff_user_id = p_staff_user_id
  order by schedule.report_type;
end;
$$;

create or replace function private.report_attachments_are_valid(
  p_attachments jsonb
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select
    jsonb_typeof(p_attachments) = 'array'
    and jsonb_array_length(p_attachments) <= 2
    and pg_column_size(p_attachments) <= 14000000
    and not exists (
      select 1
      from jsonb_array_elements(p_attachments) as attachment
      where jsonb_typeof(attachment) <> 'object'
        or coalesce(attachment ->> 'filename', '') !~
          '^[A-Za-z0-9][A-Za-z0-9_. -]{0,119}\.(pdf|csv)$'
        or coalesce(attachment ->> 'content_type', '') not in (
          'application/pdf',
          'text/csv'
        )
        or char_length(coalesce(attachment ->> 'content_base64', ''))
          not between 4 and 12000000
        or coalesce(attachment ->> 'content_base64', '') !~
          '^[A-Za-z0-9+/]*={0,2}$'
    );
$$;

create or replace function public.enqueue_analytics_report_artifact(
  p_organization_id uuid,
  p_schedule_id uuid,
  p_period_start date,
  p_period_end date,
  p_subject text,
  p_html_body text,
  p_text_body text,
  p_attachments jsonb,
  p_idempotency_key text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule public.analytics_report_schedules%rowtype;
  v_recipient_email text;
  v_email_id uuid;
begin
  select schedule.*
  into v_schedule
  from public.analytics_report_schedules as schedule
  join public.staff_users as staff
    on staff.organization_id = schedule.organization_id
    and staff.id = schedule.staff_user_id
    and staff.status = 'active'
  where schedule.id = p_schedule_id
    and schedule.organization_id = p_organization_id
    and schedule.staff_user_id = p_actor_user_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Active analytics report recipient not found.';
  end if;

  select staff.email
  into v_recipient_email
  from public.staff_users as staff
  where staff.organization_id = p_organization_id
    and staff.id = p_actor_user_id
    and staff.status = 'active';
  if p_period_start > p_period_end then
    raise exception using
      errcode = '22023',
      message = 'Analytics report period is invalid.';
  end if;
  if char_length(btrim(p_subject)) not between 1 and 200
    or p_subject ~ E'[\r\n]'
    or char_length(p_html_body) not between 1 and 100000
    or lower(p_html_body) ~ '<[[:space:]]*script'
    or char_length(p_text_body) not between 1 and 100000
  then
    raise exception using
      errcode = '22023',
      message = 'Analytics report content is invalid.';
  end if;
  if not private.report_attachments_are_valid(p_attachments) then
    raise exception using
      errcode = '22023',
      message = 'Analytics report attachments are invalid.';
  end if;

  insert into public.email_log (
    organization_id,
    member_id,
    template_id,
    trigger_type,
    is_test,
    requested_by,
    idempotency_key,
    to_email,
    subject,
    body,
    payload,
    scheduled_for
  )
  select
    p_organization_id,
    null,
    template.id,
    'analytics_report',
    false,
    p_actor_user_id,
    p_idempotency_key,
    v_recipient_email,
    p_subject,
    p_html_body,
    jsonb_build_object(
      'report_type', v_schedule.report_type,
      'period_start', p_period_start,
      'period_end', p_period_end,
      'text_body', p_text_body,
      'widget_ids', v_schedule.widget_ids,
      'dashboard', public.get_analytics_dashboard(
        p_organization_id,
        p_period_start,
        p_period_end
      ),
      'attachments', p_attachments
    ),
    now()
  from public.email_templates as template
  where template.organization_id = p_organization_id
    and template.trigger_type = 'analytics_report'
    and template.enabled
  on conflict on constraint email_log_org_idempotency_key
  do update set idempotency_key = excluded.idempotency_key
  returning id into v_email_id;

  if v_email_id is null then
    raise exception using
      errcode = '23514',
      message = 'Analytics report email template is disabled.';
  end if;

  insert into public.email_outbox (
    organization_id,
    email_log_id,
    available_at
  )
  values (p_organization_id, v_email_id, now())
  on conflict on constraint email_outbox_email_log_key do nothing;

  update public.analytics_report_schedules
  set
    last_enqueued_at = now(),
    next_report_at = private.next_analytics_report_at(
      frequency,
      day_of_week,
      day_of_month,
      send_hour_utc,
      greatest(now(), next_report_at)
    )
  where id = p_schedule_id
    and organization_id = p_organization_id;

  return v_email_id;
end;
$$;

create or replace function public.enqueue_due_analytics_reports(
  p_as_of timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule record;
  v_period_start date;
  v_period_end date := (p_as_of - interval '1 day')::date;
  v_dashboard jsonb;
  v_html_body text;
  v_text_body text;
  v_count integer := 0;
begin
  for v_schedule in
    select
      schedule.*,
      organization.name as organization_name
    from public.analytics_report_schedules as schedule
    join public.organizations as organization
      on organization.id = schedule.organization_id
    where schedule.enabled
      and schedule.report_type = 'analytics_summary'
      and schedule.next_report_at <= p_as_of
    order by schedule.next_report_at, schedule.id
    for update of schedule skip locked
  loop
    v_period_start := case v_schedule.frequency
      when 'weekly' then v_period_end - 6
      when 'monthly' then (date_trunc('month', v_period_end) - interval '1 month')::date
      else (date_trunc('quarter', v_period_end) - interval '3 months')::date
    end;
    v_dashboard := public.get_analytics_dashboard(
      v_schedule.organization_id,
      v_period_start,
      v_period_end
    );
    v_text_body := format(
      'Vinifera analytics summary for %s through %s.',
      v_period_start,
      v_period_end
    );
    v_html_body := format(
      '<p>Vinifera analytics summary for %s through %s.</p><ul>',
      v_period_start,
      v_period_end
    );

    if 'revenue-by-tier' = any(v_schedule.widget_ids) then
      v_text_body := v_text_body || format(
        ' Revenue by tier — MRR: %s cents; ARR: %s cents.',
        coalesce(v_dashboard #>> '{revenue,mrr_cents}', '0'),
        coalesce(v_dashboard #>> '{revenue,arr_cents}', '0')
      );
      v_html_body := v_html_body || format(
        '<li>Revenue by tier — MRR: %s cents; ARR: %s cents</li>',
        coalesce(v_dashboard #>> '{revenue,mrr_cents}', '0'),
        coalesce(v_dashboard #>> '{revenue,arr_cents}', '0')
      );
    end if;
    if 'member-growth' = any(v_schedule.widget_ids) then
      v_text_body := v_text_body || format(
        ' Member growth — active: %s; net growth: %s.',
        coalesce(v_dashboard #>> '{members,active}', '0'),
        coalesce(v_dashboard #>> '{members,net_growth}', '0')
      );
      v_html_body := v_html_body || format(
        '<li>Member growth — active: %s; net growth: %s</li>',
        coalesce(v_dashboard #>> '{members,active}', '0'),
        coalesce(v_dashboard #>> '{members,net_growth}', '0')
      );
    end if;
    if 'member-cohorts' = any(v_schedule.widget_ids) then
      v_text_body := v_text_body || format(
        ' Member cohorts — %s retention observations.',
        jsonb_array_length(coalesce(
          v_dashboard #> '{members,cohortRetention}',
          '[]'::jsonb
        ))
      );
      v_html_body := v_html_body || format(
        '<li>Member cohorts — %s retention observations</li>',
        jsonb_array_length(coalesce(
          v_dashboard #> '{members,cohortRetention}',
          '[]'::jsonb
        ))
      );
    end if;
    if 'ltv-by-tier' = any(v_schedule.widget_ids) then
      v_text_body := v_text_body || format(
        ' LTV by tier — average member LTV: %s cents.',
        coalesce(v_dashboard #>> '{members,average_ltv_cents}', '0')
      );
      v_html_body := v_html_body || format(
        '<li>LTV by tier — average member LTV: %s cents</li>',
        coalesce(v_dashboard #>> '{members,average_ltv_cents}', '0')
      );
    end if;
    if 'shipment-operations' = any(v_schedule.widget_ids) then
      v_text_body := v_text_body || format(
        ' Shipment operations — fulfillment rate: %s; decline rate: %s.',
        coalesce(v_dashboard #>> '{shipments,fulfillment_rate}', '0'),
        coalesce(v_dashboard #>> '{shipments,decline_rate}', '0')
      );
      v_html_body := v_html_body || format(
        '<li>Shipment operations — fulfillment rate: %s; decline rate: %s</li>',
        coalesce(v_dashboard #>> '{shipments,fulfillment_rate}', '0'),
        coalesce(v_dashboard #>> '{shipments,decline_rate}', '0')
      );
    end if;
    if 'engagement' = any(v_schedule.widget_ids) then
      v_text_body := v_text_body || format(
        ' Engagement — email open rate: %s; email click rate: %s.',
        coalesce(v_dashboard #>> '{engagement,email_open_rate}', '0'),
        coalesce(v_dashboard #>> '{engagement,email_click_rate}', '0')
      );
      v_html_body := v_html_body || format(
        '<li>Engagement — email open rate: %s; email click rate: %s</li>',
        coalesce(v_dashboard #>> '{engagement,email_open_rate}', '0'),
        coalesce(v_dashboard #>> '{engagement,email_click_rate}', '0')
      );
    end if;
    if 'acquisition' = any(v_schedule.widget_ids) then
      v_text_body := v_text_body || format(
        ' Acquisition — new members: %s.',
        coalesce(v_dashboard #>> '{members,new}', '0')
      );
      v_html_body := v_html_body || format(
        '<li>Acquisition — new members: %s</li>',
        coalesce(v_dashboard #>> '{members,new}', '0')
      );
    end if;
    v_html_body := v_html_body || '</ul>';

    perform public.enqueue_analytics_report_artifact(
      v_schedule.organization_id,
      v_schedule.id,
      v_period_start,
      v_period_end,
      'Vinifera analytics summary',
      v_html_body,
      v_text_body,
      '[]'::jsonb,
      'report:analytics:' || v_schedule.id::text || ':'
        || v_schedule.next_report_at::text,
      v_schedule.staff_user_id
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.get_due_benchmark_report_recipients(
  p_as_of timestamptz default now()
)
returns table (
  schedule_id uuid,
  organization_id uuid,
  organization_name text,
  staff_user_id uuid,
  recipient_email text,
  period date,
  benchmark_available boolean,
  peer_group jsonb,
  sample_count_band text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    schedule.id,
    schedule.organization_id,
    organization.name,
    schedule.staff_user_id,
    staff.email,
    (
      date_trunc('quarter', p_as_of - interval '1 day')
      - interval '1 month'
    )::date,
    aggregate.id is not null,
    case
      when aggregate.id is null then null
      else jsonb_build_object(
        'region_group', aggregate.region_group,
        'tier_distribution_band', aggregate.tier_distribution_band,
        'member_count_band', aggregate.member_count_band,
        'coarsening_level', aggregate.coarsening_level
      )
    end,
    aggregate.participant_count_band
  from public.analytics_report_schedules as schedule
  join public.organizations as organization
    on organization.id = schedule.organization_id
    and organization.plan_tier in ('estate', 'reserve')
  join public.staff_users as staff
    on staff.organization_id = schedule.organization_id
    and staff.id = schedule.staff_user_id
    and staff.status = 'active'
  left join public.benchmark_contributions as contribution
    on contribution.organization_id = schedule.organization_id
    and contribution.period = (
      date_trunc('quarter', p_as_of - interval '1 day')
      - interval '1 month'
    )::date
    and contribution.opted_in
  left join lateral (
    select candidate.*
    from public.benchmark_aggregates as candidate
    where candidate.period = contribution.period
      and (
        (candidate.coarsening_level = 0
          and candidate.region_group = contribution.region_group
          and candidate.tier_distribution_band = contribution.tier_distribution_band
          and candidate.member_count_band = contribution.member_count_band)
        or (candidate.coarsening_level = 1
          and candidate.region_group = contribution.region_group
          and candidate.tier_distribution_band = contribution.tier_distribution_band
          and candidate.member_count_band = '*')
        or (candidate.coarsening_level = 2
          and candidate.region_group = contribution.region_group
          and candidate.tier_distribution_band = '*'
          and candidate.member_count_band = '*')
        or (candidate.coarsening_level = 3
          and candidate.region_group = '*'
          and candidate.tier_distribution_band = '*'
          and candidate.member_count_band = '*')
      )
    order by candidate.coarsening_level
    limit 1
  ) as aggregate on true
  where schedule.enabled
    and schedule.report_type = 'benchmark'
    and schedule.frequency = 'quarterly'
    and schedule.next_report_at <= p_as_of
  order by schedule.next_report_at, schedule.id;
$$;

create or replace function private.ml_feature_vector(
  p_feature public.ml_feature_snapshots
)
returns jsonb
language sql
immutable
strict
set search_path = ''
as $$
  select jsonb_build_object(
    'days_since_last_shipment', p_feature.days_since_last_shipment,
    'days_since_last_portal_login', p_feature.days_since_last_portal_login,
    'days_since_last_email_open', p_feature.days_since_last_email_open,
    'shipments_per_year', p_feature.shipments_per_year,
    'portal_logins_per_month', p_feature.portal_logins_per_month,
    'email_opens_per_month', p_feature.email_opens_per_month,
    'total_lifetime_spend_cents', p_feature.total_lifetime_spend_cents,
    'average_shipment_value_cents', p_feature.average_shipment_value_cents,
    'email_open_rate', p_feature.email_open_rate,
    'email_click_rate', p_feature.email_click_rate,
    'loyalty_point_balance', p_feature.loyalty_point_balance,
    'tenure_months', p_feature.tenure_months,
    'tier_change_count', p_feature.tier_change_count,
    'decline_count', p_feature.decline_count,
    'decline_recovery_rate', p_feature.decline_recovery_rate,
    'observed_expected_shipment_ratio',
      p_feature.observed_expected_shipment_ratio
  );
$$;

create or replace function private.ml_probability(
  p_coefficients jsonb,
  p_intercept numeric,
  p_hyperparameters jsonb,
  p_features jsonb
)
returns numeric
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_key text;
  v_coefficient numeric;
  v_value numeric;
  v_mean numeric;
  v_scale numeric;
  v_logit numeric := p_intercept;
begin
  for v_key, v_coefficient in
    select coefficient.key, coefficient.value::text::numeric
    from jsonb_each(p_coefficients) as coefficient
  loop
    v_value := coalesce(
      (p_features ->> v_key)::numeric,
      (p_hyperparameters -> 'feature_medians' ->> v_key)::numeric,
      0
    );
    v_mean := coalesce(
      (p_hyperparameters -> 'feature_means' ->> v_key)::numeric,
      0
    );
    v_scale := coalesce(
      nullif((p_hyperparameters -> 'feature_scales' ->> v_key)::numeric, 0),
      1
    );
    v_logit := v_logit + v_coefficient * ((v_value - v_mean) / v_scale);
  end loop;

  v_logit := greatest(-20::numeric, least(20::numeric, v_logit));
  return round((1 / (1 + exp(-v_logit)))::numeric, 6);
end;
$$;

create or replace function private.ml_top_features(
  p_coefficients jsonb,
  p_hyperparameters jsonb,
  p_features jsonb
)
returns jsonb
language sql
immutable
strict
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'feature', ranked.feature,
      'value', ranked.feature_value,
      'contribution', round(ranked.contribution, 6),
      'direction', case
        when ranked.contribution >= 0 then 'increases_risk'
        else 'decreases_risk'
      end
    )
    order by abs(ranked.contribution) desc, ranked.feature
  ), '[]'::jsonb)
  from (
    select
      coefficient.key as feature,
      coalesce(
        (p_features ->> coefficient.key)::numeric,
        (
          p_hyperparameters
            -> 'feature_medians'
            ->> coefficient.key
        )::numeric,
        0
      ) as feature_value,
      coefficient.value::text::numeric
        * (
          (
            coalesce(
              (p_features ->> coefficient.key)::numeric,
              (
                p_hyperparameters
                  -> 'feature_medians'
                  ->> coefficient.key
              )::numeric,
              0
            )
            - coalesce((
              p_hyperparameters
                -> 'feature_means'
                ->> coefficient.key
            )::numeric, 0)
          )
          / coalesce(nullif((
            p_hyperparameters
              -> 'feature_scales'
              ->> coefficient.key
          )::numeric, 0), 1)
        ) as contribution
    from jsonb_each(p_coefficients) as coefficient
    order by abs(
      coefficient.value::text::numeric
        * (
          (
            coalesce(
              (p_features ->> coefficient.key)::numeric,
              (
                p_hyperparameters
                  -> 'feature_medians'
                  ->> coefficient.key
              )::numeric,
              0
            )
            - coalesce((
              p_hyperparameters
                -> 'feature_means'
                ->> coefficient.key
            )::numeric, 0)
          )
          / coalesce(nullif((
            p_hyperparameters
              -> 'feature_scales'
              ->> coefficient.key
          )::numeric, 0), 1)
        )
    ) desc, coefficient.key
    limit 5
  ) as ranked;
$$;

create or replace function public.refresh_ml_feature_store(
  p_snapshot_date date default current_date,
  p_organization_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
  v_snapshot_end timestamptz := (p_snapshot_date + 1)::timestamptz;
begin
  insert into public.ml_feature_snapshots (
    organization_id,
    member_id,
    snapshot_date,
    days_since_last_shipment,
    days_since_last_portal_login,
    days_since_last_email_open,
    shipments_per_year,
    portal_logins_per_month,
    email_opens_per_month,
    total_lifetime_spend_cents,
    average_shipment_value_cents,
    email_open_rate,
    email_click_rate,
    loyalty_point_balance,
    tenure_months,
    tier_change_count,
    decline_count,
    decline_recovery_rate,
    observed_expected_shipment_ratio,
    rules_score
  )
  select
    member.organization_id,
    member.id,
    p_snapshot_date,
    least(
      3650,
      greatest(
        0,
        p_snapshot_date - coalesce(
          shipment_summary.last_shipment_at::date,
          member.joined_on
        )
      )
    ),
    least(
      3650,
      greatest(
        0,
        p_snapshot_date - coalesce(
          activity_summary.last_portal_login_at::date,
          member.joined_on
        )
      )
    ),
    least(
      3650,
      greatest(
        0,
        p_snapshot_date - coalesce(
          email_summary.last_email_open_at::date,
          member.joined_on
        )
      )
    ),
    shipment_summary.shipments_last_year,
    activity_summary.portal_logins_90d / 3.0,
    email_summary.email_opens_90d / 3.0,
    shipment_summary.lifetime_spend_cents,
    shipment_summary.average_shipment_value_cents,
    coalesce(
      email_summary.email_opens_90d::numeric
        / nullif(email_summary.emails_sent_90d, 0),
      0
    ),
    coalesce(
      email_summary.email_clicks_90d::numeric
        / nullif(email_summary.emails_sent_90d, 0),
      0
    ),
    loyalty_summary.available_points,
    greatest(
      0,
      extract(year from age(p_snapshot_date, member.joined_on)) * 12
      + extract(month from age(p_snapshot_date, member.joined_on))
    ),
    member.tier_change_sequence,
    decline_summary.decline_count,
    coalesce(
      decline_summary.recovered_shipments::numeric
        / nullif(decline_summary.declined_shipments, 0),
      0
    ),
    coalesce(
      shipment_summary.shipments_last_year::numeric
        / nullif(case tier.frequency
          when 'monthly' then 12
          when 'bi_monthly' then 6
          when 'quarterly' then 4
          when 'semi_annual' then 2
          when 'annual' then 1
        end, 0),
      0
    ),
    coalesce(rules.score, member.churn_risk_score, 0)
  from public.members as member
  left join public.club_tiers as tier
    on tier.organization_id = member.organization_id
    and tier.id = member.club_tier_id
  left join lateral (
    select
      max(coalesce(shipment.delivered_at, shipment.paid_at))
        filter (
          where coalesce(shipment.delivered_at, shipment.paid_at)
            < v_snapshot_end
        ) as last_shipment_at,
      count(*) filter (
        where shipment.paid_at >= v_snapshot_end - interval '365 days'
          and shipment.paid_at < v_snapshot_end
      )::numeric as shipments_last_year,
      coalesce(sum(
        shipment.charge_amount_cents - shipment.refund_amount_cents
          - shipment.loyalty_discount_cents
      ) filter (
        where shipment.paid_at < v_snapshot_end
      ), 0)::numeric as lifetime_spend_cents,
      coalesce(avg(
        shipment.charge_amount_cents - shipment.loyalty_discount_cents
      ) filter (
        where shipment.paid_at < v_snapshot_end
      ), 0)::numeric as average_shipment_value_cents
    from public.shipments as shipment
    where shipment.organization_id = member.organization_id
      and shipment.member_id = member.id
  ) as shipment_summary on true
  left join lateral (
    select
      max(activity.occurred_at) filter (
        where activity.event_type = 'portal_login'
          and activity.occurred_at < v_snapshot_end
      ) as last_portal_login_at,
      count(*) filter (
        where activity.event_type = 'portal_login'
          and activity.occurred_at >= v_snapshot_end - interval '90 days'
          and activity.occurred_at < v_snapshot_end
      )::numeric as portal_logins_90d
    from public.member_activity_events as activity
    where activity.organization_id = member.organization_id
      and activity.member_id = member.id
  ) as activity_summary on true
  left join lateral (
    select
      max(event.occurred_at) filter (
        where event.event_type = 'opened'
          and event.occurred_at < v_snapshot_end
      ) as last_email_open_at,
      count(*) filter (
        where event.event_type = 'opened'
          and event.occurred_at >= v_snapshot_end - interval '90 days'
          and event.occurred_at < v_snapshot_end
      )::numeric as email_opens_90d,
      count(*) filter (
        where event.event_type = 'clicked'
          and event.occurred_at >= v_snapshot_end - interval '90 days'
          and event.occurred_at < v_snapshot_end
      )::numeric as email_clicks_90d,
      count(distinct email.id) filter (
        where email.sent_at >= v_snapshot_end - interval '90 days'
          and email.sent_at < v_snapshot_end
      )::numeric as emails_sent_90d
    from public.email_log as email
    left join public.email_delivery_events as event
      on event.organization_id = email.organization_id
      and event.email_log_id = email.id
    where email.organization_id = member.organization_id
      and email.member_id = member.id
  ) as email_summary on true
  left join lateral (
    select coalesce(sum(
      lot.remaining_points - lot.reserved_points
    ) filter (
      where lot.expires_at >= v_snapshot_end
    ), 0)::numeric as available_points
    from public.loyalty_point_lots as lot
    where lot.organization_id = member.organization_id
      and lot.member_id = member.id
  ) as loyalty_summary on true
  left join lateral (
    select
      count(*) filter (
        where attempt.status = 'declined'
          and attempt.completed_at >= v_snapshot_end - interval '365 days'
          and attempt.completed_at < v_snapshot_end
      )::numeric as decline_count,
      count(distinct attempt.shipment_id) filter (
        where attempt.status = 'declined'
          and attempt.completed_at < v_snapshot_end
      )::numeric as declined_shipments,
      count(distinct attempt.shipment_id) filter (
        where attempt.status = 'declined'
          and attempt.completed_at < v_snapshot_end
          and exists (
            select 1
            from public.shipments as recovered
            where recovered.id = attempt.shipment_id
              and recovered.organization_id = attempt.organization_id
              and recovered.paid_at < v_snapshot_end
          )
      )::numeric as recovered_shipments
    from public.billing_attempts as attempt
    where attempt.organization_id = member.organization_id
      and exists (
        select 1
        from public.shipments as shipment
        where shipment.id = attempt.shipment_id
          and shipment.organization_id = member.organization_id
          and shipment.member_id = member.id
      )
  ) as decline_summary on true
  left join lateral (
    select score.score
    from public.churn_scores as score
    where score.organization_id = member.organization_id
      and score.member_id = member.id
      and score.score_date <= p_snapshot_date
    order by score.score_date desc
    limit 1
  ) as rules on true
  where (p_organization_id is null or member.organization_id = p_organization_id)
    and member.joined_on <= p_snapshot_date
    and member.deleted_at is null
    and (
      member.cancelled_at is null
      or member.cancelled_at >= v_snapshot_end
    )
  on conflict on constraint ml_feature_snapshots_member_date_key do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.create_ml_training_run(
  p_training_cutoff date,
  p_holdout_start date,
  p_holdout_end date,
  p_source public.ml_training_source,
  p_actor_user_id uuid
)
returns public.ml_training_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.ml_training_runs%rowtype;
  v_member_count integer;
  v_cancellation_count integer;
  v_training_count integer;
  v_holdout_count integer;
  v_evaluable_folds integer;
  v_dataset_hash text;
begin
  if not private.is_ml_training_actor() then
    raise exception using
      errcode = '42501',
      message = 'Platform training authorization is required.';
  end if;
  if p_training_cutoff >= p_holdout_start
    or p_holdout_start > p_holdout_end
    or p_holdout_end > current_date - 90
  then
    raise exception using
      errcode = '22023',
      message = 'Temporal training and holdout windows are invalid.';
  end if;

  insert into public.ml_training_runs (
    source,
    training_cutoff,
    holdout_start,
    holdout_end,
    created_by
  )
  values (
    p_source,
    p_training_cutoff,
    p_holdout_start,
    p_holdout_end,
    p_actor_user_id
  )
  on conflict (
    source,
    training_cutoff,
    holdout_start,
    holdout_end,
    feature_schema_version
  ) do nothing
  returning * into v_run;

  if not found then
    select training.*
    into v_run
    from public.ml_training_runs as training
    where training.source = p_source
      and training.training_cutoff = p_training_cutoff
      and training.holdout_start = p_holdout_start
      and training.holdout_end = p_holdout_end
      and training.feature_schema_version = 'vinifera-churn-v1';
    return v_run;
  end if;

  update public.ml_retraining_signals
  set
    training_run_id = v_run.id,
    consumed_at = now()
  where training_run_id is null
    and created_at >= now() - interval '30 days';

  with eligible_members as (
    select
      member.organization_id,
      member.id as member_id,
      member.joined_on,
      member.cancelled_at,
      training_feature.id as training_feature_id,
      holdout_feature.id as holdout_feature_id
    from public.members as member
    join lateral (
      select feature.id
      from public.ml_feature_snapshots as feature
      where feature.organization_id = member.organization_id
        and feature.member_id = member.id
        and feature.snapshot_date <= p_training_cutoff
        and feature.snapshot_date + 90 <= current_date
      order by feature.snapshot_date desc, feature.id
      limit 1
    ) as training_feature on true
    join lateral (
      select feature.id
      from public.ml_feature_snapshots as feature
      where feature.organization_id = member.organization_id
        and feature.member_id = member.id
        and feature.snapshot_date between p_holdout_start and p_holdout_end
        and feature.snapshot_date + 90 <= current_date
      order by feature.snapshot_date desc, feature.id
      limit 1
    ) as holdout_feature on true
    where member.joined_on <= p_training_cutoff
  ),
  ordered as (
    select
      eligible_members.*,
      row_number() over (
        order by joined_on, member_id
      ) as temporal_ordinal,
      count(*) over () as population_size
    from eligible_members
  ),
  assigned as (
    select
      ordered.*,
      case
        when temporal_ordinal <= floor(population_size * 0.80)
        then 'train'
        else 'holdout'
      end as split,
      case
        when temporal_ordinal <= floor(population_size * 0.80)
        then training_feature_id
        else holdout_feature_id
      end as feature_snapshot_id
    from ordered
  ),
  folded as (
    select
      assigned.*,
      feature.snapshot_date,
      case
        when split = 'train' then (
          ntile(6) over (
            partition by split
            order by assigned.joined_on, feature.snapshot_date, assigned.member_id
          ) - 1
        )::smallint
        else null
      end as fold
    from assigned
    join public.ml_feature_snapshots as feature
      on feature.organization_id = assigned.organization_id
      and feature.id = assigned.feature_snapshot_id
  )
  insert into public.ml_training_rows (
    training_run_id,
    organization_id,
    member_id,
    feature_snapshot_id,
    split,
    fold,
    churned_within_90_days,
    outcome_at
  )
  select
    v_run.id,
    folded.organization_id,
    folded.member_id,
    folded.feature_snapshot_id,
    folded.split,
    folded.fold,
    folded.cancelled_at is not null
      and folded.cancelled_at::date > folded.snapshot_date
      and folded.cancelled_at::date <= folded.snapshot_date + 90
      and folded.cancelled_at::date <= current_date,
    case
      when folded.cancelled_at is not null
        and folded.cancelled_at::date > folded.snapshot_date
        and folded.cancelled_at::date <= folded.snapshot_date + 90
        and folded.cancelled_at::date <= current_date
      then folded.cancelled_at
      else null
    end
  from folded;

  select
    count(distinct training.member_id)::integer,
    count(distinct training.member_id) filter (
      where training.churned_within_90_days
    )::integer,
    count(*) filter (where training.split = 'train')::integer,
    count(*) filter (where training.split = 'holdout')::integer,
    encode(extensions.digest(
      convert_to(coalesce(string_agg(
        training.member_id::text || ':' || training.feature_snapshot_id::text
          || ':' || training.split || ':' || coalesce(training.fold::text, '-')
          || ':' || training.churned_within_90_days::text,
        ',' order by training.member_id
      ), ''), 'UTF8'),
      'sha256'
    ), 'hex')
  into
    v_member_count,
    v_cancellation_count,
    v_training_count,
    v_holdout_count,
    v_dataset_hash
  from public.ml_training_rows as training
  where training.training_run_id = v_run.id;

  select count(*)::integer
  into v_evaluable_folds
  from (
    select training.fold
    from public.ml_training_rows as training
    where training.training_run_id = v_run.id
      and training.split = 'train'
      and training.fold between 1 and 5
    group by training.fold
    having count(*) filter (where training.churned_within_90_days) > 0
      and count(*) filter (where not training.churned_within_90_days) > 0
  ) as evaluable;

  update public.ml_training_runs
  set
    status = case
      when v_member_count >= 500
        and v_cancellation_count >= 50
        and v_holdout_count > 0
        and v_evaluable_folds = 5
        and v_training_count::numeric
          / nullif(v_member_count, 0) between 0.79 and 0.81
      then 'ready'::public.ml_training_status
      else 'insufficient_data'::public.ml_training_status
    end,
    member_count = v_member_count,
    cancellation_count = v_cancellation_count,
    training_row_count = v_training_count,
    holdout_row_count = v_holdout_count,
    actual_training_ratio = v_training_count::numeric
      / nullif(v_member_count, 0),
    dataset_hash = v_dataset_hash,
    completed_at = now()
  where id = v_run.id
  returning * into v_run;

  return v_run;
end;
$$;

create or replace function public.get_ml_training_dataset(
  p_training_run_id uuid
)
returns table (
  row_id uuid,
  member_id uuid,
  observed_at timestamptz,
  split text,
  fold smallint,
  churned_within_90_days boolean,
  rules_probability numeric,
  features jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_ml_training_actor() then
    raise exception using
      errcode = '42501',
      message = 'Platform training authorization is required.';
  end if;

  return query
  select
    training.id,
    training.member_id,
    feature.snapshot_date::timestamptz,
    training.split,
    training.fold,
    training.churned_within_90_days,
    (feature.rules_score / 100.0)::numeric,
    private.ml_feature_vector(feature)
  from public.ml_training_rows as training
  join public.ml_feature_snapshots as feature
    on feature.organization_id = training.organization_id
    and feature.id = training.feature_snapshot_id
  where training.training_run_id = p_training_run_id
  order by training.split, feature.snapshot_date, training.id;
end;
$$;

create or replace function public.register_ml_model_version(
  p_training_run_id uuid,
  p_version text,
  p_algorithm text,
  p_hyperparameters jsonb,
  p_coefficients jsonb,
  p_intercept numeric,
  p_metrics jsonb,
  p_feature_importance jsonb,
  p_artifact_hash text,
  p_high_risk_threshold numeric,
  p_trained_at timestamptz,
  p_actor_user_id uuid
)
returns public.ml_model_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.ml_training_runs%rowtype;
  v_model public.ml_model_versions%rowtype;
  v_feature text;
begin
  if not private.is_ml_training_actor() then
    raise exception using
      errcode = '42501',
      message = 'Platform training authorization is required.';
  end if;

  lock table public.ml_model_versions in share row exclusive mode;

  select model.*
  into v_model
  from public.ml_model_versions as model
  where model.version = p_version
    or model.artifact_hash = p_artifact_hash
  order by model.registered_at
  limit 1;

  if found then
    if v_model.training_run_id = p_training_run_id
      and v_model.version = p_version
      and v_model.artifact_hash = p_artifact_hash
    then
      return v_model;
    end if;
    raise exception using
      errcode = '23505',
      message = 'Model version or artifact already belongs to another registration.';
  end if;

  select training.*
  into v_run
  from public.ml_training_runs as training
  where training.id = p_training_run_id
  for update;

  if not found or v_run.status <> 'ready' then
    raise exception using
      errcode = '23514',
      message = 'A ready training run is required.';
  end if;
  if (
    select count(*)
    from (
      select training.fold
      from public.ml_training_rows as training
      where training.training_run_id = p_training_run_id
        and training.split = 'train'
        and training.fold between 1 and 5
      group by training.fold
      having count(*) filter (where training.churned_within_90_days) > 0
        and count(*) filter (where not training.churned_within_90_days) > 0
    ) as evaluable
  ) <> 5 then
    raise exception using
      errcode = '23514',
      message = 'Exactly five evaluable temporal validation folds are required.';
  end if;
  if not private.ml_metrics_are_complete(p_metrics) then
    raise exception using
      errcode = '22023',
      message = 'Model metrics are incomplete.';
  end if;
  if jsonb_typeof(p_hyperparameters -> 'feature_means') <> 'object'
    or jsonb_typeof(p_hyperparameters -> 'feature_scales') <> 'object'
    or jsonb_typeof(p_hyperparameters -> 'feature_medians') <> 'object'
  then
    raise exception using
      errcode = '22023',
      message = 'Feature means and scales are required.';
  end if;

  for v_feature in
    select key
    from jsonb_each(p_coefficients)
  loop
    if not (p_hyperparameters -> 'feature_means' ? v_feature)
      or not (p_hyperparameters -> 'feature_scales' ? v_feature)
      or not (p_hyperparameters -> 'feature_medians' ? v_feature)
      or (p_hyperparameters -> 'feature_scales' ->> v_feature)::numeric <= 0
    then
      raise exception using
        errcode = '22023',
        message = 'Every coefficient requires a positive feature scale.';
    end if;
  end loop;

  insert into public.ml_model_versions (
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
    high_risk_threshold,
    trained_at,
    registered_by
  )
  values (
    v_run.id,
    p_version,
    p_algorithm,
    p_hyperparameters,
    p_coefficients,
    p_intercept,
    v_run.member_count,
    v_run.cancellation_count,
    p_metrics,
    p_feature_importance,
    p_artifact_hash,
    p_high_risk_threshold,
    p_trained_at,
    p_actor_user_id
  )
  returning * into v_model;

  return v_model;
end;
$$;

create or replace function public.start_ml_experiment(
  p_model_version_id uuid,
  p_actor_user_id uuid
)
returns public.ml_experiments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model public.ml_model_versions%rowtype;
  v_run public.ml_training_runs%rowtype;
  v_experiment public.ml_experiments%rowtype;
begin
  if not private.is_ml_training_actor() then
    raise exception using
      errcode = '42501',
      message = 'Platform training authorization is required.';
  end if;

  select model.*
  into v_model
  from public.ml_model_versions as model
  where model.id = p_model_version_id
  for update of model;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'Model is not eligible for a production A/B test.';
  end if;

  select training.*
  into v_run
  from public.ml_training_runs as training
  where training.id = v_model.training_run_id;

  if v_model.deployment_status <> 'candidate'
    or v_run.source <> 'production_history'
    or v_run.member_count < 500
    or v_run.cancellation_count < 50
    or (v_model.metrics ->> 'auc_roc')::numeric < 0.82
  then
    raise exception using
      errcode = '23514',
      message = 'Model is not eligible for a production A/B test.';
  end if;

  insert into public.ml_experiments (
    model_version_id,
    status,
    started_at,
    planned_end_at,
    created_by
  )
  values (
    v_model.id,
    'running',
    now(),
    now() + interval '30 days',
    p_actor_user_id
  )
  returning * into v_experiment;

  update public.ml_model_versions
  set deployment_status = 'ab_test'
  where id = v_model.id;

  return v_experiment;
end;
$$;

create or replace function public.start_eligible_ml_experiment(
  p_model_version_id uuid,
  p_actor_user_id uuid
)
returns public.ml_experiments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_experiment public.ml_experiments%rowtype;
begin
  if not private.is_ml_training_actor() then
    raise exception using
      errcode = '42501',
      message = 'Platform training authorization is required.';
  end if;
  lock table public.ml_experiments in share row exclusive mode;

  select experiment.*
  into v_experiment
  from public.ml_experiments as experiment
  where experiment.model_version_id = p_model_version_id
    and experiment.status in ('scheduled', 'running')
  order by experiment.created_at desc
  limit 1;
  if found then
    return v_experiment;
  end if;
  if exists (
    select 1
    from public.ml_experiments as experiment
    where experiment.status in ('scheduled', 'running')
  ) then
    return null;
  end if;
  return public.start_ml_experiment(
    p_model_version_id,
    p_actor_user_id
  );
end;
$$;

create or replace function public.complete_ml_experiment(
  p_experiment_id uuid,
  p_ml_auc numeric,
  p_rules_auc numeric,
  p_ml_brier_score numeric,
  p_rules_brier_score numeric,
  p_evaluated_outcomes integer,
  p_actor_user_id uuid
)
returns public.ml_experiments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_experiment public.ml_experiments%rowtype;
begin
  if not private.is_ml_training_actor() then
    raise exception using
      errcode = '42501',
      message = 'Platform training authorization is required.';
  end if;

  select experiment.*
  into v_experiment
  from public.ml_experiments as experiment
  where experiment.id = p_experiment_id
  for update;

  if not found
    or v_experiment.status <> 'running'
    or now() < v_experiment.planned_end_at
    or p_evaluated_outcomes < 50
    or p_ml_auc not between 0 and 1
    or p_rules_auc not between 0 and 1
    or p_ml_brier_score not between 0 and 1
    or p_rules_brier_score not between 0 and 1
  then
    raise exception using
      errcode = '23514',
      message = 'A/B experiment completion gate is not satisfied.';
  end if;

  update public.ml_experiments
  set
    status = 'completed',
    completed_at = now(),
    evaluated_outcomes = p_evaluated_outcomes,
    ml_auc = p_ml_auc,
    rules_auc = p_rules_auc,
    ml_brier_score = p_ml_brier_score,
    rules_brier_score = p_rules_brier_score
  where id = p_experiment_id
  returning * into v_experiment;

  return v_experiment;
end;
$$;

create or replace function public.evaluate_due_ml_experiments(
  p_as_of timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_experiment public.ml_experiments%rowtype;
  v_evaluated integer;
  v_positive integer;
  v_negative integer;
  v_ml_auc numeric;
  v_rules_auc numeric;
  v_ml_brier numeric;
  v_rules_brier numeric;
  v_completed integer := 0;
begin
  if not private.is_ml_training_actor() then
    raise exception using
      errcode = '42501',
      message = 'Platform training authorization is required.';
  end if;
  if p_as_of > now() + interval '5 minutes' then
    raise exception using
      errcode = '22023',
      message = 'Experiment evaluation cannot use future outcomes.';
  end if;

  for v_experiment in
    select experiment.*
    from public.ml_experiments as experiment
    where experiment.status = 'running'
      and experiment.planned_end_at <= p_as_of
      and experiment.started_at <= p_as_of - interval '30 days'
    order by experiment.started_at, experiment.id
    for update skip locked
  loop
    with observations as (
      select distinct on (prediction.member_id)
        prediction.member_id,
        prediction.score::numeric as ml_probability,
        (prediction.rules_score / 100.0)::numeric as rules_probability,
        (
          member.cancelled_at is not null
          and member.cancelled_at >= prediction.prediction_date
          and member.cancelled_at <= prediction.prediction_date + 90
          and member.cancelled_at <= p_as_of
        )::integer as outcome
      from public.ml_churn_predictions as prediction
      join public.members as member
        on member.organization_id = prediction.organization_id
        and member.id = prediction.member_id
      where prediction.experiment_id = v_experiment.id
        and prediction.prediction_date <= p_as_of::date - 90
      order by prediction.member_id, prediction.prediction_date
    )
    select
      count(*)::integer,
      count(*) filter (where outcome = 1)::integer,
      count(*) filter (where outcome = 0)::integer,
      avg(power(ml_probability - outcome, 2)),
      avg(power(rules_probability - outcome, 2))
    into
      v_evaluated,
      v_positive,
      v_negative,
      v_ml_brier,
      v_rules_brier
    from observations;

    if v_evaluated < 50 or v_positive = 0 or v_negative = 0 then
      continue;
    end if;

    with observations as (
      select distinct on (prediction.member_id)
        prediction.member_id,
        prediction.score::numeric as probability,
        (
          member.cancelled_at is not null
          and member.cancelled_at >= prediction.prediction_date
          and member.cancelled_at <= prediction.prediction_date + 90
          and member.cancelled_at <= p_as_of
        )::integer as outcome
      from public.ml_churn_predictions as prediction
      join public.members as member
        on member.organization_id = prediction.organization_id
        and member.id = prediction.member_id
      where prediction.experiment_id = v_experiment.id
        and prediction.prediction_date <= p_as_of::date - 90
      order by prediction.member_id, prediction.prediction_date
    ),
    ranked as (
      select
        outcome,
        rank() over (order by probability)::numeric
          + (count(*) over (partition by probability) - 1)::numeric / 2
          as average_rank
      from observations
    )
    select (
      sum(average_rank) filter (where outcome = 1)
        - v_positive::numeric * (v_positive + 1) / 2
    ) / (v_positive::numeric * v_negative::numeric)
    into v_ml_auc
    from ranked;

    with observations as (
      select distinct on (prediction.member_id)
        prediction.member_id,
        (prediction.rules_score / 100.0)::numeric as probability,
        (
          member.cancelled_at is not null
          and member.cancelled_at >= prediction.prediction_date
          and member.cancelled_at <= prediction.prediction_date + 90
          and member.cancelled_at <= p_as_of
        )::integer as outcome
      from public.ml_churn_predictions as prediction
      join public.members as member
        on member.organization_id = prediction.organization_id
        and member.id = prediction.member_id
      where prediction.experiment_id = v_experiment.id
        and prediction.prediction_date <= p_as_of::date - 90
      order by prediction.member_id, prediction.prediction_date
    ),
    ranked as (
      select
        outcome,
        rank() over (order by probability)::numeric
          + (count(*) over (partition by probability) - 1)::numeric / 2
          as average_rank
      from observations
    )
    select (
      sum(average_rank) filter (where outcome = 1)
        - v_positive::numeric * (v_positive + 1) / 2
    ) / (v_positive::numeric * v_negative::numeric)
    into v_rules_auc
    from ranked;

    perform public.complete_ml_experiment(
      v_experiment.id,
      round(v_ml_auc, 6),
      round(v_rules_auc, 6),
      round(v_ml_brier, 6),
      round(v_rules_brier, 6),
      v_evaluated,
      v_experiment.created_by
    );
    v_completed := v_completed + 1;
  end loop;

  return v_completed;
end;
$$;

create or replace function public.promote_ml_model_version(
  p_model_version_id uuid,
  p_actor_user_id uuid
)
returns public.ml_model_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model public.ml_model_versions%rowtype;
  v_run public.ml_training_runs%rowtype;
  v_experiment public.ml_experiments%rowtype;
  v_drift public.ml_drift_reports%rowtype;
begin
  if not private.is_ml_training_actor() then
    raise exception using
      errcode = '42501',
      message = 'Platform training authorization is required.';
  end if;

  select model.*
  into v_model
  from public.ml_model_versions as model
  where model.id = p_model_version_id
  for update of model;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'Production model promotion gates are not satisfied.';
  end if;

  select training.*
  into v_run
  from public.ml_training_runs as training
  where training.id = v_model.training_run_id;

  select experiment.*
  into v_experiment
  from public.ml_experiments as experiment
  where experiment.model_version_id = p_model_version_id
  order by experiment.created_at desc
  limit 1;

  select drift.*
  into v_drift
  from public.ml_drift_reports as drift
  where drift.model_version_id = p_model_version_id
  order by drift.snapshot_date desc
  limit 1;

  if v_run.source <> 'production_history'
    or v_run.status <> 'ready'
    or v_run.temporal_split is not true
    or v_run.cross_validation_folds <> 5
    or v_run.member_count < 500
    or v_run.cancellation_count < 50
    or (v_model.metrics ->> 'auc_roc')::numeric < 0.82
    or v_experiment.status <> 'completed'
    or v_experiment.completed_at < v_experiment.started_at + interval '30 days'
    or v_experiment.evaluated_outcomes < 50
    or v_experiment.ml_auc <= v_experiment.rules_auc
    or v_experiment.ml_brier_score >= v_experiment.rules_brier_score
    or v_drift.id is null
    or v_drift.retraining_required
    or v_drift.snapshot_date < current_date - 7
  then
    raise exception using
      errcode = '23514',
      message = 'Production model promotion gates are not satisfied.';
  end if;

  update public.ml_model_versions
  set
    deployment_status = 'retired',
    retired_at = now()
  where deployment_status = 'production'
    and id <> p_model_version_id;

  update public.ml_model_versions
  set
    deployment_status = 'production',
    promoted_at = now(),
    retired_at = null
  where id = p_model_version_id
  returning * into v_model;

  return v_model;
end;
$$;

create or replace function public.record_ml_drift_report(
  p_model_version_id uuid,
  p_snapshot_date date,
  p_population_size integer,
  p_population_stability_index numeric,
  p_feature_drift jsonb
)
returns public.ml_drift_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.ml_drift_reports%rowtype;
begin
  if not private.is_ml_training_actor() then
    raise exception using
      errcode = '42501',
      message = 'Platform training authorization is required.';
  end if;

  insert into public.ml_drift_reports (
    model_version_id,
    snapshot_date,
    population_size,
    population_stability_index,
    feature_drift,
    retraining_required
  )
  values (
    p_model_version_id,
    p_snapshot_date,
    p_population_size,
    p_population_stability_index,
    p_feature_drift,
    p_population_stability_index >= 0.20
  )
  on conflict on constraint ml_drift_reports_model_date_key
  do update set
    population_size = excluded.population_size,
    population_stability_index = excluded.population_stability_index,
    feature_drift = excluded.feature_drift,
    retraining_required = excluded.retraining_required,
    recorded_at = now()
  returning * into v_report;

  return v_report;
end;
$$;

create or replace function public.refresh_ml_drift_reports(
  p_snapshot_date date default current_date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model public.ml_model_versions%rowtype;
  v_population integer;
  v_feature_drift jsonb;
  v_population_stability_index numeric;
  v_recorded integer := 0;
begin
  if not private.is_ml_training_actor() then
    raise exception using
      errcode = '42501',
      message = 'Platform training authorization is required.';
  end if;
  if p_snapshot_date > current_date then
    raise exception using
      errcode = '22023',
      message = 'Drift reports cannot use future feature snapshots.';
  end if;

  for v_model in
    select model.*
    from public.ml_model_versions as model
    where model.deployment_status in ('production', 'ab_test')
    order by model.trained_at desc
  loop
    with feature_values as (
      select
        feature.id,
        value.key as feature_name,
        (
          (value.value #>> '{}')::numeric
            - coalesce(
              (v_model.hyperparameters -> 'feature_means'
                ->> value.key)::numeric,
              0
            )
        ) / greatest(
          coalesce(
            (v_model.hyperparameters -> 'feature_scales'
              ->> value.key)::numeric,
            1
          ),
          0.000001
        ) as standardized_value
      from public.ml_feature_snapshots as feature
      cross join lateral jsonb_each(
        private.ml_feature_vector(feature)
      ) as value
      where feature.snapshot_date = p_snapshot_date
    ),
    binned as (
      select
        feature_name,
        case
          when standardized_value < -1 then 1
          when standardized_value < 0 then 2
          when standardized_value < 1 then 3
          else 4
        end as bin,
        count(*)::numeric as observed_count
      from feature_values
      group by feature_name, 2
    ),
    expected as (
      select
        baseline.key as feature_name,
        bin.ordinality::integer as bin,
        bin.value::numeric as expected_share
      from jsonb_each(
        v_model.hyperparameters -> 'feature_baseline_bins'
      ) as baseline
      cross join lateral jsonb_array_elements_text(
        baseline.value
      ) with ordinality as bin(value, ordinality)
    ),
    proportions as (
      select
        expected.feature_name,
        expected.bin,
        expected.expected_share,
        greatest(
          coalesce(binned.observed_count, 0)
            / nullif(sum(coalesce(binned.observed_count, 0))
              over (partition by expected.feature_name), 0),
          0.000001
        ) as observed_share
      from expected
      left join binned
        on binned.feature_name = expected.feature_name
        and binned.bin = expected.bin
    ),
    per_feature as (
      select
        feature_name,
        sum(
          (observed_share - expected_share)
            * ln(observed_share / expected_share)
        ) as psi
      from proportions
      group by feature_name
    )
    select
      (
        select count(distinct feature.id)::integer
        from public.ml_feature_snapshots as feature
        where feature.snapshot_date = p_snapshot_date
      ),
      coalesce(
        jsonb_object_agg(
          feature_name,
          jsonb_build_object(
            'population_stability_index', round(psi, 8),
            'threshold', 0.20,
            'retraining_required', psi >= 0.20
          )
          order by feature_name
        ),
        '{}'::jsonb
      ),
      coalesce(max(psi), 0)
    into
      v_population,
      v_feature_drift,
      v_population_stability_index
    from per_feature;

    if v_population = 0 then
      continue;
    end if;

    perform public.record_ml_drift_report(
      v_model.id,
      p_snapshot_date,
      v_population,
      round(v_population_stability_index, 8),
      v_feature_drift
    );
    v_recorded := v_recorded + 1;
  end loop;

  return v_recorded;
end;
$$;

create or replace function public.run_ml_lifecycle(
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model record;
  v_next_candidate record;
  v_evaluated integer;
  v_drifted integer;
  v_promoted integer := 0;
  v_rejected integer := 0;
  v_started_experiment_id uuid;
  v_retraining_model_count integer := 0;
  v_retraining_model_ids jsonb := '[]'::jsonb;
  v_retraining_triggered boolean := false;
  v_retraining_trigger_count integer := 0;
  v_retraining_trigger_model_ids jsonb := '[]'::jsonb;
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'ML lifecycle orchestration is service-only.';
  end if;

  v_evaluated := public.evaluate_due_ml_experiments(p_as_of);
  v_drifted := public.refresh_ml_drift_reports(p_as_of::date);

  for v_model in
    select
      model.id,
      experiment.created_by,
      (
        training.source = 'production_history'
        and training.status = 'ready'
        and training.member_count >= 500
        and training.cancellation_count >= 50
        and training.temporal_split
        and training.cross_validation_folds = 5
        and (model.metrics ->> 'auc_roc')::numeric >= 0.82
        and experiment.completed_at >=
          experiment.started_at + interval '30 days'
        and experiment.evaluated_outcomes >= 50
        and experiment.ml_auc > experiment.rules_auc
        and experiment.ml_brier_score < experiment.rules_brier_score
        and drift.id is not null
        and not drift.retraining_required
        and drift.snapshot_date >= p_as_of::date - 7
      ) as promotion_eligible
    from public.ml_model_versions as model
    join public.ml_training_runs as training
      on training.id = model.training_run_id
    join public.ml_experiments as experiment
      on experiment.model_version_id = model.id
      and experiment.status = 'completed'
    left join lateral (
      select report.*
      from public.ml_drift_reports as report
      where report.model_version_id = model.id
      order by report.snapshot_date desc
      limit 1
    ) as drift on true
    where model.deployment_status = 'ab_test'
    order by experiment.completed_at, model.id
    for update of model skip locked
  loop
    if v_model.promotion_eligible then
      perform public.promote_ml_model_version(
        v_model.id,
        v_model.created_by
      );
      v_promoted := v_promoted + 1;
    else
      update public.ml_model_versions
      set deployment_status = 'rejected'
      where id = v_model.id;
      v_rejected := v_rejected + 1;
    end if;
  end loop;

  select
    count(*)::integer,
    coalesce(jsonb_agg(model.id order by model.id), '[]'::jsonb)
  into v_retraining_model_count, v_retraining_model_ids
  from public.ml_model_versions as model
  join public.ml_drift_reports as drift
    on drift.model_version_id = model.id
    and drift.snapshot_date = p_as_of::date
    and drift.retraining_required
  where model.deployment_status in ('production', 'ab_test');

  with inserted as (
    insert into public.ml_retraining_signals (
      model_version_id,
      first_breach_date,
      population_stability_index
    )
    select
      model.id,
      drift.snapshot_date,
      drift.population_stability_index
    from public.ml_model_versions as model
    join public.ml_drift_reports as drift
      on drift.model_version_id = model.id
      and drift.snapshot_date = p_as_of::date
      and drift.retraining_required
    where model.deployment_status in ('production', 'ab_test')
      and not exists (
        select 1
        from public.ml_retraining_signals as prior
        where prior.model_version_id = model.id
          and prior.created_at >= p_as_of - interval '30 days'
      )
    on conflict on constraint ml_retraining_signals_model_breach_key
    do nothing
    returning model_version_id
  )
  select
    count(*)::integer,
    coalesce(
      jsonb_agg(model_version_id order by model_version_id),
      '[]'::jsonb
    )
  into v_retraining_trigger_count, v_retraining_trigger_model_ids
  from inserted;

  v_retraining_triggered := v_retraining_trigger_count > 0;

  if not exists (
    select 1
    from public.ml_experiments as experiment
    where experiment.status in ('scheduled', 'running')
  ) then
    select
      model.id,
      model.registered_by
    into v_next_candidate
    from public.ml_model_versions as model
    join public.ml_training_runs as training
      on training.id = model.training_run_id
    where model.deployment_status = 'candidate'
      and training.source = 'production_history'
      and training.status = 'ready'
      and training.member_count >= 500
      and training.cancellation_count >= 50
      and (model.metrics ->> 'auc_roc')::numeric >= 0.82
      and not exists (
        select 1
        from public.ml_experiments as prior
        where prior.model_version_id = model.id
      )
    order by
      (model.metrics ->> 'auc_roc')::numeric desc,
      model.trained_at desc,
      model.id
    for update of model skip locked
    limit 1;

    if found then
      select (public.start_ml_experiment(
        v_next_candidate.id,
        v_next_candidate.registered_by
      )).id
      into v_started_experiment_id;
    end if;
  end if;

  return jsonb_build_object(
    'evaluated', v_evaluated,
    'driftReports', v_drifted,
    'promoted', v_promoted,
    'rejected', v_rejected,
    'startedExperimentId', v_started_experiment_id,
    'retrainingRequired', v_retraining_model_count > 0,
    'retrainingTriggered', v_retraining_triggered,
    'retrainingTriggerCount', v_retraining_trigger_count,
    'retrainingTriggerModelIds', v_retraining_trigger_model_ids,
    'retrainingModelCount', v_retraining_model_count,
    'retrainingModelIds', v_retraining_model_ids
  );
end;
$$;

create or replace function public.score_ml_churn_batch(
  p_prediction_date date default current_date,
  p_organization_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model public.ml_model_versions%rowtype;
  v_experiment_id uuid;
  v_inserted integer;
begin
  select model.*
  into v_model
  from public.ml_model_versions as model
  where model.deployment_status = 'production'
    or (
      model.deployment_status = 'ab_test'
      and exists (
        select 1
        from public.ml_experiments as active_experiment
        where active_experiment.model_version_id = model.id
          and active_experiment.status = 'running'
      )
    )
  order by
    case model.deployment_status
      when 'production' then 0
      else 1
    end,
    model.trained_at desc
  limit 1;

  if not found then
    return 0;
  end if;

  select experiment.id
  into v_experiment_id
  from public.ml_experiments as experiment
  where experiment.model_version_id = v_model.id
    and experiment.status = 'running'
  order by experiment.created_at desc
  limit 1;

  with features as (
    select
      feature.*,
      private.ml_feature_vector(feature) as feature_vector
    from public.ml_feature_snapshots as feature
    join public.members as member
      on member.organization_id = feature.organization_id
      and member.id = feature.member_id
      and member.status = 'active'
      and member.deleted_at is null
    where feature.snapshot_date = p_prediction_date
      and (
        p_organization_id is null
        or feature.organization_id = p_organization_id
      )
  ),
  scored as (
    select
      feature.*,
      private.ml_probability(
        v_model.coefficients,
        v_model.intercept,
        v_model.hyperparameters,
        feature.feature_vector
      ) as probability
    from features as feature
  )
  insert into public.ml_churn_predictions (
    organization_id,
    member_id,
    feature_snapshot_id,
    model_version_id,
    experiment_id,
    experiment_arm,
    score,
    rules_score,
    confidence_interval_low,
    confidence_interval_high,
    top_features,
    predicted_at,
    prediction_date
  )
  select
    scored.organization_id,
    scored.member_id,
    scored.id,
    v_model.id,
    v_experiment_id,
    case
      when v_model.deployment_status = 'production' then 'ml'
      when mod(hashtext(scored.member_id::text)::bigint, 2) = 0 then 'ml'
      else 'rules'
    end::public.ml_prediction_source,
    scored.probability,
    scored.rules_score,
    greatest(
      0,
      scored.probability
        - sqrt((v_model.metrics ->> 'brier_score')::numeric)
    ),
    least(
      1,
      scored.probability
        + sqrt((v_model.metrics ->> 'brier_score')::numeric)
    ),
    private.ml_top_features(
      v_model.coefficients,
      v_model.hyperparameters,
      scored.feature_vector
    ),
    now(),
    p_prediction_date
  from scored
  on conflict on constraint ml_churn_predictions_member_model_date_key
  do nothing;

  get diagnostics v_inserted = row_count;

  insert into public.ml_high_risk_alerts (
    organization_id,
    member_id,
    prediction_id,
    score,
    threshold
  )
  select
    prediction.organization_id,
    prediction.member_id,
    prediction.id,
    prediction.score,
    v_model.high_risk_threshold
  from public.ml_churn_predictions as prediction
  where prediction.model_version_id = v_model.id
    and prediction.prediction_date = p_prediction_date
    and prediction.score >= v_model.high_risk_threshold
    and (
      p_organization_id is null
      or prediction.organization_id = p_organization_id
    )
    and not exists (
      select 1
      from public.ml_churn_predictions as previous
      where previous.organization_id = prediction.organization_id
        and previous.member_id = prediction.member_id
        and previous.model_version_id = prediction.model_version_id
        and previous.prediction_date < prediction.prediction_date
        and previous.score >= v_model.high_risk_threshold
    )
  on conflict on constraint ml_high_risk_alerts_org_prediction_key do nothing;

  if v_model.deployment_status = 'production' then
    update public.members as member
    set churn_risk_score = round(prediction.score * 100, 2)
    from public.ml_churn_predictions as prediction
    where prediction.organization_id = member.organization_id
      and prediction.member_id = member.id
      and prediction.model_version_id = v_model.id
      and prediction.prediction_date = p_prediction_date
      and (
        p_organization_id is null
        or member.organization_id = p_organization_id
      );
  end if;

  return v_inserted;
end;
$$;

create or replace function public.list_churn_intelligence(
  p_organization_id uuid,
  p_risk_level text default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  member_id uuid,
  member_name text,
  member_email text,
  tier_name text,
  rules_score numeric,
  ml_probability numeric,
  ml_score numeric,
  effective_score numeric,
  effective_source public.ml_prediction_source,
  risk_level public.churn_risk_level,
  confidence_interval_low numeric,
  confidence_interval_high numeric,
  top_features jsonb,
  predicted_at timestamptz,
  alert_id uuid,
  alert_created_at timestamptz,
  alert_acknowledged_at timestamptz,
  alert_acknowledged_by_name text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_read_org_analytics(p_organization_id) then
    raise exception using
      errcode = '42501',
      message = 'Staff authorization is required.';
  end if;
  if p_risk_level is not null
    and p_risk_level not in ('low', 'medium', 'high')
  then
    raise exception using
      errcode = '22023',
      message = 'Unsupported churn risk level.';
  end if;
  if p_limit not between 1 and 200 or p_offset < 0 then
    raise exception using
      errcode = '22023',
      message = 'Churn pagination is invalid.';
  end if;
  if p_search is not null and char_length(p_search) > 120 then
    raise exception using
      errcode = '22023',
      message = 'Churn search is too long.';
  end if;

  return query
  with intelligence as (
    select
      member.id as member_id,
      btrim(member.first_name || ' ' || member.last_name) as member_name,
      member.email as member_email,
      tier.name as tier_name,
      coalesce(rule.score, member.churn_risk_score, 0)::numeric as rules_score,
      prediction.score::numeric as ml_probability,
      round(prediction.score * 100, 2)::numeric as ml_score,
      case
        when model.deployment_status = 'production'
        then round(prediction.score * 100, 2)::numeric
        else coalesce(rule.score, member.churn_risk_score, 0)::numeric
      end as effective_score,
      case
        when model.deployment_status = 'production'
        then 'ml'::public.ml_prediction_source
        else 'rules'::public.ml_prediction_source
      end as effective_source,
      prediction.confidence_interval_low,
      prediction.confidence_interval_high,
      prediction.top_features,
      prediction.predicted_at,
      alert.id as alert_id,
      alert.created_at as alert_created_at,
      alert.acknowledged_at as alert_acknowledged_at,
      case
        when alert.acknowledged_by is null then null
        else acknowledger.email
      end as alert_acknowledged_by_name
    from public.members as member
    left join public.club_tiers as tier
      on tier.organization_id = member.organization_id
      and tier.id = member.club_tier_id
    left join lateral (
      select score.*
      from public.churn_scores as score
      where score.organization_id = member.organization_id
        and score.member_id = member.id
      order by score.score_date desc
      limit 1
    ) as rule on true
    left join lateral (
      select candidate.*
      from public.ml_churn_predictions as candidate
      where candidate.organization_id = member.organization_id
        and candidate.member_id = member.id
      order by candidate.prediction_date desc, candidate.predicted_at desc
      limit 1
    ) as prediction on true
    left join public.ml_model_versions as model
      on model.id = prediction.model_version_id
    left join public.ml_high_risk_alerts as alert
      on alert.organization_id = member.organization_id
      and alert.prediction_id = prediction.id
    left join public.staff_users as acknowledger
      on acknowledger.organization_id = alert.organization_id
      and acknowledger.id = alert.acknowledged_by
    where member.organization_id = p_organization_id
      and member.status = 'active'
      and member.deleted_at is null
      and (
        p_search is null
        or position(
          lower(btrim(p_search))
          in lower(
            member.first_name || ' ' || member.last_name || ' ' || member.email
          )
        ) > 0
      )
  ),
  classified as (
    select
      intelligence.*,
      case
        when intelligence.effective_score <= 30 then 'low'
        when intelligence.effective_score <= 60 then 'medium'
        else 'high'
      end::public.churn_risk_level as risk_level
    from intelligence
  )
  select
    classified.member_id,
    classified.member_name,
    classified.member_email,
    classified.tier_name,
    classified.rules_score,
    classified.ml_probability,
    classified.ml_score,
    classified.effective_score,
    classified.effective_source,
    classified.risk_level,
    classified.confidence_interval_low,
    classified.confidence_interval_high,
    coalesce(classified.top_features, '[]'::jsonb),
    classified.predicted_at,
    classified.alert_id,
    classified.alert_created_at,
    classified.alert_acknowledged_at,
    classified.alert_acknowledged_by_name,
    count(*) over()
  from classified
  where p_risk_level is null
    or classified.risk_level::text = p_risk_level
  order by classified.effective_score desc, classified.member_name
  limit p_limit
  offset p_offset;
end;
$$;

create or replace function public.get_member_churn_intelligence(
  p_organization_id uuid,
  p_member_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_member_email text;
begin
  if not private.can_read_org_analytics(p_organization_id) then
    raise exception using
      errcode = '42501',
      message = 'Staff authorization is required.';
  end if;

  select member.email
  into v_member_email
  from public.members as member
  where member.organization_id = p_organization_id
    and member.id = p_member_id
    and member.status = 'active'
    and member.deleted_at is null;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Active member churn intelligence not found.';
  end if;

  select intelligence.*
  into v_row
  from public.list_churn_intelligence(
    p_organization_id,
    null,
    v_member_email,
    200,
    0
  ) as intelligence
  where intelligence.member_id = p_member_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Active member churn intelligence not found.';
  end if;

  return jsonb_build_object(
    'memberId', v_row.member_id,
    'memberName', v_row.member_name,
    'tierName', v_row.tier_name,
    'rulesScore', v_row.rules_score,
    'mlProbability', v_row.ml_probability,
    'mlScore', v_row.ml_score,
    'effectiveScore', v_row.effective_score,
    'effectiveSource', v_row.effective_source,
    'riskLevel', v_row.risk_level,
    'confidenceInterval', case
      when v_row.ml_probability is null then null
      else jsonb_build_object(
        'low', v_row.confidence_interval_low,
        'high', v_row.confidence_interval_high
      )
    end,
    'topFeatures', v_row.top_features,
    'predictedAt', v_row.predicted_at,
    'alertId', v_row.alert_id,
    'alertCreatedAt', v_row.alert_created_at,
    'alertAcknowledgedAt', v_row.alert_acknowledged_at,
    'alertAcknowledgedByName', v_row.alert_acknowledged_by_name,
    'fallbackActive', v_row.effective_source = 'rules'
  );
end;
$$;

create or replace function public.get_ml_operations_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_service_role()
    and not private.is_super_admin()
    and coalesce(private.auth_surface()::text, '') <> 'staff'
  then
    raise exception using
      errcode = '42501',
      message = 'Staff authorization is required.';
  end if;

  return jsonb_build_object(
    'productionModel', (
      select jsonb_build_object(
        'id', model.id,
        'version', model.version,
        'algorithm', model.algorithm,
        'deploymentStatus', model.deployment_status,
        'trainingSource', training.source,
        'memberCount', training.member_count,
        'trainingDataSize', model.training_data_size,
        'cancellationCount', model.cancellation_count,
        'metrics', model.metrics,
        'trainedAt', model.trained_at,
        'promotedAt', model.promoted_at
      )
      from public.ml_model_versions as model
      join public.ml_training_runs as training
        on training.id = model.training_run_id
      where model.deployment_status = 'production'
      limit 1
    ),
    'abTestModel', (
      select jsonb_build_object(
        'id', model.id,
        'version', model.version,
        'algorithm', model.algorithm,
        'deploymentStatus', model.deployment_status,
        'trainingSource', training.source,
        'memberCount', training.member_count,
        'trainingDataSize', model.training_data_size,
        'cancellationCount', model.cancellation_count,
        'metrics', model.metrics,
        'trainedAt', model.trained_at
      )
      from public.ml_model_versions as model
      join public.ml_training_runs as training
        on training.id = model.training_run_id
      where model.deployment_status = 'ab_test'
      limit 1
    ),
    'experiment', (
      select jsonb_build_object(
        'id', experiment.id,
        'modelVersionId', experiment.model_version_id,
        'status', experiment.status,
        'startedAt', experiment.started_at,
        'plannedEndAt', experiment.planned_end_at,
        'completedAt', experiment.completed_at,
        'evaluatedOutcomes', experiment.evaluated_outcomes,
        'mlAuc', experiment.ml_auc,
        'rulesAuc', experiment.rules_auc,
        'minimumDurationMet', experiment.completed_at is not null
          and experiment.completed_at >= experiment.started_at + interval '30 days',
        'mlSuperior', experiment.ml_auc is not null
          and experiment.rules_auc is not null
          and experiment.ml_auc > experiment.rules_auc
          and experiment.ml_brier_score < experiment.rules_brier_score
      )
      from public.ml_experiments as experiment
      order by experiment.created_at desc
      limit 1
    ),
    'latestDrift', (
      select jsonb_build_object(
        'modelVersionId', drift.model_version_id,
        'snapshotDate', drift.snapshot_date,
        'populationSize', drift.population_size,
        'populationStabilityIndex', drift.population_stability_index,
        'retrainingRequired', drift.retraining_required,
        'status', case
          when drift.retraining_required then 'degraded'
          else 'stable'
        end
      )
      from public.ml_drift_reports as drift
      order by drift.snapshot_date desc
      limit 1
    ),
    'fallback', not exists (
      select 1
      from public.ml_model_versions as model
      where model.deployment_status = 'production'
    )
  );
end;
$$;

create or replace function public.acknowledge_ml_high_risk_alert(
  p_organization_id uuid,
  p_alert_id uuid,
  p_actor_user_id uuid
)
returns public.ml_high_risk_alerts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert public.ml_high_risk_alerts%rowtype;
begin
  if not exists (
    select 1 from public.staff_users as staff
    where staff.organization_id = p_organization_id
      and staff.id = p_actor_user_id
      and staff.status = 'active'
  )
    or (
      not private.is_service_role()
      and (
        not private.is_staff_for_org(p_organization_id)
        or auth.uid() is distinct from p_actor_user_id
      )
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Staff authorization is required.';
  end if;

  select alert.*
  into v_alert
  from public.ml_high_risk_alerts as alert
  where alert.id = p_alert_id
    and alert.organization_id = p_organization_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'High-risk alert not found.';
  end if;
  if v_alert.acknowledged_at is not null then
    return v_alert;
  end if;

  update public.ml_high_risk_alerts
  set
    acknowledged_by = p_actor_user_id,
    acknowledged_at = now()
  where id = p_alert_id
    and organization_id = p_organization_id
  returning * into v_alert;

  perform public.append_audit_entry(
    p_organization_id,
    p_actor_user_id,
    'churn.alert_acknowledged',
    'member',
    v_alert.member_id,
    jsonb_build_object(
      'alert_id', v_alert.id,
      'prediction_id', v_alert.prediction_id,
      'score', v_alert.score
    )
  );
  perform public.record_analytics_event(
    p_organization_id,
    v_alert.member_id,
    'churn.alert_acknowledged',
    jsonb_build_object(
      'alert_id', v_alert.id,
      'score', v_alert.score
    ),
    'workflow:churn.alert_acknowledged:' || v_alert.id::text,
    now()
  );
  return v_alert;
end;
$$;

create or replace function public.set_benchmark_preferences(
  p_organization_id uuid,
  p_opted_in boolean,
  p_quarterly_report_enabled boolean,
  p_actor_user_id uuid
)
returns public.benchmark_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preference public.benchmark_preferences%rowtype;
  v_origin_state text;
  v_region_group text;
begin
  if not exists (
    select 1
    from public.staff_users as staff
    join public.organizations as organization
      on organization.id = staff.organization_id
      and organization.plan_tier in ('estate', 'reserve')
    where staff.organization_id = p_organization_id
      and staff.id = p_actor_user_id
      and staff.status = 'active'
      and staff.role in ('owner', 'admin')
  )
    or (
      not private.is_service_role()
      and (
        not private.is_staff_for_org(
          p_organization_id,
          array['owner', 'admin']::public.staff_role[]
        )
        or auth.uid() is distinct from p_actor_user_id
      )
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Estate or Reserve owner authorization is required.';
  end if;
  if p_quarterly_report_enabled and not p_opted_in then
    raise exception using
      errcode = '22023',
      message = 'Quarterly benchmark reports require benchmark opt-in.';
  end if;

  select upper(organization.shipping_origin_address ->> 'state')
  into v_origin_state
  from public.organizations as organization
  where organization.id = p_organization_id;

  if p_opted_in and (
    v_origin_state is null
    or v_origin_state !~ '^[A-Z]{2}$'
  ) then
    raise exception using
      errcode = '22023',
      message = 'A configured two-letter shipping-origin state is required for benchmark opt-in.';
  end if;

  v_region_group := case
    when v_origin_state in ('WA', 'OR', 'CA', 'AK', 'HI') then 'west'
    when v_origin_state in ('AZ', 'NM', 'NV', 'UT', 'CO') then 'southwest'
    when v_origin_state in (
      'ND', 'SD', 'NE', 'KS', 'MN', 'IA', 'MO', 'WI', 'IL', 'IN', 'MI', 'OH'
    ) then 'midwest'
    when v_origin_state in (
      'TX', 'OK', 'AR', 'LA', 'MS', 'AL', 'TN', 'KY', 'WV', 'VA', 'NC', 'SC',
      'GA', 'FL', 'MD', 'DE', 'DC'
    ) then 'south'
    when v_origin_state in (
      'PA', 'NJ', 'NY', 'CT', 'RI', 'MA', 'VT', 'NH', 'ME'
    ) then 'northeast'
    else 'other'
  end;

  insert into public.benchmark_preferences (
    organization_id,
    opted_in,
    region_group,
    quarterly_report_enabled,
    opted_in_at,
    opted_out_at,
    updated_by
  )
  values (
    p_organization_id,
    p_opted_in,
    case when p_opted_in then v_region_group else null end,
    p_quarterly_report_enabled,
    case when p_opted_in then now() else null end,
    case when p_opted_in then null else now() end,
    p_actor_user_id
  )
  on conflict (organization_id)
  do update set
    opted_in = excluded.opted_in,
    region_group = excluded.region_group,
    quarterly_report_enabled = excluded.quarterly_report_enabled,
    opted_in_at = excluded.opted_in_at,
    opted_out_at = excluded.opted_out_at,
    updated_by = excluded.updated_by
  returning * into v_preference;

  if not p_opted_in then
    update public.benchmark_contributions
    set opted_in = false
    where organization_id = p_organization_id
      and period >= date_trunc('month', current_date)::date;
  end if;

  if p_quarterly_report_enabled then
    insert into public.analytics_report_schedules (
      organization_id,
      staff_user_id,
      report_type,
      frequency,
      day_of_week,
      day_of_month,
      send_hour_utc,
      widget_ids,
      enabled,
      next_report_at
    )
    values (
      p_organization_id,
      p_actor_user_id,
      'benchmark',
      'quarterly',
      null,
      1,
      8,
      array[
        'revenue-by-tier',
        'member-growth',
        'member-cohorts',
        'ltv-by-tier',
        'shipment-operations',
        'engagement',
        'acquisition'
      ]::text[],
      true,
      private.next_analytics_report_at(
        'quarterly',
        null,
        1,
        8,
        now()
      )
    )
    on conflict on constraint analytics_report_schedules_org_staff_type_key
    do update set
      frequency = 'quarterly',
      day_of_week = null,
      day_of_month = 1,
      send_hour_utc = 8,
      enabled = true,
      next_report_at = excluded.next_report_at;
  else
    update public.analytics_report_schedules
    set enabled = false
    where organization_id = p_organization_id
      and staff_user_id = p_actor_user_id
      and report_type = 'benchmark';
  end if;

  perform public.append_audit_entry(
    p_organization_id,
    p_actor_user_id,
    case when p_opted_in
      then 'benchmark.opted_in'
      else 'benchmark.opted_out'
    end,
    'benchmark_preference',
    v_preference.id,
    jsonb_build_object(
      'opted_in', p_opted_in,
      'region_group', v_preference.region_group,
      'quarterly_report_enabled', p_quarterly_report_enabled
    )
  );

  return v_preference;
end;
$$;

create or replace function public.set_benchmark_opt_in(
  p_organization_id uuid,
  p_opted_in boolean,
  p_quarterly_report_enabled boolean,
  p_actor_user_id uuid
)
returns public.benchmark_preferences
language sql
security definer
set search_path = ''
as $$
  select public.set_benchmark_preferences(
    p_organization_id,
    p_opted_in,
    p_quarterly_report_enabled,
    p_actor_user_id
  );
$$;

create or replace function public.refresh_benchmark_contributions(
  p_period date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period date := date_trunc('month', p_period)::date;
  v_inserted integer;
begin
  insert into public.benchmark_contributions (
    organization_id,
    period,
    region_group,
    tier_distribution_band,
    member_count_band,
    metrics,
    opted_in
  )
  select
    preference.organization_id,
    v_period,
    preference.region_group,
    coalesce(tier_mix.tier_distribution_band, 'balanced'),
    case
      when latest.active_members < 250 then 'under_250'
      when latest.active_members < 500 then '250_499'
      when latest.active_members < 1000 then '500_999'
      when latest.active_members < 2500 then '1000_2499'
      else '2500_plus'
    end,
    jsonb_build_object(
      'retention_rate', coalesce(
        latest.active_members::numeric
          / nullif(
            latest.active_members
              + period_metrics.cancelled_members,
            0
          ),
        0
      ),
      'average_shipment_value_cents', coalesce(
        period_metrics.shipment_value_cents::numeric
          / nullif(period_metrics.fulfilled_shipments, 0),
        0
      ),
      'decline_rate', coalesce(
        period_metrics.declined_attempts::numeric
          / nullif(period_metrics.attempted_shipments, 0),
        0
      ),
      'mrr_growth_rate', coalesce(
        (latest.mrr_cents - previous.mrr_cents)::numeric
          / nullif(previous.mrr_cents, 0),
        0
      ),
      'email_engagement_rate', coalesce(
        period_metrics.email_opens::numeric
          / nullif(period_metrics.emails_sent, 0),
        0
      )
    ),
    true
  from public.benchmark_preferences as preference
  join public.organizations as organization
    on organization.id = preference.organization_id
    and organization.plan_tier in ('estate', 'reserve')
  join lateral (
    select metric.*
    from public.analytics_daily_metrics as metric
    where metric.organization_id = preference.organization_id
      and metric.metric_date >= v_period
      and metric.metric_date < v_period + interval '1 month'
    order by metric.metric_date desc
    limit 1
  ) as latest on true
  left join lateral (
    select metric.*
    from public.analytics_daily_metrics as metric
    where metric.organization_id = preference.organization_id
      and metric.metric_date < v_period
    order by metric.metric_date desc
    limit 1
  ) as previous on true
  cross join lateral (
    select
      coalesce(sum(metric.cancelled_members), 0)::integer as cancelled_members,
      coalesce(sum(metric.shipment_value_cents), 0)::bigint
        as shipment_value_cents,
      coalesce(sum(metric.fulfilled_shipments), 0)::integer
        as fulfilled_shipments,
      coalesce(sum(metric.declined_attempts), 0)::integer
        as declined_attempts,
      coalesce(sum(metric.attempted_shipments), 0)::integer
        as attempted_shipments,
      coalesce(sum(metric.email_opens), 0)::integer as email_opens,
      coalesce(sum(metric.emails_sent), 0)::integer as emails_sent
    from public.analytics_daily_metrics as metric
    where metric.organization_id = preference.organization_id
      and metric.metric_date >= v_period
      and metric.metric_date < v_period + interval '1 month'
  ) as period_metrics
  left join lateral (
    select case max(mix.member_count) filter (
      where mix.tier_name = max_mix.tier_name
    )
      when null then 'balanced'
      else case lower(max_mix.tier_name)
        when 'vine' then 'vine_heavy'
        when 'cellar' then 'cellar_heavy'
        when 'estate' then 'estate_heavy'
        when 'reserve' then 'reserve_heavy'
        else 'balanced'
      end
    end as tier_distribution_band
    from (
      select tier.name as tier_name, count(*)::integer as member_count
      from public.members as member
      join public.club_tiers as tier
        on tier.organization_id = member.organization_id
        and tier.id = member.club_tier_id
      where member.organization_id = preference.organization_id
        and member.status = 'active'
        and member.deleted_at is null
      group by tier.name
    ) as mix
    left join lateral (
      select mix_inner.tier_name
      from (
        select tier.name as tier_name, count(*)::integer as member_count
        from public.members as member
        join public.club_tiers as tier
          on tier.organization_id = member.organization_id
          and tier.id = member.club_tier_id
        where member.organization_id = preference.organization_id
          and member.status = 'active'
          and member.deleted_at is null
        group by tier.name
      ) as mix_inner
      order by mix_inner.member_count desc, mix_inner.tier_name
      limit 1
    ) as max_mix on true
    group by max_mix.tier_name
  ) as tier_mix on true
  where preference.opted_in
    and preference.region_group is not null
  on conflict on constraint benchmark_contributions_org_period_key
  do update set
    region_group = excluded.region_group,
    tier_distribution_band = excluded.tier_distribution_band,
    member_count_band = excluded.member_count_band,
    metrics = excluded.metrics,
    opted_in = excluded.opted_in,
    created_at = now();

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.refresh_benchmark_aggregates(
  p_period date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period date := date_trunc('month', p_period)::date;
  v_inserted integer;
begin
  perform public.refresh_benchmark_contributions(v_period);

  delete from public.benchmark_aggregates
  where period = v_period;

  with groups as (
    select
      contribution.period,
      grouping(contribution.region_group)::smallint
        + grouping(contribution.tier_distribution_band)::smallint
        + grouping(contribution.member_count_band)::smallint
          as coarsening_level,
      coalesce(contribution.region_group, '*') as region_group,
      coalesce(contribution.tier_distribution_band, '*')
        as tier_distribution_band,
      coalesce(contribution.member_count_band, '*') as member_count_band,
      count(*)::integer as participant_count,
      percentile_cont(0.25) within group (
        order by (contribution.metrics ->> 'retention_rate')::numeric
      ) as retention_p25,
      percentile_cont(0.50) within group (
        order by (contribution.metrics ->> 'retention_rate')::numeric
      ) as retention_median,
      percentile_cont(0.75) within group (
        order by (contribution.metrics ->> 'retention_rate')::numeric
      ) as retention_p75,
      percentile_cont(0.25) within group (
        order by (contribution.metrics ->> 'average_shipment_value_cents')::numeric
      ) as shipment_value_p25,
      percentile_cont(0.50) within group (
        order by (contribution.metrics ->> 'average_shipment_value_cents')::numeric
      ) as shipment_value_median,
      percentile_cont(0.75) within group (
        order by (contribution.metrics ->> 'average_shipment_value_cents')::numeric
      ) as shipment_value_p75,
      percentile_cont(0.25) within group (
        order by (contribution.metrics ->> 'decline_rate')::numeric
      ) as decline_p25,
      percentile_cont(0.50) within group (
        order by (contribution.metrics ->> 'decline_rate')::numeric
      ) as decline_median,
      percentile_cont(0.75) within group (
        order by (contribution.metrics ->> 'decline_rate')::numeric
      ) as decline_p75,
      percentile_cont(0.25) within group (
        order by (contribution.metrics ->> 'mrr_growth_rate')::numeric
      ) as mrr_growth_p25,
      percentile_cont(0.50) within group (
        order by (contribution.metrics ->> 'mrr_growth_rate')::numeric
      ) as mrr_growth_median,
      percentile_cont(0.75) within group (
        order by (contribution.metrics ->> 'mrr_growth_rate')::numeric
      ) as mrr_growth_p75,
      percentile_cont(0.25) within group (
        order by (contribution.metrics ->> 'email_engagement_rate')::numeric
      ) as email_p25,
      percentile_cont(0.50) within group (
        order by (contribution.metrics ->> 'email_engagement_rate')::numeric
      ) as email_median,
      percentile_cont(0.75) within group (
        order by (contribution.metrics ->> 'email_engagement_rate')::numeric
      ) as email_p75
    from public.benchmark_contributions as contribution
    where contribution.period = v_period
      and contribution.opted_in
    group by grouping sets (
      (
        contribution.period,
        contribution.region_group,
        contribution.tier_distribution_band,
        contribution.member_count_band
      ),
      (
        contribution.period,
        contribution.region_group,
        contribution.tier_distribution_band
      ),
      (
        contribution.period,
        contribution.region_group
      ),
      (contribution.period)
    )
    having count(*) >= 10
  )
  insert into public.benchmark_aggregates (
    period,
    coarsening_level,
    region_group,
    tier_distribution_band,
    member_count_band,
    participant_count,
    participant_count_band,
    metric_percentiles
  )
  select
    groups.period,
    groups.coarsening_level,
    groups.region_group,
    groups.tier_distribution_band,
    groups.member_count_band,
    groups.participant_count,
    case
      when groups.participant_count between 10 and 19 then '10-19'
      when groups.participant_count between 20 and 49 then '20-49'
      else '50+'
    end,
    jsonb_build_object(
      'retention_rate', jsonb_build_object(
        'p25', groups.retention_p25,
        'median', groups.retention_median,
        'p75', groups.retention_p75
      ),
      'average_shipment_value_cents', jsonb_build_object(
        'p25', groups.shipment_value_p25,
        'median', groups.shipment_value_median,
        'p75', groups.shipment_value_p75
      ),
      'decline_rate', jsonb_build_object(
        'p25', groups.decline_p25,
        'median', groups.decline_median,
        'p75', groups.decline_p75
      ),
      'mrr_growth_rate', jsonb_build_object(
        'p25', groups.mrr_growth_p25,
        'median', groups.mrr_growth_median,
        'p75', groups.mrr_growth_p75
      ),
      'email_engagement_rate', jsonb_build_object(
        'p25', groups.email_p25,
        'median', groups.email_median,
        'p75', groups.email_p75
      )
    )
  from groups;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function private.get_benchmark_comparison_raw(
  p_organization_id uuid,
  p_period date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contribution public.benchmark_contributions%rowtype;
  v_aggregate public.benchmark_aggregates%rowtype;
begin
  if not private.can_read_org_analytics(p_organization_id) then
    raise exception using
      errcode = '42501',
      message = 'Staff authorization is required.';
  end if;
  if not exists (
    select 1
    from public.organizations as organization
    join public.benchmark_preferences as preference
      on preference.organization_id = organization.id
      and preference.opted_in
    where organization.id = p_organization_id
      and organization.plan_tier in ('estate', 'reserve')
  ) then
    return jsonb_build_object(
      'available', false,
      'guidance', 'Estate or Reserve benchmark opt-in is required.',
      'minimumPeers', 10
    );
  end if;

  select contribution.*
  into v_contribution
  from public.benchmark_contributions as contribution
  where contribution.organization_id = p_organization_id
    and contribution.period = date_trunc('month', p_period)::date
    and contribution.opted_in;

  if not found then
    return jsonb_build_object(
      'available', false,
      'guidance', 'No real operational contribution exists for this period.',
      'minimumPeers', 10
    );
  end if;

  select aggregate.*
  into v_aggregate
  from public.benchmark_aggregates as aggregate
  where aggregate.period = v_contribution.period
    and (
      (aggregate.coarsening_level = 0
        and aggregate.region_group = v_contribution.region_group
        and aggregate.tier_distribution_band = v_contribution.tier_distribution_band
        and aggregate.member_count_band = v_contribution.member_count_band)
      or (aggregate.coarsening_level = 1
        and aggregate.region_group = v_contribution.region_group
        and aggregate.tier_distribution_band = v_contribution.tier_distribution_band
        and aggregate.member_count_band = '*')
      or (aggregate.coarsening_level = 2
        and aggregate.region_group = v_contribution.region_group
        and aggregate.tier_distribution_band = '*'
        and aggregate.member_count_band = '*')
      or (aggregate.coarsening_level = 3
        and aggregate.region_group = '*'
        and aggregate.tier_distribution_band = '*'
        and aggregate.member_count_band = '*')
    )
  order by aggregate.coarsening_level
  limit 1;

  if not found then
    return jsonb_build_object(
      'available', false,
      'guidance', 'Peer results are suppressed until at least 10 opted-in organizations can be safely grouped.',
      'minimumPeers', 10
    );
  end if;

  return jsonb_build_object(
    'available', true,
    'kAnonymous', true,
    'sampleCountBand', v_aggregate.participant_count_band,
    'peerGroup', jsonb_build_object(
      'regionGroup', v_aggregate.region_group,
      'tierDistributionBand', v_aggregate.tier_distribution_band,
      'memberCountBand', v_aggregate.member_count_band,
      'coarseningLevel', v_aggregate.coarsening_level
    ),
    'organizationMetrics', v_contribution.metrics,
    'peerPercentiles', v_aggregate.metric_percentiles
  );
end;
$$;

create or replace function public.get_benchmark_comparison(
  p_organization_id uuid,
  p_period date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_raw jsonb;
  v_plan public.plan_tier;
  v_opted_in boolean := false;
  v_quarterly_enabled boolean := false;
  v_next_send_at timestamptz;
  v_metrics jsonb := '[]'::jsonb;
begin
  if not private.can_read_org_analytics(p_organization_id) then
    raise exception using
      errcode = '42501',
      message = 'Staff authorization is required.';
  end if;

  select
    organization.plan_tier,
    coalesce(preference.opted_in, false),
    coalesce(preference.quarterly_report_enabled, false),
    schedule.next_report_at
  into
    v_plan,
    v_opted_in,
    v_quarterly_enabled,
    v_next_send_at
  from public.organizations as organization
  left join public.benchmark_preferences as preference
    on preference.organization_id = organization.id
  left join lateral (
    select report.next_report_at
    from public.analytics_report_schedules as report
    where report.organization_id = organization.id
      and report.report_type = 'benchmark'
      and report.enabled
    order by report.next_report_at
    limit 1
  ) as schedule on true
  where organization.id = p_organization_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Organization not found.';
  end if;

  v_raw := private.get_benchmark_comparison_raw(
    p_organization_id,
    p_period
  );

  if coalesce((v_raw ->> 'available')::boolean, false) then
    select jsonb_agg(
      jsonb_build_object(
        'id', metric.key,
        'key', metric.key,
        'label', case metric.key
          when 'retention_rate' then 'Member retention rate'
          when 'average_shipment_value_cents' then 'Average shipment value'
          when 'decline_rate' then 'Payment decline rate'
          when 'mrr_growth_rate' then 'MRR growth rate'
          when 'email_engagement_rate' then 'Email engagement rate'
        end,
        'organizationValue', v_raw -> 'organizationMetrics' -> metric.key,
        'unit', case metric.key
          when 'average_shipment_value_cents' then 'cents'
          else 'percent'
        end,
        'peerP25', metric.value -> 'p25',
        'peerMedian', metric.value -> 'median',
        'peerP75', metric.value -> 'p75',
        'percentile', (
          select round(
            100 * count(*) filter (
              where (peer.metrics ->> metric.key)::numeric
                <= (v_raw -> 'organizationMetrics' ->> metric.key)::numeric
            )::numeric
              / nullif(count(*), 0),
            1
          )
          from public.benchmark_contributions as peer
          where peer.period = date_trunc('month', p_period)::date
            and peer.opted_in
            and (
              v_raw -> 'peerGroup' ->> 'regionGroup' = '*'
              or peer.region_group =
                v_raw -> 'peerGroup' ->> 'regionGroup'
            )
            and (
              v_raw -> 'peerGroup' ->> 'tierDistributionBand' = '*'
              or peer.tier_distribution_band =
                v_raw -> 'peerGroup' ->> 'tierDistributionBand'
            )
            and (
              v_raw -> 'peerGroup' ->> 'memberCountBand' = '*'
              or peer.member_count_band =
                v_raw -> 'peerGroup' ->> 'memberCountBand'
            )
        ),
        'kAnonymous', true,
        'sampleCountBand', v_raw ->> 'sampleCountBand'
      )
      order by metric.key
    )
    into v_metrics
    from jsonb_each(v_raw -> 'peerPercentiles') as metric;
  end if;

  return jsonb_build_object(
    'eligible', v_plan in ('estate', 'reserve'),
    'subscriptionTier', v_plan,
    'optedIn', v_opted_in,
    'minimumPeerCount', 10,
    'available', coalesce((v_raw ->> 'available')::boolean, false),
    'guidance', v_raw ->> 'guidance',
    'peerGroup', v_raw -> 'peerGroup',
    'period', date_trunc('month', p_period)::date,
    'generatedAt', now(),
    'metrics', coalesce(v_metrics, '[]'::jsonb),
    'quarterlyReport', jsonb_build_object(
      'enabled', v_quarterly_enabled,
      'nextSendAt', v_next_send_at
    )
  );
end;
$$;

create or replace function public.get_peer_benchmark(
  p_organization_id uuid,
  p_period date
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.get_benchmark_comparison(p_organization_id, p_period);
$$;

create or replace function private.shipment_compliance_fingerprint(
  p_organization_id uuid,
  p_shipment_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'organization_id', shipment.organization_id,
          'shipment_id', shipment.id,
          'member_id', shipment.member_id,
          'release_id', shipment.release_id,
          'release_tier_id', shipment.release_tier_id,
          'tier_id', shipment.tier_id,
          'shipping_origin_address', organization.shipping_origin_address,
          'member_birthday', member.birthday,
          'shipping_address', shipment.shipping_address,
          'validated_shipping_address', shipment.validated_shipping_address,
          'charge_amount_cents', shipment.charge_amount_cents,
          'loyalty_discount_cents', shipment.loyalty_discount_cents,
          'payable_amount_cents',
            shipment.charge_amount_cents - shipment.loyalty_discount_cents,
          'items', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', item.id,
                'release_wine_id', item.release_wine_id,
                'wine_name', item.wine_name,
                'vintage', item.vintage,
                'sku', item.sku,
                'barcode', item.barcode,
                'quantity', item.quantity,
                'price_cents', item.price_cents
              )
              order by item.id
            )
            from public.shipment_items as item
            where item.organization_id = shipment.organization_id
              and item.shipment_id = shipment.id
          ), '[]'::jsonb)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from public.shipments as shipment
  join public.organizations as organization
    on organization.id = shipment.organization_id
  join public.members as member
    on member.organization_id = shipment.organization_id
    and member.id = shipment.member_id
  where shipment.organization_id = p_organization_id
    and shipment.id = p_shipment_id;
$$;

create or replace function private.invalidate_shipment_compliance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_relevant_change boolean;
begin
  if tg_table_name = 'shipments' then
    v_relevant_change :=
      new.member_id is distinct from old.member_id
      or new.release_id is distinct from old.release_id
      or new.release_tier_id is distinct from old.release_tier_id
      or new.tier_id is distinct from old.tier_id
      or new.shipping_address is distinct from old.shipping_address
      or new.validated_shipping_address is distinct
        from old.validated_shipping_address
      or new.charge_amount_cents is distinct from old.charge_amount_cents
      or new.loyalty_discount_cents is distinct from old.loyalty_discount_cents;

    if not v_relevant_change then
      return new;
    end if;
    if old.status in ('label_created', 'packed', 'shipped', 'delivered')
      or new.status in ('label_created', 'packed', 'shipped', 'delivered')
    then
      raise exception using
        errcode = '23514',
        message = 'Compliance-relevant shipment data cannot change after label generation.';
    end if;
    new.latest_compliance_check_id := null;
    new.latest_compliance_request_fingerprint := null;
    new.latest_compliance_state_fingerprint := null;
    new.compliance_status := null;
    new.compliance_reason := null;
    new.compliance_tax_estimate_cents := null;
    new.compliance_checked_at := null;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_relevant_change :=
      new.release_wine_id is distinct from old.release_wine_id
      or new.wine_name is distinct from old.wine_name
      or new.vintage is distinct from old.vintage
      or new.sku is distinct from old.sku
      or new.barcode is distinct from old.barcode
      or new.quantity is distinct from old.quantity
      or new.price_cents is distinct from old.price_cents;
    if not v_relevant_change then
      return new;
    end if;
  end if;

  perform 1
  from public.shipments as shipment
  where shipment.organization_id = coalesce(new.organization_id, old.organization_id)
    and shipment.id = coalesce(new.shipment_id, old.shipment_id)
    and shipment.status in ('label_created', 'packed', 'shipped', 'delivered');
  if found then
    raise exception using
      errcode = '23514',
      message = 'Compliance-relevant shipment items cannot change after label generation.';
  end if;

  update public.shipments
  set
    latest_compliance_check_id = null,
    latest_compliance_request_fingerprint = null,
    latest_compliance_state_fingerprint = null,
    compliance_status = null,
    compliance_reason = null,
    compliance_tax_estimate_cents = null,
    compliance_checked_at = null
  where organization_id = coalesce(new.organization_id, old.organization_id)
    and id = coalesce(new.shipment_id, old.shipment_id);

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger shipments_invalidate_compliance
before update on public.shipments
for each row execute function private.invalidate_shipment_compliance();

create trigger shipment_items_invalidate_compliance
before insert or update or delete on public.shipment_items
for each row execute function private.invalidate_shipment_compliance();

create or replace function private.invalidate_dependent_compliance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'organizations'
    and new.shipping_origin_address is distinct
      from old.shipping_origin_address
  then
    update public.shipments
    set
      latest_compliance_check_id = null,
      latest_compliance_request_fingerprint = null,
      latest_compliance_state_fingerprint = null,
      compliance_status = null,
      compliance_reason = null,
      compliance_tax_estimate_cents = null,
      compliance_checked_at = null
    where organization_id = new.id
      and status = 'charged'
      and latest_compliance_check_id is not null;
  elsif tg_table_name = 'members'
    and new.birthday is distinct from old.birthday
  then
    update public.shipments
    set
      latest_compliance_check_id = null,
      latest_compliance_request_fingerprint = null,
      latest_compliance_state_fingerprint = null,
      compliance_status = null,
      compliance_reason = null,
      compliance_tax_estimate_cents = null,
      compliance_checked_at = null
    where organization_id = new.organization_id
      and member_id = new.id
      and status = 'charged'
      and latest_compliance_check_id is not null;
  end if;
  return new;
end;
$$;

create trigger organizations_invalidate_shipment_compliance
after update of shipping_origin_address on public.organizations
for each row execute function private.invalidate_dependent_compliance();

create trigger members_invalidate_shipment_compliance
after update of birthday on public.members
for each row execute function private.invalidate_dependent_compliance();

create or replace function public.set_validated_shipment_address(
  p_organization_id uuid,
  p_shipment_id uuid,
  p_validation_status public.address_validation_status,
  p_validated_address jsonb,
  p_validation_messages jsonb,
  p_actor_user_id uuid
)
returns public.shipments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shipment public.shipments%rowtype;
begin
  if not private.is_service_role()
    or not exists (
      select 1 from public.staff_users as staff
      where staff.organization_id = p_organization_id
        and staff.id = p_actor_user_id
        and staff.status = 'active'
        and staff.role in ('owner', 'admin', 'manager', 'staff')
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Address validation persistence is service-only.';
  end if;
  if jsonb_typeof(coalesce(p_validation_messages, '[]'::jsonb)) <> 'array'
    or (
      p_validation_status = 'valid'
      and (
        jsonb_typeof(p_validated_address) <> 'object'
        or upper(coalesce(
          p_validated_address ->> 'state',
          p_validated_address ->> 'region'
        )) !~ '^[A-Z]{2}$'
      )
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Validated shipment address payload is invalid.';
  end if;

  update public.shipments
  set
    address_validation_status = p_validation_status,
    address_validation_messages =
      coalesce(p_validation_messages, '[]'::jsonb),
    validated_shipping_address = case
      when p_validation_status = 'valid' then p_validated_address
      else null
    end
  where organization_id = p_organization_id
    and id = p_shipment_id
    and status = 'charged'
  returning * into v_shipment;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'Only charged pre-label shipments can persist address validation.';
  end if;

  perform public.append_audit_entry(
    p_organization_id,
    p_actor_user_id,
    'shipment.address_validated',
    'shipment',
    p_shipment_id,
    jsonb_build_object(
      'validation_status', p_validation_status,
      'compliance_invalidated', true
    )
  );
  return v_shipment;
end;
$$;

create or replace function public.record_shipment_compliance_check(
  p_organization_id uuid,
  p_shipment_id uuid,
  p_status public.compliance_check_status,
  p_reason text,
  p_tax_estimate_cents integer,
  p_provider_response_id text,
  p_provider text,
  p_checked_at timestamptz,
  p_actor_user_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns public.compliance_checks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shipment public.shipments%rowtype;
  v_check public.compliance_checks%rowtype;
  v_recipient_state text;
  v_request_fingerprint text;
  v_shipment_state_fingerprint text;
begin
  if not exists (
    select 1
    from public.staff_users as staff
    where staff.organization_id = p_organization_id
      and staff.id = p_actor_user_id
      and staff.status = 'active'
  ) then
    raise exception using
      errcode = '42501',
      message = 'Active staff actor is required.';
  end if;
  if not private.is_service_role()
    and (
      not private.is_staff_for_org(p_organization_id)
      or auth.uid() is distinct from p_actor_user_id
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Staff authorization is required.';
  end if;
  if p_checked_at > now() + interval '5 minutes'
    or p_checked_at < now() - interval '1 day'
  then
    raise exception using
      errcode = '22023',
      message = 'Compliance check timestamp is outside the accepted window.';
  end if;
  if not private.analytics_payload_is_minimized(p_metadata) then
    raise exception using
      errcode = '22023',
      message = 'Compliance metadata contains prohibited or excessive data.';
  end if;
  v_request_fingerprint := lower(
    coalesce(p_metadata ->> 'request_fingerprint_sha256', '')
  );
  if v_request_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'Compliance request fingerprint must be a SHA-256 hex digest.';
  end if;
  if p_status = 'compliant' and not (
    p_tax_estimate_cents is not null
    and p_metadata @> '{
      "recipient_state_allowed": true,
      "origin_to_recipient_allowed": true,
      "age_verified": true,
      "volume_within_limit": true
    }'::jsonb
    and char_length(coalesce(p_metadata ->> 'rules_version', ''))
      between 1 and 120
  ) then
    raise exception using
      errcode = '23514',
      message = 'Compliant status requires tax and complete rule evidence.';
  end if;

  select shipment.*
  into v_shipment
  from public.shipments as shipment
  where shipment.id = p_shipment_id
    and shipment.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Shipment not found.';
  end if;
  if v_shipment.status <> 'charged' then
    raise exception using
      errcode = '23514',
      message = 'Compliance checks are allowed only for charged pre-label shipments.';
  end if;

  v_recipient_state := upper(coalesce(
    v_shipment.validated_shipping_address ->> 'state',
    v_shipment.validated_shipping_address ->> 'region',
    v_shipment.shipping_address ->> 'state',
    v_shipment.shipping_address ->> 'region'
  ));
  if v_recipient_state !~ '^[A-Z]{2}$' then
    raise exception using
      errcode = '22023',
      message = 'Shipment requires a two-letter recipient state.';
  end if;

  v_shipment_state_fingerprint := private.shipment_compliance_fingerprint(
    p_organization_id,
    p_shipment_id
  );
  if v_shipment_state_fingerprint is null then
    raise exception using
      errcode = 'P0002',
      message = 'Shipment compliance request could not be fingerprinted.';
  end if;

  select compliance.*
  into v_check
  from public.compliance_checks as compliance
  where compliance.provider = p_provider
    and compliance.provider_response_id = p_provider_response_id;

  if found then
    if v_check.organization_id <> p_organization_id
      or v_check.shipment_id <> p_shipment_id
      or v_check.status <> p_status
      or v_check.request_fingerprint <> v_request_fingerprint
      or v_check.shipment_state_fingerprint <> v_shipment_state_fingerprint
    then
      raise exception using
        errcode = '23505',
        message = 'Provider response identifier was already used for another result.';
    end if;
  else
    insert into public.compliance_checks (
      organization_id,
      shipment_id,
      recipient_state,
      status,
      reason,
      tax_estimate_cents,
      provider,
      provider_response_id,
      request_fingerprint,
      shipment_state_fingerprint,
      checked_at,
      actor_user_id,
      metadata
    )
    values (
      p_organization_id,
      p_shipment_id,
      v_recipient_state,
      p_status,
      nullif(btrim(p_reason), ''),
      p_tax_estimate_cents,
      p_provider,
      p_provider_response_id,
      v_request_fingerprint,
      v_shipment_state_fingerprint,
      p_checked_at,
      p_actor_user_id,
      p_metadata
    )
    returning * into v_check;
  end if;

  update public.shipments
  set
    latest_compliance_check_id = v_check.id,
    latest_compliance_request_fingerprint = v_check.request_fingerprint,
    latest_compliance_state_fingerprint =
      v_check.shipment_state_fingerprint,
    compliance_status = v_check.status,
    compliance_reason = v_check.reason,
    compliance_tax_estimate_cents = coalesce(
      v_check.tax_estimate_cents,
      0
    ),
    compliance_checked_at = v_check.checked_at
  where id = p_shipment_id
    and organization_id = p_organization_id;

  if v_check.status in ('non_compliant', 'unknown') then
    perform public.enqueue_email_trigger(
      p_organization_id,
      v_shipment.member_id,
      'compliance_hold',
      'email:compliance_hold:' || v_check.id::text,
      jsonb_build_object(
        'shipment_id', p_shipment_id,
        'compliance_status', v_check.status,
        'compliance_reason', v_check.reason,
        'tax_estimate_cents', v_check.tax_estimate_cents
      ),
      now()
    );
  end if;

  perform public.append_audit_entry(
    p_organization_id,
    p_actor_user_id,
    'shipment.compliance_checked',
    'shipment',
    p_shipment_id,
    jsonb_build_object(
      'compliance_check_id', v_check.id,
      'status', v_check.status,
      'reason', v_check.reason,
      'tax_estimate_cents', v_check.tax_estimate_cents,
      'provider', v_check.provider
      ,'request_fingerprint', v_check.request_fingerprint
      ,'shipment_state_fingerprint', v_check.shipment_state_fingerprint
    )
  );

  return v_check;
end;
$$;

create or replace function private.enforce_compliance_before_label()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('label_created', 'packed', 'shipped', 'delivered')
    and (
      new.compliance_status is distinct from 'compliant'
      or new.latest_compliance_check_id is null
      or new.latest_compliance_request_fingerprint is null
      or new.latest_compliance_state_fingerprint is null
      or new.latest_compliance_state_fingerprint
        is distinct from private.shipment_compliance_fingerprint(
          new.organization_id,
          new.id
        )
      or new.compliance_checked_at is null
      or new.compliance_checked_at < now() - interval '24 hours'
    )
  then
    raise exception using
      errcode = '23514',
      message = 'A recent compliant ShipCompliant check is required before label generation.';
  end if;
  return new;
end;
$$;

create trigger shipments_enforce_compliance_before_label
before insert or update of
  status,
  latest_compliance_check_id,
  latest_compliance_request_fingerprint,
  latest_compliance_state_fingerprint,
  compliance_status,
  compliance_checked_at
on public.shipments
for each row execute function private.enforce_compliance_before_label();

create or replace function public.get_shipment_compliance_check(
  p_organization_id uuid,
  p_shipment_id uuid
)
returns public.compliance_checks
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_check public.compliance_checks%rowtype;
begin
  if not private.can_read_org_analytics(p_organization_id)
    and not private.is_member_for_org(
      p_organization_id,
      (
        select shipment.member_id
        from public.shipments as shipment
        where shipment.organization_id = p_organization_id
          and shipment.id = p_shipment_id
      )
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Shipment authorization is required.';
  end if;

  select compliance.*
  into v_check
  from public.compliance_checks as compliance
  where compliance.organization_id = p_organization_id
    and compliance.shipment_id = p_shipment_id
  order by compliance.checked_at desc, compliance.created_at desc
  limit 1;

  return v_check;
end;
$$;

create or replace function public.get_latest_shipment_compliance(
  p_organization_id uuid,
  p_shipment_id uuid
)
returns public.compliance_checks
language sql
stable
security definer
set search_path = ''
as $$
  select public.get_shipment_compliance_check(
    p_organization_id,
    p_shipment_id
  );
$$;

create or replace function private.get_compliance_dashboard_rows(
  p_organization_id uuid,
  p_release_id uuid default null,
  p_status public.compliance_check_status default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  id uuid,
  shipment_id uuid,
  shipment_status public.shipment_status,
  release_id uuid,
  release_name text,
  member_id uuid,
  member_name text,
  recipient_state text,
  status public.compliance_check_status,
  reason text,
  tax_estimate_cents integer,
  provider text,
  provider_response_id text,
  checked_at timestamptz,
  label_blocked boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_read_org_analytics(p_organization_id) then
    raise exception using
      errcode = '42501',
      message = 'Staff authorization is required.';
  end if;
  if p_limit not between 1 and 200 or p_offset < 0 then
    raise exception using
      errcode = '22023',
      message = 'Compliance pagination is invalid.';
  end if;

  return query
  select
    compliance.id,
    shipment.id,
    shipment.status,
    shipment.release_id,
    release.name,
    shipment.member_id,
    btrim(member.first_name || ' ' || member.last_name),
    compliance.recipient_state,
    compliance.status,
    compliance.reason,
    compliance.tax_estimate_cents,
    compliance.provider,
    compliance.provider_response_id,
    compliance.checked_at,
    compliance.status is distinct from 'compliant'
      or compliance.checked_at < now() - interval '24 hours',
    count(*) over()
  from public.shipments as shipment
  join public.releases as release
    on release.organization_id = shipment.organization_id
    and release.id = shipment.release_id
  join public.members as member
    on member.organization_id = shipment.organization_id
    and member.id = shipment.member_id
  left join public.compliance_checks as compliance
    on compliance.organization_id = shipment.organization_id
    and compliance.id = shipment.latest_compliance_check_id
  where shipment.organization_id = p_organization_id
    and (p_release_id is null or shipment.release_id = p_release_id)
    and (p_status is null or compliance.status = p_status)
  order by
    (compliance.status is distinct from 'compliant') desc,
    shipment.created_at,
    shipment.id
  limit p_limit
  offset p_offset;
end;
$$;

create or replace function public.get_compliance_dashboard(
  p_organization_id uuid,
  p_release_id uuid default null,
  p_status public.compliance_check_status default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_summary jsonb;
  v_total bigint;
begin
  if not private.can_read_org_analytics(p_organization_id) then
    raise exception using
      errcode = '42501',
      message = 'Staff authorization is required.';
  end if;

  select
    coalesce(jsonb_agg(to_jsonb(item) order by item.label_blocked desc, item.checked_at desc), '[]'::jsonb),
    coalesce(max(item.total_count), 0)
  into v_items, v_total
  from private.get_compliance_dashboard_rows(
    p_organization_id,
    p_release_id,
    p_status,
    p_limit,
    p_offset
  ) as item;

  select jsonb_build_object(
    'totalChecks', count(compliance.id),
    'compliant', count(compliance.id) filter (
      where compliance.status = 'compliant'
    ),
    'nonCompliant', count(compliance.id) filter (
      where compliance.status = 'non_compliant'
    ),
    'unknown', count(*) filter (
      where compliance.id is null or compliance.status = 'unknown'
    ),
    'taxEstimateCents', coalesce(sum(compliance.tax_estimate_cents), 0)
  )
  into v_summary
  from public.shipments as shipment
  left join public.compliance_checks as compliance
    on compliance.organization_id = shipment.organization_id
    and compliance.id = shipment.latest_compliance_check_id
  where shipment.organization_id = p_organization_id
    and (p_release_id is null or shipment.release_id = p_release_id);

  return jsonb_build_object(
    'summary', v_summary,
    'items', v_items,
    'total', v_total,
    'providerStatus', jsonb_build_object(
      'provider', 'shipcompliant',
      'lastCheckedAt', (
        select max(compliance.checked_at)
        from public.compliance_checks as compliance
        where compliance.organization_id = p_organization_id
          and compliance.provider = 'shipcompliant'
      ),
      'lastSuccessfulCheckAt', (
        select max(compliance.checked_at)
        from public.compliance_checks as compliance
        where compliance.organization_id = p_organization_id
          and compliance.provider = 'shipcompliant'
          and compliance.status in ('compliant', 'non_compliant')
          and coalesce(
            (compliance.metadata ->> 'provider_response_is_local')::boolean,
            true
          ) = false
      ),
      'lastRulesVersionAt', (
        select max(compliance.checked_at)
        from public.compliance_checks as compliance
        where compliance.organization_id = p_organization_id
          and compliance.provider = 'shipcompliant'
          and nullif(compliance.metadata ->> 'rules_version', '') is not null
          and coalesce(
            (compliance.metadata ->> 'provider_response_is_local')::boolean,
            true
          ) = false
      ),
      'liveChecks', (
        select count(*)
        from public.compliance_checks as compliance
        where compliance.organization_id = p_organization_id
          and compliance.provider = 'shipcompliant'
      ),
      'simulatedChecks', (
        select count(*)
        from public.compliance_checks as compliance
        where compliance.organization_id = p_organization_id
          and compliance.provider = 'simulated'
      )
    )
  );
end;
$$;

create or replace function public.get_release_compliance_queue(
  p_organization_id uuid,
  p_release_id uuid
)
returns table (
  id uuid,
  shipment_id uuid,
  shipment_status public.shipment_status,
  release_id uuid,
  release_name text,
  member_id uuid,
  member_name text,
  recipient_state text,
  status public.compliance_check_status,
  reason text,
  tax_estimate_cents integer,
  provider text,
  provider_response_id text,
  checked_at timestamptz,
  label_blocked boolean,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select *
  from private.get_compliance_dashboard_rows(
    p_organization_id,
    p_release_id,
    null,
    200,
    0
  );
$$;

create or replace function public.acquire_shipping_label_attempt(
  p_organization_id uuid,
  p_shipment_id uuid,
  p_worker_id text,
  p_actor_user_id uuid,
  p_lease_seconds integer default 300,
  p_provider text default 'easypost'
)
returns table (
  attempt_id uuid,
  disposition text,
  lease_token text,
  request_fingerprint text,
  correlation_reference text,
  provider text,
  external_shipment_id text,
  external_rate_id text,
  external_label_id text,
  label_url text,
  tracking_number text,
  carrier text,
  label_cost_cents integer,
  provider_metadata jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shipment public.shipments%rowtype;
  v_attempt public.shipping_label_attempts%rowtype;
  v_token text;
  v_reference text;
  v_was_indeterminate boolean := false;
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Shipping label acquisition is service-only.';
  end if;
  if not exists (
    select 1 from public.staff_users as staff
    where staff.organization_id = p_organization_id
      and staff.id = p_actor_user_id
      and staff.status = 'active'
      and staff.role in ('owner', 'admin', 'manager', 'staff')
  ) then
    raise exception using
      errcode = '42501',
      message = 'An active staff actor is required.';
  end if;
  if char_length(btrim(coalesce(p_worker_id, ''))) not between 3 and 200
    or p_lease_seconds not between 30 and 900
    or p_provider not in ('easypost', 'simulated')
  then
    raise exception using
      errcode = '22023',
      message = 'Shipping label lease parameters are invalid.';
  end if;

  select shipment.*
  into v_shipment
  from public.shipments as shipment
  where shipment.organization_id = p_organization_id
    and shipment.id = p_shipment_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Shipment not found.';
  end if;
  if v_shipment.status = 'label_created' then
    select attempt.*
    into v_attempt
    from public.shipping_label_attempts as attempt
    where attempt.organization_id = p_organization_id
      and attempt.shipment_id = p_shipment_id
      and attempt.status = 'succeeded'
    order by attempt.completed_at desc
    limit 1;
    if found then
      return query select
        v_attempt.id,
        'succeeded'::text,
        null::text,
        v_attempt.request_fingerprint,
        v_attempt.correlation_reference,
        v_attempt.provider,
        v_attempt.external_shipment_id,
        v_attempt.external_rate_id,
        v_attempt.external_label_id,
        v_attempt.label_url,
        v_attempt.tracking_number,
        v_attempt.carrier,
        v_attempt.label_cost_cents,
        v_attempt.provider_metadata;
      return;
    end if;
  end if;
  if v_shipment.status <> 'charged'
    or v_shipment.compliance_status is distinct from 'compliant'
    or v_shipment.latest_compliance_check_id is null
    or v_shipment.latest_compliance_request_fingerprint is null
    or v_shipment.latest_compliance_state_fingerprint
      is distinct from private.shipment_compliance_fingerprint(
        p_organization_id,
        p_shipment_id
      )
    or v_shipment.compliance_checked_at < now() - interval '24 hours'
  then
    raise exception using
      errcode = '23514',
      message = 'A current compliant charged shipment is required for label purchase.';
  end if;

  v_reference := 'vinifera:' || p_provider || ':label:'
    || p_shipment_id::text || ':'
    || v_shipment.latest_compliance_request_fingerprint;

  select attempt.*
  into v_attempt
  from public.shipping_label_attempts as attempt
  where attempt.organization_id = p_organization_id
    and attempt.shipment_id = p_shipment_id
    and attempt.request_fingerprint =
      v_shipment.latest_compliance_request_fingerprint
  for update;

  if found and v_attempt.provider <> p_provider then
    raise exception using
      errcode = '23514',
      message = 'Shipping label provider cannot change for an existing attempt.';
  end if;

  if found
    and v_attempt.status <> 'succeeded'
    and v_attempt.compliance_check_id is distinct from
      v_shipment.latest_compliance_check_id
  then
    update public.shipping_label_attempts
    set
      compliance_check_id = v_shipment.latest_compliance_check_id,
      updated_at = now()
    where id = v_attempt.id
    returning * into v_attempt;
  end if;

  if found and v_attempt.status = 'succeeded' then
    return query select
      v_attempt.id, 'succeeded'::text, null::text,
      v_attempt.request_fingerprint, v_attempt.correlation_reference,
      v_attempt.provider,
      v_attempt.external_shipment_id, v_attempt.external_rate_id,
      v_attempt.external_label_id, v_attempt.label_url,
      v_attempt.tracking_number, v_attempt.carrier,
      v_attempt.label_cost_cents, v_attempt.provider_metadata;
    return;
  end if;
  if found and v_attempt.status = 'indeterminate' then
    v_was_indeterminate := true;
  end if;
  if found
    and v_attempt.status in ('claimed', 'shipment_created')
    and v_attempt.lease_expires_at > now()
  then
    return query select
      v_attempt.id, 'in_progress'::text, null::text,
      v_attempt.request_fingerprint, v_attempt.correlation_reference,
      v_attempt.provider,
      v_attempt.external_shipment_id, v_attempt.external_rate_id,
      v_attempt.external_label_id, v_attempt.label_url,
      v_attempt.tracking_number, v_attempt.carrier,
      v_attempt.label_cost_cents, v_attempt.provider_metadata;
    return;
  end if;

  v_token := gen_random_uuid()::text || gen_random_uuid()::text;
  if found then
    update public.shipping_label_attempts as target
    set
      status = case
        when target.external_shipment_id is null
        then 'claimed'::public.shipping_label_attempt_status
        else 'shipment_created'::public.shipping_label_attempt_status
      end,
      worker_id = btrim(p_worker_id),
      lease_token_hash = encode(
        extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'),
        'hex'
      ),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempt_count = attempt_count + 1,
      error_message = null,
      completed_at = null,
      claimed_at = now(),
      updated_at = now()
    where target.id = v_attempt.id
    returning * into v_attempt;
  else
    insert into public.shipping_label_attempts (
      organization_id,
      shipment_id,
      compliance_check_id,
      request_fingerprint,
      correlation_reference,
      provider,
      worker_id,
      lease_token_hash,
      lease_expires_at
    ) values (
      p_organization_id,
      p_shipment_id,
      v_shipment.latest_compliance_check_id,
      v_shipment.latest_compliance_request_fingerprint,
      v_reference,
      p_provider,
      btrim(p_worker_id),
      encode(
        extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'),
        'hex'
      ),
      now() + make_interval(secs => p_lease_seconds)
    )
    returning * into v_attempt;
  end if;

  return query select
    v_attempt.id,
    case
      when v_was_indeterminate then 'reconcile'
      when v_attempt.external_shipment_id is null then 'create_shipment'
      else 'recover_purchase'
    end::text,
    v_token,
    v_attempt.request_fingerprint,
    v_attempt.correlation_reference,
    v_attempt.provider,
    v_attempt.external_shipment_id,
    v_attempt.external_rate_id,
    v_attempt.external_label_id,
    v_attempt.label_url,
    v_attempt.tracking_number,
    v_attempt.carrier,
    v_attempt.label_cost_cents,
    v_attempt.provider_metadata;
end;
$$;

create or replace function public.persist_shipping_label_external_shipment(
  p_attempt_id uuid,
  p_lease_token text,
  p_external_shipment_id text,
  p_external_rate_id text
)
returns public.shipping_label_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.shipping_label_attempts%rowtype;
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Shipping label persistence is service-only.';
  end if;
  select attempt.*
  into v_attempt
  from public.shipping_label_attempts as attempt
  where attempt.id = p_attempt_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Shipping label attempt not found.';
  end if;
  if (
      (
        v_attempt.provider = 'easypost'
        and (
          p_external_shipment_id !~ '^shp_[A-Za-z0-9]+$'
          or p_external_rate_id !~ '^rate_[A-Za-z0-9]+$'
        )
      )
      or (
        v_attempt.provider = 'simulated'
        and (
          p_external_shipment_id !~ '^simshipment_[A-Za-z0-9]+$'
          or p_external_rate_id !~ '^simrate_[A-Za-z0-9]+$'
        )
      )
    )
    or nullif(btrim(p_external_rate_id), '') is null
  then
    raise exception using
      errcode = '22023',
      message = 'Provider shipment and rate identifiers are invalid.';
  end if;

  update public.shipping_label_attempts
  set
    status = 'shipment_created',
    external_shipment_id = p_external_shipment_id,
    external_rate_id = btrim(p_external_rate_id),
    external_shipment_persisted_at = coalesce(
      external_shipment_persisted_at,
      now()
    ),
    updated_at = now()
  where id = p_attempt_id
    and status in ('claimed', 'shipment_created')
    and lease_expires_at > now()
    and lease_token_hash = encode(
      extensions.digest(
        convert_to(coalesce(p_lease_token, ''), 'UTF8'),
        'sha256'
      ),
      'hex'
    )
    and (
      external_shipment_id is null
      or external_shipment_id = p_external_shipment_id
    )
  returning * into v_attempt;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'Shipping label lease is invalid or expired.';
  end if;
  return v_attempt;
end;
$$;

create or replace function public.complete_shipping_label_attempt(
  p_attempt_id uuid,
  p_lease_token text,
  p_outcome text,
  p_external_label_id text,
  p_label_url text,
  p_tracking_number text,
  p_carrier text,
  p_label_cost_cents integer,
  p_provider_metadata jsonb,
  p_error_message text default null
)
returns public.shipping_label_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.shipping_label_attempts%rowtype;
begin
  if not private.is_service_role() then
    raise exception using
      errcode = '42501',
      message = 'Shipping label completion is service-only.';
  end if;
  if p_outcome not in ('succeeded', 'failed', 'indeterminate')
    or not private.analytics_payload_is_minimized(
      coalesce(p_provider_metadata, '{}'::jsonb)
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Shipping label outcome is invalid.';
  end if;

  select attempt.*
  into v_attempt
  from public.shipping_label_attempts as attempt
  where attempt.id = p_attempt_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Shipping label attempt not found.';
  end if;
  if v_attempt.status = 'succeeded' then
    return v_attempt;
  end if;
  if v_attempt.status not in ('claimed', 'shipment_created')
    or v_attempt.lease_expires_at <= now()
    or v_attempt.lease_token_hash <> encode(
      extensions.digest(
        convert_to(coalesce(p_lease_token, ''), 'UTF8'),
        'sha256'
      ),
      'hex'
    )
  then
    raise exception using
      errcode = '55000',
      message = 'Shipping label lease is invalid or expired.';
  end if;
  if p_outcome in ('succeeded', 'indeterminate')
    and v_attempt.external_shipment_id is null
  then
    raise exception using
      errcode = '23514',
      message = 'External EasyPost shipment must be persisted before purchase.';
  end if;
  if p_outcome = 'succeeded' and (
    nullif(btrim(p_external_label_id), '') is null
    or nullif(btrim(p_label_url), '') is null
    or nullif(btrim(p_tracking_number), '') is null
    or nullif(btrim(p_carrier), '') is null
    or p_label_cost_cents is null
    or p_label_cost_cents < 0
  ) then
    raise exception using
      errcode = '23514',
      message = 'Successful label purchase requires complete label evidence.';
  end if;
  if p_outcome = 'succeeded'
    and (
      p_label_url !~ '^https://'
      or (
        v_attempt.provider = 'easypost'
        and p_external_label_id !~ '^(pl_|easypost_label_)[A-Za-z0-9]+$'
      )
      or (
        v_attempt.provider = 'simulated'
        and p_external_label_id !~ '^simlabel_[A-Za-z0-9]+$'
      )
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Provider label evidence is invalid.';
  end if;
  if p_outcome = 'succeeded' and not exists (
    select 1
    from public.shipments as shipment
    where shipment.organization_id = v_attempt.organization_id
      and shipment.id = v_attempt.shipment_id
      and shipment.status = 'charged'
      and shipment.compliance_status = 'compliant'
      and shipment.latest_compliance_check_id =
        v_attempt.compliance_check_id
      and shipment.latest_compliance_request_fingerprint =
        v_attempt.request_fingerprint
      and shipment.latest_compliance_state_fingerprint =
        private.shipment_compliance_fingerprint(
          shipment.organization_id,
          shipment.id
        )
      and shipment.compliance_checked_at >= now() - interval '24 hours'
  ) then
    raise exception using
      errcode = '23514',
      message = 'Shipment compliance changed before label completion.';
  end if;

  update public.shipping_label_attempts
  set
    status = p_outcome::public.shipping_label_attempt_status,
    worker_id = null,
    lease_token_hash = null,
    lease_expires_at = null,
    external_label_id = nullif(btrim(p_external_label_id), ''),
    label_url = nullif(btrim(p_label_url), ''),
    tracking_number = nullif(btrim(p_tracking_number), ''),
    carrier = nullif(btrim(p_carrier), ''),
    label_cost_cents = p_label_cost_cents,
    provider_metadata = coalesce(p_provider_metadata, '{}'::jsonb),
    error_message = nullif(btrim(p_error_message), ''),
    completed_at = now(),
    updated_at = now()
  where id = p_attempt_id
  returning * into v_attempt;

  if p_outcome = 'succeeded' then
    update public.shipments
    set
      status = 'label_created',
      shipping_provider = v_attempt.provider,
      external_shipment_id = v_attempt.external_shipment_id,
      external_rate_id = v_attempt.external_rate_id,
      external_label_id = v_attempt.external_label_id,
      label_url = v_attempt.label_url,
      label_cost_cents = v_attempt.label_cost_cents,
      tracking_number = v_attempt.tracking_number,
      carrier = v_attempt.carrier,
      shipping_provider_metadata = v_attempt.provider_metadata,
      label_created_at = now()
    where organization_id = v_attempt.organization_id
      and id = v_attempt.shipment_id;
  end if;

  return v_attempt;
end;
$$;

-- Phase 2's picking service shipped with this RPC contract but without its
-- database implementation. Keep the correction here so every deployed
-- environment receives an atomic, tenant-scoped packing operation.
create or replace function public.confirm_shipment_item_pack(
  p_organization_id uuid,
  p_shipment_id uuid,
  p_barcode text,
  p_actor_user_id uuid
)
returns table (
  complete boolean,
  packed_items integer,
  status public.shipment_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shipment public.shipments%rowtype;
  v_item public.shipment_items%rowtype;
  v_matching_items integer;
  v_total_items integer;
  v_packed_items integer;
  v_normalized_barcode text := btrim(coalesce(p_barcode, ''));
  v_incremented boolean := false;
begin
  if char_length(v_normalized_barcode) not between 1 and 255 then
    raise exception using
      errcode = '22023',
      message = 'Barcode must contain between 1 and 255 characters.';
  end if;

  if not exists (
    select 1
    from public.staff_users as staff
    where staff.id = p_actor_user_id
      and staff.organization_id = p_organization_id
      and staff.status = 'active'
      and staff.role in ('owner', 'admin', 'manager', 'staff')
  ) then
    raise exception using
      errcode = '42501',
      message = 'Packing requires an active staff actor for the organization.';
  end if;

  select shipment.*
  into v_shipment
  from public.shipments as shipment
  where shipment.id = p_shipment_id
    and shipment.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Shipment not found.';
  end if;

  if v_shipment.status not in ('label_created', 'packed') then
    raise exception using
      errcode = '23514',
      message = 'Only a labeled shipment can be packed.';
  end if;

  select count(*)::integer
  into v_matching_items
  from public.shipment_items as item
  where item.organization_id = p_organization_id
    and item.shipment_id = p_shipment_id
    and item.barcode = v_normalized_barcode;

  if v_matching_items = 0 then
    raise exception using
      errcode = 'P0002',
      message = 'Barcode was not found in this shipment.';
  end if;

  if v_matching_items > 1 then
    raise exception using
      errcode = '23514',
      message = 'Barcode is ambiguous within this shipment.';
  end if;

  select item.*
  into v_item
  from public.shipment_items as item
  where item.organization_id = p_organization_id
    and item.shipment_id = p_shipment_id
    and item.barcode = v_normalized_barcode
  for update;

  if v_shipment.status = 'label_created'
    and v_item.packed_quantity < v_item.quantity
  then
    update public.shipment_items
    set packed_quantity = packed_quantity + 1
    where id = v_item.id;
    v_incremented := true;
  end if;

  select
    coalesce(sum(item.quantity), 0)::integer,
    coalesce(sum(item.packed_quantity), 0)::integer
  into v_total_items, v_packed_items
  from public.shipment_items as item
  where item.organization_id = p_organization_id
    and item.shipment_id = p_shipment_id;

  complete := v_total_items > 0 and v_packed_items = v_total_items;

  if complete and v_shipment.status = 'label_created' then
    update public.shipments as target
    set
      status = 'packed',
      packed_at = coalesce(packed_at, now())
    where target.id = p_shipment_id
      and target.organization_id = p_organization_id
    returning target.status into status;
  else
    status := v_shipment.status;
  end if;

  packed_items := v_packed_items;

  if v_incremented then
    perform public.append_audit_entry(
      p_organization_id,
      p_actor_user_id,
      'shipment.item_packed',
      'shipment',
      p_shipment_id,
      jsonb_build_object(
        'shipment_item_id', v_item.id,
        'packed_quantity', least(v_item.packed_quantity + 1, v_item.quantity),
        'required_quantity', v_item.quantity,
        'packed_items', v_packed_items,
        'complete', complete
      )
    );
  end if;

  return next;
end;
$$;

alter table public.analytics_events enable row level security;
alter table public.analytics_events force row level security;
alter table public.analytics_daily_metrics enable row level security;
alter table public.analytics_daily_metrics force row level security;
alter table public.analytics_cohort_retention enable row level security;
alter table public.analytics_cohort_retention force row level security;
alter table public.dashboard_layout_preferences enable row level security;
alter table public.dashboard_layout_preferences force row level security;
alter table public.analytics_report_schedules enable row level security;
alter table public.analytics_report_schedules force row level security;
alter table public.ml_feature_snapshots enable row level security;
alter table public.ml_feature_snapshots force row level security;
alter table public.ml_training_runs enable row level security;
alter table public.ml_training_runs force row level security;
alter table public.ml_training_rows enable row level security;
alter table public.ml_training_rows force row level security;
alter table public.ml_model_versions enable row level security;
alter table public.ml_model_versions force row level security;
alter table public.ml_churn_predictions enable row level security;
alter table public.ml_churn_predictions force row level security;
alter table public.ml_experiments enable row level security;
alter table public.ml_experiments force row level security;
alter table public.ml_drift_reports enable row level security;
alter table public.ml_drift_reports force row level security;
alter table public.ml_retraining_signals enable row level security;
alter table public.ml_retraining_signals force row level security;
alter table public.ml_high_risk_alerts enable row level security;
alter table public.ml_high_risk_alerts force row level security;
alter table public.benchmark_preferences enable row level security;
alter table public.benchmark_preferences force row level security;
alter table public.benchmark_contributions enable row level security;
alter table public.benchmark_contributions force row level security;
alter table public.benchmark_aggregates enable row level security;
alter table public.benchmark_aggregates force row level security;
alter table public.compliance_checks enable row level security;
alter table public.compliance_checks force row level security;
alter table public.shipping_label_attempts enable row level security;
alter table public.shipping_label_attempts force row level security;

create policy analytics_events_super_admin_all
on public.analytics_events
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy analytics_daily_metrics_staff_select
on public.analytics_daily_metrics
for select
to authenticated
using ((select private.is_staff_for_org(organization_id)));

create policy analytics_daily_metrics_super_admin_all
on public.analytics_daily_metrics
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy analytics_cohort_retention_staff_select
on public.analytics_cohort_retention
for select
to authenticated
using ((select private.is_staff_for_org(organization_id)));

create policy analytics_cohort_retention_super_admin_all
on public.analytics_cohort_retention
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy dashboard_layout_preferences_owner_select
on public.dashboard_layout_preferences
for select
to authenticated
using (
  staff_user_id = (select auth.uid())
  and (select private.is_staff_for_org(organization_id))
);

create policy dashboard_layout_preferences_super_admin_all
on public.dashboard_layout_preferences
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy analytics_report_schedules_owner_select
on public.analytics_report_schedules
for select
to authenticated
using (
  staff_user_id = (select auth.uid())
  and (select private.is_staff_for_org(organization_id))
);

create policy analytics_report_schedules_super_admin_all
on public.analytics_report_schedules
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy ml_feature_snapshots_super_admin_all
on public.ml_feature_snapshots
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy ml_training_runs_super_admin_all
on public.ml_training_runs
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy ml_training_rows_super_admin_all
on public.ml_training_rows
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy ml_model_versions_super_admin_all
on public.ml_model_versions
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy ml_churn_predictions_staff_select
on public.ml_churn_predictions
for select
to authenticated
using ((select private.is_staff_for_org(organization_id)));

create policy ml_churn_predictions_super_admin_all
on public.ml_churn_predictions
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy ml_experiments_super_admin_all
on public.ml_experiments
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy ml_drift_reports_super_admin_all
on public.ml_drift_reports
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy ml_retraining_signals_super_admin_all
on public.ml_retraining_signals
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy ml_high_risk_alerts_staff_select
on public.ml_high_risk_alerts
for select
to authenticated
using ((select private.is_staff_for_org(organization_id)));

create policy ml_high_risk_alerts_super_admin_all
on public.ml_high_risk_alerts
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy benchmark_preferences_staff_select
on public.benchmark_preferences
for select
to authenticated
using ((select private.is_staff_for_org(organization_id)));

create policy benchmark_preferences_super_admin_all
on public.benchmark_preferences
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy benchmark_contributions_staff_select
on public.benchmark_contributions
for select
to authenticated
using ((select private.is_staff_for_org(organization_id)));

create policy benchmark_contributions_super_admin_all
on public.benchmark_contributions
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy benchmark_aggregates_super_admin_all
on public.benchmark_aggregates
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy compliance_checks_staff_select
on public.compliance_checks
for select
to authenticated
using ((select private.is_staff_for_org(organization_id)));

create policy compliance_checks_member_select
on public.compliance_checks
for select
to authenticated
using (
  (select private.member_can_view_shipment(organization_id, shipment_id))
);

create policy compliance_checks_super_admin_all
on public.compliance_checks
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

create policy shipping_label_attempts_super_admin_all
on public.shipping_label_attempts
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

revoke all on table
  public.analytics_events,
  public.analytics_daily_metrics,
  public.analytics_cohort_retention,
  public.dashboard_layout_preferences,
  public.analytics_report_schedules,
  public.ml_feature_snapshots,
  public.ml_training_runs,
  public.ml_training_rows,
  public.ml_model_versions,
  public.ml_churn_predictions,
  public.ml_experiments,
  public.ml_drift_reports,
  public.ml_retraining_signals,
  public.ml_high_risk_alerts,
  public.benchmark_preferences,
  public.benchmark_contributions,
  public.benchmark_aggregates,
  public.compliance_checks,
  public.shipping_label_attempts
from anon, authenticated;

grant select on table
  public.analytics_daily_metrics,
  public.analytics_cohort_retention,
  public.dashboard_layout_preferences,
  public.analytics_report_schedules,
  public.ml_churn_predictions,
  public.ml_high_risk_alerts,
  public.benchmark_preferences,
  public.benchmark_contributions,
  public.compliance_checks
to authenticated;

grant all on table
  public.analytics_events,
  public.analytics_daily_metrics,
  public.analytics_cohort_retention,
  public.dashboard_layout_preferences,
  public.analytics_report_schedules,
  public.ml_feature_snapshots,
  public.ml_training_runs,
  public.ml_training_rows,
  public.ml_model_versions,
  public.ml_churn_predictions,
  public.ml_experiments,
  public.ml_drift_reports,
  public.ml_retraining_signals,
  public.ml_high_risk_alerts,
  public.benchmark_preferences,
  public.benchmark_contributions,
  public.benchmark_aggregates,
  public.compliance_checks,
  public.shipping_label_attempts
to service_role;

revoke execute on function private.seed_phase4_organization_defaults()
from public, anon, authenticated;
revoke execute on function private.reject_phase4_append_only_mutation()
from public, anon, authenticated;
revoke execute on function private.enforce_ml_training_member_split()
from public, anon, authenticated;
revoke execute on function private.enqueue_high_risk_staff_notifications()
from public, anon, authenticated;
revoke execute on function private.protect_ml_model_artifact()
from public, anon, authenticated;
revoke execute on function private.ml_feature_vector(public.ml_feature_snapshots)
from public, anon, authenticated;
revoke execute on function private.ml_probability(jsonb, numeric, jsonb, jsonb)
from public, anon, authenticated;
revoke execute on function private.ml_top_features(jsonb, jsonb, jsonb)
from public, anon, authenticated;
revoke execute on function private.next_analytics_report_at(
  public.analytics_report_frequency,
  smallint,
  smallint,
  smallint,
  timestamptz
) from public, anon, authenticated;
revoke execute on function private.report_attachments_are_valid(jsonb)
from public, anon, authenticated;
revoke execute on function private.enforce_compliance_before_label()
from public, anon, authenticated;
revoke execute on function private.shipment_compliance_fingerprint(uuid, uuid)
from public, anon, authenticated;
revoke execute on function private.invalidate_shipment_compliance()
from public, anon, authenticated;
revoke execute on function private.invalidate_dependent_compliance()
from public, anon, authenticated;
revoke execute on function private.get_analytics_dashboard_raw(uuid, date, date)
from public, anon;
revoke execute on function private.get_benchmark_comparison_raw(uuid, date)
from public, anon;
revoke execute on function private.get_compliance_dashboard_rows(
  uuid,
  uuid,
  public.compliance_check_status,
  integer,
  integer
) from public, anon;

revoke execute on function public.record_analytics_event(
  uuid, uuid, text, jsonb, text, timestamptz
) from public, anon, authenticated;
revoke execute on function public.refresh_analytics_snapshots(date, uuid)
from public, anon, authenticated;
revoke execute on function public.backfill_analytics_snapshots(date, date, uuid)
from public, anon, authenticated;
revoke execute on function public.enqueue_analytics_report_artifact(
  uuid, uuid, date, date, text, text, text, jsonb, text, uuid
) from public, anon, authenticated;
revoke execute on function public.enqueue_due_analytics_reports(timestamptz)
from public, anon, authenticated;
revoke execute on function public.get_due_benchmark_report_recipients(timestamptz)
from public, anon, authenticated;
revoke execute on function public.refresh_ml_feature_store(date, uuid)
from public, anon, authenticated;
revoke execute on function public.create_ml_training_run(
  date, date, date, public.ml_training_source, uuid
) from public, anon, authenticated;
revoke execute on function public.get_ml_training_dataset(uuid)
from public, anon, authenticated;
revoke execute on function public.register_ml_model_version(
  uuid, text, text, jsonb, jsonb, numeric, jsonb, jsonb,
  text, numeric, timestamptz, uuid
) from public, anon, authenticated;
revoke execute on function public.start_ml_experiment(uuid, uuid)
from public, anon, authenticated;
revoke execute on function public.start_eligible_ml_experiment(uuid, uuid)
from public, anon, authenticated;
revoke execute on function public.complete_ml_experiment(
  uuid, numeric, numeric, numeric, numeric, integer, uuid
) from public, anon, authenticated, service_role;
revoke execute on function public.evaluate_due_ml_experiments(timestamptz)
from public, anon, authenticated;
revoke execute on function public.promote_ml_model_version(uuid, uuid)
from public, anon, authenticated;
revoke execute on function public.record_ml_drift_report(
  uuid, date, integer, numeric, jsonb
) from public, anon, authenticated;
revoke execute on function public.refresh_ml_drift_reports(date)
from public, anon, authenticated;
revoke execute on function public.run_ml_lifecycle(timestamptz)
from public, anon, authenticated;
revoke execute on function public.score_ml_churn_batch(date, uuid)
from public, anon, authenticated;
revoke execute on function public.refresh_benchmark_contributions(date)
from public, anon, authenticated;
revoke execute on function public.refresh_benchmark_aggregates(date)
from public, anon, authenticated;
revoke execute on function public.record_shipment_compliance_check(
  uuid, uuid, public.compliance_check_status, text, integer,
  text, text, timestamptz, uuid, jsonb
) from public, anon, authenticated;
revoke execute on function public.set_validated_shipment_address(
  uuid, uuid, public.address_validation_status, jsonb, jsonb, uuid
) from public, anon, authenticated;
revoke execute on function public.acquire_shipping_label_attempt(
  uuid, uuid, text, uuid, integer, text
) from public, anon, authenticated;
revoke execute on function public.persist_shipping_label_external_shipment(
  uuid, text, text, text
) from public, anon, authenticated;
revoke execute on function public.complete_shipping_label_attempt(
  uuid, text, text, text, text, text, text, integer, jsonb, text
) from public, anon, authenticated;
revoke execute on function public.confirm_shipment_item_pack(
  uuid, uuid, text, uuid
) from public, anon, authenticated;

grant execute on function public.record_analytics_event(
  uuid, uuid, text, jsonb, text, timestamptz
) to service_role;
grant execute on function public.refresh_analytics_snapshots(date, uuid)
to service_role;
grant execute on function public.backfill_analytics_snapshots(date, date, uuid)
to service_role;
grant execute on function public.enqueue_analytics_report_artifact(
  uuid, uuid, date, date, text, text, text, jsonb, text, uuid
) to service_role;
grant execute on function public.enqueue_due_analytics_reports(timestamptz)
to service_role;
grant execute on function public.get_due_benchmark_report_recipients(timestamptz)
to service_role;
grant execute on function public.refresh_ml_feature_store(date, uuid)
to service_role;
grant execute on function public.create_ml_training_run(
  date, date, date, public.ml_training_source, uuid
) to authenticated, service_role;
grant execute on function public.get_ml_training_dataset(uuid)
to authenticated, service_role;
grant execute on function public.register_ml_model_version(
  uuid, text, text, jsonb, jsonb, numeric, jsonb, jsonb,
  text, numeric, timestamptz, uuid
) to authenticated, service_role;
grant execute on function public.start_ml_experiment(uuid, uuid)
to authenticated, service_role;
grant execute on function public.start_eligible_ml_experiment(uuid, uuid)
to service_role;
grant execute on function public.evaluate_due_ml_experiments(timestamptz)
to service_role;
grant execute on function public.promote_ml_model_version(uuid, uuid)
to authenticated, service_role;
grant execute on function public.record_ml_drift_report(
  uuid, date, integer, numeric, jsonb
) to authenticated, service_role;
grant execute on function public.refresh_ml_drift_reports(date)
to service_role;
grant execute on function public.run_ml_lifecycle(timestamptz)
to service_role;
grant execute on function public.score_ml_churn_batch(date, uuid)
to service_role;
grant execute on function public.refresh_benchmark_contributions(date)
to service_role;
grant execute on function public.refresh_benchmark_aggregates(date)
to service_role;
grant execute on function public.record_shipment_compliance_check(
  uuid, uuid, public.compliance_check_status, text, integer,
  text, text, timestamptz, uuid, jsonb
) to service_role;
grant execute on function public.set_validated_shipment_address(
  uuid, uuid, public.address_validation_status, jsonb, jsonb, uuid
) to service_role;
grant execute on function public.acquire_shipping_label_attempt(
  uuid, uuid, text, uuid, integer, text
) to service_role;
grant execute on function public.persist_shipping_label_external_shipment(
  uuid, text, text, text
) to service_role;
grant execute on function public.complete_shipping_label_attempt(
  uuid, text, text, text, text, text, text, integer, jsonb, text
) to service_role;
grant execute on function public.confirm_shipment_item_pack(
  uuid, uuid, text, uuid
) to service_role;

revoke execute on function public.get_analytics_dashboard(uuid, date, date)
from public, anon;
revoke execute on function public.get_analytics_series(
  uuid, text, date, date
) from public, anon;
revoke execute on function public.save_dashboard_layout(uuid, uuid, jsonb)
from public, anon;
revoke execute on function public.save_analytics_dashboard_layout(
  uuid, uuid, jsonb
) from public, anon;
revoke execute on function public.get_analytics_dashboard_layout(uuid, uuid)
from public, anon;
revoke execute on function public.upsert_analytics_report_schedule(
  uuid, uuid, public.analytics_report_frequency, smallint, smallint,
  smallint, text[], boolean, public.analytics_report_type
) from public, anon;
revoke execute on function public.list_analytics_report_schedules(uuid, uuid)
from public, anon;
revoke execute on function public.list_churn_intelligence(
  uuid, text, text, integer, integer
) from public, anon;
revoke execute on function public.get_member_churn_intelligence(uuid, uuid)
from public, anon;
revoke execute on function public.get_ml_operations_status()
from public, anon;
revoke execute on function public.acknowledge_ml_high_risk_alert(
  uuid, uuid, uuid
) from public, anon;
revoke execute on function public.set_benchmark_preferences(
  uuid, boolean, boolean, uuid
) from public, anon;
revoke execute on function public.set_benchmark_opt_in(
  uuid, boolean, boolean, uuid
) from public, anon;
revoke execute on function public.get_benchmark_comparison(uuid, date)
from public, anon;
revoke execute on function public.get_peer_benchmark(uuid, date)
from public, anon;
revoke execute on function public.get_shipment_compliance_check(uuid, uuid)
from public, anon;
revoke execute on function public.get_latest_shipment_compliance(uuid, uuid)
from public, anon;
revoke execute on function public.get_compliance_dashboard(
  uuid, uuid, public.compliance_check_status, integer, integer
) from public, anon;
revoke execute on function public.get_release_compliance_queue(uuid, uuid)
from public, anon;

grant execute on function public.get_analytics_dashboard(uuid, date, date)
to authenticated, service_role;
grant execute on function public.get_analytics_series(uuid, text, date, date)
to authenticated, service_role;
grant execute on function public.save_dashboard_layout(uuid, uuid, jsonb)
to authenticated, service_role;
grant execute on function public.save_analytics_dashboard_layout(
  uuid, uuid, jsonb
) to authenticated, service_role;
grant execute on function public.get_analytics_dashboard_layout(uuid, uuid)
to authenticated, service_role;
grant execute on function public.upsert_analytics_report_schedule(
  uuid, uuid, public.analytics_report_frequency, smallint, smallint,
  smallint, text[], boolean, public.analytics_report_type
) to authenticated, service_role;
grant execute on function public.list_analytics_report_schedules(uuid, uuid)
to authenticated, service_role;
grant execute on function public.list_churn_intelligence(
  uuid, text, text, integer, integer
) to authenticated, service_role;
grant execute on function public.get_member_churn_intelligence(uuid, uuid)
to authenticated, service_role;
grant execute on function public.get_ml_operations_status()
to authenticated, service_role;
grant execute on function public.acknowledge_ml_high_risk_alert(
  uuid, uuid, uuid
) to authenticated, service_role;
grant execute on function public.set_benchmark_preferences(
  uuid, boolean, boolean, uuid
) to authenticated, service_role;
grant execute on function public.set_benchmark_opt_in(
  uuid, boolean, boolean, uuid
) to authenticated, service_role;
grant execute on function public.get_benchmark_comparison(uuid, date)
to authenticated, service_role;
grant execute on function public.get_peer_benchmark(uuid, date)
to authenticated, service_role;
grant execute on function public.get_shipment_compliance_check(uuid, uuid)
to authenticated, service_role;
grant execute on function public.get_latest_shipment_compliance(uuid, uuid)
to authenticated, service_role;
grant execute on function public.get_compliance_dashboard(
  uuid, uuid, public.compliance_check_status, integer, integer
) to authenticated, service_role;
grant execute on function public.get_release_compliance_queue(uuid, uuid)
to authenticated, service_role;

comment on table public.analytics_events is
  'Minimized, append-only behavioral events. Direct identifiers and raw email addresses are rejected.';
comment on table public.ml_training_runs is
  'Immutable training provenance. Synthetic fixtures can validate code but are never production-promotable.';
comment on table public.ml_model_versions is
  'Interpretable L2 logistic artifacts with immutable temporal validation, confusion, calibration, and rules-baseline metrics.';
comment on table public.benchmark_aggregates is
  'Platform-only k-anonymous peer aggregates; browser RPCs expose count bands and percentiles only.';
comment on table public.compliance_checks is
  'Append-only ShipCompliant results. Provider credentials remain environment-only and are never stored here.';
comment on function public.promote_ml_model_version(uuid, uuid) is
  'Fails closed unless production history has at least 500 members, 50 cancellations, temporal AUC >= 0.82, and a superior completed 30-day A/B result.';
comment on function public.record_shipment_compliance_check(
  uuid, uuid, public.compliance_check_status, text, integer,
  text, text, timestamptz, uuid, jsonb
) is
  'Persists a minimized provider result, syncs the shipment, and notifies members on blocked or unknown outcomes. API credentials are supplied only by the Worker environment.';

commit;
