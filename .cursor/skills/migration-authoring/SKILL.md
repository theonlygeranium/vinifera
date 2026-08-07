---
name: migration-authoring
description: Conventions for authoring Supabase migrations, including numbering rules, allocation gaps, and hash canonicalization requirements.
paths:
  - "supabase/migrations/**"
  - "scripts/**"
---

# Migration Authoring Skill

This skill provides conventions for authoring Supabase migrations in the Vinifera project.

## Migration Numbering

- Migrations live in `supabase/migrations/` and are numbered sequentially
- Before creating a new migration, check the highest existing number across all branches and open PRs
- Do not reuse migration numbers
- Do not silently fill allocation gaps — a missing number may belong to a migration in another PR

## Allocation Gaps

If you discover a gap (e.g., 030 → 032 with 031 missing):
1. Document it in the PR description
2. Check open PRs for a migration at the missing number
3. If 031 merges first, the Phase 5 DB coverage script (`verify-phase5-db.mjs`) will have a gap
4. Coordinate with the PR owner to resolve the numbering conflict before merge

## Hash Canonicalization

PostgreSQL `jsonb::text` serialization is used for attestation hash computation. This is a critical and undocumented behavior:

- The output of `jsonb::text` is sensitive to PostgreSQL version and configuration
- Manifest authors must reproduce the hash byte-identically or attestation will always mismatch
- Do not assume a canonical JSON format — test against the actual database output
- If you are writing or modifying attestation logic, verify the hash matches the database's actual `jsonb::text` output

## pgTAP Test Coverage

- Attestation RPCs currently have no functional SQL-layer test coverage
- pgTAP test 028 is purely structural (string-matching on function definitions)
- If you add a new attestation RPC, write a functional pgTAP test, not just a structural one

## Brand ID Scoping

Every migration that creates or modifies tenant data must include `brand_id` as a column or filter:
- New tables: include `brand_id uuid not null` column
- New RPCs: accept `brand_id` as a parameter and filter on it
- Service-role queries that span tenants: use `is_service_role()` / `is_staff_for_org()` + `all_brands`

## Testing Migrations

Before submitting a PR with a new migration:
1. Run the migration locally against a clean database
2. Run the relevant acceptance test scripts
3. Verify existing pgTAP tests still pass
4. Check for migration number collisions with open PRs
5. If the migration modifies attestation logic, verify the hash computation matches the database output
