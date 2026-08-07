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

v0.5.0 — source architecture complete and structurally hardened. All 6 build
specs (BS-01 through BS-06) have been merged to `main`. Hosted activation Gates
1, 2, 3, 4, 5, 7, and 9 are `live-passed`. Gate 7 passed on 2026-08-06 against
the reviewed exact candidate with retained runtime, tenant/Auth, Stripe test,
webhook-lifecycle, and fixture-cleanup evidence. The other 13 gates remain
pending; see `CONTINUITY_BRIEF.md`.

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
3. **Deliver atomically.** One logical change per PR or promotion. Work-in-progress commits are permitted only on an isolated feature branch; squash them into one reviewed logical commit when merging to `dev`.
4. **Leave a trail.** Future agents — and the human owner — must be able to reconstruct exactly what was done, why, and what the state was before and after.
5. **Update CHANGELOG.md once per logical PR or promotion.** The final reviewed diff must contain one consolidated `[Unreleased]` entry; intermediate WIP commits do not each add duplicate entries.
6. **Preserve WCAG compliance.** All pages must pass axe-core with 0 WCAG 2.1 AA violations. Run the fast browser smoke for routine visual PRs and the complete Playwright/axe suite before promotion.
7. **Test on mobile.** Every visual change must be verified at 375px viewport width. Touch targets must meet 44×44px (WCAG 2.5.5).
8. **Own every PR through completion.** Opening a PR is not completion. Use an available wait or monitoring mechanism until the applicable exact-head checks and reviews pass and there are no active requested-changes reviews. Routine ready `dev` candidates require `Dev fast checks`; frontend-relevant candidates also require exact-head `Frontend preview evidence`, while the same status reports policy-approved non-applicability for other surfaces. Promotions require `Vinifera Promotion Gate` plus Octopus. Explicitly classified or labeled high-risk work also requires Octopus. CodeRabbit is optional and non-blocking while unavailable or rate-limited. Follow `docs/agent-workflow.md`.
9. **Protect hosted activation.** Provider and environment mutations must run only through the applicable protected, fail-closed workflow under explicit task authority or a standing owner-approved automation contract. Production, live billing, destructive data operations, credential rotation, and DNS/domain ownership changes retain their independent confirmations and protection. `human-review-required` pauses merges, promotions, deployments, and other boundary-crossing mutations, but never suppresses safe diagnosis, repair, review, preview, packaging, or evidence collection. `do-not-merge` is an absolute merge prohibition.
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
│   ├── _headers            # Security headers + Content-Type overrides
│   ├── marketing.js        # Shared landing-page interaction and focus behavior
│   ├── lucide.min.js       # Pinned self-hosted Lucide icon runtime
│   └── lucide-LICENSE.txt  # Upstream Lucide license notice
├── scripts/                # Build, QA, verification, and asset generation scripts
├── docs/                   # Architecture, setup, ADRs, runbooks, build specs
│   ├── decisions/          # Architectural Decision Records (ADRs)
│   ├── build-specs/        # BS-01 through BS-06 specs and dispatch guide
│   └── agent-workflow.md   # Branching, PR, and review loop rules
├── .github/workflows/      # 19 CI/CD workflows (see Section 5)
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
| `AGENTS.md` | Any agent via PR | Changes to Section 2 (Prime Directives) or this ownership table require a corresponding ADR and explicit owner authority; the initiating task may record that authority. |
| `CONTINUITY_BRIEF.md` | Any agent | Must reflect current reality — update after every session |
| `README.md` | Any agent | Must reflect reality — no aspirational content |
| `CHANGELOG.md` | Any agent | One consolidated entry per logical PR or promotion |
| `REVERT.md` | Any agent | Update whenever a new stable tag is created |
| `.env.example` | Any agent | Real secrets NEVER go here |
| `docs/` | Any agent | Must stay in sync with actual architecture |
| `docs/decisions/` | Any agent | Add an ADR only for architectural, security, deployment, database-policy, or governance decisions |
| `.octopus/` | Any agent via PR | Exact-head trusted review is required; owner review is additionally required only when the change weakens a hard-stop, production, privacy, authentication, authorization, or tenant-isolation boundary. |
| `src/client/` | Any agent | Verify WCAG + mobile after any visual change |
| `server/routes/` | Any agent | Extraction-only unless a new domain is being added — no logic changes during refactors |
| `server/services/` | Any agent | `brand_id` scoping is mandatory on every data-access function |
| `server/integrations/` | Any agent | All integrations must fail closed when credentials are absent |
| `supabase/migrations/` | Any agent via PR | Never modify an applied migration — always add a forward migration |
| `tests/` | Any agent | Never delete existing tests without documented justification |
| `.github/workflows/` | Any agent via PR | Exact-head CI and applicable Octopus review are required. Owner review is additionally required only for the hard-stop boundaries named in Section 10; direct-push guard must remain enabled. |
| `index.html` | Any agent | Verify WCAG after changes |
| `app` | Any agent | Visual prototype — verify WCAG + mobile |
| `guide` | Any agent | Investor's guide — verify WCAG + mobile |
| `public/_redirects` | Any agent | Test routing rules after changes |
| `public/_headers` | Any agent | Test security headers after changes |

