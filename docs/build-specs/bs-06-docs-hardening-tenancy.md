# BS-06 — Architecture Hardening, Tenancy Audit & Documentation

**Wave:** 2 (start after BS-01 merges; can run concurrently with BS-05)
**Branch:** `chore/architecture-hardening-and-docs`
**Estimated duration:** 3–4 hours
**Parallel-safe:** Yes — primarily creates/edits documentation and adds scoping guards; no overlap with BS-05 frontend work
**Spawns subagents:** Optional — tenancy audit and architecture.md can run in parallel
**Blocks:** Nothing directly, but resolves open risks that would otherwise generate Greptile noise on every subsequent PR

---

## Mandatory pre-task reading

1. `AGENTS.md`
2. `CONTINUITY_BRIEF.md`
3. `docs/agent-workflow.md`
4. `docs/codebase-assessment-2026-07-27.md` — §4 issues M-1 (rate limiting, already covered in BS-04), M-2 (self-review), and all Low-severity items
5. All `.greptile/rules.md` files committed by BS-01 — Rule 8 (tenant isolation) is the primary enforcement target
6. All `supabase/migrations/` files — you will need to understand the current multi-tenant schema to audit scoping

---

## Context: what this spec addresses

The assessment identified three structural risks that do not require credentials to fix but will accumulate technical debt silently if left open:

1. **Missing `brand_id` scoping** on some service functions — a multi-tenant data leakage risk flagged by `.greptile/rules.md` Rule 8 but requiring a human-aided audit to locate definitively
2. **Self-review permitted on protected environments** — a governance gap in `.github/CODEOWNERS` or branch protection rules
3. **`AGENTS.md` describes a static prototype** — creates structural divergence when new agents read it and form incorrect models of the system

Additionally, `docs/architecture.md` either does not exist or does not reflect the current Worker + Supabase + Pages topology. Greptile's `.greptile/files.json` (from BS-01) points at it — if it does not exist, every Greptile review is running without the architectural context file it was told to load.

---

## Task 1: Tenant isolation audit

Read every service function in `server/services/` (post BS-03 decomposition, or `server/services/core-club.ts` if BS-03 is not yet merged). For each function that executes a Supabase query:

**Check:** Does the query include a `.eq('brand_id', brandId)` or equivalent tenant scope condition?

Produce `docs/build-specs/tenancy-audit.md` with a table:

| Function | File | Has brand_id scope | Notes |
|---|---|---|---|
| `getMembers` | `services/members.ts` | ✅ | `.eq('brand_id', brandId)` on line N |
| `getOrderById` | `services/orders.ts` | ❌ | Missing — can return cross-tenant record |

For every function marked ❌:
1. Add a `brand_id` scope condition to the query
2. Verify the function signature already accepts `brandId` as a parameter — if not, add it
3. Update the caller (in routes or other services) to pass `brandId`
4. Add a Vitest test that verifies a query with the wrong `brandId` returns empty/null, not the record

**Do not change function behavior** — only add the scoping predicate. If a function's logic would change materially by adding the scope, flag it in the audit and leave it for human review.

---

## Task 2: Fix self-review on protected environments

Read `.github/CODEOWNERS` and the branch protection rules (check via GitHub API or documented in CI files).

The risk: a single developer can open and merge their own PR to `staging` or `production` branches without a second reviewer. For a solo-founder project this is pragmatic today but is an open risk to document and mitigate.

**Mitigation steps:**

1. In `.github/CODEOWNERS`, add an entry for the `main` branch owner. If `CODEOWNERS` does not exist, create it:
```
# All files require review from the repository owner
*       @theonlygeranium
```

2. Create `.github/pull_request_template.md` if it does not exist:
```markdown
## Summary
<!-- What changed and why -->

## Type of change
- [ ] Bug fix
- [ ] New feature
- [ ] Refactor (no behavior change)
- [ ] Docs
- [ ] Chore / dependency update

## Testing
- [ ] Unit tests pass (`npm run test:unit`)
- [ ] E2E tests pass (`npm run test:e2e`)
- [ ] Typecheck passes (`npm run typecheck`)
- [ ] Greptile review addressed

## Activation gates affected
<!-- List any of the 20 activation gates this PR touches or unblocks -->
None

## Risks and assumptions
<!-- Anything the reviewer should know -->
```

3. Document in `docs/build-specs/governance-notes.md`:
   - That self-review is currently permitted on `staging` and `production` branches
   - The risk level (Medium)
   - The recommended fix (require 1 reviewer on protected branches via GitHub branch protection settings — requires human action in the GitHub UI, not configurable in code)
   - A checklist item for the founder to configure once collaborators are added

---

## Task 3: Create `docs/architecture.md`

This is a critical file — it is referenced in `.greptile/files.json` (from BS-01) and will be loaded by Greptile as context for every PR review. It must accurately describe the current system.

Write `docs/architecture.md` covering:

### System overview
Describe the three-tier architecture:
1. **Cloudflare Pages** — serves the React frontend (static build)
2. **Cloudflare Worker** (`vinifera-api`) — Express-compatible API server; handles all HTTP routes, Supabase queries, and provider calls
3. **Supabase** — Postgres database with Row Level Security, Auth, and Storage

### Multi-tenant model
Describe `brand_id` as the tenant discriminator. Every data-access query must scope to `brand_id`. One Supabase instance serves all brands; isolation is enforced at the application layer (Worker) and documented in `.greptile/rules.md` Rule 8.

### Provider integrations
List all providers and their activation status:
| Provider | Purpose | Activation gate | Status |
|---|---|---|---|
| Stripe Connect | Member billing | Gate 3 | Pending |
| EasyPost | Shipment labels | Gate 6 | Pending |
| Resend | Transactional email | Gate 7 | Pending |
| Klaviyo | Member marketing | Gate 8 | Pending |

