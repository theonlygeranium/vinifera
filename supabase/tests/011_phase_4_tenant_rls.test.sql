begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, private;

select plan(25);
set local request.jwt.claims = '{"role":"service_role"}';

insert into auth.users (id, email)
values
  ('b1000000-0000-4000-8000-000000000001', 'phase4-a-owner@example.test'),
  ('b1000000-0000-4000-8000-000000000002', 'phase4-b-owner@example.test'),
  ('b1000000-0000-4000-8000-000000000003', 'phase4-a-member@example.test'),
  ('b1000000-0000-4000-8000-000000000004', 'phase4-super@example.test');

insert into public.organizations (id, name, plan_tier)
values
  ('b2000000-0000-4000-8000-000000000001', 'Phase 4 RLS A', 'estate'),
  ('b2000000-0000-4000-8000-000000000002', 'Phase 4 RLS B', 'estate');

insert into public.staff_users (id, organization_id, email, role)
values
  ('b1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'phase4-a-owner@example.test', 'owner'),
  ('b1000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002', 'phase4-b-owner@example.test', 'owner');

insert into public.platform_users (id, email, role)
values (
  'b1000000-0000-4000-8000-000000000004',
  'phase4-super@example.test',
  'super_admin'
);

insert into public.members (
  id, auth_user_id, organization_id, email, first_name, last_name, joined_on
)
values
  ('b3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000001', 'phase4-a-member@example.test', 'Tenant', 'A', current_date - 400),
  ('b3000000-0000-4000-8000-000000000002', null, 'b2000000-0000-4000-8000-000000000002', 'phase4-b-member@example.test', 'Tenant', 'B', current_date - 400);

update public.email_templates set enabled = false
where organization_id in (
  'b2000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000002'
);

set local role service_role;

insert into public.analytics_events (
  organization_id, member_id, event_type, event_data, idempotency_key, occurred_at
)
values
  ('b2000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'analytics.dashboard_viewed', '{"surface":"staff"}', 'rls:event:a', now()),
  ('b2000000-0000-4000-8000-000000000002', 'b3000000-0000-4000-8000-000000000002', 'analytics.dashboard_viewed', '{"surface":"staff"}', 'rls:event:b', now());

insert into public.analytics_daily_metrics (
  organization_id, metric_date, mrr_cents, active_members
)
values
  ('b2000000-0000-4000-8000-000000000001', current_date, 10000, 1),
  ('b2000000-0000-4000-8000-000000000002', current_date, 20000, 1);

insert into public.analytics_cohort_retention (
  organization_id, cohort_month, observation_month, months_since_join,
  cohort_size, retained_members, retention_rate
)
values
  ('b2000000-0000-4000-8000-000000000001', date_trunc('month', current_date - 400)::date, date_trunc('month', current_date)::date, 13, 1, 1, 1),
  ('b2000000-0000-4000-8000-000000000002', date_trunc('month', current_date - 400)::date, date_trunc('month', current_date)::date, 13, 1, 1, 1);

insert into public.dashboard_layout_preferences (
  organization_id, staff_user_id, layout
)
values
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', '[{"widget_id":"revenue-by-tier","order":0,"size":"half","enabled":true}]'),
  ('b2000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', '[{"widget_id":"revenue-by-tier","order":0,"size":"half","enabled":true}]');

insert into public.analytics_report_schedules (
  organization_id, staff_user_id, frequency, day_of_week, next_report_at
)
values
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'weekly', 1, now() + interval '1 day'),
  ('b2000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', 'weekly', 1, now() + interval '1 day');

select public.refresh_ml_feature_store(current_date, null);

insert into public.ml_training_runs (
  id, source, status, training_cutoff, holdout_start, holdout_end, created_by
)
values (
  'b4000000-0000-4000-8000-000000000001',
  'production_history',
  'building',
  current_date - 100,
  current_date - 99,
  current_date,
  'b1000000-0000-4000-8000-000000000004'
);

insert into public.benchmark_contributions (
  organization_id, period, region_group, tier_distribution_band,
  member_count_band, metrics, opted_in
)
values
  ('b2000000-0000-4000-8000-000000000001', date_trunc('month', current_date)::date, 'CA', 'estate_heavy', 'under_250', '{"retention_rate":0.9,"average_shipment_value_cents":15000,"decline_rate":0.1,"mrr_growth_rate":0.05,"email_engagement_rate":0.5}', true),
  ('b2000000-0000-4000-8000-000000000002', date_trunc('month', current_date)::date, 'CA', 'estate_heavy', 'under_250', '{"retention_rate":0.8,"average_shipment_value_cents":12000,"decline_rate":0.2,"mrr_growth_rate":0.03,"email_engagement_rate":0.4}', true);

create function pg_temp.table_count_matches_when_selectable(
  p_table regclass,
  p_expected bigint
)
returns boolean
language plpgsql
as $$
declare
  v_actual bigint;
begin
  if not has_table_privilege('authenticated', p_table, 'SELECT') then
    return true;
  end if;
  execute format('select count(*) from %s', p_table) into v_actual;
  return v_actual = p_expected;
end;
$$;

create function pg_temp.max_mrr_matches_when_selectable(p_expected bigint)
returns boolean
language plpgsql
as $$
declare
  v_actual bigint;
begin
  if not has_table_privilege(
    'authenticated',
    'public.analytics_daily_metrics',
    'SELECT'
  ) then
    return true;
  end if;
  execute 'select max(mrr_cents) from public.analytics_daily_metrics'
    into v_actual;
  return v_actual = p_expected;
end;
$$;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated","organization_id":"b2000000-0000-4000-8000-000000000001","user_role":"owner","auth_surface":"staff","platform_role":null}';

select ok(
  pg_temp.table_count_matches_when_selectable('public.analytics_daily_metrics', 1),
  'staff aggregate visibility follows the active migration privilege boundary'
);
select ok(
  pg_temp.max_mrr_matches_when_selectable(10000),
  'staff cannot infer another tenant revenue at either privilege boundary'
);
select ok(
  pg_temp.table_count_matches_when_selectable('public.analytics_cohort_retention', 1),
  'staff cohort visibility follows the active migration privilege boundary'
);
select is((select count(*) from public.dashboard_layout_preferences), 1::bigint, 'staff sees only its saved layout');
select is((select count(*) from public.analytics_report_schedules), 1::bigint, 'staff sees only its report schedule');
select ok(
  pg_temp.table_count_matches_when_selectable('public.benchmark_preferences', 1),
  'staff benchmark-preference visibility follows the migration boundary'
);
select ok(
  pg_temp.table_count_matches_when_selectable('public.benchmark_contributions', 1),
  'staff benchmark-contribution visibility follows the migration boundary'
);
select throws_ok(
  $$ select count(*) from public.analytics_events $$,
  '42501',
  'permission denied for table analytics_events',
  'ordinary staff has no direct raw analytics privilege'
);
select throws_ok(
  $$ select count(*) from public.ml_feature_snapshots $$,
  '42501',
  'permission denied for table ml_feature_snapshots',
  'ordinary staff has no direct ML feature privilege'
);
select throws_ok(
  $$ select count(*) from public.ml_training_runs $$,
  '42501',
  'permission denied for table ml_training_runs',
  'ordinary staff has no direct training provenance privilege'
);
select throws_ok(
  $$ select count(*) from public.ml_training_rows $$,
  '42501',
  'permission denied for table ml_training_rows',
  'ordinary staff has no direct training membership privilege'
);
select throws_ok(
  $$ select count(*) from public.ml_model_versions $$,
  '42501',
  'permission denied for table ml_model_versions',
  'ordinary staff has no direct model artifact privilege'
);
select throws_ok(
  $$ select count(*) from public.ml_drift_reports $$,
  '42501',
  'permission denied for table ml_drift_reports',
  'ordinary staff has no direct global drift artifact privilege'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.get_analytics_dashboard(uuid,date,date)',
    'EXECUTE'
  ) = has_table_privilege(
    'authenticated',
    'public.analytics_daily_metrics',
    'SELECT'
  ),
  'analytics RPC privilege follows the active migration generation boundary'
);

