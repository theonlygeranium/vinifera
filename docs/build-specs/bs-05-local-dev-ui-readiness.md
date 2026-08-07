# BS-05 — Local Dev Environment + UI Platform Readiness

**Wave:** 2 (start after BS-01 merges; ideally after BS-02 and BS-03 are merged or in-flight)
**Branch:** `feat/local-dev-and-ui-readiness`
**Estimated duration:** 4–5 hours
**Parallel-safe:** Yes — no file overlap with BS-03, BS-04 in Wave 2
**Spawns subagents:** Recommended — seed data and UI wiring can run concurrently
**Goal:** Produce a working local environment where the actual Vinifera platform UI renders, authenticates, and displays real seeded data — not the static prototype

---

## Mandatory pre-task reading

1. `AGENTS.md`
2. `CONTINUITY_BRIEF.md` — read the 20 activation gates and identify which gates can be simulated locally without live credentials
3. `docs/agent-workflow.md`
4. `docs/codebase-assessment-2026-07-27.md` §5 — "UI readiness" and local dev gaps
5. `package.json` — understand existing dev scripts
6. All seed data files under `supabase/` if they exist
7. `wrangler.toml` — note the `[dev]` section for local Worker configuration

---

## Context: what "UI readiness" means

The Vinifera codebase passes 145 Playwright tests and all CI checks. However, the custom domain still serves the static Pages prototype — the actual platform UI (members dashboard, club admin panel, tier management, order history) has never been rendered against a live Worker. This spec's job is to close that gap locally so the final activation handoff (Track A) connects to a validated UI, not a theoretical one.

The test is simple: after completing this spec, an agent or human should be able to run `npm run dev` (or equivalent), navigate to `http://localhost:8788`, authenticate as a seeded member, and see a populated dashboard with real data flowing from the local Worker through Supabase local to the React frontend. Activation Gate 1 cannot be called "passed" until this is demonstrably true.

---

## Task 1: Audit and fix the local dev startup sequence

Read `package.json` and all scripts. Map the exact command sequence needed to start the full stack locally:
1. Supabase local (via Supabase CLI)
2. Wrangler dev server
3. Frontend dev server (Vite or equivalent)

If these three cannot be started with a single command, create `scripts/dev.sh`:

```bash
#!/usr/bin/env bash
set -e

echo "Starting Vinifera local dev stack..."

# 1. Supabase local
echo "[1/3] Starting Supabase local..."
supabase start

# 2. Seed database (idempotent)
echo "[2/3] Seeding database..."
supabase db seed

# 3. Worker + Frontend (via wrangler dev or turbo/concurrently)
echo "[3/3] Starting Worker + Frontend..."
npx concurrently \
  "wrangler dev --local" \
  "npm run dev:frontend"
```

Make `scripts/dev.sh` executable (`chmod +x`). Document it in `README.md` under a new "Local Development" section.

---

## Task 2: Create comprehensive seed data

This is the most important task in this spec. Without realistic seed data, the UI cannot be meaningfully tested.

Create or expand `supabase/seed.sql` to include:

### Brands (multi-tenant test data)
```sql
-- Two test brands for multi-tenant isolation testing
INSERT INTO brands (id, name, slug, domain, stripe_account_id)
VALUES
  ('brand-test-001', 'Sunrise Valley Wine Club', 'sunrise-valley', 'localhost', 'acct_test_sunrise'),
  ('brand-test-002', 'Pacific Crest Cellar', 'pacific-crest', 'localhost-2', 'acct_test_pacific')
ON CONFLICT (id) DO NOTHING;
```

### Members (varied states)
Create at minimum:
- 5 active members with paid subscriptions for `brand-test-001`
- 2 members in `pending` state (enrolled but not yet charged)
- 1 member with a lapsed/cancelled subscription
- 1 member with a failed payment (to test error states in the UI)
- 2 members for `brand-test-002` (to verify tenant isolation — they must not appear in brand-001 views)

All members must use `@example.com` email addresses. No real personal data.

### Tiers
Create 3 tiers for `brand-test-001`:
- `Essential` — 2 bottles/quarter, $89
- `Reserve` — 4 bottles/quarter, $159
- `Collector` — 6 bottles/quarter, $249

### Orders
Create at minimum:
- 3 fulfilled orders (status: `shipped`) with tracking numbers (`EZDEMO123456`)
- 2 orders in `processing` state
- 1 order in `failed` state

### Clubs
At minimum one club per brand with the correct `brand_id` foreign key.

---

## Task 3: Verify Supabase local migrations run cleanly

```bash
supabase db reset
supabase db seed
```

Both commands must complete without errors. If any migration fails locally that passes in CI, identify the discrepancy and fix it. Document any divergence between local and CI migration state in `docs/build-specs/local-dev-notes.md`.

---

