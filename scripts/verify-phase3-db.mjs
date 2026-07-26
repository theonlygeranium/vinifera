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
      "Phase 3 database verification requires @electric-sql/pglite.",
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

const migrations = [
  "supabase/migrations/202607260001_phase_1_foundation.sql",
  "supabase/migrations/202607260002_phase_2_core_club_loop.sql",
  "supabase/migrations/202607260003_phase_3_retention_comms.sql",
];
const tests = [
  "supabase/tests/007_phase_3_schema.test.sql",
  "supabase/tests/008_phase_3_tenant_rls.test.sql",
  "supabase/tests/009_phase_3_retention_rpcs.test.sql",
];

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
    sql.match(/^select (?:ok|is|lives_ok|throws_ok)\(/gm) ?? []
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
  await database.exec(bootstrapSql);
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
  `PASS Phase 3 embedded database verification (${totalAssertions}/${totalAssertions})`,
);
console.log(
  "INFO Hosted Supabase must still run native pgcrypto and pgTAP verification.",
);
