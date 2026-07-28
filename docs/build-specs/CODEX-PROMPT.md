# Vinifera — Codex Agent Dispatch Prompt

This file contains the dispatch prompts for Codex agents working on the Vinifera repository. The **Structural Hardening Sprint (BS-01 through BS-06) is complete and merged to `main`**. The codebase is now modular, observable, and structurally ready for Track A activation work.

---

## Before You Start

Read these four files in full before dispatching any agent:

1. `AGENTS.md` — prime directives, file ownership, and review protocol
2. `CONTINUITY_BRIEF.md` — current state, all 20 activation gates, what is and is not live
3. `docs/agent-workflow.md` — branching rules and PR review loop
4. `docs/architecture.md` — current topology, tenant model, provider guards

Every dispatched prompt inherits the mandatory PR ownership and completion loop
in `docs/agent-workflow.md`. Opening a PR is not completion. These prompts
grant no merge authority: after all required checks pass and zero unresolved
review threads remain, leave the PR ready and report its status.

---

## Current Repository State (v0.5.0)

All build specs have been merged. The following structural work is complete:

| Spec | Status | What it delivered |
|------|--------|-------------------|
| BS-01 | ✅ Merged | `.greptile/` architectural rules, repo hygiene, Phase 5 QA report |
| BS-02 | ✅ Merged | 129 Express routes extracted into `server/routes/` domain files |
| BS-03 | ✅ Merged | `core-club.ts` and `integrations.ts` decomposed into domain service modules |
| BS-04 | ✅ Merged | Sentry observability + per-tenant rate limiting |
| BS-05 | ✅ Merged | `npm run dev` local stack with seeded tenants, authenticated smoke tests |
| BS-06 | ✅ Merged | Tenancy audit, `docs/architecture.md`, governance ADR, Greptile training notes |

**Verified test baseline:** 448 Vitest · 250/199/158/513 DB assertions · 145 Playwright/axe

---

## Next Work: Track A — Hosted Activation

The next milestone is transitioning from operationally dormant to live. This requires connecting real hosted credentials through the 20 activation gate sequence documented in `CONTINUITY_BRIEF.md`.

**Gate sequence (must be completed in order by a human operator):**

1. Provision hosted Supabase staging project → apply all 22 migrations → run pgTAP
2. Deploy `vinifera-staging` Worker → verify `/api/health` returns JSON
3. Configure Supabase Auth (custom access-token hook, 900-second OTP expiry, Google OAuth, SMTP relay)
4. Reconcile Stripe Price catalog from prior run `30218801133` using fixed lookup keys; bootstrap/verify all four recurring Prices; register `/api/billing/webhook`
5. Wire EasyPost test API key + winery origin address
6. Verify Resend sending domain (DKIM/SPF)
7. Run ten-member full billing proof cycle (charge, fulfill, track, email)

**Note:** Gates 1–7 require credentials and are human-operator work. Codex agents should not attempt to pass any activation gate without explicit human instruction.

---

## Active Dispatch: Maintenance and Enhancement Work

The following prompt templates are ready for Codex dispatch. Each targets incremental improvement without touching activation gates.

---

### PROMPT: Track A Support — Pre-Activation Readiness Verification

**Use when:** You want to verify everything is in order before beginning hosted credential work.

```
You are executing a pre-activation readiness verification for the Vinifera repository
(theonlygeranium/vinifera).

Before writing a single line of code, read these files in full:
1. AGENTS.md
2. CONTINUITY_BRIEF.md
3. docs/agent-workflow.md
4. docs/architecture.md

Your task is a read-only source audit — do not modify any application source, migration, or configuration file. Your only output is the report document below. Produce a verification report covering:

1. All 22 supabase/migrations/ files — confirm sequential numbering with no gaps
2. CONTINUITY_BRIEF.md activation gate list — confirm all 20 gates are accurately described
3. docs/architecture.md — confirm it matches the current server/routes/ and server/services/ structure
4. package.json scripts — confirm all QA commands referenced in AGENTS.md are present
5. .greptile/ config — confirm architectural rules are present and non-empty
6. CHANGELOG.md — confirm [Unreleased] section is current

Produce your report as docs/pre-activation-audit-YYYY-MM-DD.md.

Branch: docs/pre-activation-audit
PR target: main
PR title: docs: pre-activation readiness audit

Follow docs/agent-workflow.md through all required checks and zero unresolved
review threads. This prompt grants no merge authority; leave the PR ready and
report its final status.
```

