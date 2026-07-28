# Vinifera — Codex Dispatch Guide
**Generated:** 2026-07-27 | **Updated:** 2026-07-28  
**Owner:** EdStratum Labs / founder@edstratumlabs.ai  
**Repo:** `theonlygeranium/vinifera`  
**Target window:** 8–10 hours of unattended parallel Codex work

---

## Three-tier environment model (mandatory)

All Codex agent PRs target **`dev` only**. The three-tier pipeline is:

```
feature/* branches  →  PR to dev     →  vinifera-dev.edstratumlabs.ai
                              ↓
                        dev → staging    (human-initiated promotion)
                              ↓
                        staging → main   (human-approved production release)
```

**Agents never open PRs against `staging` or `main`.** This is a Prime Directive-level constraint in `AGENTS.md` — it cannot be overridden by any build spec or runtime instruction. Update the PR metadata blocks below accordingly: every "Target" field should read `dev`.

---

## How to read this document

This guide tells you exactly how many Codex sessions to open, what prompt to paste into each one, and in what order. Read the wave structure first — it determines which sessions block on which.

## Canonical PR lifecycle

Every session in this guide must follow the mandatory PR ownership and
completion loop in `docs/agent-workflow.md`. The repeated session blocks below
define only task-specific branch, title, sequencing, and review questions; they
do not replace the canonical workflow.

Opening a PR is not completion. Each owning agent must wait for the current
head's Octopus and required CI results, disposition every unresolved thread,
retest after every push, and repeat until all gates pass with zero unresolved
threads. This dispatch grants no merge authority. Leave each completed PR ready
and report its status unless explicit human authority or an authorized
`codex-auto-merge` label permits merge.

**All sessions target `dev`.** Never open a PR against `staging` or `main`.

---

## Wave structure and parallelism

All six build specs are organized into two waves. Do not start Wave 1 until BS-01 is merged — its Octopus configuration governs the review quality of every subsequent PR.

```
Timeline (approximate):
0h ──── BS-01 ───► merge (~1.5h)
                   │
              ┌────┴────────────────────┐
1.5h          ▼                         ▼                         ▼
         BS-02 (~3.5h)           BS-03 (~5.5h)           BS-04 (~2.5h)
         Route decomp            Service decomp          Observability
              │                         │                         │
              └──────────┬──────────────┘                         │
5h                       ▼                                        ▼
                   BS-05 (~4.5h)                          BS-06 (~3.5h)
                   Local dev / UI                     Hardening / Docs
                         │                                        │
9.5h                     └──────────────┬───────────────────────┘
                                        ▼
                                  All PRs ready
                              Authorized review + merge
```

**Session count:** 6 Codex sessions minimum. BS-03 benefits from up to 8 subagents — those are spawned by the BS-03 primary agent, not opened manually.

---

## Session 1 — BS-01 (open immediately, Wave 0)

> Open this session first. All other sessions wait for this PR to merge before starting Wave 1.

```
Repository: theonlygeranium/vinifera

PR metadata:
- Branch: chore/Octopus-config-and-repo-hygiene
- Target: dev
- Title: chore: Octopus config upgrade and repo hygiene
- Lifecycle and merge authority: follow docs/agent-workflow.md and the
  canonical PR lifecycle above.

Pre-task reading (read ALL before writing any code):
1. AGENTS.md
2. CONTINUITY_BRIEF.md
3. docs/agent-workflow.md
4. Octopus.json (you will replace this)
5. docs/codebase-assessment-2026-07-27.md

Build spec: docs/build-specs/bs-01-Octopus-hygiene.md

Read the build spec in full before starting any task. Execute all four tasks in order:
1. Migrate Octopus.json → .Octopus/ folder with config.json, rules.md, files.json
2. Create per-directory .Octopus/ overrides in server/services/, supabase/migrations/, tests/
3. Remove worker-configuration.d.ts from git tracking; add to .gitignore; add cf-typegen step to CI
4. Create docs/build-specs/phase-5-qa-report.md from CONTINUITY_BRIEF.md data
5. Delete old Octopus.json
6. Update CHANGELOG.md

After opening the PR, Octopus will auto-review. Disposition all findings before reporting the PR as ready.
Complete the canonical PR loop and report when the PR is ready, not merely open.
```