## Task 4: Verify Worker boot against local Supabase

Start the Worker in local mode:
```bash
wrangler dev --local --persist
```

Make the following HTTP requests and confirm responses:

| Request | Expected response |
|---------|------------------|
| `GET /api/health` | `200 { status: "ok" }` |
| `GET /api/members` (no auth) | `401 Unauthorized` |
| `POST /api/auth/login` (seeded member creds) | `200` with session cookie |
| `GET /api/members` (with session cookie) | `200` with member array |
| `GET /api/members` (brand-002 cookie on brand-001 endpoint) | `403` or empty array (tenant isolation) |

Document the results in `docs/build-specs/local-dev-notes.md`. If any request returns an unexpected result, fix it — do not document a failure as acceptable.

---

## Task 5: Wire the frontend to the local Worker

Read the frontend entry point (likely `src/main.tsx` or equivalent). Identify where the API base URL is configured. Verify:

1. In `development` mode, the frontend calls `http://localhost:8788` (or the wrangler dev port)
2. In `production` mode, it calls the configured production domain
3. There is no hardcoded production URL in the development build

If a `.env.local` file does not exist, create `.env.local.example`:
```
VITE_API_BASE_URL=http://localhost:8788
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=your-local-anon-key-from-supabase-start
```

Add `.env.local` to `.gitignore` if not already present.

---

## Task 6: Run a full UI smoke test

Using Playwright (do not write new tests — use the existing 145):

```bash
npm run test:e2e
```

All 145 tests must pass against the local stack. If any test that previously passed in CI now fails locally, the local environment has a configuration gap — fix the gap, not the test.

If axe-core accessibility tests are part of the E2E suite (they are, per CONTINUITY_BRIEF.md), they must also pass with zero violations.

---

## Task 7: Create a `docs/local-dev-quickstart.md` guide

Write a concise guide (under 500 words) that covers the exact steps to go from a fresh clone to a running local stack with populated data. Target audience: a Codex agent that has never worked on this repo. Include:

1. Prerequisites (`node`, `supabase CLI`, `wrangler CLI`, versions)
2. Run `scripts/dev.sh`
3. Credentials for seeded test accounts
4. How to verify the stack is working (hit `/api/health`)
5. Known issues and workarounds discovered during this spec

---

## Task 8: Document activation readiness

Create `docs/build-specs/activation-readiness.md`. This file will be the living checklist used during Track A (Staged Activation). It should list all 20 gates from `CONTINUITY_BRIEF.md` with:

- Gate number and description
- Current status: `pending`, `local-verified`, or `live-passed`
- What evidence is required to mark it `live-passed`
- Which build spec or Track A task is responsible

After completing this spec, mark any gate that was verified locally (Task 4 results) as `local-verified`. All others remain `pending`.

---

## CHANGELOG entry

```markdown
### Added
- `scripts/dev.sh`: Single-command local dev stack startup (Supabase + Wrangler + Frontend)
- `supabase/seed.sql`: Comprehensive seed data — 2 brands, 8+ members with varied states, 3 tiers, 6 orders
- `docs/local-dev-quickstart.md`: Step-by-step local dev guide for agents and contributors
- `docs/build-specs/local-dev-notes.md`: Worker / Supabase local verification results
- `docs/build-specs/activation-readiness.md`: 20-gate activation checklist with local/live status tracking
- `.env.local.example`: Frontend environment variable template

### Fixed
- Frontend API base URL now correctly uses `VITE_API_BASE_URL` in development (no hardcoded production URLs)
```

---

## Acceptance criteria

- [ ] `scripts/dev.sh` exists, is executable, and starts the full stack without manual steps
- [ ] `supabase/seed.sql` contains 2 brands, 8+ members, 3 tiers, 6 orders
- [ ] `supabase db reset && supabase db seed` completes without errors
- [ ] All 5 HTTP smoke tests in Task 4 pass with expected responses
- [ ] Tenant isolation verified: brand-002 member cannot see brand-001 data
- [ ] Frontend calls `http://localhost:8788` in development mode (no hardcoded prod URLs)
- [ ] `npm run test:e2e` passes (145/145) against local stack
- [ ] Zero axe violations in local E2E run
- [ ] `docs/local-dev-quickstart.md` exists and is under 500 words
- [ ] `docs/build-specs/activation-readiness.md` exists with all 20 gates listed
- [ ] `CHANGELOG.md` updated

---

## Greptile workflow

After opening the PR:
1. Comment `@greptileai verify tenant isolation is enforced in all seeded queries and smoke test assertions`
2. Comment `@greptileai check that no real credentials or DSN values appear in .env.local.example`
3. Greptile has context from CONTINUITY_BRIEF.md (via `.greptile/files.json` from BS-01) and will identify if any activation gate logic in the Worker looks inconsistent with the smoke test results