### Service layer diagram (text)
```
HTTP Request
  └─► Cloudflare Worker (app.ts)
        ├─► Auth middleware (reads HTTP-only cookie)
        ├─► Rate limiter (server/lib/rate-limit.ts)
        ├─► Route handler (server/routes/<domain>.ts)
        │     └─► Validates with Zod
        └─► Service function (server/services/<domain>.ts)
              ├─► Supabase query (always scoped to brand_id)
              └─► Provider call (only if activation guard passes)
```

### Activation gates
List all 20 gates verbatim from `CONTINUITY_BRIEF.md`. Status column: all `pending` until Track A passes them.

### File ownership
Reproduce the ownership table from `AGENTS.md` (agent must read AGENTS.md first). Do not rewrite the table — copy it exactly.

---

## Task 4: Suppress known-safe Greptile false positives

Some patterns in the codebase will generate Greptile noise that is intentional and correct. Proactively document them so the team can consistently 👎 react and suppress them faster 【kg-wwwgre-8575ec2f】.

Create `docs/greptile-learning-notes.md`:

```markdown
# Greptile Learning Notes

This file documents patterns that Greptile may flag but are intentional. 
When Greptile comments on these, 👎 react and reply with the relevant note.

## HTTP-only cookie auth
Greptile may suggest using Authorization Bearer headers for API authentication.
Vinifera uses HTTP-only cookies for web sessions by design (see architecture.md).
👎 any suggestion to switch to Bearer headers for web routes.

## Activation guards look like dead code
Provider calls are wrapped in activation guards that check environment flags.
Greptile may flag these as unreachable or unnecessary. They are correct — the 
code runs in a dormant state until the corresponding gate passes.
👎 any suggestion to remove activation guards.

## any type in legacy service files
`core-club.ts` and `integrations.ts` contain `any` types from before the 
TypeScript strict mode migration. These are being addressed in BS-03 and BS-06.
👎 Greptile comments on `any` in the original monolith files until they are deleted.
👍 Greptile comments on `any` in new service files extracted by BS-03.

## Idempotency key patterns
Stripe and EasyPost calls use database UUID columns as idempotency keys.
Greptile may suggest alternative patterns. The current pattern is intentional.
👎 suggestions to use random UUIDs or timestamps as idempotency keys.
```

---

## Task 5: Update `README.md`

Read the current `README.md`. It likely describes a prototype or lacks developer setup instructions. Without replacing substantive content, add or update the following sections:

1. **Project status** — one sentence: "v0.5.0: architecturally complete, operationally dormant pending 20 activation gates. See `CONTINUITY_BRIEF.md`."
2. **Local development** — link to `docs/local-dev-quickstart.md` (created in BS-05). If BS-05 is not yet merged, add a placeholder.
3. **Agent workflow** — one sentence linking to `docs/agent-workflow.md`
4. **Architecture** — one sentence linking to `docs/architecture.md`

Do not delete any existing content. Only add missing sections.

---

## Task 6: Write Vitest tests for tenant isolation fixes

For every function repaired in Task 1, write a Vitest test that:
1. Creates two mock `brandId` values
2. Calls the service function with `brandId-1`
3. Asserts the result does not contain any record seeded under `brandId-2`

These tests require Supabase to be mockable. If the existing test suite uses a mock Supabase client, follow the same pattern. If not, use `vi.mock` to mock the Supabase module.

Minimum: one test per repaired function. All must pass in `npm run test:unit`.

---

## CHANGELOG entry

```markdown
### Added
- `docs/architecture.md`: Current system architecture — three-tier topology, multi-tenant model, provider table, service layer diagram, all 20 activation gates
- `.github/CODEOWNERS`: Review ownership for all files
- `.github/pull_request_template.md`: Standard PR template with activation gates section
- `docs/greptile-learning-notes.md`: Greptile training guidance for intentional patterns
- `docs/build-specs/tenancy-audit.md`: Per-function tenant isolation audit results
- `docs/build-specs/governance-notes.md`: Self-review risk documentation and recommended mitigations

### Fixed
- Added `brand_id` scoping to N service functions identified in tenancy audit (see tenancy-audit.md)
- Vitest tests added for each repaired function verifying cross-tenant data isolation

### Changed
- `README.md`: Added project status, local dev, agent workflow, and architecture links
```

---

## Acceptance criteria

- [ ] `docs/architecture.md` exists, accurate, references all 20 activation gates
- [ ] `.github/CODEOWNERS` exists with `* @theonlygeranium`
- [ ] `.github/pull_request_template.md` exists with activation gates section
- [ ] `docs/greptile-learning-notes.md` exists with 4+ documented patterns
- [ ] `docs/build-specs/tenancy-audit.md` committed with full function table
- [ ] All functions marked ❌ in audit now have `brand_id` scoping
- [ ] Vitest tests added for each repaired function
- [ ] `npm run test:unit` passes (352+ tests)
- [ ] `npm run typecheck` passes
- [ ] `README.md` updated with 4 new/updated sections
- [ ] `CHANGELOG.md` updated

---

## Greptile workflow

After opening the PR:
1. Comment `@greptileai verify all database queries in server/services/ have brand_id scoping`
2. Comment `@greptileai check architecture.md accurately reflects the current codebase structure`
3. Greptile will cross-reference `docs/architecture.md` (now in its context files via `.greptile/files.json`) against the actual code and flag discrepancies — this is a high-value review
4. Use 👍 reactions on Greptile comments that correctly identify additional unscoped queries to reinforce the rule 【kg-wwwgre-8575ec2f】