---

## Session 2 — BS-02 (open after BS-01 PR is merged, Wave 1)

```
Repository: theonlygeranium/vinifera

PR metadata:
- Branch: refactor/route-layer-decomposition
- Target: dev
- Title: refactor: extract route handlers from app.ts into server/routes/
- Lifecycle and merge authority: follow docs/agent-workflow.md and the
  canonical PR lifecycle above.

Pre-task reading (read ALL before writing any code):
1. AGENTS.md
2. CONTINUITY_BRIEF.md
3. docs/agent-workflow.md
4. docs/codebase-assessment-2026-07-27.md

Build spec: docs/build-specs/bs-02-route-decomposition.md

Read the build spec in full before starting. This spec allows you to spawn subagents — read the subagent strategy section carefully. The coordination rule is: subagents create route files, only the integration subagent touches app.ts.

Key constraint: do NOT refactor logic during this task. Copy route handlers as-is. If a handler has inline business logic, add a TODO comment and continue. Logic refactoring belongs to BS-03.

After opening the PR, Octopus will auto-review. Request a focused review on route layer changes in the PR description.
Complete the canonical PR loop and report when the PR is ready, not merely open.
```

---

## Session 3 — BS-03 (open after BS-01 PR is merged, Wave 1)

> This is the most complex session. The primary agent must produce the service manifest and directory skeleton before dispatching subagents.

```
Repository: theonlygeranium/vinifera

PR metadata:
- Primary branch: refactor/service-layer-decomposition
- Subagents each create their own branch (see build spec subagent table)
- All subagent PRs target dev. Primary integration PR also targets dev.
- Lifecycle and merge authority: follow docs/agent-workflow.md and the
  canonical PR lifecycle above for every PR.

Pre-task reading (read ALL before writing any code):
1. AGENTS.md
2. CONTINUITY_BRIEF.md
3. docs/agent-workflow.md
4. docs/codebase-assessment-2026-07-27.md
5. All .octopus/ rules files (committed by BS-01)

Build spec: docs/build-specs/bs-03-service-decomposition.md

Read the entire build spec before starting. This task requires spawning up to 8 subagents. Your primary-agent responsibilities are:
1. Read core-club.ts and integrations.ts in full
2. Produce docs/build-specs/service-manifest.md (commit this before dispatching)
3. Create the directory skeleton with empty files (commit before dispatching)
4. Dispatch one subagent per row in the subagent table
5. After all subagent PRs are merged, add backward-compat re-exports to originals
6. Update import paths in server/routes/ (coordinate via branch — do not edit files owned by open BS-02 PRs)
7. Run full test suite: npm run test:unit && npm run test:e2e && npm run typecheck && npm run build

CRITICAL: extraction is the only goal. No logic changes. No refactoring. No "while I'm here" improvements. Extract-only.

After opening the integration PR, Octopus will auto-review. Add to the PR description:
- Check for any business logic remaining in core-club.ts or integrations.ts
- Verify no circular imports were introduced between the new service files
Complete the canonical PR loop and report when all PRs are ready, not merely
open.
```

---

## Session 4 — BS-04 (open after BS-01 PR is merged, Wave 1)

