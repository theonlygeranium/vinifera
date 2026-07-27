# Vinifera — Codex Agent Dispatch Prompt

This file contains the exact prompts to give Codex agents for the **Vinifera Structural Hardening Sprint** (v0.5.0 → production-ready). The codebase is architecturally complete. These specs harden, decompose, and instrument it for safe parallel agent work and activation.

---

## Before You Start

Read these three files in full before dispatching any agent:

1. `AGENTS.md` — prime directives and file ownership
2. `CONTINUITY_BRIEF.md` — current state, activation gates, what is and is not live
3. `docs/build-specs/CODEX-DISPATCH-GUIDE.md` — full wave structure, merge order, and risk notes
4. `docs/agent-workflow.md` — branching rules and Greptile workflow

---

## Wave Structure

```
Wave 0 (Sequential — must merge before anything else):
  BS-01: Greptile config upgrade + repo hygiene

Wave 1 (Parallel — run simultaneously after BS-01 merges):
  BS-02: Route layer decomposition
  BS-03: Service layer decomposition
  BS-04: Observability + rate limiting

Wave 2 (Parallel — run simultaneously):
  BS-05: Local dev + platform UI readiness
  BS-06: Docs + hardening + tenancy

Merge order: BS-01 → BS-04 → (BS-02 & BS-06) → BS-03 integration → BS-05
```

---

## PROMPT: BS-01 — Greptile Config Upgrade & Repo Hygiene

**Send this to a single Codex session. Do not run in parallel with other specs.**

```
You are executing Build Spec BS-01 for the Vinifera repository (theonlygeranium/vinifera).

Before writing a single line of code, read these files in full:
1. AGENTS.md
2. CONTINUITY_BRIEF.md
3. docs/agent-workflow.md
4. docs/build-specs/bs-01-greptile-hygiene.md  ← your primary spec
5. docs/build-specs/CODEX-DISPATCH-GUIDE.md

Your spec is docs/build-specs/bs-01-greptile-hygiene.md. Read it completely before starting.

Branch: chore/bs-01-greptile-hygiene
PR target: main
PR title: chore: BS-01 — Greptile config upgrade and repo hygiene

Do NOT merge the PR. Leave it open for Greptile review and CI. Do not touch AGENTS.md.
```

---

## PROMPT: BS-02 — Route Layer Decomposition

**Run in Wave 1 after BS-01 merges. Safe to run in parallel with BS-03 and BS-04.**

```
You are executing Build Spec BS-02 for the Vinifera repository (theonlygeranium/vinifera).

Before writing a single line of code, read these files in full:
1. AGENTS.md
2. CONTINUITY_BRIEF.md
3. docs/agent-workflow.md
4. docs/build-specs/bs-02-route-decomposition.md  ← your primary spec
5. docs/build-specs/CODEX-DISPATCH-GUIDE.md

Your spec is docs/build-specs/bs-02-route-decomposition.md. Read it completely before starting.

CRITICAL: This spec is extraction-only. Do not refactor any logic. Do not change any behavior.
Move handler code from server/app.ts into domain-scoped route files verbatim.
The acceptance criterion is: git diff --stat shows only additions in server/routes/ and
deletions in server/app.ts, with zero net logic changes.

This spec explicitly instructs you to spawn subagents for domain extraction.
Read the subagent delegation instructions in the spec carefully.

Branch: refactor/bs-02-route-decomposition
PR target: main
PR title: refactor: BS-02 — decompose server/app.ts into domain-scoped route files

Do NOT merge the PR. Leave it open for Greptile review and CI.
```

---

## PROMPT: BS-03 — Service Layer Decomposition

**Run in Wave 1 after BS-01 merges. Safe to run in parallel with BS-02 and BS-04.
This is the highest-risk spec — read the risk notes in CODEX-DISPATCH-GUIDE.md.**

