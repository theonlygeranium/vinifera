import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const allowSkip = process.env.VINIFERA_DB_VERIFY_ALLOW_SKIP === "1";
const require = createRequire(import.meta.url);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function resolvePglite() {
  try {
    return require.resolve("@electric-sql/pglite");
  } catch {
    const message = [
      "Phase 4 database verification requires @electric-sql/pglite.",
      "Expose an existing workspace installation with NODE_PATH or install it",
      "outside this repository. Set VINIFERA_DB_VERIFY_ALLOW_SKIP=1 only when",
      "an explicit non-blocking skip is intended.",
    ].join(" ");
    if (allowSkip) {
      console.warn(`SKIP ${message}`);
      return null;
    }
    throw new Error(message);
  }
}

const pgliteEntry = resolvePglite();
if (pgliteEntry === null) process.exit(0);

const { PGlite } = await import(pathToFileURL(pgliteEntry).href);

const pointInTimeMigrations = [
  "supabase/migrations/202607260001_phase_1_foundation.sql",
  "supabase/migrations/202607260002_phase_2_core_club_loop.sql",
  "supabase/migrations/202607260003_phase_3_retention_comms.sql",
  "supabase/migrations/202607260004_phase_4_analytics.sql",
];
const pointInTimeTests = [
  "supabase/tests/010_phase_4_schema.test.sql",
  "supabase/tests/011_phase_4_tenant_rls.test.sql",
  "supabase/tests/012_phase_4_analytics_ml_compliance.test.sql",
];
const currentStackMigrations = [
  ...pointInTimeMigrations,
  "supabase/migrations/202607260005_phase_5_scale_integrations.sql",
  "supabase/migrations/202607260006_phase_5_permissions.sql",
  "supabase/migrations/202607260007_stripe_runtime_retry_safety.sql",
  "supabase/migrations/202607260008_phase_5_meta_attribution.sql",
  "supabase/migrations/202607260009_credential_envelope_rotation.sql",
  "supabase/migrations/202607260010_phase_5_tax_accounting_facts.sql",
  "supabase/migrations/202607260011_provider_activation_runtime.sql",
  "supabase/migrations/202607260012_custom_hostname_write_safety.sql",
  "supabase/migrations/202607260013_phase_2_transactional_commands.sql",
  "supabase/migrations/202607260014_phase_3_brand_retention_hardening.sql",
  "supabase/migrations/202607260015_phase_4_analytics_current_stack_hardening.sql",
];
const currentStackTests = [
  "supabase/tests/025_phase_4_current_stack_hardening.test.sql",
];

async function readRepositoryFile(relativeFile) {
  return fs.readFile(path.join(repositoryRoot, relativeFile), "utf8");
}

async function phase3Bootstrap() {
  const source = await readRepositoryFile("scripts/verify-phase3-db.mjs");
  const match = source.match(
    /const bootstrapSql = `([\s\S]*?)`;\n\nasync function readRepositoryFile/,
  );
  if (!match?.[1]) {
    throw new Error("Could not load the shared embedded PostgreSQL bootstrap.");
  }
  return match[1];
}