---

## 4. Mandatory Documentation Standards

### 4.1 Every logical PR or promotion must include

- **What changed:** Every file modified and what was altered.
- **Why it changed:** The reason or requirement that motivated the change.
- **Impact on deployment:** Whether the change affects routing, Worker behavior, database state, or activation gates.
- **Verification steps:** How to confirm the change worked — include specific test commands and counts.

### 4.2 Commit message format

WIP commits may be used only on an isolated feature branch. Before merge to
`dev`, squash them into one logical commit whose Conventional Commit message
contains a substantive body and the exact verification actually run:

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

<body — what changed and why>

Verification: <commands run and results, e.g. "npm run check; 575/575 Vitest; 155 passed Playwright/axe">
```

**Types:** `feat`, `fix`, `docs`, `chore`, `refactor`, `perf`, `test`, `ci`

### 4.3 CHANGELOG.md format

Every logical PR or promotion must add one consolidated entry under
`[Unreleased]` using [Keep a Changelog](https://keepachangelog.com/). Do not
create a separate entry for each WIP or reviewer-repair commit.

### 4.4 Architectural Decision Records (ADRs)

Create an ADR only when the change makes an architectural, security,
deployment, database-policy, or governance decision. Routine implementation,
test, documentation, dependency, and defect-repair work does not require an
ADR unless it changes one of those boundaries.

**Filename:** `docs/decisions/YYYY-MM-DD-short-title.md`

Decisions that **require** an ADR include activation or deployment gate logic,
new external provider integrations, authentication/authorization or RLS
policy, changes to Prime Directives or `AGENTS.md` ownership rules, and CI
enforcement or promotion policy.

---

## 5. CI/CD and Deployment

The repository has distinct fast-development and protected full-delivery
workflows under `.github/workflows/`:

| Workflow file | Trigger | What it does |
|--------------|---------|-------------|
| `dev-fast.yml` | Ready PR candidates to `dev`, non-draft new heads, exact manual candidates | Fail-closed candidate/path classification, focused validation, path-aware browser smoke, preview packaging, the PR-only `Dev fast checks` aggregate, and distinct manual evidence |
| `frontend-preview-publish.yml` | Completed development candidate workflow, trusted default-branch code | Revalidates the exact same-repository PR and publishes frontend assets or policy-approved non-applicability as `Frontend preview evidence` without executing PR-head code beside credentials |
| `dev-automerge.yml` | Completed fast CI, preview dispatch, or authorized PR metadata change | Trusted default-branch exact-SHA squash merge for eligible low/medium-risk `dev` candidates |
| `dev-deployment-candidate.yml` | Protected `dev` push | Records one unprivileged exact development deployment candidate |
| `dev-worker-release.yml` | Completed development deployment candidate | Prepared-disabled trusted immutable Worker upload, deploy, hosted verification, evidence, and automatic rollback |
| `release-candidate-package.yml` | Manual, trusted default branch | Packages one exact fully certified `dev → staging` candidate without environment rebuild |
| `delivery-control-center.yml` | Scheduled, manual | Maintains one exception-oriented delivery status issue |
| `ci.yml` | Promotion PRs, staging/main, manual, nightly | Full release validation, selective/nightly Android, hidden promotion-smoke fast validation, the exact `Vinifera Promotion Gate` aggregate, and opt-in sanitized Gates 10–16 readiness evidence after an exact staging deployment |
| `direct-push-guard.yml` | Push to main | Enforces no direct commits reach main without a merged PR; fails closed |
| `hosted-readiness.yml` | Manual, unprotected | Read-only credential and hosted-target readiness report; performs no migration or deployment |
| `octopus-main-deploy.yml` | Push to main, manual | Reconcile trusted Octopus configuration after the default-branch bootstrap |
| `octopus-pr-quality-gates.yml` | Promotion PRs and explicit high-risk review requests | Validate same-repository PR source and publish the trusted Octopus result for the exact PR/head/base/attempt |
| `octopus-security-audit.yml` | Scheduled, manual | Run the trusted Octopus security audit |
| `production-worker-release.yml` | Manual, protected | Bootstrap, upload, deploy, or roll back the production Worker without domain/Pages mutation (credential-gated) |
| `promote-dev-to-staging.yml` | Manual/owner-authorized | Open/update, validate, and auto-merge a consolidated `dev` to `staging` promotion unless dry-run or explicitly disabled; never starts after every `dev` push |
| `stripe-test-catalog.yml` | Manual, mixed | Stripe test Price catalog probe/verify without reviewer approval; bootstrap remains staging-protected |
| `stripe-live-billing-cutover.yml` | Manual, protected | Stripe live billing cutover (live-mode credential-gated) |
| `credential-envelope-rotation.yml` | Manual, protected | Rotate encrypted credential envelopes |
| `mobile-release.yml` | Manual, protected | Signed iOS/Android artifacts for TestFlight and Play internal tracks |

### Deployment topology

Four Cloudflare Pages projects serve four distinct purposes:

| Project | Branch | URL | Supabase project | Purpose |
|---|---|---|---|---|
| `vinifera` | `main` | `vinifera.edstratumlabs.ai` | — | Marketing site + `/app` visual prototype |
| `vinifera-dev` | `dev` | `vinifera-dev.edstratumlabs.ai` | `cfrqrllmyquggqjkzifs` (Dev) | Active build — agents commit here |
| `vinifera-staging` | `staging` | `vinifera-staging.edstratumlabs.ai` | Not provisioned; must be isolated from Dev | Validation gate — human tests here |
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

### Evidence levels

- **Local validation:** commands run in a developer checkout; no claim about
  GitHub, Cloudflare, a hosted database, or a provider.
- **Fast GitHub validation:** the exact-head `Dev fast checks` aggregate for a
  feature PR. It is not promotion evidence.
- **Full GitHub validation:** the exact-head/exact-base
  `Vinifera Promotion Gate` aggregate for a promotion or protected
  release comparison.
- **Preview deployment:** a branch alias plus immutable Pages deployment URL.
  It is not the stable dev environment and must not use production data.
- **Staging/production deployment:** the expected environment marker, build
  SHA or artifact digest, and API health contract verified at the stable URL.
- **Hosted/provider readiness:** provider-specific redacted runtime evidence.
  A build, preview, HTTP 200, or landing page cannot substitute for it.

---

## 6. Quality Assurance

### Current verified test counts (2026-08-05 hosted-gate QA baseline)

| Suite | Count | Command |
|-------|-------|---------|
| Vitest unit/integration | 575 | `npm run check` |
| Phase 1 DB (foundation) | 92 assertions | `npm run qa:db:phase1` |
| Phase 2 DB (core club) | 250 assertions | `npm run qa:db:phase2` |
| Phase 3 DB (retention) | 199 assertions | `npm run qa:db:phase3` |
| Phase 4 DB (intelligence) | 159 assertions | `npm run qa:db:phase4` |
| Phase 5 DB (scale) | 515 assertions | `npm run qa:db:phase5` |
| Playwright E2E + axe-core | 155 passed, 3 hosted-only skipped | `npm run qa:e2e` |

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
                        promote-dev-to-staging.yml   (manual/owner-authorized full gate + auto-merge)
                              ↓
                        staging                →  vinifera-staging.edstratumlabs.ai  (protected validation)
                              ↓
                        PR staging→main (owner-authorized) →  vinifera-live.edstratumlabs.ai
```

