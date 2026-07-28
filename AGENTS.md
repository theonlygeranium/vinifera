# AGENTS.md — Vinifera Agent Collaboration Guide

> **This file is mandatory reading for every AI agent that touches this repository.**
> Read it in full before making any change. No exceptions.

---

## 1. What This Repository Is

`vinifera` is a **production-grade wine club management platform** owned by EdStratum Labs. It is a full-stack SaaS application consisting of a React/Vite staff application and member portal, an Express 5 API deployed to Cloudflare Workers, a Supabase PostgreSQL database with Row-Level Security, Stripe billing, EasyPost fulfillment, Resend email, and Capacitor iOS/Android native shells.

**Live URLs:**
- `https://vinifera.edstratumlabs.ai` — Marketing site + `/app` visual prototype (static, always-on demo)
- `https://vinifera-dev.edstratumlabs.ai` — Active development environment (branch: `dev`)
- `https://vinifera-staging.edstratumlabs.ai` — Staging / validation gate (branch: `staging`)
- `https://vinifera-live.edstratumlabs.ai` — Production application (branch: `main`)

**Deployed on:** Cloudflare Pages (four projects — see Section 5)  
**Owner contact:** `founder@edstratumlabs.ai`

### Current status

v0.5.0 — source architecture complete and structurally hardened. All 6 build specs (BS-01 through BS-06) have been merged to `main`. The platform source is modular, observable, and locally runnable. All 20 hosted activation gates remain `pending` — see `CONTINUITY_BRIEF.md` for the full gate list and current state.

The public custom domain continues to serve the verified static Cloudflare Pages rollback baseline. It is **not** evidence that the Worker application is live.

### Application routes

| Route | Served by | Description |
|-------|-----------|-------------|
| `/` | `index.html` (static) | Landing page — hero vineyard illustration, features, pricing |
| `/app/*` | React staff application | Admin dashboard, members, shipments, analytics, tiers, fulfillment |
| `/portal/*` | React member portal | Self-service: preview shipments, update address, swap bottles, pause |
| `/guide/*` | `guide` (extensionless, `_redirects`) | 8-part investor's guide with sticky TOC |
| `/api/*` | Express Worker BFF | Authenticated API — all tenanted operations |
| `/.well-known/*` | Worker-generated | Mobile app association files |

---

## 2. Prime Directives for All Agents

1. **Document everything.** Every change — no matter how small — must be documented before it is committed. Non-negotiable.
2. **No silent changes.** Any modification to a config, script, or deployment file must update the relevant documentation in the same commit.
3. **Commit atomically.** One logical change per commit. Never bundle unrelated changes.
4. **Leave a trail.** Future agents — and the human owner — must be able to reconstruct exactly what was done, why, and what the state was before and after.
5. **Update CHANGELOG.md on every commit.** No exceptions.
6. **Preserve WCAG compliance.** All pages must pass axe-core with 0 WCAG 2.1 AA violations. Run the full QA suite before pushing.
7. **Test on mobile.** Every visual change must be verified at 375px viewport width. Touch targets must meet 44×44px (WCAG 2.5.5).
8. **Own every PR through completion.** Opening a PR is not completion. Use an available wait or monitoring mechanism until required CI, Octopus, and CodeRabbit pass and zero unresolved review threads remain; disposition every finding, retest and re-review after each push, and merge only with explicit human authorization. Follow the complete loop in `docs/agent-workflow.md`.
9. **Never activate a hosted gate without human authorization.** The platform is credential-gated by design. Do not attempt to connect real Supabase, Stripe, EasyPost, Resend, or DNS credentials, or to flip any activation gate to `complete`, without an explicit human instruction to do so.
10. **Respect tenant isolation.** Every database query that touches member, shipment, billing, or integration data must be scoped to `brand_id`. Missing `brand_id` predicates are a critical defect. Octopus is configured to flag these — always resolve them before merging.

---

## 3. Repository Structure