function assertionPlan(sql, testFile) {
  const plannedMatch = sql.match(/^select plan\((\d+)\);$/m);
  if (!plannedMatch) {
    throw new Error(`${testFile} does not declare a pgTAP plan.`);
  }
  const planned = Number(plannedMatch[1]);
  const assertions = (
    sql.match(/^select (?:ok|is|lives_ok|throws_ok)\(/gm) ?? []
  ).length;
  if (planned !== assertions) {
    throw new Error(
      `${testFile} plans ${planned} assertions but declares ${assertions}.`,
    );
  }
  return planned;
}

async function createDatabase(migrationFiles = pointInTimeMigrations) {
  const database = new PGlite();
  await database.exec(await phase3Bootstrap());
  for (const migration of migrationFiles) {
    let sql = await readRepositoryFile(migration);
    sql = sql.replace(
      "create extension if not exists pgcrypto with schema extensions;",
      "",
    );
    await database.exec(sql);
  }
  return database;
}

function expectCount(actual, expected, description) {
  if (Number(actual) !== expected) {
    throw new Error(
      `${description}: expected ${expected}, received ${String(actual)}.`,
    );
  }
}

async function runPerformanceGates() {
  const database = await createDatabase();
  const organizationId = "a1000000-0000-4000-8000-000000000001";
  const ownerId = "a1000000-0000-4000-8000-000000000002";
  const tierId = "a1000000-0000-4000-8000-000000000003";
  const runId = "a1000000-0000-4000-8000-000000000004";
  const modelId = "a1000000-0000-4000-8000-000000000005";
  const featureNames = [
    "days_since_last_shipment",
    "days_since_last_portal_login",
    "days_since_last_email_open",
    "shipments_per_year",
    "portal_logins_per_month",
    "email_opens_per_month",
    "total_lifetime_spend_cents",
    "average_shipment_value_cents",
    "email_open_rate",
    "email_click_rate",
    "loyalty_point_balance",
    "tenure_months",
    "tier_change_count",
    "decline_count",
    "decline_recovery_rate",
    "observed_expected_shipment_ratio",
  ];
  const zeroObject = Object.fromEntries(featureNames.map((name) => [name, 0]));
  const scaleObject = Object.fromEntries(featureNames.map((name) => [name, 1]));
  const baselineObject = Object.fromEntries(
    featureNames.map((name) => [name, [0.25, 0.25, 0.25, 0.25]]),
  );
  const featureImportance = featureNames.slice(0, 5).map((feature) => ({
    feature,
    importance: 0,
  }));
  const metrics = {
    accuracy: 0.85,
    auc_roc: 0.86,
    brier_score: 0.14,
    calibration_intercept: 0,
    calibration_slope: 1,
    false_negative: 20,
    false_positive: 30,
    true_negative: 370,
    true_positive: 80,
    cv_auc_mean: 0.84,
    cv_auc_stddev: 0.02,
    f1: 0.7619,
    precision: 0.7273,
    recall: 0.8,
    rules_baseline_auc: 0.72,
  };

  try {
    await database.exec(`
      insert into auth.users (id, email)
      values ('${ownerId}', 'phase4-performance-owner@example.test');
      insert into public.organizations (
        id, name, plan_tier, shipping_origin_address
      ) values (
        '${organizationId}',
        'Phase 4 Performance Winery',
        'estate',
        '{
          "company":"Phase 4 Performance Winery",
          "name":"Fulfillment",
          "phone":"+17075550100",
          "line1":"1 Winery Lane",
          "city":"Napa",
          "state":"CA",
          "postal_code":"94558",
          "country":"US"
        }'
      );
      insert into public.staff_users (id, organization_id, email, role)
      values (
        '${ownerId}',
        '${organizationId}',
        'phase4-performance-owner@example.test',
        'owner'
      );
      insert into public.club_tiers (
        id, organization_id, name, price_cents, bottle_count, frequency
      ) values (
        '${tierId}', '${organizationId}', 'Estate', 15000, 3, 'quarterly'
      );
      update public.email_templates
      set enabled = false
      where organization_id = '${organizationId}';
    `);

    const members = Array.from({ length: 10_000 }, (_, index) => ({
      email: `phase4-perf-${index + 1}@example.test`,
      id: `a2000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      joined_on: "2024-01-01",
    }));
    await database.query(
      `
        insert into public.members (
          id, organization_id, email, first_name, last_name,
          club_tier_id, joined_on
        )
        select
          fixture.id,
          $2::uuid,
          fixture.email,
          'Performance',
          'Member',
          $3::uuid,
          fixture.joined_on
        from jsonb_to_recordset($1::jsonb) as fixture (
          id uuid,
          email text,
          joined_on date
        )
      `,
      [JSON.stringify(members), organizationId, tierId],
    );

    await database.query(
      `
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
          $1::uuid,
          member.id,
          current_date,
          (row_number() over ()) % 365,
          (row_number() over ()) % 180,
          (row_number() over ()) % 90,
          4,
          2,
          3,
          60000,
          15000,
          0.5,
          0.2,
          100,
          30,
          0,
          1,
          0.5,
          1,
          ((row_number() over ()) % 100)
        from public.members as member
        where member.organization_id = $1::uuid
      `,
      [organizationId],
    );

    await database.query(
      `
        insert into public.ml_training_runs (
          id, source, status, training_cutoff, holdout_start, holdout_end,
          member_count, cancellation_count, training_row_count,
          holdout_row_count, dataset_hash, completed_at
        ) values (
          $1::uuid, 'synthetic_fixture', 'ready',
          current_date - 61, current_date - 60, current_date,
          10000, 1000, 8000, 2000, repeat('a', 64), now()
        )
      `,
      [runId],
    );
    await database.query(
      `
        insert into public.ml_model_versions (
          id, training_run_id, version, algorithm, hyperparameters,
          coefficients, intercept, training_data_size, cancellation_count,
          metrics, feature_importance, artifact_hash, deployment_status,
          high_risk_threshold, trained_at
        ) values (
          $1::uuid, $2::uuid, 'perf-v1', 'logistic_regression_l2',
          $3::jsonb, $4::jsonb, 0.9946225751, 10000, 1000,
          $5::jsonb, $6::jsonb, repeat('b', 64), 'ab_test', 0.95, now()
        )
      `,
      [
        modelId,
        runId,
        JSON.stringify({
          cross_validation_folds: 5,
          feature_means: zeroObject,
          feature_medians: zeroObject,
          feature_scales: scaleObject,
          feature_baseline_bins: baselineObject,
          regularization: 0.02,
          split_strategy: "temporal_80_20_member_disjoint",
        }),
        JSON.stringify(zeroObject),
        JSON.stringify(metrics),
        JSON.stringify(featureImportance),
      ],
    );
    await database.query(
      `
        insert into public.ml_experiments (
          model_version_id, status, started_at, planned_end_at, created_by
        ) values (
          $1::uuid, 'running', now(), now() + interval '30 days', $2::uuid
        )
      `,
      [modelId, ownerId],
    );

    const scoreStartedAt = performance.now();
    const scoreResult = await database.query(
      "select public.score_ml_churn_batch(current_date, $1::uuid) as scored_count",
      [organizationId],
    );
    const scoreElapsedMs = performance.now() - scoreStartedAt;
    expectCount(
      scoreResult.rows[0]?.scored_count,
      10_000,
      "10,000-member ML scoring result",
    );
    const persisted = await database.query(
      `
        select count(*)::integer as prediction_count
        from public.ml_churn_predictions
        where organization_id = $1::uuid
          and score between 0 and 1
          and confidence_interval_low <= score
          and confidence_interval_high >= score
          and jsonb_array_length(top_features) = 5
      `,
      [organizationId],
    );
    expectCount(
      persisted.rows[0]?.prediction_count,
      10_000,
      "persisted explainable ML predictions",
    );
    if (scoreElapsedMs >= 300_000) {
      throw new Error(
        `10,000-member ML scoring took ${scoreElapsedMs.toFixed(2)}ms; limit is 300000ms.`,
      );
    }

    await database.exec(`
      insert into public.analytics_daily_metrics (
        organization_id, metric_date, mrr_cents, active_members,
        new_members, gross_revenue_cents, net_revenue_cents,
        attempted_shipments, fulfilled_shipments, shipment_value_cents
      )
      select
        '${organizationId}',
        day::date,
        1500000,
        10000,
        10,
        600000,
        600000,
        40,
        39,
        600000
      from generate_series(
        current_date - interval '364 days',
        current_date,
        interval '1 day'
      ) as day
      on conflict (organization_id, metric_date) do nothing;
    `);
    await database.exec(
      `set request.jwt.claims = '{"role":"service_role"}';`,
    );
    const dashboardStartedAt = performance.now();
    const dashboard = await database.query(
      "select public.get_analytics_dashboard($1::uuid, current_date - 364, current_date) as payload",
      [organizationId],
    );
    const dashboardElapsedMs = performance.now() - dashboardStartedAt;
    if (!dashboard.rows[0]?.payload) {
      throw new Error("analytics dashboard performance query returned no payload");
    }
    if (dashboardElapsedMs >= 2_000) {
      throw new Error(
        `365-day analytics dashboard took ${dashboardElapsedMs.toFixed(2)}ms; limit is 2000ms.`,
      );
    }

    console.log(
      `PASS Phase 4 performance ml_score_10000=${scoreElapsedMs.toFixed(2)}ms/300000ms dashboard_365d=${dashboardElapsedMs.toFixed(2)}ms/2000ms`,
    );
  } finally {
    await database.close();
  }
}

let totalAssertions = 0;
for (const testFile of pointInTimeTests) {
  let database;
  try {
    database = await createDatabase();
    let sql = await readRepositoryFile(testFile);
    const assertions = assertionPlan(sql, testFile);
    sql = sql.replace(
      "create extension if not exists pgtap with schema extensions;",
      "",
    );
    await database.exec(sql);
    totalAssertions += assertions;
    console.log(`PASS ${testFile} (${assertions}/${assertions})`);
  } catch (error) {
    console.error(`FAIL ${testFile}`);
    throw error;
  } finally {
    await database?.close();
  }
}

for (const testFile of currentStackTests) {
  let database;
  try {
    database = await createDatabase(currentStackMigrations);
    let sql = await readRepositoryFile(testFile);
    const assertions = assertionPlan(sql, testFile);
    sql = sql.replace(
      "create extension if not exists pgtap with schema extensions;",
      "",
    );
    await database.exec(sql);
    totalAssertions += assertions;
    console.log(`PASS ${testFile} (${assertions}/${assertions})`);
  } catch (error) {
    console.error(`FAIL ${testFile}`);
    throw error;
  } finally {
    await database?.close();
  }
}

await runPerformanceGates();

console.log(
  `PASS Phase 4 embedded database verification (${totalAssertions}/${totalAssertions})`,
);
console.log(
  "INFO Hosted Supabase must still run native pgcrypto and pgTAP verification.",
);