**Agents MUST follow these routing rules without exception:**

- **All agent feature PRs target `dev` only.** Never open a feature PR targeting `staging` or `main`.
- General feature pushes and draft PRs are local/WIP activity, not cloud-CI
  candidates. Mark one coherent head ready for review; batch findings and use
  no more than two substantive repair/re-review cycles.
- `codex-auto-merge` is standing owner authority only for a low- or medium-risk
  same-repository PR to `dev` after trusted automation revalidates the live
  head/base, exact required checks, applicable preview evidence, labels, and
  no active requested-changes reviews immediately before merge.
- `.github/delivery-risk-contract.json` is the machine-readable merge
  authority contract. Missing, skipped, neutral, pending, cancelled, stale, or
  failed required evidence blocks merge. High-risk candidates never auto-merge.
- A consolidated `dev → staging` promotion is started manually or by an
  explicitly owner-authorized workflow; it is never created after every push
  to `dev`. `promote-dev-to-staging.yml`:
  1. Opens or updates a promotion PR from `dev` to `staging` with an
     event-producing token and captures the exact head, staging base, and
     readiness-attempt timestamp.
  2. Probes the configured staging Supabase REST endpoint — fails closed if it is unavailable.
  3. Waits for `Vinifera Promotion Gate`, Octopus, and no active
     requested-changes review for that exact comparison and readiness attempt.
     CodeRabbit evidence may be recorded but is optional.
  4. Re-probes staging Supabase REST immediately before merge readiness.
  5. Revalidates the captured head/base, canonical gate, Octopus, and active reviews
     after the second probe, then squash-merges with the exact captured head
     unless `dry_run=true`, `auto_merge=false`, or an emergency label/review gate blocks it.
