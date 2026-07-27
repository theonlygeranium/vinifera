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
      "Phase 5 database verification requires @electric-sql/pglite.",
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
if (pgliteEntry === null) process.exit(0);

const { PGlite } = await import(pathToFileURL(pgliteEntry).href);

const migrations = [
  "supabase/migrations/202607260001_phase_1_foundation.sql",
  "supabase/migrations/202607260002_phase_2_core_club_loop.sql",
  "supabase/migrations/202607260003_phase_3_retention_comms.sql",
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
  "supabase/migrations/202607260015_phase_4_analytics_current_stack_hardening.sql",
];
const tests = [
  "supabase/tests/013_phase_5_schema.test.sql",
  "supabase/tests/014_phase_5_multibrand_rls.test.sql",
  "supabase/tests/015_phase_5_integrations_mobile.test.sql",
  "supabase/tests/016_phase_5_backend_regressions.test.sql",
  "supabase/tests/017_stripe_runtime_retry_safety.test.sql",
  "supabase/tests/018_phase_5_meta_attribution.test.sql",
  "supabase/tests/019_credential_envelope_rotation.test.sql",
  "supabase/tests/020_phase_5_tax_accounting_facts.test.sql",
  "supabase/tests/021_provider_activation_runtime.test.sql",
  "supabase/tests/022_custom_hostname_write_safety.test.sql",
  "supabase/tests/023_phase_2_transactional_commands.test.sql",
  "supabase/tests/024_phase_3_current_stack_hardening.test.sql",
  "supabase/tests/025_phase_4_current_stack_hardening.test.sql",
];

async function readRepositoryFile(relativeFile) {
  return fs.readFile(path.join(repositoryRoot, relativeFile), "utf8");
}

async function sharedBootstrap() {
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
    sql.match(/^select (?:ok|is|isnt|lives_ok|throws_ok)\(/gm) ?? []
  ).length;
  if (planned !== assertions) {
    throw new Error(
      `${testFile} plans ${planned} assertions but declares ${assertions}.`,
    );
  }
  return planned;
}

