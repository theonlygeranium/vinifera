import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bootstrapSql } from "./lib/pg-bootstrap.mjs";

const allowSkip = process.env.VINIFERA_DB_VERIFY_ALLOW_SKIP === "1";
const require = createRequire(import.meta.url);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function resolvePglite() {
  try {
    return require.resolve("@electric-sql/pglite");
  } catch {
    const message = [
      "Phase 3 database verification requires @electric-sql/pglite.",
      "Run npm ci to install the locked development dependency.",
      "Set VINIFERA_DB_VERIFY_ALLOW_SKIP=1 only when an explicit non-blocking",
      "skip is intended.",
    ].join(" ");
    if (allowSkip) {
      console.warn(`SKIP ${message}`);
      return null;
    }
    throw new Error(message);
  }
}

const pgliteEntry = resolvePglite();
if (pgliteEntry === null) {
  process.exit(0);
}

const { PGlite } = await import(pathToFileURL(pgliteEntry).href);

const pointInTimeMigrations = [
  "supabase/migrations/202607260001_phase_1_foundation.sql",
  "supabase/migrations/202607260002_phase_2_core_club_loop.sql",
  "supabase/migrations/202607260003_phase_3_retention_comms.sql",
];
const pointInTimeTests = [
  "supabase/tests/007_phase_3_schema.test.sql",
  "supabase/tests/008_phase_3_tenant_rls.test.sql",
  "supabase/tests/009_phase_3_retention_rpcs.test.sql",
];
const currentStackMigrations = [
  ...pointInTimeMigrations,
  "supabase/migrations/202607260004_phase_4_analytics.sql",
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
];
const currentStackTests = [
  "supabase/tests/024_phase_3_current_stack_hardening.test.sql",
];

async function readRepositoryFile(relativeFile) {
  return fs.readFile(path.join(repositoryRoot, relativeFile), "utf8");
}

