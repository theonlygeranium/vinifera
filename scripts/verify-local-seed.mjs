import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bootstrapSql } from "./lib/pg-bootstrap.mjs";

const require = createRequire(import.meta.url);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function resolvePglite() {
  try {
    return require.resolve("@electric-sql/pglite");
  } catch {
    throw new Error(
      "Local seed verification requires @electric-sql/pglite. Run npm ci first.",
    );
  }
}

const { PGlite } = await import(pathToFileURL(resolvePglite()).href);

async function readRepositoryFile(relativeFile) {
  return fs.readFile(path.join(repositoryRoot, relativeFile), "utf8");
}

async function migrationFiles() {
  const directory = path.join(repositoryRoot, "supabase/migrations");
  return (await fs.readdir(directory))
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => `supabase/migrations/${file}`);
}

async function applySql(database, relativeFile) {
  let sql = await readRepositoryFile(relativeFile);
  sql = sql.replace(
    "create extension if not exists pgcrypto with schema extensions;",
    "",
  );
  try {
    await database.exec(sql);
  } catch (error) {
    throw new Error(`${relativeFile} failed: ${error.message}`, {
      cause: error,
    });
  }
}

function expectCount(actual, expected, description) {
  if (Number(actual) !== expected) {
    throw new Error(
      `${description}: expected ${expected}, received ${String(actual)}.`,
    );
  }
}

const expectedBrandIdentities = [
  {
    organization_id: "10000000-0000-4000-8000-000000000001",
    brand_id: "20000000-0000-4000-8000-000000000001",
  },
  {
    organization_id: "10000000-0000-4000-8000-000000000002",
    brand_id: "20000000-0000-4000-8000-000000000002",
  },
];

async function brandIdentities(database) {
  return (
    await database.query(`
      select
        organization.id::text as organization_id,
        organization.default_brand_id::text as brand_id
      from public.organizations as organization
      order by organization.id
    `)
  ).rows;
}

function expectBrandIdentities(actual, description) {
  if (JSON.stringify(actual) !== JSON.stringify(expectedBrandIdentities)) {
    throw new Error(
      `${description}: expected ${JSON.stringify(expectedBrandIdentities)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

const migrations = await migrationFiles();
const database = new PGlite();

try {
  await database.exec(bootstrapSql);

  for (const migration of migrations) {
    await applySql(database, migration);
  }
  console.log(`PASS clean migration chain (${migrations.length} migrations)`);

  await applySql(database, "supabase/seed.sql");
  console.log("PASS seed applies after a clean migration chain");

  await applySql(database, "supabase/seed.sql");
  console.log("PASS seed reapplies without duplicate trigger side effects");

  const counts = (
    await database.query(`
      select
        (select count(*) from public.organizations) as organizations,
        (select count(*) from public.brands) as brands,
        (select count(*) from public.club_tiers) as tiers,
        (select count(*) from public.members) as members,
        (select count(*) from public.releases) as releases,
        (select count(*) from public.shipments) as shipments,
        (select count(*) from public.billing_attempts) as billing_attempts
    `)
  ).rows[0];

  expectCount(counts.organizations, 2, "organization count");
  expectCount(counts.brands, 2, "brand count");
  expectCount(counts.tiers, 4, "club tier count");
  expectCount(counts.members, 11, "member count");
  expectCount(counts.releases, 1, "release count");
  expectCount(counts.shipments, 6, "shipment count");
  expectCount(counts.billing_attempts, 4, "billing attempt count");
  console.log("PASS fixture cardinality");

  const firstBrandIdentities = await brandIdentities(database);
  expectBrandIdentities(firstBrandIdentities, "primary clean brand identities");
  console.log("PASS fixed brand identities");

  const tenantCounts = (
    await database.query(`
      select
        count(*) filter (
          where organization_id = '10000000-0000-4000-8000-000000000001'
        ) as sunrise_members,
        count(*) filter (
          where organization_id = '10000000-0000-4000-8000-000000000002'
        ) as pacific_members,
        count(*) filter (where status = 'active') as active_members,
        count(*) filter (where status = 'cancelled') as cancelled_members,
        count(*) filter (
          where stripe_customer_id is null
            and status = 'active'
        ) as unbilled_active_members,
        count(*) filter (
          where split_part(email, '@', 2) <> 'example.com'
        ) as non_example_emails
      from public.members
    `)
  ).rows[0];

  expectCount(tenantCounts.sunrise_members, 9, "Sunrise member count");
  expectCount(tenantCounts.pacific_members, 2, "Pacific member count");
  expectCount(tenantCounts.active_members, 10, "active member count");
  expectCount(tenantCounts.cancelled_members, 1, "cancelled member count");
  expectCount(
    tenantCounts.unbilled_active_members,
    3,
    "unbilled active member count",
  );
  expectCount(tenantCounts.non_example_emails, 0, "non-example member emails");
  console.log("PASS tenant member mix");

  const shipmentCounts = (
    await database.query(`
      select
        count(*) filter (where status = 'charged') as charged,
        count(*) filter (where status = 'pending') as pending,
        count(*) filter (where status = 'declined') as declined,
        count(*) filter (
          where status in ('label_created', 'packed', 'shipped', 'delivered')
        ) as fulfillment_without_provider_evidence
      from public.shipments
    `)
  ).rows[0];

  expectCount(shipmentCounts.charged, 3, "charged shipment count");
  expectCount(shipmentCounts.pending, 2, "pending shipment count");
  expectCount(shipmentCounts.declined, 1, "declined shipment count");
  expectCount(
    shipmentCounts.fulfillment_without_provider_evidence,
    0,
    "provider-gated fixture count",
  );
  console.log("PASS safe shipment state mix");

  const isolation = (
    await database.query(`
      select
        (
          select count(*)
          from public.members as member
          join public.brands as brand
            on brand.id = member.brand_id
          where brand.organization_id <> member.organization_id
        )
        + (
          select count(*)
          from public.club_tiers as tier
          join public.brands as brand
            on brand.id = tier.brand_id
          where brand.organization_id <> tier.organization_id
        )
        + (
          select count(*)
          from public.shipments as shipment
          join public.members as member
            on member.id = shipment.member_id
          where member.organization_id <> shipment.organization_id
            or member.brand_id <> shipment.brand_id
        )
        + (
          select count(*)
          from public.billing_attempts as attempt
          join public.shipments as shipment
            on shipment.id = attempt.shipment_id
          where shipment.organization_id <> attempt.organization_id
            or shipment.brand_id <> attempt.brand_id
        ) as mismatches
    `)
  ).rows[0];

  expectCount(isolation.mismatches, 0, "cross-tenant fixture mismatch count");
  console.log("PASS fixture tenant isolation");

  const independentDatabase = new PGlite();
  try {
    await independentDatabase.exec(bootstrapSql);
    for (const migration of migrations) {
      await applySql(independentDatabase, migration);
    }
    await applySql(independentDatabase, "supabase/seed.sql");
    const independentBrandIdentities =
      await brandIdentities(independentDatabase);
    expectBrandIdentities(
      independentBrandIdentities,
      "independent clean brand identities",
    );
    if (
      JSON.stringify(independentBrandIdentities) !==
      JSON.stringify(firstBrandIdentities)
    ) {
      throw new Error("Independent clean databases produced different brand IDs.");
    }
    console.log("PASS brand identities match across independent clean databases");
  } finally {
    await independentDatabase.close();
  }
} finally {
  await database.close();
}