```
vinifera/
├── index.html              # Landing page (hero, features, pricing, CTA)
├── app                     # Original visual prototype (source reference + Pages rollback)
├── guide                   # Investor's guide (extensionless, served at /guide/*)
├── web/                    # Vite HTML entry points
├── src/
│   └── client/             # React staff application and member portal
├── server/                 # Express BFF and Cloudflare Worker entry
│   ├── routes/             # Domain-scoped route files (auth, billing, club, etc.)
│   ├── services/           # Domain-scoped service modules
│   └── integrations/       # Klaviyo, QuickBooks, Avalara, Meta, mobile auth, push adapters
├── supabase/
│   ├── migrations/         # 22 PostgreSQL migrations (do not modify applied migrations)
│   └── tests/              # pgTAP RLS and schema tests
├── tests/                  # Vitest unit/integration suites + Playwright E2E + axe-core
├── android/                # Capacitor Android source project
├── ios/                    # Capacitor iOS source project
├── mobile/                 # App identity, source artwork, native security, deep links
├── capacitor.config.json   # Shared native shell configuration
├── public/
│   ├── _redirects          # Route rules: /app/* /guide/*
│   └── _headers            # Security headers + Content-Type overrides
├── scripts/                # Build, QA, verification, and asset generation scripts
├── docs/                   # Architecture, setup, ADRs, runbooks, build specs
│   ├── decisions/          # Architectural Decision Records (ADRs)
│   ├── build-specs/        # BS-01 through BS-06 specs and dispatch guide
│   └── agent-workflow.md   # Branching, PR, and review loop rules
├── .github/workflows/      # 8 CI/CD workflows (see Section 5)
├── .octopus/               # Octopus architectural boundary rules
├── AGENTS.md               # YOU ARE HERE — agent collaboration guide
├── CONTINUITY_BRIEF.md     # Drop-in context for new agent sessions
├── README.md               # Project overview
├── CHANGELOG.md            # Versioned change log
├── REVERT.md               # Stable baseline and rollback guide
├── package.json            # Locked build, test, and deploy commands
└── wrangler.jsonc          # Worker, static assets, and hourly reconciliation config
```

### File and directory ownership rules

| File / Directory | Who can modify | Notes |
|-----------------|----------------|-------|
| `AGENTS.md` | Any agent via PR | Human owner **must review and merge**. Changes to Section 2 (Prime Directives) or this ownership table require a corresponding ADR in `docs/decisions/`. See ADR `docs/decisions/2026-07-28-agents-md-governance-update.md`. |
| `CONTINUITY_BRIEF.md` | Any agent | Must reflect current reality — update after every session |
| `README.md` | Any agent | Must reflect reality — no aspirational content |
| `CHANGELOG.md` | Any agent | Required on every commit |
| `REVERT.md` | Any agent | Update whenever a new stable tag is created |
| `.env.example` | Any agent | Real secrets NEVER go here |
| `docs/` | Any agent | Must stay in sync with actual architecture |
| `docs/decisions/` | Any agent | Add an ADR for every architectural or security decision |
| `.octopus/` | Any agent via PR | Changes to architectural rules require human review before merge |
| `src/client/` | Any agent | Verify WCAG + mobile after any visual change |
| `server/routes/` | Any agent | Extraction-only unless a new domain is being added — no logic changes during refactors |
| `server/services/` | Any agent | `brand_id` scoping is mandatory on every data-access function |
| `server/integrations/` | Any agent | All integrations must fail closed when credentials are absent |
| `supabase/migrations/` | Any agent via PR | Never modify an applied migration — always add a forward migration |
| `tests/` | Any agent | Never delete existing tests without documented justification |
| `.github/workflows/` | Any agent via PR | Human review required before merge; direct-push guard must remain enabled |
| `index.html` | Any agent | Verify WCAG after changes |
| `app` | Any agent | Visual prototype — verify WCAG + mobile |
| `guide` | Any agent | Investor's guide — verify WCAG + mobile |
| `public/_redirects` | Any agent | Test routing rules after changes |
| `public/_headers` | Any agent | Test security headers after changes |

---

## 4. Mandatory Documentation Standards

### 4.1 Every commit must include

- **What changed:** Every file modified and what was altered.
- **Why it changed:** The reason or requirement that motivated the change.
- **Impact on deployment:** Whether the change affects routing, Worker behavior, database state, or activation gates.
- **Verification steps:** How to confirm the change worked — include specific test commands and counts.

### 4.2 Commit message format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

<body — what changed and why>