async function applyMigration(database, migration) {
  let sql = await readRepositoryFile(migration);
  sql = sql.replace(
    "create extension if not exists pgcrypto with schema extensions;",
    "",
  );
  await database.exec(sql);
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

async function createDatabase(
  migrationFiles = pointInTimeMigrations,
) {
  const database = new PGlite();
  await database.exec(bootstrapSql);
  for (const migration of migrationFiles) {
    await applyMigration(database, migration);
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

async function runProcessingLeaseUpgradeGate() {
  const legacyMigrations = currentStackMigrations.slice(0, -1);
  const hardeningMigration = currentStackMigrations.at(-1);
  const database = await createDatabase(legacyMigrations);
  try {
    await database.exec(`
      insert into auth.users (id, email)
      values (
        '53000000-0000-4000-8000-000000000001',
        'phase3-upgrade-owner@example.test'
      );

      insert into public.organizations (id, name, plan_tier)
      values (
        '53000000-0000-4000-8000-000000000002',
        'Phase 3 Upgrade Winery',
        'vine'
      );

      insert into public.staff_users (id, organization_id, email, role)
      values (
        '53000000-0000-4000-8000-000000000001',
        '53000000-0000-4000-8000-000000000002',
        'phase3-upgrade-owner@example.test',
        'owner'
      );

      insert into public.email_log (
        id,
        organization_id,
        brand_id,
        trigger_type,
        is_test,
        requested_by,
        idempotency_key,
        to_email,
        subject,
        body,
        status
      )
      select
        '53000000-0000-4000-8000-000000000003',
        organization.id,
        organization.default_brand_id,
        'welcome',
        true,
        '53000000-0000-4000-8000-000000000001',
        'email:phase3:upgrade-fixture',
        'recipient@example.test',
        'Upgrade fixture',
        'Upgrade fixture body',
        'processing'
      from public.organizations as organization
      where organization.id = '53000000-0000-4000-8000-000000000002';

      insert into public.email_outbox (
        id,
        organization_id,
        brand_id,
        email_log_id,
        status,
        lease_expires_at,
        worker_id,
        attempt_count
      )
      select
        '53000000-0000-4000-8000-000000000004',
        email.organization_id,
        email.brand_id,
        email.id,
        'processing',
        now() + interval '5 minutes',
        'legacy-worker',
        5
      from public.email_log as email
      where email.id = '53000000-0000-4000-8000-000000000003';
    `);
    await applyMigration(database, hardeningMigration);
    const result = await database.query(`
      select
        status,
        lease_expires_at,
        worker_id,
        completion_token,
        attempt_count,
        last_error
      from public.email_outbox
      where id = '53000000-0000-4000-8000-000000000004'
    `);
    const row = result.rows[0];
    if (
      row?.status !== "failed" ||
      row.lease_expires_at !== null ||
      row.worker_id !== null ||
      row.completion_token !== null ||
      Number(row.attempt_count) !== 4 ||
      row.last_error !== "migration_requeued_for_completion_token"
    ) {
      throw new Error(
        `legacy processing lease was not safely requeued: ${JSON.stringify(row)}`,
      );
    }
    console.log(
      "PASS Phase 3 migration upgrade fixture requeues legacy processing leases (1/1)",
    );
  } finally {
    await database.close();
  }
}

async function runPerformanceGates() {
  const database = await createDatabase();
  const organizationId = "51000000-0000-4000-8000-000000000001";
  const ownerId = "51000000-0000-4000-8000-000000000002";

  try {
    await database.exec(`
      insert into auth.users (id, email)
      values ('${ownerId}', 'phase3-performance-owner@example.test');

      insert into public.organizations (id, name, plan_tier)
      values ('${organizationId}', 'Phase 3 Performance Winery', 'vine');

      insert into public.staff_users (id, organization_id, email, role)
      values (
        '${ownerId}',
        '${organizationId}',
        'phase3-performance-owner@example.test',
        'owner'
      );

      update public.email_templates
      set enabled = false
      where organization_id = '${organizationId}';
    `);

    const members = Array.from({ length: 1_000 }, (_, index) => ({
      email: `phase3-perf-${index + 1}@example.test`,
      first_name: "Performance",
      id: `52000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      last_name: `Member ${index + 1}`,
    }));
    await database.query(
      `
        insert into public.members (
          id,
          organization_id,
          email,
          first_name,
          last_name,
          joined_on
        )
        select
          fixture.id,
          $2::uuid,
          fixture.email,
          fixture.first_name,
          fixture.last_name,
          current_date - (fixture.member_number % 1000)
        from jsonb_to_recordset($1::jsonb) as fixture (
          id uuid,
          email text,
          first_name text,
          last_name text,
          member_number integer
        )
      `,
      [
        JSON.stringify(
          members.map((member, index) => ({
            ...member,
            member_number: index + 1,
          })),
        ),
        organizationId,
      ],
    );

    const scoreStartedAt = performance.now();
    const scoreResult = await database.query(
      "select public.calculate_nightly_churn_scores(now(), $1::uuid) as scored_count",
      [organizationId],
    );
    const scoreElapsedMs = performance.now() - scoreStartedAt;
    expectCount(
      scoreResult.rows[0]?.scored_count,
      1_000,
      "nightly churn score RPC result",
    );
    const scoreCount = await database.query(
      `
        select count(*)::integer as score_count
        from public.churn_scores
        where organization_id = $1::uuid
          and score between 0 and 100
          and contributing_factors ? 'rules_version'
      `,
      [organizationId],
    );
    expectCount(
      scoreCount.rows[0]?.score_count,
      1_000,
      "persisted explainable churn scores",
    );
    if (scoreElapsedMs >= 60_000) {
      throw new Error(
        `1,000-member scoring took ${scoreElapsedMs.toFixed(2)}ms; limit is 60000ms.`,
      );
    }

    await database.exec(`
      update public.email_templates
      set enabled = true
      where organization_id = '${organizationId}'
        and trigger_type = 'welcome';
    `);
    for (let index = 1; index <= 100; index += 1) {
      await database.query(
        `
          select public.enqueue_email_trigger(
            $1::uuid,
            $2::uuid,
            'welcome',
            $3::text,
            '{}'::jsonb,
            now()
          )
        `,
        [
          organizationId,
          `52000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          `email:performance:${index}`,
        ],
      );
    }

    const claimStartedAt = performance.now();
    const claimResult = await database.query(
      "select count(*)::integer as claimed_count from public.claim_email_outbox_batch('phase3-performance-worker', 100, 300)",
    );
    const claimElapsedMs = performance.now() - claimStartedAt;
    expectCount(
      claimResult.rows[0]?.claimed_count,
      100,
      "email outbox claim result",
    );
    const processingCount = await database.query(
      `
        select count(*)::integer as processing_count
        from public.email_outbox
        where organization_id = $1::uuid
          and status = 'processing'
          and worker_id = 'phase3-performance-worker'
      `,
      [organizationId],
    );
    expectCount(
      processingCount.rows[0]?.processing_count,
      100,
      "persisted claimed email jobs",
    );
    if (claimElapsedMs >= 10_000) {
      throw new Error(
        `100-email claim took ${claimElapsedMs.toFixed(2)}ms; limit is 10000ms.`,
      );
    }

    console.log(
      `PASS Phase 3 performance churn_1000=${scoreElapsedMs.toFixed(2)}ms/60000ms email_claim_100=${claimElapsedMs.toFixed(2)}ms/10000ms`,
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
await runProcessingLeaseUpgradeGate();

console.log(
  `PASS Phase 3 embedded database verification (${totalAssertions}/${totalAssertions})`,
);
console.log(
  "INFO Hosted Supabase must still run native pgcrypto and pgTAP verification.",
);
