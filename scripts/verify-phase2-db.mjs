import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const allowSkip = process.env.VINIFERA_DB_VERIFY_ALLOW_SKIP === "1";
const targetPhase =
  process.env.VINIFERA_DB_VERIFY_PHASE === "1" ? 1 : 2;
const require = createRequire(import.meta.url);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function resolvePglite() {
  try {
    return require.resolve("@electric-sql/pglite");
  } catch {
    const message = [
      `Phase ${targetPhase} database verification requires @electric-sql/pglite.`,
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
if (pgliteEntry === null) {
  process.exit(0);
}

const { PGlite } = await import(pathToFileURL(pgliteEntry).href);

const phase2CurrentStackMigrations = [
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
];
const migrations =
  targetPhase === 1
    ? ["supabase/migrations/202607260001_phase_1_foundation.sql"]
    : [
        "supabase/migrations/202607260001_phase_1_foundation.sql",
        "supabase/migrations/202607260002_phase_2_core_club_loop.sql",
      ];
const tests =
  targetPhase === 1
    ? [
        "supabase/tests/001_foundation_schema.test.sql",
        "supabase/tests/002_tenant_rls.test.sql",
        "supabase/tests/003_server_rpcs.test.sql",
      ]
    : [
        "supabase/tests/004_phase_2_schema.test.sql",
        "supabase/tests/005_phase_2_tenant_rls.test.sql",
        "supabase/tests/006_phase_2_server_rpcs.test.sql",
      ];
const currentStackTests =
  targetPhase === 2
    ? ["supabase/tests/023_phase_2_transactional_commands.test.sql"]
    : [];

const bootstrapSql = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create role supabase_auth_admin nologin;
  create schema auth;
  create schema extensions;
  grant usage on schema extensions to public;

  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );

  create or replace function auth.jwt()
  returns jsonb
  language sql
  stable
  set search_path = ''
  as $$
    select coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb,
      '{}'::jsonb
    );
  $$;

  create or replace function auth.uid()
  returns uuid
  language sql
  stable
  set search_path = ''
  as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid;
  $$;

  -- This PGlite build does not ship pgcrypto. The deterministic 32-byte
  -- substitute exercises hashing, uniqueness, and chain verification without
  -- changing the production migration, which continues to use SHA-256.
  create or replace function extensions.digest(value bytea, algorithm text)
  returns bytea
  language sql
  immutable
  set search_path = ''
  as $$
    select decode(
      md5(encode(value, 'hex'))
      || md5(encode(value, 'hex') || algorithm),
      'hex'
    );
  $$;

  create or replace function extensions.plan(expected integer)
  returns integer
  language sql
  as $$ select expected; $$;

  create or replace function extensions.ok(actual boolean, description text)
  returns text
  language plpgsql
  as $$
  begin
    if actual is distinct from true then
      raise exception 'not ok: %', description;
    end if;
    return description;
  end;
  $$;

  create or replace function extensions.is(
    actual anyelement,
    expected anyelement,
    description text
  )
  returns text
  language plpgsql
  as $$
  begin
    if actual is distinct from expected then
      raise exception 'not ok: % (actual %, expected %)',
        description, actual, expected;
    end if;
    return description;
  end;
  $$;

  create or replace function extensions.lives_ok(
    statement text,
    description text
  )
  returns text
  language plpgsql
  as $$
  begin
    execute statement;
    return description;
  exception when others then
    raise exception 'not ok: % (%)', description, sqlerrm;
  end;
  $$;

  create or replace function extensions.throws_ok(
    statement text,
    expected_state text,
    expected_message text,
    description text
  )
  returns text
  language plpgsql
  as $$
  begin
    execute statement;
    raise exception 'not ok: % (statement did not throw)', description;
  exception when others then
    if sqlstate <> expected_state or sqlerrm <> expected_message then
      raise exception 'not ok: % (state %, message %)',
        description, sqlstate, sqlerrm;
    end if;
    return description;
  end;
  $$;

  create or replace function extensions.finish()
  returns setof text
  language sql
  as $$ select null::text where false; $$;
`;

async function readRepositoryFile(relativeFile) {
  return fs.readFile(path.join(repositoryRoot, relativeFile), "utf8");
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

async function createDatabase(migrationFiles = migrations) {
  const database = new PGlite();
  await database.exec(bootstrapSql);
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
  const organizationId = "41000000-0000-4000-8000-000000000001";
  const ownerId = "41000000-0000-4000-8000-000000000002";
  const tierId = "41000000-0000-4000-8000-000000000003";
  const releaseId = "41000000-0000-4000-8000-000000000004";
  const releaseTierId = "41000000-0000-4000-8000-000000000005";
  const releaseWineId = "41000000-0000-4000-8000-000000000006";
  const importId = "41000000-0000-4000-8000-000000000007";
  const uploadToken =
    "phase2-performance-import-token-abcdefghijklmnopqrstuvwxyz";

  try {
    await database.exec(`
      insert into auth.users (id, email)
      values (
        '${ownerId}',
        'phase2-performance-owner@example.test'
      );

      insert into public.organizations (id, name, plan_tier)
      values (
        '${organizationId}',
        'Phase 2 Performance Winery',
        'vine'
      );

      insert into public.staff_users (id, organization_id, email, role)
      values (
        '${ownerId}',
        '${organizationId}',
        'phase2-performance-owner@example.test',
        'owner'
      );

      insert into public.club_tiers (
        id,
        organization_id,
        name,
        price_cents,
        bottle_count,
        frequency
      )
      values (
        '${tierId}',
        '${organizationId}',
        'Performance Reserve',
        12000,
        3,
        'quarterly'
      );

      insert into public.releases (
        id,
        organization_id,
        name,
        processing_date,
        embargo_date,
        status,
        created_by
      )
      values (
        '${releaseId}',
        '${organizationId}',
        'Performance Release',
        current_date,
        current_date,
        'scheduled',
        '${ownerId}'
      );

      insert into public.release_tiers (
        id,
        organization_id,
        release_id,
        tier_id
      )
      values (
        '${releaseTierId}',
        '${organizationId}',
        '${releaseId}',
        '${tierId}'
      );

      insert into public.release_wines (
        id,
        organization_id,
        release_id,
        wine_name,
        vintage,
        sku
      )
      values (
        '${releaseWineId}',
        '${organizationId}',
        '${releaseId}',
        'Performance Cabernet',
        2024,
        'PERF-CAB-24'
      );

      insert into public.release_tier_items (
        organization_id,
        release_id,
        release_tier_id,
        release_wine_id,
        quantity,
        unit_price_cents
      )
      values (
        '${organizationId}',
        '${releaseId}',
        '${releaseTierId}',
        '${releaseWineId}',
        3,
        4000
      );
    `);

    const releaseMembers = Array.from({ length: 50 }, (_, index) => ({
      email: `perf-release-${index + 1}@example.test`,
      first_name: "Performance",
      id: `42000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      last_name: `Member ${index + 1}`,
      line1: `${index + 1} Release Way`,
    }));
    await database.query(
      `
        insert into public.members (
          id,
          organization_id,
          email,
          first_name,
          last_name,
          shipping_address_line1,
          shipping_city,
          shipping_region,
          shipping_postal_code,
          club_tier_id
        )
        select
          fixture.id,
          $2::uuid,
          fixture.email,
          fixture.first_name,
          fixture.last_name,
          fixture.line1,
          'Napa',
          'CA',
          '94558',
          $3::uuid
        from jsonb_to_recordset($1::jsonb) as fixture (
          id uuid,
          email text,
          first_name text,
          last_name text,
          line1 text
        )
      `,
      [JSON.stringify(releaseMembers), organizationId, tierId],
    );

    const releaseStartedAt = performance.now();
    const releaseResult = await database.query(
      `
        select count(*)::integer as generated_count
        from public.create_release_shipments($1::uuid, $2::uuid, $3::uuid)
      `,
      [organizationId, releaseId, ownerId],
    );
    const releaseElapsedMs = performance.now() - releaseStartedAt;
    expectCount(
      releaseResult.rows[0]?.generated_count,
      50,
      "release shipment RPC result",
    );
    const releaseCounts = await database.query(
      `
        select
          (select count(*) from public.shipments where release_id = $1::uuid)
            as shipment_count,
          (
            select count(*)
            from public.shipment_items as item
            join public.shipments as shipment on shipment.id = item.shipment_id
            where shipment.release_id = $1::uuid
          ) as item_count
      `,
      [releaseId],
    );
    expectCount(
      releaseCounts.rows[0]?.shipment_count,
      50,
      "persisted release shipments",
    );
    expectCount(
      releaseCounts.rows[0]?.item_count,
      50,
      "persisted shipment item snapshots",
    );
    if (releaseElapsedMs >= 30_000) {
      throw new Error(
        `50-member release took ${releaseElapsedMs.toFixed(2)}ms; limit is 30000ms.`,
      );
    }

    await database.exec(`
      insert into public.member_imports (
        id,
        organization_id,
        upload_token_hash,
        content_sha256,
        source,
        original_filename,
        content_type,
        file_size_bytes,
        headers,
        column_mapping,
        status,
        imported_by
      )
      values (
        '${importId}',
        '${organizationId}',
        encode(
          extensions.digest(
            convert_to('${uploadToken}', 'UTF8'),
            'sha256'
          ),
          'hex'
        ),
        repeat('f', 64),
        'generic',
        'performance-1000.csv',
        'text/csv',
        128000,
        '["Email","First","Last"]'::jsonb,
        '{"email":"Email","first_name":"First","last_name":"Last"}'::jsonb,
        'previewed',
        '${ownerId}'
      );
    `);
    const importRows = Array.from({ length: 1_000 }, (_, index) => ({
      normalized: {
        email: `perf-import-${index + 1}@example.test`,
        first_name: "Imported",
        last_name: `Member ${index + 1}`,
        status: "active",
      },
      raw: {
        Email: `perf-import-${index + 1}@example.test`,
        First: "Imported",
        Last: `Member ${index + 1}`,
      },
      row_number: index + 1,
    }));
    await database.query(
      `
        insert into public.member_import_rows (
          organization_id,
          import_id,
          row_number,
          raw_data,
          normalized_data,
          status
        )
        select
          $2::uuid,
          $3::uuid,
          (fixture ->> 'row_number')::integer,
          fixture -> 'raw',
          fixture -> 'normalized',
          'valid'
        from jsonb_array_elements($1::jsonb) as staged(fixture)
      `,
      [JSON.stringify(importRows), organizationId, importId],
    );

    const importStartedAt = performance.now();
    const importResult = await database.query(
      `
        select inserted_count, failed_count
        from public.complete_member_import(
          $1::uuid,
          $2::text,
          $3::jsonb,
          $4::uuid
        )
      `,
      [
        organizationId,
        uploadToken,
        JSON.stringify({
          email: "Email",
          first_name: "First",
          last_name: "Last",
        }),
        ownerId,
      ],
    );
    const importElapsedMs = performance.now() - importStartedAt;
    expectCount(
      importResult.rows[0]?.inserted_count,
      1_000,
      "CSV import RPC inserted count",
    );
    expectCount(
      importResult.rows[0]?.failed_count,
      0,
      "CSV import RPC failed count",
    );
    const importCount = await database.query(
      `
        select count(*)::integer as imported_count
        from public.members
        where organization_id = $1::uuid
          and email like 'perf-import-%@example.test'
      `,
      [organizationId],
    );
    expectCount(
      importCount.rows[0]?.imported_count,
      1_000,
      "persisted imported members",
    );
    if (importElapsedMs >= 10_000) {
      throw new Error(
        `1,000-row import took ${importElapsedMs.toFixed(2)}ms; limit is 10000ms.`,
      );
    }

    console.log(
      `PASS Phase 2 performance release_50=${releaseElapsedMs.toFixed(2)}ms/30000ms csv_1000=${importElapsedMs.toFixed(2)}ms/10000ms`,
    );
    return { importElapsedMs, releaseElapsedMs };
  } finally {
    await database.close();
  }
}

let totalAssertions = 0;
const testCases = [
  ...tests.map((testFile) => ({ migrations, testFile })),
  ...currentStackTests.map((testFile) => ({
    migrations: phase2CurrentStackMigrations,
    testFile,
  })),
];
for (const testCase of testCases) {
  const { testFile } = testCase;
  let database;
  try {
    let sql = await readRepositoryFile(testFile);
    const assertions = assertionPlan(sql, testFile);
    sql = sql.replace(
      "create extension if not exists pgtap with schema extensions;",
      "",
    );
    database = await createDatabase(testCase.migrations);
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

if (targetPhase === 2) {
  await runPerformanceGates();
}

console.log(
  `PASS Phase ${targetPhase} embedded database verification (${totalAssertions}/${totalAssertions})`,
);
console.log(
  "INFO Hosted Supabase must still run native pgcrypto and pgTAP verification.",
);