```
You are executing Build Spec BS-03 for the Vinifera repository (theonlygeranium/vinifera).

Before writing a single line of code, read these files in full:
1. AGENTS.md
2. CONTINUITY_BRIEF.md
3. docs/agent-workflow.md
4. docs/build-specs/bs-03-service-decomposition.md  ← your primary spec
5. docs/build-specs/CODEX-DISPATCH-GUIDE.md

Your spec is docs/build-specs/bs-03-service-decomposition.md. Read it completely before starting.

CRITICAL: This spec is extraction-only. Do not refactor any logic. Do not change any behavior.
core-club.ts (207 KB) and integrations.ts (206 KB) are decomposed by moving functions
into domain-scoped modules verbatim. No logic changes. No renames. No async refactors.

This spec explicitly instructs the primary agent to produce a manifest of all exported
functions before spawning subagents. Do the manifest step first — do not skip it.

Branch: refactor/bs-03-service-decomposition
PR target: main
PR title: refactor: BS-03 — decompose monolithic service files into domain modules

Do NOT merge the PR. Leave it open for Greptile review and CI. This PR must not merge
until BS-02 is merged first per the dispatch guide merge order.
```

---

## PROMPT: BS-04 — Observability & Rate Limiting

**Run in Wave 1 after BS-01 merges. Safe to run in parallel with BS-02 and BS-03.**

```
You are executing Build Spec BS-04 for the Vinifera repository (theonlygeranium/vinifera).

Before writing a single line of code, read these files in full:
1. AGENTS.md
2. CONTINUITY_BRIEF.md
3. docs/agent-workflow.md
4. docs/build-specs/bs-04-observability-rate-limiting.md  ← your primary spec
5. docs/build-specs/CODEX-DISPATCH-GUIDE.md

Your spec is docs/build-specs/bs-04-observability-rate-limiting.md. Read it completely before starting.

This spec adds structured error observability and per-route/per-tenant rate limiting
to the API layer. No activation gates are required — all work is credential-independent.

Branch: feat/bs-04-observability-rate-limiting
PR target: main
PR title: feat: BS-04 — add observability integration and API rate limiting

Do NOT merge the PR. Leave it open for Greptile review and CI.
```

---

## PROMPT: BS-05 — Local Dev & Platform UI Readiness

**Run in Wave 2. Can run in parallel with BS-06.**

```
You are executing Build Spec BS-05 for the Vinifera repository (theonlygeranium/vinifera).

Before writing a single line of code, read these files in full:
1. AGENTS.md
2. CONTINUITY_BRIEF.md
3. docs/agent-workflow.md
4. docs/build-specs/bs-05-local-dev-ui-readiness.md  ← your primary spec
5. docs/build-specs/CODEX-DISPATCH-GUIDE.md

Your spec is docs/build-specs/bs-05-local-dev-ui-readiness.md. Read it completely before starting.

This spec makes the actual platform UI (not the static prototype) locally runnable and
browser-testable. The goal is: npm run dev produces a fully functional local environment
where staff app, member portal, and API all work end-to-end without live credentials.

Branch: feat/bs-05-local-dev-ui-readiness
PR target: main
PR title: feat: BS-05 — local dev environment and platform UI testability

Do NOT merge the PR. Leave it open for Greptile review and CI.
```

---

## PROMPT: BS-06 — Docs, Hardening & Tenancy

**Run in Wave 2. Can run in parallel with BS-05.**

```
You are executing Build Spec BS-06 for the Vinifera repository (theonlygeranium/vinifera).

Before writing a single line of code, read these files in full:
1. AGENTS.md
2. CONTINUITY_BRIEF.md
3. docs/agent-workflow.md
4. docs/build-specs/bs-06-docs-hardening-tenancy.md  ← your primary spec
5. docs/build-specs/CODEX-DISPATCH-GUIDE.md

Your spec is docs/build-specs/bs-06-docs-hardening-tenancy.md. Read it completely before starting.

This spec covers: self-review mitigation documentation, Phase 5 QA report population,
multi-brand tenancy hardening, and architectural documentation updates.

Branch: docs/bs-06-docs-hardening-tenancy
PR target: main
PR title: docs: BS-06 — hardening documentation, tenancy audit, and QA report

Do NOT merge the PR. Leave it open for Greptile review and CI.
```

---

## Notes

- Every agent must update `CHANGELOG.md` in their commit per repo convention.
- No agent may modify `AGENTS.md` — it is human-owner-only (`founder@edstratumlabs.ai`).
- Greptile will review every PR. Use 👍 when Greptile correctly identifies missing `brand_id` scoping. Use 👎 when Greptile incorrectly suggests switching to Bearer headers for web routes or removing activation guards.
- The dispatch guide (`docs/build-specs/CODEX-DISPATCH-GUIDE.md`) contains full context, risk notes, and the complete merge order. Send it as reference context alongside this prompt when dispatching agents.