---

### PROMPT: Dependency Audit and Update

**Use when:** You want to ensure all dependencies are current and audit-clean before activation.

```
You are executing a dependency audit and update for the Vinifera repository
(theonlygeranium/vinifera).

Before writing a single line of code, read these files in full:
1. AGENTS.md
2. CONTINUITY_BRIEF.md
3. docs/agent-workflow.md

Your task:
1. Run npm audit --audit-level=moderate and document all findings
2. Run npm outdated and document all outdated packages
3. For any package with a security advisory at moderate or higher: produce a targeted
   fix using npm audit fix (no --force) and verify all test suites still pass
4. Do NOT update major versions without separate human authorization
5. Update CHANGELOG.md with all dependency changes

Acceptance criteria:
- npm audit --audit-level=moderate exits 0
- All test counts at or above: 448 Vitest, 145 Playwright/axe
- No TypeScript errors (npm run check)

Branch: chore/dependency-audit-YYYY-MM-DD
PR target: main
PR title: chore: dependency audit and security patch (YYYY-MM-DD)

Follow docs/agent-workflow.md through all required checks and zero unresolved
review threads. This prompt grants no merge authority; leave the PR ready and
report its final status.
```

---

### PROMPT: CONTINUITY_BRIEF.md Refresh

**Use when:** The activation gate status or architecture description has drifted from reality.

```
You are executing a CONTINUITY_BRIEF.md refresh for the Vinifera repository
(theonlygeranium/vinifera).

Before writing a single line of code, read these files in full:
1. AGENTS.md
2. CONTINUITY_BRIEF.md (your primary target)
3. docs/agent-workflow.md
4. docs/architecture.md
5. CHANGELOG.md

Your task:
1. Read CONTINUITY_BRIEF.md in full
2. Cross-reference every claim against the current source tree and CHANGELOG.md
3. Update any description that has drifted from the actual codebase state
4. Do NOT change any activation gate status — gate statuses are human-owner-only
5. Update CHANGELOG.md

Branch: docs/continuity-brief-refresh
PR target: main
PR title: docs: refresh CONTINUITY_BRIEF.md to current source state

Follow docs/agent-workflow.md through all required checks and zero unresolved
review threads. This prompt grants no merge authority.
```

---

### PROMPT: AGENTS.md Architecture Section Update

**Use when:** A significant structural change (new service domain, new route group, new workflow)
has been merged and AGENTS.md Section 3 needs to reflect it.

```
You are updating AGENTS.md to reflect recent structural changes in the Vinifera repository
(theonlygeranium/vinifera).

Before writing a single line of code, read these files in full:
1. AGENTS.md (your primary target — Section 3 and ownership table)
2. CONTINUITY_BRIEF.md
3. docs/agent-workflow.md
4. The CHANGELOG.md entry for the change you are documenting

Your task:
1. Update Section 3 repository structure tree to match the current file system
2. Update the ownership table to include any new directories or files
3. Do NOT modify Section 2 (Prime Directives) without a corresponding ADR
4. Do NOT modify the ownership policy for any file without human authorization
5. Create an ADR in docs/decisions/ if you are proposing a policy change
6. Update CHANGELOG.md

Branch: docs/agents-md-architecture-update
PR target: main
PR title: docs: update AGENTS.md architecture section

Follow docs/agent-workflow.md through all required checks and zero unresolved
review threads. Human owner must review and merge this PR — do not request
auto-merge.
```

---

## Notes for All Dispatched Agents

- Every agent must update `CHANGELOG.md` in their commit per repo convention.
- `AGENTS.md` changes require human owner review and merge — do not bypass this.
- Greptile reviews every PR. Use 👍 when Greptile correctly identifies missing `brand_id` scoping. Use 👎 when Greptile incorrectly suggests switching to Bearer headers for web routes or removing activation guards.
- CodeRabbit reviews every PR. All findings must be dispositioned before a PR is ready to merge.
- The dispatch guide (`docs/build-specs/CODEX-DISPATCH-GUIDE.md`) contains the full BS-01 through BS-06 history, context, and merge order for reference.
- No agent activates a hosted gate without explicit human instruction. The platform is credential-gated by design.