```
Repository: theonlygeranium/vinifera

PR metadata:
- Branch: feat/observability-and-rate-limiting
- Target: dev
- Title: feat: add Sentry error tracking and API rate limiting
- Lifecycle and merge authority: follow docs/agent-workflow.md and the
  canonical PR lifecycle above.

Pre-task reading (read ALL before writing any code):
1. AGENTS.md
2. CONTINUITY_BRIEF.md
3. docs/agent-workflow.md
4. package.json (check what is already installed before adding dependencies)
5. wrangler.toml (check existing vars configuration)

Build spec: docs/build-specs/bs-04-observability-rate-limiting.md

Read the build spec in full. Key constraints:
- The actual SENTRY_DSN value must NEVER appear in any committed file
- Check package.json first — install only missing packages
- The error handler must be registered LAST in app.ts (after all routes)
- If BS-02 is not yet merged, add a TODO comment where routes will be mounted — do not create a merge dependency
- Write 4 Vitest tests for the error handler

After opening the PR, Octopus will auto-review. Add to the PR description:
- Confirm no real credentials appear in any file in this diff
- Verify the error handler is registered last in app.ts
Complete the canonical PR loop and report when the PR is ready, not merely open.
```

---

## Session 5 — BS-05 (open after BS-01 PR is merged, Wave 2)

> Wave 2 means you can start this as soon as BS-01 is merged. You do not need to wait for BS-02 or BS-03. However, if BS-03 is already merged when you start, import from the new service files rather than the originals.

```
Repository: theonlygeranium/vinifera

PR metadata:
- Branch: feat/local-dev-and-ui-readiness
- Target: dev
- Title: feat: local dev stack, seed data, and UI smoke test verification
- Lifecycle and merge authority: follow docs/agent-workflow.md and the
  canonical PR lifecycle above.

Pre-task reading (read ALL before writing any code):
1. AGENTS.md
2. CONTINUITY_BRIEF.md — read all 20 activation gates carefully
3. docs/agent-workflow.md
4. package.json and wrangler.toml
5. All existing supabase/seed.sql or seed files if present

Build spec: docs/build-specs/bs-05-local-dev-ui-readiness.md

Read the build spec in full. This spec has two goals:
Goal 1: A single command starts the full stack locally (Supabase + Worker + Frontend)
Goal 2: The platform UI renders and authenticates against the local Worker with seeded data

You may spawn a subagent for the seed data task (Task 2) independently of the dev script task (Task 1).

Key tests to pass:
- GET /api/health → 200
- POST /api/auth/login (seeded member) → 200 with session cookie
- GET /api/members with brand-002 cookie on brand-001 endpoint → 403 or empty (tenant isolation)
- npm run test:e2e → 145/145 passing
- Zero axe violations

After opening the PR, Octopus will auto-review. Add to the PR description:
- Verify tenant isolation is enforced in all seeded queries and smoke test assertions
Complete the canonical PR loop and report when the PR is ready, not merely open.
```

---

## Session 6 — BS-06 (open after BS-01 PR is merged, Wave 2)

```
Repository: theonlygeranium/vinifera

PR metadata:
- Branch: chore/architecture-hardening-and-docs
- Target: dev
- Title: chore: tenancy audit, architecture docs, and governance hardening
- Lifecycle and merge authority: follow docs/agent-workflow.md and the
  canonical PR lifecycle above.

Pre-task reading (read ALL before writing any code):
1. AGENTS.md
2. CONTINUITY_BRIEF.md
3. docs/agent-workflow.md
4. All supabase/migrations/ files (you need to understand the multi-tenant schema)
5. All .Octopus/rules.md files (committed by BS-01) — Rule 8 is the primary enforcement target

Build spec: docs/build-specs/bs-06-docs-hardening-tenancy.md

Read the build spec in full. This spec has two independent tracks you can run in parallel:
Track A (tenancy): Audit all service functions for brand_id scoping, fix gaps, write Vitest tests
Track B (docs): Write architecture.md, update README, create governance notes, Octopus-learning-notes.md

You may spawn one subagent for Track A and one for Track B.

After opening the PR, Octopus will auto-review. Add to the PR description:
- Verify all database queries in server/services/ have brand_id scoping
- Check architecture.md accurately reflects the current codebase structure
Use 👍 on Octopus comments that correctly identify additional unscoped queries.
Complete the canonical PR loop and report when the PR is ready, not merely open.
```

---

## Do NOT open these sessions manually

