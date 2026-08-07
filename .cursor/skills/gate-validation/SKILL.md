---
name: gate-validation
description: How to run and interpret Vinifera promotion gate acceptance scripts, including Phase 5 DB verification and Gate 6 Phase 2 acceptance testing.
paths:
  - "scripts/**"
  - "supabase/**"
  - ".github/workflows/**"
---

# Gate Validation Skill

This skill provides domain knowledge for running and interpreting Vinifera promotion gate acceptance scripts.

## Gate Structure

The Vinifera project uses a two-speed validation model with numbered activation gates. Each gate has an associated acceptance script in `scripts/`.

## Key Acceptance Scripts

### Phase 5 DB Verification (`scripts/verify-phase5-db.mjs`)
- Verifies database state after Phase 5 migrations
- Checks migration numbering (watch for allocation gaps — e.g., 030 → 032 with 031 missing)
- Runs pgTAP tests against the database

### Gate 6 Phase 2 Acceptance (`scripts/hosted-gate6-phase2-acceptance.mjs`)
- Tests Supabase admin client configuration
- Verifies `redirect: "error"` and origin bounding on fetch calls
- Checks that Worker request helpers use `redirect: "error"` (not `redirect: "manual"`)

## Running Tests

```bash
# Run all tests
npm test

# Run a specific acceptance script
node scripts/hosted-gate6-phase2-acceptance.mjs

# Run the full test suite (591 tests expected to pass)
npm run test:all
```

## Interpreting Results

- **591/591 passing:** Clean state, safe to proceed
- **Skipped tests (not failed):** May indicate runner/control-plane cancellation, not a source regression. Check if the test job status is `skipped` vs `failed`.
- **Failed tests:** Investigate the specific test. Check if it's a structural string-match test (e.g., pgTAP test 028) or a functional test.

## Common False Positives

1. **PR #300 label TOCTOU:** The policy test (`two-speed-review-policy.test.mjs` line 159) deliberately asserts preview workflows should NOT contain `human-review-required`/`do-not-merge` checks. Adding these checks to preview workflows is a false positive.

2. **PR #307 `create_brand` authorization:** The `create_brand` function contains a proper `is_service_role()` / `is_staff_for_org()` + `all_brands` guard. Flagging it as a cross-tenant isolation defect is a false positive.

3. **PR #307 `sharp` devDependency:** `sharp` in the production build path is a deployment-environment concern, not a source bug. Don't patch the dependency classification.

## Gate CI Status

When reviewing CI for a gate PR:
1. Check if the test job is `skipped` or `failed` — skipped usually means runner cancellation
2. Check if the failure exists on the base commit (if so, it's pre-existing, not introduced)
3. Look for control-plane cancellation messages in the logs
4. Only flag as a true failure if the test job status is `failed` with an actual test assertion error