set local request.jwt.claims =
  '{"sub":"b1000000-0000-4000-8000-000000000003","role":"authenticated","organization_id":"b2000000-0000-4000-8000-000000000001","user_role":"member","auth_surface":"member","platform_role":null}';

select ok(
  pg_temp.table_count_matches_when_selectable('public.analytics_daily_metrics', 0),
  'member cannot read winery analytics at either privilege boundary'
);
select ok(
  pg_temp.table_count_matches_when_selectable('public.analytics_cohort_retention', 0),
  'member cannot read cohort analytics at either privilege boundary'
);
select is((select count(*) from public.dashboard_layout_preferences), 0::bigint, 'member cannot read staff layouts');
select is((select count(*) from public.analytics_report_schedules), 0::bigint, 'member cannot read staff report schedules');
select ok(
  pg_temp.table_count_matches_when_selectable('public.benchmark_preferences', 0),
  'member cannot read benchmark consent at either privilege boundary'
);
select ok(
  pg_temp.table_count_matches_when_selectable('public.benchmark_contributions', 0),
  'member cannot read benchmark contributions at either privilege boundary'
);

set local request.jwt.claims =
  '{"sub":"b1000000-0000-4000-8000-000000000004","role":"authenticated","organization_id":null,"user_role":null,"auth_surface":"platform","platform_role":"super_admin"}';

select throws_ok(
  $$ select count(*) from public.analytics_events $$,
  '42501',
  'permission denied for table analytics_events',
  'super admin direct raw analytics access remains closed'
);
select lives_ok(
  $$ select * from public.get_ml_training_dataset('b4000000-0000-4000-8000-000000000001') $$,
  'super admin can use the guarded training dataset RPC'
);
select throws_ok(
  $$ select count(*) from public.ml_training_runs $$,
  '42501',
  'permission denied for table ml_training_runs',
  'super admin direct training-table access remains closed'
);
select ok(
  pg_temp.table_count_matches_when_selectable('public.analytics_daily_metrics', 2),
  'super-admin aggregate access follows the active migration boundary'
);
select ok(
  pg_temp.table_count_matches_when_selectable('public.benchmark_contributions', 2),
  'super-admin benchmark-source access follows the active migration boundary'
);

select * from finish();
rollback;