Verification: <commands run and results, e.g. "npm run check; 448/448 Vitest; 145/145 Playwright/axe">
```

**Types:** `feat`, `fix`, `docs`, `chore`, `refactor`, `perf`, `test`, `ci`

### 4.3 CHANGELOG.md format

Every commit must add an entry under `[Unreleased]` using [Keep a Changelog](https://keepachangelog.com/) format.

### 4.4 Architectural Decision Records (ADRs)

Whenever an architectural, technology, security, or governance decision is made, create an ADR in `docs/decisions/`.

**Filename:** `docs/decisions/YYYY-MM-DD-short-title.md`

Decisions that **require** an ADR: changes to activation gate logic, new external provider integrations, changes to RLS policy, changes to Prime Directives or AGENTS.md ownership rules, changes to CI pipeline enforcements.

---

## 5. CI/CD and Deployment

The repository has **8 GitHub Actions workflows** under `.github/workflows/`:

| Workflow file | Trigger | What it does |
|--------------|---------|-------------|
| `ci.yml` | PR, push to main | TypeScript check, Vitest (448+ tests), Phase 2–5 DB gates, Playwright/axe (145 tests) |
| `direct-push-guard.yml` | Push to main | Enforces no direct commits reach main without a merged PR; fails closed |
| `hosted-readiness.yml` | Manual, protected | Apply Supabase migrations + deploy isolated `vinifera-staging` Worker (credential-gated) |
| `production-worker-release.yml` | Manual, protected | Deploy production Worker, domain move, Pages rollback (credential-gated) |
| `stripe-test-catalog.yml` | Manual, protected | Stripe test Price catalog bootstrap and reconciliation |
| `stripe-live-billing-cutover.yml` | Manual, protected | Stripe live billing cutover (live-mode credential-gated) |
| `credential-envelope-rotation.yml` | Manual, protected | Rotate encrypted credential envelopes |
| `mobile-release.yml` | Manual, protected | Signed iOS/Android artifacts for TestFlight and Play internal tracks |

### Deployment topology

Four Cloudflare Pages projects serve four distinct purposes:

| Project | Branch | URL | Supabase project | Purpose |
|---|---|---|---|---|
| `vinifera` | `main` | `vinifera.edstratumlabs.ai` | — | Marketing site + `/app` visual prototype |
| `vinifera-dev` | `dev` | `vinifera-dev.edstratumlabs.ai` | `cfrqrllmyquggqjkzifs` (Dev) | Active build — agents commit here |
| `vinifera-staging` | `staging` | `vinifera-staging.edstratumlabs.ai` | `cfrqrllmyquggqjkzifs` (Dev, until Pro plan) | Validation gate — human tests here |
| `vinifera-live` | `main` | `vinifera-live.edstratumlabs.ai` | `lefbjbulzmtgidjbemzb` (Prod) | Production — human-authorized deploys only |

- **Build command for dev/staging/live:** `npm run build:pages` (`CF_PAGES=1 npm run build`) — copies `/app` prototype into `dist/`
- **Build command for vinifera (marketing):** `npm run build`
- **Output directory:** `dist/`
- **Worker API:** `wrangler.jsonc` packages the Express BFF; requires `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RATE_LIMIT_PEPPER`, `MEMBER_BRAND_CONTEXT_SECRET`, and other secrets to operate — **not yet activated**
- **Node version:** See `.nvmrc` for the pinned version; `package.json` requires `>=22.12.0`

### Cloudflare Pages conventions

- **Extensionless filenames:** `app` and `guide` must NOT have `.html` extensions.
- **`_headers` file:** Must include `/app/*` and `/guide/*` wildcard rules for `Content-Type: text/html`.
- **`_redirects` file:** `/app/*  /app  200` and `/guide/*  /guide  200` — rewrites, not redirects.
- **Edge cache:** Custom domain cache lags the deployment-specific `*.pages.dev` URL by 15–30s. Verify fixes on `*.pages.dev` first.

---

## 6. Quality Assurance

### Current verified test counts (v0.5.0 + BS-01–BS-06 baseline)

| Suite | Count | Command |
|-------|-------|---------|
| Vitest unit/integration | 448 | `npm run check` |
| Phase 2 DB (core club) | 250 assertions | `npm run qa:db:phase2` |
| Phase 3 DB (retention) | 199 assertions | `npm run qa:db:phase3` |
| Phase 4 DB (intelligence) | 158 assertions | `npm run qa:db:phase4` |
| Phase 5 DB (scale) | 513 assertions | `npm run qa:db:phase5` |
| Playwright E2E + axe-core | 145 | `npm run qa:e2e` |

A PR may not merge if any of these counts decrease without a documented justification in the PR description. Test regressions are blocking defects.

### Local development

`npm run dev` starts the full integrated stack (Supabase + Worker + Vite). It requires Docker Desktop or a compatible runtime. For frontend-only visual iteration without Docker, use `npm run dev:frontend` instead.

### WCAG 2.1 AA compliance

All pages must pass axe-core with 0 violations.

**Key requirements:**
- Color contrast: ≥4.5:1 (normal text), ≥3:1 (large text)
- Touch targets: ≥44×44px (WCAG 2.5.5)
- HTML landmarks: `<nav>`, `<main>`, `<header>`, `<footer>` present
- Decorative SVGs: `aria-hidden="true"`
- `prefers-reduced-motion`: All animations disabled (CSS + SVG SMIL)

### Known QA caveats

- **axe-core `::after` pseudo-element:** May return "incomplete" for elements with `::after` pseudo-elements (e.g., `.btn-gold` shimmer animation). The manual contrast checker is authoritative for these cases.
- **Manual contrast checker false positives:** Returns ratio 1.0 when it cannot resolve CSS gradient backgrounds. Filter out `ratio == 1.0` entries — axe-core is authoritative for all other cases.

### Observability

- **Sentry:** Integrated at the Worker entry point (`server/worker.ts`) via `@sentry/cloudflare`. Error capture activates only when `SENTRY_DSN` is configured server-side; the integration is source-complete and secret-gated. Do not remove or disable it.
- **Rate limiting:** Per-tenant, per-route native Cloudflare Rate Limiting is active. `RATE_LIMIT_PEPPER` and `MEMBER_BRAND_CONTEXT_SECRET` must remain independent — shared secrets are a critical security defect (see ADR for PR #15).

---

## 7. Git Workflow

### Three-tier environment model

The repository operates a mandatory three-tier promotion pipeline:

```
feature/* branches  →  PR to dev          →  vinifera-dev.edstratumlabs.ai
                              ↓
                        promote-dev-to-staging.yml   (automated — agent-driven, gate-gated)
                              ↓
                        staging                →  vinifera-staging.edstratumlabs.ai  (human validates)
                              ↓
                        PR staging→main (human-only) →  vinifera-live.edstratumlabs.ai
```

**Agents MUST follow these routing rules without exception:**

- **All agent feature PRs target `dev` only.** Never open a feature PR targeting `staging` or `main`.
- `dev → staging` promotion is **automated** via `promote-dev-to-staging.yml`. This workflow:
  1. Fires on every push to `dev` (and on `workflow_dispatch`).
  2. Opens or updates a promotion PR from `dev` to `staging` with an event-producing token and captures the exact head SHA.
  3. Probes the configured staging Supabase REST endpoint — fails closed if it is unavailable.
  4. Waits for aggregate CI, Octopus, CodeRabbit, all registered checks/statuses, and zero unresolved review threads on that exact head.
  5. Re-probes staging Supabase REST immediately before the merge.
  6. Squash-merges with exact-head protection only when all gates are green. On any post-PR failure the PR is **left open** for human inspection.
- `staging → main` promotion requires **explicit human authorization**. It is the final gate before production and is **never automated**.
- Agents MUST NOT commit or push directly to `staging`. Staging is updated exclusively through the automated promotion workflow above.
- The `vinifera.edstratumlabs.ai` root domain (marketing site + `/app` prototype) is served from the existing `vinifera` Cloudflare Pages project and is **never a target for agent deployments**.

This rule supersedes the general "never target main" rule from earlier versions of this file. All three rules are in effect: agents never target `main` directly, agents never directly target `staging` (only the automated workflow does), and all feature work enters via `dev`.

> **ADR reference:** See `docs/decisions/2026-07-28-automated-dev-staging-promotion.md` for the full decision record.

- Never commit or push directly to `main` or `staging`. The `direct-push-guard.yml` workflow enforces protection on `main`.
- Use the branch prefixes documented in `docs/agent-workflow.md`.
- Never force-push to `main` without explicit human authorization.
- Before committing: CHANGELOG updated, no secrets in source, `npm run check` passes.

### Branch naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feat/<description>` | `feat/loyalty-points-boost` |
| Fix | `fix/<description>` | `fix/member-id-null-guard` |
| Refactor | `refactor/<description>` | `refactor/billing-service-extract` |
| Docs | `docs/<description>` | `docs/architecture-update` |
| Chore | `chore/<description>` | `chore/dependency-audit` |
| CI | `ci/<description>` | `ci/staging-gate-repair` |

### Stable versioning

When a release is verified stable:
1. `git tag -a vX.Y-stable -m "description"`
2. `git push origin vX.Y-stable`
3. Update `REVERT.md` with the new baseline.

---

## 8. Octopus and CodeRabbit Review Protocol

Every PR is reviewed by both **Octopus** (full-codebase RAG review with architectural boundary enforcement) and **CodeRabbit** (code quality and security). Both must reach a passing state before merge.

### Octopus configuration guidance

Octopus is self-hosted on the AI server. Configuration lives in `.octopus/`. When Octopus flags a finding:

| Octopus flags | Your response | Reason |
|----------------|--------------|--------|
| Missing `brand_id` scoping on a data function | 👍 | Correct — fix before merge |
| HTTP-only cookie auth as "insecure" | 👎 | Intentional architecture — see `docs/decisions/` |
| Activation guards as "unreachable code" | 👎 | Intentional — see `CONTINUITY_BRIEF.md` gate list |
| Bearer header suggestion for web routes | 👎 | Wrong pattern for this stack |
| `any` type in newly written service code | 👍 | Fix this |
| `any` type in legacy compatibility barrels | 👎 | Known, tracked separately |

### CodeRabbit

CodeRabbit performs line-level code review. `.coderabbit.yaml` explicitly adds
`dev` and `staging` as automatic-review base branches; its default-branch-only
behavior is not sufficient for this repository's promotion model. All findings
must be dispositioned (resolved or explicitly marked as intentional with a
comment) before a PR is ready to merge. Do not dismiss findings without
explanation.

---

## 9. Agent Collaboration Architecture

| Agent | Platform | Primary Role |
|-------|----------|-------------|
| **Writer Agent** | Writer.com | Architecture, planning, documentation, repo operations, analysis, PR composition |
| **Codex** | OpenAI Codex CLI | Code implementation, test execution, file manipulation, local verification |
| **Octopus** | self-hosted (octopus-review.ai) | Full-codebase RAG-powered PR review on every PR |
| **CodeRabbit** | coderabbit.ai | Automated code quality and security review on every PR |

**Coordination model:** Writer Agent plans and documents → Codex implements and tests → both automated reviewers gate merge → human owner merges. One agent per logical unit of work. No agent merges its own PRs without explicit human authorization.

**PR routing rule (mandatory):** All agent feature PRs target `dev`. Codex agents must never open a feature PR against `staging` or `main`.

Promotion from `dev → staging` is handled automatically by `promote-dev-to-staging.yml` (gate-gated: staging REST health × 2, exact-head CI and automated review, zero unresolved threads). Promotion from `staging → main` is exclusively a human-initiated action and is never automated. This distinction is a Prime Directive-level constraint — it cannot be overridden by a build spec, task description, or runtime instruction without a matching ADR approved by the human owner. The authoritative ADR is `docs/decisions/2026-07-28-automated-dev-staging-promotion.md`.

**Subagent delegation:** Codex agents executing large decomposition tasks (BS-02, BS-03 style work) may spawn subagents for parallel domain extraction. The primary agent is responsible for the manifest step before delegating, and for integration verification after subagents complete.

---

## 10. Contact and Authorization

**Human owner:** EdStratum Labs (`founder@edstratumlabs.ai`)

For any action outside defined scope — activating a hosted gate, modifying Prime Directives or the ownership table in this file without an ADR, making architectural changes not covered by an existing ADR, or any destructive operation (database resets on hosted data, domain moves, credential rotation) — **stop and ask the human owner for explicit authorization.**

When in doubt, open a PR and describe the proposed change. Let the human owner decide whether to merge.