- `staging → main` and production remain protected operations. They require
  explicit task authority or an owner-approved protected workflow, the full
  release gate, staging soak/health evidence, an identical reviewed artifact
  or content digest, and a known rollback target bound to a prior reviewed
  release SHA and a previously sole-active Worker version.
- Agents MUST NOT commit or push directly to `staging` or `main`; those
  branches advance only through their promotion PRs.
- The `vinifera.edstratumlabs.ai` root domain (marketing site + `/app` prototype) is served from the existing `vinifera` Cloudflare Pages project and is **never a target for agent deployments**.

This rule supersedes the general "never target main" rule from earlier versions
of this file. All three rules are in effect: agents never target `main`
directly, agents never directly update `staging`, and all feature work enters
via `dev`.

> **ADR reference:** See
> `docs/decisions/2026-07-29-two-speed-delivery-governance.md`; it amends the
> earlier automated-readiness decision.

- Never commit or push directly to `main` or `staging`. The `direct-push-guard.yml` workflow enforces protection on `main`.
- Use the branch prefixes documented in `docs/agent-workflow.md`.
- Never force-push to `main`.
- Before requesting review: one consolidated changelog entry is present, no
  secrets are in the diff, and the selected local validation passes.

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

**Octopus** is the required full-codebase review for every `dev → staging`
promotion and for protected, explicitly classified, or labeled high-risk
review. It is not automatically run on every routine feature PR to `dev`;
high-risk PRs request Octopus by applying
`octopus-review-required`. Removing the label or closing the PR cancels the
attempt. Missing Octopus blocks promotion, but not routine preview iteration.

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

CodeRabbit is currently rate-limited and optional. Its available findings must
still be inspected and substantively dispositioned, but a missing, skipped, or
rate-limited CodeRabbit run is not a required check and does not block an
otherwise ready PR or promotion.

---

## 9. Agent Collaboration Architecture

| Agent | Platform | Primary Role |
|-------|----------|-------------|
| **Writer Agent** | Writer.com | Architecture, planning, documentation, repo operations, analysis, PR composition |
| **Codex** | OpenAI Codex CLI | Code implementation, test execution, file manipulation, local verification |
| **Octopus** | self-hosted (octopus-review.ai) | Required promotion/high-risk full-codebase review |
| **CodeRabbit** | coderabbit.ai | Optional line-level review while rate-limited |

**Coordination model:** Writer Agent plans and documents → Codex implements and
tests → fast CI and preview gate routine delivery → full CI and Octopus gate
promotions. One primary agent owns each logical unit and may delegate bounded
work while retaining integration responsibility.

**PR routing rule (mandatory):** All agent feature PRs target `dev`. Codex
agents must never open a feature PR against `staging` or `main`. Promotion is
a separate consolidated release-candidate operation.