async function createDatabase() {
  const database = new PGlite();
  await database.exec(await sharedBootstrap());
  for (const migration of migrations) {
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
  const organizationId = "f1000000-0000-4000-8000-000000000001";
  const ownerId = "f1000000-0000-4000-8000-000000000002";
  const tierId = "f1000000-0000-4000-8000-000000000003";
  const releaseId = "f1000000-0000-4000-8000-000000000004";
  const releaseTierId = "f1000000-0000-4000-8000-000000000005";
  const klaviyoConnectionId = "f1000000-0000-4000-8000-000000000006";
  const quickbooksConnectionId = "f1000000-0000-4000-8000-000000000007";

  try {
    await database.exec(`
      insert into auth.users (id, email)
      values ('${ownerId}', 'phase5-performance-owner@example.test');
      insert into public.organizations (id, name, plan_tier)
      values ('${organizationId}', 'Phase 5 Performance Winery', 'reserve');
      insert into public.staff_users (id, organization_id, email, role)
      values (
        '${ownerId}',
        '${organizationId}',
        'phase5-performance-owner@example.test',
        'owner'
      );
      insert into public.club_tiers (
        id, organization_id, name, price_cents, bottle_count, frequency
      ) values (
        '${tierId}', '${organizationId}', 'Estate', 15000, 3, 'quarterly'
      );
      insert into public.releases (
        id, organization_id, name, processing_date, embargo_date, status,
        created_by
      ) values (
        '${releaseId}', '${organizationId}', 'Performance Release',
        current_date + 2, current_date, 'scheduled', '${ownerId}'
      );
      insert into public.release_tiers (
        id, organization_id, release_id, tier_id
      ) values (
        '${releaseTierId}', '${organizationId}', '${releaseId}', '${tierId}'
      );
      update public.email_templates
      set enabled = false
      where organization_id = '${organizationId}';
    `);

    const members = Array.from({ length: 10_000 }, (_, index) => ({
      email: `phase5-perf-${index + 1}@example.test`,
      id: `f2000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    }));
    await database.query(
      `
        insert into public.members (
          id, organization_id, brand_id, email, first_name, last_name,
          club_tier_id, joined_on
        )
        select
          fixture.id,
          $2::uuid,
          organization.default_brand_id,
          fixture.email,
          'Performance',
          'Member',
          $3::uuid,
          current_date - 365
        from jsonb_to_recordset($1::jsonb) as fixture (id uuid, email text)
        cross join public.organizations as organization
        where organization.id = $2::uuid
      `,
      [JSON.stringify(members), organizationId, tierId],
    );

    const shipments = Array.from({ length: 100 }, (_, index) => ({
      id: `f3000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      member_id: members[index].id,
    }));
    await database.query(
      `
        insert into public.shipments (
          id, organization_id, member_id, release_id, release_tier_id,
          tier_id, shipping_address, charge_amount_cents, status, paid_at
        )
        select
          fixture.id,
          $2::uuid,
          fixture.member_id,
          $3::uuid,
          $4::uuid,
          $5::uuid,
          '{"line1":"1 Performance Way"}'::jsonb,
          15000,
          'charged',
          now()
        from jsonb_to_recordset($1::jsonb) as fixture (
          id uuid,
          member_id uuid
        )
      `,
      [
        JSON.stringify(shipments),
        organizationId,
        releaseId,
        releaseTierId,
        tierId,
      ],
    );

    await database.exec(`
      insert into public.integration_connections (
        id, organization_id, brand_id, integration_type,
        status, opted_in, consented_at
      )
      select
        '${klaviyoConnectionId}',
        id,
        default_brand_id,
        'klaviyo',
        'active',
        true,
        now()
      from public.organizations
      where id = '${organizationId}';
      insert into public.integration_connections (
        id, organization_id, brand_id, integration_type,
        status, opted_in, consented_at
      )
      select
        '${quickbooksConnectionId}',
        id,
        default_brand_id,
        'quickbooks',
        'active',
        true,
        now()
      from public.organizations
      where id = '${organizationId}';
      set request.jwt.claims = '{"role":"service_role"}';
    `);

    const klaviyoStartedAt = performance.now();
    const klaviyo = await database.query(
      `
        select count(*)::integer as source_count
        from public.get_klaviyo_member_source($1::uuid, 1000, null)
      `,
      [klaviyoConnectionId],
    );
    const klaviyoElapsedMs = performance.now() - klaviyoStartedAt;
    expectCount(
      klaviyo.rows[0]?.source_count,
      1000,
      "1,000-member Klaviyo source batch",
    );
    if (klaviyoElapsedMs >= 30_000) {
      throw new Error(
        `Klaviyo 1,000-member source took ${klaviyoElapsedMs.toFixed(2)}ms; limit is 30000ms.`,
      );
    }

    const quickbooksStartedAt = performance.now();
    const quickbooks = await database.query(
      `
        select count(*)::integer as source_count
        from public.get_quickbooks_transaction_source($1::uuid, 100, null)
      `,
      [quickbooksConnectionId],
    );
    const quickbooksElapsedMs = performance.now() - quickbooksStartedAt;
    expectCount(
      quickbooks.rows[0]?.source_count,
      100,
      "100-transaction QuickBooks source batch",
    );
    if (quickbooksElapsedMs >= 60_000) {
      throw new Error(
        `QuickBooks 100-transaction source took ${quickbooksElapsedMs.toFixed(2)}ms; limit is 60000ms.`,
      );
    }

    await database.exec(`
      set role authenticated;
      set request.jwt.claims =
        '{"sub":"${ownerId}","role":"authenticated","organization_id":"${organizationId}","user_role":"owner","auth_surface":"staff","platform_role":null}';
    `);
    // PGlite lazily compiles the first RLS plan. Warm it once, then use the
    // median of three cached-plan requests while preserving the production
    // requirement that a representative 10,000-row query stays below 2s.
    const isolationWarmup = await database.query(
      "select count(*)::integer as member_count from public.members",
    );
    expectCount(
      isolationWarmup.rows[0]?.member_count,
      10_000,
      "10,000-member brand-isolated staff query warm-up",
    );
    const isolationSamples = [];
    for (let sample = 0; sample < 3; sample += 1) {
      const isolationStartedAt = performance.now();
      const isolation = await database.query(
        "select count(*)::integer as member_count from public.members",
      );
      isolationSamples.push(performance.now() - isolationStartedAt);
      expectCount(
        isolation.rows[0]?.member_count,
        10_000,
        `10,000-member brand-isolated staff query sample ${sample + 1}`,
      );
    }
    isolationSamples.sort((left, right) => left - right);
    const isolationElapsedMs = isolationSamples[1];
    if (isolationElapsedMs >= 2_000) {
      throw new Error(
        `10,000-member brand isolation median took ${isolationElapsedMs.toFixed(2)}ms; limit is 2000ms.`,
      );
    }

    console.log(
      `PASS Phase 5 performance klaviyo_1000=${klaviyoElapsedMs.toFixed(2)}ms/30000ms quickbooks_100=${quickbooksElapsedMs.toFixed(2)}ms/60000ms brand_isolation_10000_median=${isolationElapsedMs.toFixed(2)}ms/2000ms`,
    );
  } finally {
    await database.close();
  }
}

let totalAssertions = 0;
for (const testFile of tests) {
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

await runPerformanceGates();

console.log(
  `PASS Phase 5 embedded database verification (${totalAssertions}/${totalAssertions})`,
);
console.log(
  "INFO Hosted Supabase must still run native pgcrypto, pgTAP, credential, and provider verification.",
);