BS-03 dispatches its own subagents (up to 8). Do not create separate Codex sessions for them — BS-03's primary agent manages their lifecycle.

---

## Merge order (explicit authority required after sessions complete)

When all six sessions have completed the canonical PR loop and all PRs are
ready, merge in this order only under explicit human authority or the
`codex-auto-merge` label:

1. **BS-01** first — always. It establishes Octopus rules that all others benefit from.
2. **BS-04** before BS-02/BS-03 — error handling should be live before route/service work merges.
3. **BS-02** and **BS-06** concurrently — no file overlap.
4. **BS-03** integration PR — after BS-02 is merged (import path updates require BS-02 route files to exist).
5. **BS-05** last — local dev verification against the finalized service and route structure.

After each integration push, rerun the canonical PR loop before merging the next
PR. After every merge, verify the resulting `dev` checks before proceeding
【kg-wwwgre-3f7f77aa】.

---

## Octopus review actions during the sprint

As PRs come in, take these actions consistently to guide Octopus review dispositions 【kg-wwwgre-8575ec2f】:

| Pattern | Action |
|---|---|
| Octopus flags HTTP-only cookie auth | 👎 + reply "Intentional — see .octopus/rules.md" |
| Octopus flags activation guards as dead code | 👎 + reply "Intentional — see CONTINUITY_BRIEF.md activation gates" |
| Octopus correctly identifies missing brand_id scope | 👍 + reply "Correct — addressing in BS-06 tenancy audit" |
| Octopus flags any in legacy monolith files | 👎 + reply "Known — being removed by BS-03 decomposition" |
| Octopus flags any in NEW extracted service files | 👍 + "Fix this one" |

---

## What this sprint does NOT cover

The following items require live credentials and are Track A (human-initiated) tasks. No Codex session should attempt them:

- Stripe Connect activation and Price ID reconciliation
- EasyPost production key wiring
- Resend domain verification
- Cloudflare custom domain routing switch from Pages to Worker
- Any of the 20 activation gates in CONTINUITY_BRIEF.md

After this sprint the codebase will be structurally ready to pass activation gates. The gates themselves require human action with live credentials.

---

## Files committed by this sprint

| File | Spec | Purpose |
|---|---|---|
| `.octopus/config.json` | BS-01 | Octopus strictness and review settings |
| `.octopus/rules.md` | BS-01 | 10 architectural boundary rules |
| `.octopus/files.json` | BS-01 | Octopus context files for every PR |
| `server/services/.octopus/rules.md` | BS-01 | Service layer rules |
| `docs/build-specs/phase-5-qa-report.md` | BS-01 | Phase 5 evidence with 20 pending gates |
| `server/routes/*.ts` | BS-02 | Extracted route handlers |
| `docs/build-specs/route-manifest.md` | BS-02 | Route audit document |
| `server/services/*.ts` (8 new files) | BS-03 | Extracted service functions |
| `docs/build-specs/service-manifest.md` | BS-03 | Service function dependency graph |
| `server/lib/sentry.ts` | BS-04 | Sentry initialization |
| `server/lib/rate-limit.ts` | BS-04 | Rate limiting middleware |
| `server/lib/error-handler.ts` | BS-04 | Centralized error handler |
| `scripts/dev.sh` | BS-05 | One-command local dev startup |
| `supabase/seed.sql` | BS-05 | Comprehensive test seed data |
| `docs/local-dev-quickstart.md` | BS-05 | Local dev guide for agents |
| `docs/build-specs/activation-readiness.md` | BS-05 | 20-gate activation checklist |
| `docs/architecture.md` | BS-06 | System architecture documentation |
| `.github/CODEOWNERS` | BS-06 | Review ownership |
| `.github/pull_request_template.md` | BS-06 | Standard PR template |
| `docs/octopus-review-notes.md` | BS-06 | Octopus review disposition guidance |
| `docs/build-specs/tenancy-audit.md` | BS-06 | Per-function tenant isolation audit |