Readiness for `dev → staging` is initiated manually or through an explicitly
owner-authorized workflow. It requires staging REST health twice, exact
head/base `Vinifera Promotion Gate`, Octopus, and no active requested-changes review. Production remains
protected and owner-authorized. A standing owner-approved protected workflow
may initiate and complete `dev → staging`; production, live billing,
destructive data work, credential rotation, and DNS/domain ownership changes
retain their independent confirmations. A stop label blocks only its
consequential boundary and does not suppress evidence or safe repair work.

**Subagent delegation:** Codex agents executing large decomposition tasks (BS-02, BS-03 style work) may spawn subagents for parallel domain extraction. The primary agent is responsible for the manifest step before delegating, and for integration verification after subagents complete.

---

## 10. Contact and Authorization

**Human owner:** EdStratum Labs (`founder@edstratumlabs.ai`)

Standing owner authorization may cover routine reversible fixes, feature
merges to `dev`, validated environment promotions, deployments, verification,
and automatic rollback when it is explicitly recorded for the task or encoded
in a trusted protected workflow. It never bypasses target hashes, environment
protection, exact confirmations, exact-revision evidence, privacy boundaries,
or rollback requirements.

Apply `human-review-required` and notify the owner for
destructive or irreversible database work; credible production data-loss,
authentication, authorization, tenant-isolation, or secret-exposure risk;
real-money billing decisions; legal/regulatory judgment; suspected credential
compromise; DNS/domain ownership changes; materially undefined product
choices; repeated repair failure; or an external failure without a safe
fallback. Continue safe diagnostics, reversible repairs, review, preview,
packaging, and evidence gathering while paused; stop only the merge,
promotion, deployment, or other boundary-crossing mutation that requires the
owner's decision. `do-not-merge` is an absolute merge prohibition. Only the
owner or an explicitly trusted owner workflow may remove either control.

---

## Cursor Cloud specific instructions

These notes cover non-obvious startup/run details for the Cursor Cloud VM. The
startup update script already runs `npm ci` and `npx playwright install
chromium`, so dependencies and the Chromium E2E browser are present. Standard
lint/test/build/run commands live in `package.json` and `docs/setup.md` — refer
to those rather than duplicating them.

### Docker daemon (required for the full stack)

The VM has Docker Engine installed but **no systemd**, so the daemon is not
started automatically. Start it once per session before `npm run dev`:

```bash
sudo dockerd > /tmp/dockerd.log 2>&1 &   # then wait until `docker info` succeeds
```

- The `ubuntu` user is already in the `docker` group. In a shell started before
  the group was applied, run docker/`npm run dev` via `sg docker -c "…"`; fresh
  login shells pick the group up automatically.
- This VM runs Docker 29 with the **fuse-overlayfs** storage driver, so
  `/etc/docker/daemon.json` sets `"features": { "containerd-snapshotter": false
  }`. Do not remove that — fuse-overlayfs will not initialize otherwise.
- The first `npm run dev` may re-pull the pinned Supabase images if the local
  image cache was not preserved; this is slow but requires no extra steps.

### Running the app

- Full integrated stack: `npm run dev` (needs the Docker daemon above). It boots
  Supabase (Postgres/Auth/Studio/Mailpit), applies migrations + seed, seeds
  local Auth, then serves the Worker at `http://127.0.0.1:8788/app/`, Vite at
  `http://127.0.0.1:5173/app/`, Studio at `http://127.0.0.1:54323`, and Mailpit
  at `http://127.0.0.1:54324`.
- Frontend-only (no Docker): `npm run dev:frontend`.
- E2E (`npm run qa:e2e`) starts its own `wrangler dev` Worker on port 8787 and
  is credential-independent — it does **not** require Docker or Supabase.

### Seeded local login (from `scripts/bootstrap-local-auth.mjs`)

Only present after `npm run dev` seeds Auth. Password is `ViniferaLocal1!`
(override via `VINIFERA_LOCAL_TEST_PASSWORD`).

- Staff owners: `owner.sunrise@example.com`, `owner.pacific@example.com`
- Members: `member.sunrise@example.com`, `member.pacific@example.com`

### Known test caveat

`tests/scripts/promotion-smoke.test.mjs` occasionally times out on a cold run
because it builds throwaway git fixture repos under the default 5s per-test
timeout (a different case fails each cold run). It is not a code defect — a warm
re-run, or `npx vitest run tests/scripts/promotion-smoke.test.mjs
--testTimeout=60000`, passes all 9.
