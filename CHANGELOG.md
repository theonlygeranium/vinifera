# Changelog

## [Unreleased] — 2026-07-28 (Octopus Dev PR Gate)

### Fixed
- `.github/workflows/octopus-pr-quality-gates.yml`: Routed Octopus PR quality
  gates to the mandatory `dev` integration branch and added
  `ready_for_review` activity. The prior `main`-only filter prevented every
  agent-authored product PR from invoking the required reviewer.
- `.github/workflows/octopus-pr-quality-gates.yml`: Replaced the nonexistent
  `run-runbook-action@v1` reference with a tested REST bridge. The self-hosted
  server predates the v4 Executions API and its legacy CLI is incompatible
  with GitHub's Ubuntu 24 OpenSSL runtime, so the bridge implements the
  documented prompted-runbook flow and bounded task polling without a legacy
  binary.
- `.github/scripts/octopus-runbook.mjs` and
  `tests/scripts/octopus-runbook.test.mjs`: Added the HTTPS-only, fail-closed
  bridge and focused coverage for URL normalization, prompt mapping, required
  prompt enforcement, run creation, and successful task completion.
- `.github/pull_request_template.md` and `docs/agent-workflow.md`: Replaced
  stale Greptile and direct-to-`main` instructions with the current
  Octopus/CodeRabbit review loop and `dev` PR routing.
- `docs/decisions/2026-07-28-switch-greptile-to-octopus.md`: Reconciled the
  ADR with current repository governance and recorded the human-authorized,
  one-time bootstrap exception for this workflow correction.

### Deployment impact
- No application, routing, database, provider, Pages, or Worker behavior
  changes. Future and re-triggered PRs to `dev` invoke the self-hosted Octopus
  `PR Quality Gates` runbook.

### Verification
- Validate workflow syntax, run the repository docs-only CI lane, confirm
  CodeRabbit and zero unresolved review threads on the bootstrap PR, merge it
  to `dev`, then reopen the pending product PRs and require successful Octopus
  runs before merge.
- Run the focused Octopus bridge tests and confirm the hosted workflow waits
  for the self-hosted runbook result.

## [Unreleased] — 2026-07-28 (UI Testing Spec Formatting Fix)

### Fixed
- `docs/build-specs/vinifera-ui-testing-doc.md`: Stripped trailing whitespace from 5 lines (lines 2, 3, 4, 786, 788) to satisfy CI docs-lane `git diff --check` policy. No content change.

## [Unreleased] — 2026-07-28 (Three-Tier Environment)

### Added
- Three-tier deployment architecture: `vinifera-dev` (dev branch), `vinifera-staging` (staging branch), `vinifera-live` (main branch).
- `staging` branch created from `dev` at `f530c46deb1a`.
- `vinifera-staging` Cloudflare Pages project provisioned at `vinifera-staging.edstratumlabs.ai` with CNAME + Cloudflare-proxied SSL.
- Supabase staging project blocked by free plan 2-project limit — staging Pages project provisioned but temporarily shares dev Supabase project (`cfrqrllmyquggqjkzifs`) until Pro plan upgrade.

### Changed
- `AGENTS.md`: Added three-tier environment model with mandatory PR routing rules (`dev` only for all agents). Updated deployment topology table (4 Cloudflare Pages projects). Updated agent coordination model with Prime Directive-level PR routing constraint.
- `docs/build-specs/CODEX-DISPATCH-GUIDE.md`: All 6 session PR targets updated from `main` → `dev`. All Greptile references replaced with Octopus. Added three-tier environment model header with explicit routing rule. Merge order updated to reference `dev` checks.

### Architecture
- Promotion pipeline: `feature/* → PR to dev → human promotes dev→staging → human approves staging→main`
- Agents never open PRs against `staging` or `main` — enforced in AGENTS.md Section 7 and Section 9.
- Supabase staging DB: upgrade to Pro plan at supabase.com/dashboard to provision a third isolated project.



## [Unreleased] — 2026-07-28

### Added
- `dev` branch created from `main` at `d5b0e02d` as the primary integration branch for active development.
- Two Cloudflare Pages projects provisioned: `vinifera-dev` (branch: `dev`) and `vinifera-live` (branch: `main`).
- Custom domains configured: `vinifera-dev.edstratumlabs.ai` and `vinifera-live.edstratumlabs.ai` with Cloudflare-proxied DNS CNAMEs.
- SSL certificates initializing automatically via Cloudflare Universal SSL.
- All 22 database migrations applied to both Supabase projects (`cfrqrllmyquggqjkzifs` dev, `lefbjbulzmtgidjbemzb` prod). 97 tables, RLS enabled, all required extensions loaded.
- `.env.example` updated with dedicated section documenting `vinifera-dev` and `vinifera-live` Cloudflare Pages environment variables and build configuration.

### Infrastructure
- Build command for both Pages projects: `npm run build:pages` (`CF_PAGES=1 npm run build`)
- Output directory: `dist/`
- `scripts/build.mjs` confirmed to copy `/app` static prototype into `dist/` when `CF_PAGES=1`, preserving demo site at root domain.
- Supabase Dev project: `Vinifera Dev` (`cfrqrllmyquggqjkzifs`, us-east-1, ACTIVE_HEALTHY)
- Supabase Prod project: `Project Vinifera` (`lefbjbulzmtgidjbemzb`, ACTIVE_HEALTHY)



All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Changed
- Replaced Greptile with Octopus as the AI code review tool (self-hosted). Greptile removed
  as a required GitHub branch protection check. Branch protection now requires only
  `Type, test, build, and package` and `Block direct push to main`.
- Migrated `.greptile/` config directory to `.octopus/`. Architectural boundary rules
  (`rules.md`) are preserved; `config.json` updated to add `excludeAuthors` for bot
  accounts; `files.json` unchanged.
- Updated `AGENTS.md` Section 8 to reference Octopus instead of Greptile and updated
  directory tree, ownership table, and tool registry accordingly.

### Added
- ADR `docs/decisions/2026-07-28-switch-greptile-to-octopus.md` documenting the
  transition rationale, self-hosting approach, and rollback path.


### Removed

- **Greptile GitHub App and `.greptile/` configuration directory.** Greptile has
  been replaced by Octopus Deploy for deployment automation and code quality gate
  enforcement. The 10 architectural rules from `.greptile/rules.md` have been
  preserved verbatim in the Octopus `Vinifera` project `PR Quality Gates` runbook.
  CodeRabbit remains active and unaffected for PR review.

### Added

- **What changed:** Rewrote `AGENTS.md` to correct stale workflow names
  (`hosted-readiness.yml`, `production-worker-release.yml`,
  `stripe-test-catalog.yml`, `stripe-live-billing-cutover.yml`,
  `credential-envelope-rotation.yml`, `mobile-release.yml`,
  `direct-push-guard.yml`, `ci.yml`), updated verified test counts to
  448 Vitest / 250 / 199 / 158 / 513 DB / 145 Playwright-axe, added explicit
  `dev:frontend` documentation, corrected Sentry description to
  "integrated, secret-gated," and added Section 9 (Agent Collaboration
  Architecture) and Section 10 (Contact and Authorization). Introduced ADR
  `docs/decisions/2026-07-28-agents-md-governance-update.md` recording the
  ownership policy update from "Human owner only" to "Any agent via PR —
  human owner must review and merge." Updated `CODEX-PROMPT.md` to v0.5.0,
  corrected gate order (Auth = Gate 3, Stripe reconciliation = Gate 4 per
  `CONTINUITY_BRIEF.md`), and fixed the pre-activation audit prompt to
  clarify that the audit produces a report document and does not modify
  application source. Updated `README.md` Production Build badge to v0.5.0
  and Phase 2 quality row to 250 database assertions. **Why:** Eleven
  unresolved review threads from Greptile (P1: wrong workflow names, missing
  CHANGELOG, gate order, test counts) and CodeRabbit (Major: version
  inconsistency, assertion count, prompt contradiction; Minor: Sentry wording,
  dev command clarity) blocked merge of PR #21 under the zero-unresolved-thread
  requirement. **Deployment impact:** Documentation and governance only;
  application code, build output, routes, provider activation, hosted data, and
  all 20 activation gates are unchanged. **Verification:** Review corrected
  workflow names against `.github/workflows/` directory, verify gate order
  against `CONTINUITY_BRIEF.md` activation gates 3 and 4, run
  `npm run check` to confirm 448 Vitest and 145 Playwright/axe counts,
  inspect ADR and updated ownership table in `AGENTS.md`.


### Added

- **What changed:** Established mandatory end-to-end PR ownership for agents,
  a label-scoped 15-minute Codex safety monitor, explicit human-escalation and
  merge-authority rules, required review-thread disposition, and GitHub
  enforcement for current branches, required checks, direct-push prevention,
  and zero unresolved conversations. Canonical workflow references replace
  duplicated completion instructions in Codex dispatch prompts. **Why:** PR
  creation alone left review comments, CI failures, and post-merge state
  vulnerable to abandonment or inconsistent handling. **Deployment impact:**
  Repository governance and external GitHub/Codex automation only; application
  code, build output, routes, providers, hosted data, and activation gates are
  unchanged. **Verification:** Inspect the five governance labels, branch
  protection, automation definition, prompt references, PR template, review
  threads, required checks, and post-merge `main` run; run `git diff --check`.
- **What changed:** Added the CodeRabbit pull-request review badge to the
  README's repository status badges and linked it to this repository's
  CodeRabbit-reviewed pull requests. **Why:** Make the repository's automated
  pull-request review coverage visible and directly discoverable to visitors
  and contributors.
  **Deployment impact:** Documentation only; application code, build output,
  routes, provider activation, and the live Pages baseline are unchanged.
  **Verification:** Render the README badge URL, confirm the badge targets
  `theonlygeranium/vinifera`, run `npm run check`, `npm run qa:e2e`, and
  `git diff --check`.

### Fixed

- **What changed:** Daily portal-login recording now stores the real occurrence
  timestamp. A same-member, same-day retry accepts only the database's exact
  activity-idempotency conflict, verifies the existing organization-, brand-,
  member-, source-, and metadata-scoped event, and reuses its original
  timestamp for the analytics replay. **Why:** Midnight UTC normalization
  shifted brand-local daily analytics and backdated portal-login recency used
  by churn calculations. **Deployment impact:** Portal activity and analytics
  timestamps remain truthful while daily retries stay idempotent; no schema,
  hosted provider, secret, Pages, DNS, or production-data mutation occurs.
  **Verification:** Run the portal-login identity/replay tests, focused BS-05
  suite, full repository checks, and `git diff --check`.

### Security

- **What changed:** Final review follow-up pins both the integrated local build
  and Vite server to browser mode and the loopback Worker API origin,
  preserves explicit browser/mobile API-origin policy errors through request
  and download helpers, and makes hosted callback/return origin resolution
  require a valid configured `APP_ORIGIN`; request-header fallback requires
  explicit `development` or `test`, is normalized before use, and missing or
  unknown environment modes fail closed. Configured and request-derived HTTP
  origins are accepted only for loopback development/test; hosted and
  non-loopback origins require HTTPS. **Why:** CodeRabbit, hosted Codex, and
  independent review identified ambient-build, mobile-mode, error-reporting,
  hosted HTTP, and fallback paths that could produce a misrouted bundle,
  conceal unsafe configuration, or trust request-derived callback origins.
  **Deployment impact:** Local builds deterministically call port 8788 in
  browser mode and staging/production fail closed without canonical
  `APP_ORIGIN`; no hosted migration, provider, secret, Pages, DNS, or data
  mutation is performed. **Verification:** Run the browser and foundation
  origin regressions, launcher tests, native stack smoke, full repository
  checks, production Worker dry run, and `git diff --check`.
- **What changed:** Review follow-up now binds local staff Auth callback and
  billing return URLs to canonical `APP_ORIGIN` instead of a cross-origin Vite
  request header, asserts the seeded brand on the primary cookie-based member
  session, and scopes final seed shipment transitions by organization as well
  as deterministic ID. **Why:** Hosted Codex and Greptile reviews identified
  callback routing and tenant-proof gaps that could hide a broken hot-reload
  Auth flow or weaken fixture isolation checks. **Deployment impact:** Local
  callbacks now route through the Worker on port 8788; production keeps its
  configured canonical origin. No hosted migration, provider, secret, Pages,
  DNS, or production-data change is performed. **Verification:** Run the
  application-origin regressions, local seed replay, native authenticated
  smoke, full TypeScript/Vitest/build checks, and `git diff --check`.
- **What changed:** Review follow-up made the staging guard-order test require
  both workflow markers before comparing them, centralized the configuration
  test on the isolated security fixture, and added a recursive source-policy
  test that confines direct binding access to the Worker type and neutral
  security-secret owner. Templates and deployment guidance now state the
  whitespace rule consistently, the staging health capability uses its exact
  `billing` name, and the ADR describes behavior-level fallback proof instead
  of a narrow regex. **Why:** Hosted and independent reviews identified places
  where a missing marker, duplicated fixture, or imprecise wording could weaken
  future regression detection or operator understanding. **Deployment impact:**
  No runtime, route, schema, provider, Pages, or secret-value change; the
  existing fail-closed deployment contract is documented and tested more
  precisely. **Verification:** Run the focused security/configuration/activation
  suites, `npm run check`, `npm run qa:production-release`,
  `npm run build:worker:production`, `npm audit --audit-level=moderate`, and
  `git diff --check`.
- **What changed:** Rate-limit IP hashing and member-brand context signing now
  require separate `RATE_LIMIT_PEPPER` and `MEMBER_BRAND_CONTEXT_SECRET`
  bindings. A neutral runtime validator rejects missing, whitespace-padded,
  shorter-than-32-byte, or equal values; the configuration health report
  exposes a sanitized `security` capability; staging and production release
  guards enforce the same contract; templates, setup/runbook guidance, and
  explicit test fixtures document the deployment boundary. **Why:** Reusing a
  Supabase credential, a static fallback, or one application secret for both
  cryptographic purposes created avoidable coupling and could conceal an
  incomplete deployment. **Deployment impact:** Staging and production Worker
  deployments must provide independently generated values for both bindings.
  Existing deployments that relied on fallback behavior now fail closed with
  a sanitized configuration error until the dedicated secrets are installed;
  Pages, routes, database schema, and provider endpoints are unchanged.
  **Verification:** Run `npm run check`, the focused runtime and release-guard
  suites, `npm run qa:production-release`, `npm audit --audit-level=moderate`,
  and the fallback/secret scans documented in the security-secret separation
  ADR.

### Refactored

- **What changed:** Exact-head review cleanup moved the shared bounded
  concurrency helper, integration UUID/Klaviyo patterns, and Supabase admin
  client into `server/lib/concurrency.ts`,
  `server/lib/integration-constants.ts`, and
  `server/lib/supabase-admin.ts`. The extracted analytics, communications,
  integration-runtime, member, order, foundation, retention, Stripe, and
  webhook services now reuse those neutral owners without introducing a
  service cycle; the Stripe compatibility export remains available. Three
  caller-free release helpers were removed, and webhook serialization helpers
  were renamed to make their redaction behavior explicit. **Why:** CodeRabbit
  identified duplicate primitives, ambiguous redaction names, and dead
  post-extraction code that could drift independently. **Deployment impact:**
  Internal service organization only; no route, database migration, provider
  activation, secret, Pages, or hosted state changes. **Verification:**
  TypeScript, 386/386 Vitest tests, Vite and Worker builds, `git diff --check`,
  18-service/37-edge graph audit with zero cycles, and zero route imports from
  the compatibility integration barrel.
- **What changed:** Integrated the verified review-hardening `main` baseline
  into BS-03 and transplanted its release-wine identity/replay update from the
  retired service monolith into `server/services/orders.ts`, while keeping
  `core-club.ts` re-export-only. **Why:** BS-03 must preserve the review fixes
  without reversing the behavior-preserving service decomposition.
  **Deployment impact:** The pending forward release-identity migration and
  hardened route/guard behavior are preserved; no provider, hosted database,
  Worker, Pages, secret, or activation mutation is performed by this
  integration. **Verification:** Direct-push policy, dependency audit,
  generated Worker bindings, TypeScript, Vitest, all embedded database phases,
  Pages and Worker builds/dry runs, Playwright/axe, and structural service
  audits are rerun on the integrated head before publication.
- Decomposed `core-club.ts` into domain-scoped member, club, order, Stripe,
  and EasyPost services while preserving its prior public API through re-exports.
- Decomposed `integrations.ts` into communications and webhook services, with
  an unchanged shared provider-runtime extraction that prevents circular
  imports between those domains.
- Added the complete `server/services/index.ts` barrel and moved internal
  service consumers and BS-02 system route to their direct domain imports.
- Remapped architecture, tenancy-audit, setup, and automated-review guidance
  from the historical service monoliths to the extracted domain owners while
  preserving the original audit revision as provenance.
- Extracted all 129 Express route registrations from `server/app.ts` into
  domain-scoped modules under `server/routes/`, preserving the original route
  paths, middleware order, schemas, service calls, and response behavior.
- Reduced `server/app.ts` to the 82-line global middleware and route-mounting
  entry point, with `server/routes/index.ts` owning the ordered public,
  protected, fallback, and error-handler mounts.
- Integrated the BS-02 route mounts with BS-04 observability and rate
  limiting: all rate-limit middleware runs before public/raw-webhook and
  protected handlers, while the shared BS-04 error handler remains last after
  the `/api` 404 boundary.

### Fixed

- **What changed:** `server/lib/concurrency.ts` now rejects non-positive,
  fractional, and non-finite concurrency limits and passes `undefined` array
  elements to the operation instead of treating them as worker exhaustion.
  `tests/unit/concurrency.test.ts` proves validation, complete processing, and
  result ordering. `server/services/index.ts` now explicitly resolves the two
  member symbols also re-exported by Stripe to their canonical member binding,
  with a runtime identity assertion in the Phase 5 service suite. The service
  ADR now defines its dependency arrows against the implemented import graph
  and includes explicit deployment and verification sections. **Why:** Fresh
  exact-head reviews found that invalid limits could silently skip a batch,
  `undefined` data could truncate one worker, the original ADR arrow direction
  was ambiguous, and relying on star-export resolution made two public barrel
  symbols unnecessarily subtle. Explicit exports remove that ambiguity.
  **Deployment impact:** Worker batch helpers now fail fast on programmer
  configuration errors, while the public service barrel retains its intended
  names deterministically; routes, database migrations, provider activation,
  secrets, Pages, and hosted state are unchanged.
  **Verification:** Concurrency unit tests 2/2, TypeScript, full Vitest
  388/388, public-barrel binding identity, `git diff --check`, and fresh
  exact-head review.
- **What changed:** Exact-head review hardening now defers mobile push only for
  `activation_required` and surfaces APNs configuration mismatches; requires
  EasyPost recovery to find the exact persisted rate; rejects invalid
  QuickBooks refresh-lease generations; passes the authenticated Supabase user
  ID to the member-address command; and records a structured error when an
  integration-health downgrade fails without blocking job completion. Focused
  regressions were added to `tests/server/core-club.test.ts`,
  `tests/server/phase4-services.test.ts`, and
  `tests/server/phase5-integrations.test.ts`. **Why:** CodeRabbit found five
  fail-open, reconciliation, identity, or observability defects in the
  extracted owners. **Deployment impact:** Worker error handling and
  fail-closed provider behavior change for misconfiguration and invalid
  recovery state; no migration, secret value, provider activation, Pages
  route, or hosted mutation is required. **Verification:** Focused service
  tests 114/114, full Vitest 386/386, TypeScript, Vite build, Worker dry run,
  and fresh exact-head automated reviews.
- Updated the preserved BS-02 route manifest to include BS-04's path-specific
  rate-limit layer in registration order, and added an explicit BS-03 change
  record to the compatibility-barrel Greptile guidance.
- **What changed:** Direct-router retention coverage now proves malformed-token
  POST responses retain `no-store` and `no-referrer` before the service is
  invoked, and the agent workflow records the reason, operational impact, and
  focused verification for bounded GitHub evidence requests. **Why:** Final
  exact-head CodeRabbit review identified an unproved unsubscribe error path
  and incomplete local workflow rationale. **Deployment impact:** Test and
  workflow documentation only; the already-implemented POST headers, guard,
  application, database, Pages, providers, secrets, and activation state are
  unchanged. **Verification:** Retention HTTP contracts 31/31, direct-push
  policy 12/12, TypeScript, `git diff --check`, and fresh exact-head review.
- **What changed:** The release command RPC now scopes allowed payload fields by
  operation: only create accepts `initial_status`, update accepts aggregate
  fields without create-only state, and schedule requires an empty payload.
  pgTAP proves rejected surplus fields leave no command result. **Why:** Hosted
  CodeRabbit found that the shared allowlist could silently ignore fields on
  update or schedule. **Deployment impact:** The stricter contract ships in the
  pending release-identity migration; no new migration, Pages, provider,
  secret, or activation change is introduced. **Verification:** Phase 2 and
  Phase 5 current-stack pgTAP, `git diff --check`, and fresh exact-head reviews.
- **What changed:** Both the GET confirmation and POST mutation responses for
  token-bearing unsubscribe URLs now set route-owned `Cache-Control: no-store`
  and `Referrer-Policy: no-referrer` headers before token handling; direct-router
  tests cover the POST response without relying on global middleware. The
  Phase 2 ADR now states the required forward-migration deployment impact, and
  setup guidance distinguishes ignored local environment files from the
  tracked `.env.example` exception. **Why:** Hosted Greptile and unresolved
  CodeRabbit threads identified the POST privacy gap and two documentation
  ambiguities. **Deployment impact:** Worker response headers change on the
  unsubscribe POST; the existing pending release-identity migration remains
  required, with no additional migration, Pages, provider, secret, or
  activation change. **Verification:** Focused retention HTTP contracts,
  TypeScript, `git diff --check`, and fresh exact-head reviews.
- **What changed:** The forward release-identity command migration now rejects
  JSON `null` required scalars, tier prices, wine quantities, and wine prices
  before mutation, with pgTAP proving that rejected commands leave no replay
  record. **Why:** Authenticated CodeRabbit review found that a direct
  service-role caller could otherwise bypass SQL three-valued comparisons and
  surface a low-level not-null constraint error. **Deployment impact:** The
  validation ships within pending migration
  `202607260022_release_wine_identity_replay.sql`; no additional migration,
  Pages, provider, secret, or activation change is introduced.
  **Verification:** Phase 2 and Phase 5 current-stack pgTAP, `git diff --check`,
  and a fresh authenticated CodeRabbit review on the committed head.
- **What changed:** Draft release updates now carry each validated existing
  release-wine UUID into the transactional command, and a forward-only database
  migration preserves those UUIDs while rebuilding the aggregate. The command
  rejects IDs during create, duplicate IDs, and IDs outside the exact
  organization/brand/release boundary; new explicitly priced wines still
  receive database-generated IDs. **Why:** An exact idempotent retry after a
  lost PATCH response could previously carry the pre-update wine ID, fail
  service reconciliation after the first rebuild replaced that ID, and never
  reach the database command ledger's stored replay. **Deployment impact:** The
  Worker RPC payload adds optional `wine_id`, and Supabase must apply migration
  `202607260022_release_wine_identity_replay.sql`; Pages, providers, secrets,
  and activation state are unchanged. **Verification:** Stateful service retry
  tests, Phase 2 command-ledger pgTAP identity/tenant/mismatch assertions,
  TypeScript, 382/382 Vitest tests, database gates
  92/250/199/158/513, all Pages and Worker dry-run builds, and 145/145
  Playwright/axe checks. Authenticated CodeRabbit review is rerun on the
  committed head before merge.
- **What changed:** Review follow-up keeps both the GitHub response and its JSON
  body parsing inside the direct-push guard's per-request timeout, aligns the
  guard ADR with the ten-page implementation limit, and proves an invalid
  unsubscribe token cannot invoke the mutation service. **Why:** A response
  body can stall after headers arrive, and the security regression should
  explicitly cover the non-mutation boundary. Timeout tests also assert that
  every request receives the configured 25 ms deterministic test deadline.
  **Deployment impact:** Guard availability and test/documentation evidence
  only; application routes, database state, Pages, providers, and activation
  remain unchanged. **Verification:** direct-push policy tests (12/12),
  focused retention tests, TypeScript, and authenticated CodeRabbit review.
- **What changed:** Local setup now begins from `.dev.vars.example`, gives an
  exact selective merge sequence from the comprehensive `.env.example`
  inventory, keeps the tracked Sentry placeholder blank, and requires separate
  environment-scoped Sentry secret commands for staging and production.
  **Why:** The previous copy command contradicted the minimal Worker template
  and the unscoped secret command could target the wrong Worker environment.
  **Deployment impact:** Documentation and tracked local template only; no
  secret is created, no hosted environment is mutated, and runtime behavior is
  unchanged until an operator follows the activation steps. **Verification:**
  setup/template review, `git diff --check`, and the full
  credential-independent repository gate recorded in the continuity brief.
- **What changed:** The direct-push guard now gives every GitHub
  associated-pull-request request a five-second `AbortController` deadline,
  treats request timeouts as bounded evidence attempts with the existing
  ten-second backoff, and fails closed after three timeouts. Two deterministic
  policy tests cover timeout recovery and exhaustion, and checkout no longer
  persists its GitHub credential. **Why:** An indefinitely pending GitHub
  request could consume the entire workflow without a policy result, while
  persisted checkout credentials exceeded this read-only job's needs.
  **Deployment impact:** GitHub Actions enforcement only; application,
  database, Worker, Pages, and provider behavior are unchanged.
  **Verification:** `node --test
  .github/scripts/direct-push-guard.policy.mjs` (11 tests) and
  `git diff --check`.
- **What changed:** Release PATCH requests now reject empty bodies, direct
  status changes, ambiguous tier aliases, and unpaired tier IDs/prices; omit
  absent nested fields; and reconcile an omitted existing-wine price only by
  its stable wine ID before rebuilding the release aggregate. New or unknown
  wines still require an explicit price, while an explicit zero remains zero.
  The token-bearing unsubscribe confirmation route now owns
  `Cache-Control: no-store` and `Referrer-Policy: no-referrer` before token
  parsing and verification. **Why:** Review identified silent aggregate
  rewrites, undefined tier inputs, destructive zero-price defaults, and
  route-local privacy headers that depended on global middleware.
  **Deployment impact:** Worker API request validation and response headers
  change; no database migration, provider activation, Pages route, or static
  asset changes are required. **Verification:** `npm run typecheck` and
  `npx vitest run tests/server/app.test.ts tests/server/core-club.test.ts
  tests/server/retention.test.ts` (106 tests).
- Hardened extracted route boundaries after review: release tier/price sets and
  wine names now fail closed when inconsistent, partial email-template updates
  no longer inject `enabled: true`, padded emails normalize before validation,
  and staff callback redirects reject control-character and backslash authority
  forms.
- Preserve explicit `null` canonical member aliases over legacy alias values
  and keep member/release PATCH service inputs genuinely partial.
- Require actual raw `Buffer` bodies before webhook provider dispatch, provide
  an explicit non-zero loyalty-adjustment error, reuse the shared UUID schema,
  and document the order-sensitive intelligence/member mounts.
- Trust Cloudflare's edge-managed client-address header only in staging and
  production; direct local/test requests now use Express's socket-derived
  address for audit fields and rate-limit actor keys.
- Hardened the Worker-compatible multipart CSV parser with bounded MIME
  boundaries, exact CRLF/header framing, bounded field counts, and line-framed
  delimiter recognition. Focused API regressions cover malformed bodies and
  delimiter-like bytes inside CSV content without introducing a Node stream
  middleware dependency.

### Added

- **What changed:** Added the BS-05 local-development harness with pinned
  Supabase CLI, fail-fast Supabase/Worker/Vite orchestration, loopback-only
  Auth bootstrap, synthetic two-tenant fixtures, authenticated smoke checks,
  deterministic double-seed verification, a local quickstart, and a 20-gate
  readiness ledger. A shared readiness helper requires simultaneous Worker
  health and Vite `/app/` responses, bounds every probe and the wall-clock
  startup window, rechecks both services after smoke, and fails immediately if
  either process exits. A dated ADR records the loopback, ephemeral-secret,
  contributor-file, process-cleanup, and Auth boundaries. Browser-origin
  regressions cover same-origin production,
  loopback HTTP, credential-free HTTPS, invalid credentials/path/query/URL,
  and the unchanged stricter Capacitor policy. `test:e2e` aliases the canonical
  `qa:e2e` command. **Why:** Contributors need a reproducible local application
  path without hosted/provider credentials, and CI must prevent fixture or
  browser-origin policy drift. **Deployment impact:** CI gains a Docker-free
  22-migration seed gate; no hosted database, provider, Worker, Pages, secret,
  DNS, or activation mutation occurs. **Verification:** `npm ci`, dependency
  audit, script syntax checks, TypeScript, Vitest 448/448, focused BS-05 tests
  74/74, and `npm run qa:local-seed`.
- **What changed:** Added the domain-service decomposition ADR and linked
  architecture/service-manifest guidance, documenting extracted ownership,
  import direction, neutral shared primitives, compatibility barrels, and the
  requirement to review behavioral changes separately from structural moves.
  **Why:** The decomposition establishes a durable architecture and therefore
  requires a canonical decision record beyond the implementation manifest.
  **Deployment impact:** Documentation only; routes, Worker bindings, database
  migrations, providers, secrets, Pages, and activation state are unchanged.
  **Verification:** ADR link review, implemented import-graph comparison,
  18-service/37-edge zero-cycle audit, `git diff --check`, and exact-head
  automated review.
- Added the BS-03 `server/services/` extraction skeleton for members, clubs,
  orders, Stripe, EasyPost, communications, webhooks, and the service barrel;
  the pre-existing analytics module remains intact.
- Added the BS-03 service decomposition manifest, documenting every exported
  function, public service method, cross-domain dependency,
  provider-activation guard, and tenant-scoping boundary before extraction.
- Added architecture context for the current Pages/Worker/Supabase topology,
  explicit tenant boundary, service request path, provider activation status,
  all 20 pending gates, and the canonical file-ownership table so automated
  reviewers receive current system context.
- Added repository-wide CODEOWNERS, a pull-request template aligned with the
  actual test commands, governance risk notes, Greptile learning guidance, and
  an exhaustive service-layer tenancy audit to route ownership and make the
  remaining self-review risk explicit without claiming enforced approval.
- Added a focused mobile-bootstrap isolation test that requires member,
  shipment, and loyalty queries to use the authenticated organization and
  brand, closing the confirmed Rule 8 defense-in-depth gap.
- Added the route-layer decomposition ADR documenting domain router
  boundaries, the public/protected/fallback mount-order contract, and the
  request-scoped `RouteContext` service-selector pattern.
- Added the BS-02 route manifest covering all 129 Express route registrations,
  middleware chains, inline-logic flags, direct-database-access audit, and
  domain extraction ownership before route code is moved.
- Added `@sentry/cloudflare` at the Worker entry boundary, gated on the
  server-only `SENTRY_DSN` secret and configured to exclude request PII,
  bodies, query strings, database query data, stack-frame variables, and
  exception/log messages.
- Added `server/lib/error-handler.ts` with request-correlated structured logs,
  safe Zod/auth/authz/not-found/unknown mappings, a consistent JSON envelope,
  and Sentry capture for 5xx exceptions.
- Added `server/lib/rate-limit.ts` and four native Cloudflare Rate Limiting
  bindings for auth, general API, webhook, and admin routes. Policies consume
  both normalized route/tenant and route/hashed-actor counters and fail closed
  when a production binding is unavailable.
- Added `.dev.vars.example`, focused Sentry/error/rate-limit unit tests, the
  observability and rate-limiting ADR, and a BS-04 QA report recording audit 0,
  aggregate checks, TypeScript and generated bindings, 367/367 Vitest tests,
  Vite/Pages and all Worker dry runs, 145/145 Playwright/axe cases, and a clean
  changed-file credential scan.
- `.greptile/rules.md`: 10 architectural boundary rules encoding vinifera's service, security, and tenancy patterns
- `.greptile/files.json`: Greptile context files for every PR review
- `docs/build-specs/phase-5-qa-report.md`: Phase 5 closure evidence with all 20 activation gates listed as pending
- Added tenant-free Cloudflare Queue wake signals with PostgreSQL-authoritative
  claiming, duplicate-safe consumers, independent immediate-continuation and
  delayed-retry scheduling, hourly recovery, isolated environment bindings,
  and generated Worker type verification in CI.
- Added migration 017 and a service-role-only custom-hostname deletion ledger.
  Ambiguous DELETE results are lookup-gated, retries require proof the provider
  target still exists, provider absence/local disable complete atomically, and
  a deleted hostname generation can be safely reused.
- Added Phase 5 provider-completion migration 016 with tenant-safe Klaviyo
  field/list and QuickBooks account mapping commands, same-brand composite
  integrity, database-backed QuickBooks refresh leases and credential
  generations, persisted per-job attempt ceilings, and 35 focused pgTAP
  assertions.
- Wired the existing Integration page save contract to executable provider
  mappings. Klaviyo bulk execution now uses configured profile properties,
  churn score/level, provider profile IDs, and list add/remove transitions;
  QuickBooks defaults produce persisted membership and shipping mappings.
- Added cross-isolate QuickBooks refresh coordination tests and focused
  Klaviyo mapping/list execution tests without contacting any provider.
- Added the Phase 4 final-stack hardening migration and 37 current-stack
  assertions: brand-local operational analytics, true all-time ranges,
  refund-net LTV, de-duplicated engagement, all-brand benchmark authorization,
  qualified temporal ML provenance, concurrent shadow scoring, actor-audited
  promotion, and ShipCompliant-to-EasyPost evidence binding.
- Added the no-network/connected `ops:phase4:qualify-ml` operator command. It
  validates the six-source 95 percent reconciliation contract, requires an
  active platform automation actor, calls only the guarded five-argument RPC,
  and leaves the immutable evidence hash to PostgreSQL.
- Added shared CSV formula-injection hardening, calibrated churn uncertainty
  language, non-color chart differentiation, truthful compliance-rules
  evidence, and refreshed Phase 4 visual captures at 375, 768, and 1440.
- Phase 4 architecture closure commit `623dd2a` passed GitHub Actions run
  [`30232327146`](https://github.com/theonlygeranium/vinifera/actions/runs/30232327146):
  quality/browser QA completed in 6m49s, Android lint/debug/minified release
  completed in 4m19s, QA/native evidence uploaded, the Pages rollback artifact
  validated, and hosted migration/deployment skipped while activation remains
  off. The resulting static Pages deployment serves CSP, COOP, HSTS,
  frame-deny, and MIME-sniffing protections at `/` and `/app/`; `/api/health`
  remains static HTML until the Worker is activated.
- Added the Phase 3 final-stack retention hardening migration: brand-scoped
  defaults and time zones, same-brand composite integrity, lease-token email
  completion, a durable provider-event inbox, command result fingerprints,
  immutable cancel snapshots, stale-attempt cleanup, pause resumption, and a
  UTC/global plus brand-local daily retention ledger.
- Added 61 current-stack Phase 3 database assertions and wired them into both
  the Phase 3 and Phase 5 embedded PostgreSQL gates.
- Added paginated staff/member loyalty ledgers, current-tier downgrade
  comparison, unsaved-draft email tests, direct rules-based churn coverage, and
  tenant-scoped session-retained UUID commands for cancellation and loyalty
  mutations.
- Added the Phase 3 retention integrity hardening ADR and expanded activation
  diagnostics for lease expiry, uncertain provider receipts, early webhooks,
  monotonic events, daily replay, and brand-local dates.
- Added the Phase 2 transactional command ledger and leased provider outbox:
  UUID/SHA-256 replay protection, atomic business/audit/result persistence,
  privacy-preserving browser resumption, supersession, and bounded recovery.
- Added same-brand composite foreign keys, complete release-aggregate
  validation, immutable Stripe event convergence, stale-refund recovery leases,
  and a final provider-identity deletion reference check.
- Added the Phase 2 data-integrity hardening ADR and expanded QA evidence.
- Added the Phase 1 owner/admin Team invitation surface, role-aware
  manager/staff denial, session-backed invite/reset completion, a dedicated
  92-assertion Phase 1 database gate, and retained login/signup visual evidence
  at 375, 768, and 1440.
- Added recoverable organization signup billing with immediate idempotent
  Stripe Customer creation when connected and explicit `ready`, `deferred`,
  and `reconciliation_required` states when services are connected later.
- Added the signup billing recovery ADR covering ambiguous database responses,
  uncertain provider writes, identity retention, and just-in-time
  reconciliation.
- Completed the credential-independent production architecture with Stripe
  billing-subject locks and webhook-wait reconciliation, consent-gated
  encrypted Meta attribution, resumable envelope rotation, separately
  persisted QuickBooks shipping, Avalara mappings/exemptions/filing snapshots,
  per-brand Resend activation, provider target policies, a retry-safe hostname
  ledger, and staff white-label controls.
- Added independently protected, default-deny credential-rotation and Stripe
  live-billing controls plus restricted
  `env://VINIFERA_INTEGRATION_SECRET_*` runtime references.
- Added the deferred-service activation ADR and aligned setup, architecture,
  environment, activation, QA, and continuity documentation with the
  connect-services-later operating model.
- Added a protected Stripe test-catalog workflow with a read-only account
  fingerprint probe, tracked SHA-256 account authorization, exact typed
  confirmations, idempotent Product/Price creation, drift verification, and
  sanitized non-secret Price evidence.
- Expanded the integrated application/control suite to 189/189 tests across 16
  files.
- Added a GET-only hosted-readiness workflow that classifies staging versus
  generic Cloudflare, Supabase, and Stripe test credentials without retaining
  values, provider bodies, URLs, or identifiers.
- Added hashed staging and production target policies whose empty unresolved
  arrays block mutation before any provider write.
- Added linked hosted Supabase pgTAP/RLS execution and a sanitized staging
  Worker verifier for the core app, database, Stripe test billing, and webhook
  capabilities.
- Added a protected manual production Worker controller for first bootstrap,
  immutable version upload/deploy, full-capability domain cutover, Worker
  rollback, and non-destructive Pages restoration.
- Added a protected signed mobile-release controller for ephemeral Android/iOS
  signing, signature verification, Google Play internal edit transactions, and
  internal-only TestFlight upload.
- Added the credential-gated release ADR plus Phase 1, Phase 4, environment
  provisioning, production cutover/rollback, and signed mobile runbooks.

### Changed

- **What changed:** Vinifera JWT helpers and all migration/test references now
  use the application-owned `private` schema, migration 020 revokes the
  correct text-argument function signature, local seed application is
  idempotent, staff login/invite resolution reuses the response-owning
  Supabase client, member portal relationship embeds name their brand-scoped
  foreign keys, and daily portal-login analytics preserve the first real
  occurrence timestamp while replaying idempotently.
  The BS-05 readiness ledger records partial local prerequisite evidence for
  Gates 1, 7, and 15 while keeping all 20 composite activation gates `pending`.
  Local fixture brands now use fixed IDs verified across independent clean
  databases, local URL parsing rejects credentials and non-origin components,
  shared local-config and PostgreSQL-bootstrap modules prevent verifier drift
  across the local seed and Phase 3–5 database gates,
  and single-result roster/import feedback uses the correct singular label.
  **Why:** The native local stack and independent review exposed
  managed-schema, replay, response-cookie, ambiguous relationship,
  duplicate-idempotency, fixture-reproducibility, URL-boundary, readiness
  semantics, and UI-copy defects that embedded or mocked checks did not.
  **Deployment impact:** Local replay, Worker behavior, fixture identity,
  loopback validation, and member-count copy are corrected, but no hosted
  schema/provider state is changed. **Verification:** Native and embedded
  22-migration seed replay, independent clean-database brand identity,
  authenticated two-tenant Worker/Auth smoke, TypeScript, Vitest 448/448,
  focused BS-05 tests 74/74, Playwright 145/145, real desktop/375px axe-core
  with zero violations, 375px touch targets, and fail-closed shutdown cleanup.
- BS-06 review follow-up clarifies that CODEOWNERS routes review but is not
  currently branch-protection enforced, expands the pull-request checklist to
  cover dependency, database, and package gates, pins the tenancy audit to its
  exact code and repository-migration evidence, and strengthens the isolation
  fixture with same-organization/wrong-brand rows while retaining
  cross-organization rows. The governance note now also records explicit
  change, rationale, deployment-impact, and verification evidence for the
  observed GitHub controls. This improves review evidence only and changes no
  runtime or deployment state. Verify with read-only GitHub branch/environment
  API inspection, the repository governance files, TypeScript, the focused
  Phase 5 integration test, and the full 378-test suite.
- Integrated BS-06 with the repaired direct-push guard and completed BS-02/
  BS-04 route and observability baseline from `main`. Architecture and
  governance documentation now match the extracted route tree and current
  protected-branch controls while preserving the mobile-bootstrap tenant
  predicates and cross-brand regression. This merge changes no provider,
  hosted-database, Worker, or production activation state. Verify with the
  exact integrated evidence recorded in `CONTINUITY_BRIEF.md`.
- Updated README developer context with the current v0.5.0 status, existing
  local development commands, agent workflow, and architecture links.
- Integrated the repaired direct-push guard from `main` into the BS-04 branch
  while preserving the observability and rate-limit implementation. This merge
  changes no runtime route or activation state; verify with the guard policy
  tests and the complete BS-04 quality suite before merge.
- Review follow-up hashes complete rate-limit composites into Cloudflare's
  64-byte key maximum, derives tenant budgets from the edge-routed host instead
  of client-selected brand or forwarded-host headers, uses the Cloudflare
  connecting IP instead of rotatable authorization/cookie input for the actor
  budget, and narrows the reflective Worker secret lookup to explicit
  `unknown`.
- Registered specialized rate limits before API handlers and the centralized
  error handler last. Wrangler development, staging, and production
  environments now declare the four native rate-limit bindings. This changes
  Worker build/runtime configuration but does not deploy the Worker, activate
  Sentry, change static Pages routing, or contact a provider. Verify with
  Worker type generation, TypeScript, unit/browser tests, dependency audit,
  Vite/Pages and Worker builds, secret scanning, and middleware-order review.
  Existing API fixtures now inject deterministic allow-only rate-limit
  bindings so production-mode route assertions continue exercising their
  intended auth and activation behavior.
- Reworked the direct-push guard to produce its required check on pull
  requests and to verify `main` updates using the exact merge result returned
  by GitHub's associated-pull-request API. Conventional commit messages no
  longer bypass the guard; merge, squash, and rebase strategies remain
  supported, and focused policy tests fail closed on forced pushes, missing
  evidence, or API errors. Associated-PR lookup follows bounded, validated
  same-origin pagination and retries routine indexing delay twice before its
  final rejection.
- Local `typecheck`, `lint`, and aggregate `check` commands now regenerate the
  ignored Worker binding declaration before TypeScript reads it, so a fresh
  checkout no longer depends on a previously generated local file.
- Migrated Greptile configuration from `greptile.json` to `.greptile/` folder format with per-directory overrides for `server/services/`, `supabase/migrations/`, and `tests/`
- Removed committed generated artifact `worker-configuration.d.ts` (552 KB); CI now generates it pre-typecheck
- This repository-hygiene change does not alter runtime routes, build output,
  provider activation, or the static production baseline. Validate it with
  JSON parsing, Git tracking checks, Worker type generation/verification,
  TypeScript typecheck, and a Worker dry-run build.
- Aggregated organization-wide analytics from raw per-brand numerators and
  denominators, including email, loyalty, shipment-value, and shipping-cost
  rates, instead of weighting unrelated percentages.
- Hardened provider transports with bounded response bodies, timeouts,
  redirect rejection, fixed target validation, safe error classes, and
  constant-time fixed-size secret comparisons.
- Recorded the final credential-independent Phase 5 gate: audit 0, generated
  Worker types and TypeScript green, Vitest 352/352, database gates
  92/231/199/158/494, Playwright 145/145 with zero axe violations, 416 ms LCP,
  CLS 0, 920 ms multi-brand readiness, 444.6 ms 100-member roster, Vite/Pages
  and development/staging/production Worker dry runs, mobile identity/release
  controls, compile-only preparation, and Android/iOS Capacitor sync.
- Recorded Phase 5 architecture closure commit `5d3dadd` and GitHub Actions
  run
  [`30235083942`](https://github.com/theonlygeranium/vinifera/actions/runs/30235083942):
  quality/database/browser/Pages rollback passed in 5m39s, Android
  lint/debug/minified release passed in 4m10s, evidence uploaded, and
  credential-gated migration/deployment skipped.
- Integration enqueue/runtime/claim paths now exclude inactive or suspended
  brands, expired final-attempt jobs are dead-lettered during recovery, and
  Avalara quote adjustment replaces only same-shipment temporary facts while
  preserving provider-code uniqueness and committed immutability.
- QuickBooks OAuth authorization, exchange, and worker runtime now share the
  canonical HTTPS redirect assertion, and rolling token persistence uses a
  database generation compare-and-swap before any refreshed access token is
  used.
- Made the staff tenant boundary remount brand-scoped operational state,
  preserve explicit `scope=all` analytics URLs, suppress stale resource
  responses, and fail closed behind a retryable brand-catalog gate. Native
  member cold starts can now unlock minimized cached data in read-only mode
  when token rotation is offline, refresh-token rotation is single-flight, and
  sender verification persists the current draft before DNS activation.
- Recorded the Phase 4 credential-independent gate: audit 0, TypeScript green,
  Vitest 323/323, database gates 92/231/199/158/438, Playwright 143/143
  (Phase 4 20/20) with zero axe violations, 13,846.77 ms 10,000-member
  scoring, 58.40 ms 365-day analytics, 24.20 ms chart rendering, Pages
  rollback validation, Worker dry run, and compile-only Android/iOS sync.
- Made ML creation, registration, and promotion service-only; a missing active
  actor, source qualification, completed experiment metric, or fresh stable
  drift record now fails closed. Client-authored analytics events are denied,
  and organization-wide benchmark access requires an active all-brand actor at
  both service and database boundaries.
- Required an explicit vendor-approved ShipCompliant token path, shared the
  OAuth/check timeout budget, rejected redirects, preserved the token cache,
  and added CSP/COOP/HSTS to the Pages rollback header contract.
- Replaced composition-dependent email batch idempotency with one stable
  provider key per outbox row and bounded delivery concurrency of eight.
- Isolated email enqueue/delivery from daily churn, loyalty, cancellation, and
  pause-resume work so a configured provider outage cannot suppress unrelated
  retention jobs.
- Changed loyalty history from offset paging to an immutable-sequence snapshot
  cursor, blocked unverified sender claims without consuming attempts, and
  aligned retention analytics with completed decisions and real client events.
- Recorded the Phase 3 credential-independent gate: audit 0, TypeScript green,
  Vitest 301/301, database gates 92/231/199/121/401, Playwright 141/141
  (Phase 3 27/27) with zero axe violations, 155.11 ms scoring, 7.48 ms email
  claim, 436 ms LCP, CLS 0, Pages/Worker dry runs, and compile-only Android/iOS
  synchronization.
- Recorded Phase 3 architecture closure commit `3b01c3a` and GitHub Actions run
  `30229260377`: quality passed in 6m22s, Android in 4m25s, QA/native evidence
  uploaded, the Pages rollback artifact validated, and credential-gated
  Supabase/Worker mutation jobs skipped.
- Recorded Phase 2 architecture closure commit `15c9942` and GitHub Actions run
  `30226397256`: quality passed in 5m15s, Android in 3m39s, evidence uploaded,
  and credential-gated Supabase/Worker mutation jobs skipped.
- Recorded the current credential-independent gate: audit 0, TypeScript green,
  Vitest 290/290 (focused Phase 2 72/72), database gates
  92/231/138/121/340, Playwright 136/136 (Phase 2 38/38) with zero axe
  violations, 941.7 ms single-worker roster, 712 ms LCP, CLS 0,
  release/mobile/catalog
  controls 14/7/16, Pages/Worker dry runs, and compile-only Android/iOS sync.
- Split Phase 2 database evidence into 170 point-in-time and 61 current-stack
  transactional assertions, with 10.76 ms release and 338.85 ms import proof.
- Recorded Phase 1 architecture closure commit `a27f078` and GitHub Actions run
  `30223237016`: quality passed in 5m43s, Android in 4m44s, 90-day Playwright
  evidence uploaded, and hosted mutation jobs skipped while activation is off.
- Enforced restricted/suspended staff workspaces as billing-recovery-only,
  while keeping Subscription and sign-out available and blocking operational
  navigation and server services.
- Extended CI to run Phase 1 through Phase 5 database architecture, retain
  Playwright evidence for 90 days, and exercise explicit Tab-order plus
  Space/Enter activation.
- Updated the current local gate to TypeScript green, Vitest 256/256, Phase 1
  PostgreSQL 92/92, Phase 1 Playwright 30/30, and the full Playwright inventory
  at 132 tests.
- Raised the GitHub Actions artifact/log retention setting from 1 day to the
  repository's allowed 90-day maximum so QA, native-build, rollback, and
  protected activation evidence follows the workflow retention contracts.
- Pinned Android setup in CI and signed mobile release to
  `android-actions/setup-android` v4.0.1, whose action runtime is Node 24,
  removing the runner's Node 20 compatibility warning.
- Recorded the final local architecture gate: dependency audit 0, TypeScript
  green, Vitest 245/245, Phase 2/3/4 database regressions 145/138/121, Phase 5
  migrations 001–012 and pgTAP suites 013–022 at 279/279, Playwright 123/123
  with zero axe violations, LCP 476 ms, CLS 0, Pages/Worker/production dry-run
  builds, production release 14/14, mobile release 7/7, Stripe catalog 16/16,
  mobile identity, compile-only Capacitor preparation, and Android sync.
- Recorded architecture commit `5d36471` and GitHub Actions run `30221722696`:
  the quality job passed in 5m23s, the Java 21 Android lint/debug/minified
  release job passed in 4m37s, and credential-gated migration/deployment jobs
  skipped as designed. The local Mac still has no Java runtime.
- Requested Product expansion on newly created Stripe Prices so the controller
  can validate the Product contract in the same response. Protected bootstrap
  run `30218801133` failed closed after the first provider create because the
  initial response returned only a Product ID; the stable lookup and
  idempotency keys make the retry safe.
- Authorized the reviewed Stripe test account fingerprint after successful
  read-only run `30218422165`; the fingerprint is a one-way target binding and
  the canonical Product/Price catalog remains uncreated pending a separately
  reviewed bootstrap operation.
- Removed the implicit native production-origin fallback. Compile-only,
  isolated staging, and explicitly authorized production builds now have
  distinct fail-closed profiles and artifact labels.
- Made hosted migration success contingent on the repository's native pgTAP
  suites and made staging Worker success contingent on the JSON configuration
  contract, not only an HTTP 200 health response.
- Added a named route-free `vinifera-production` Wrangler environment that
  stays on `workers.dev` until the separate domain operation is approved.
- Made Android `bundleRelease` require complete environment-backed signing
  while retaining unsigned `assembleRelease` for compile-only CI.
- Aligned the Phase 5 build specification with the implemented source
  architecture, including credential ownership, additive non-null brand
  backfill, and signed-store mobile updates.
- Standardized the checked-in Apple association template on the canonical
  `MOBILE_APPLE_TEAM_ID` activation variable.
- Replaced the Phase 5 QA placeholders with traceable local architecture,
  database, browser, visual, security, iOS simulator, and local Android
  lint/debug/R8 evidence while keeping hosted providers, signing/FCM, store
  tracks, and live payments explicitly deferred.
- Recorded the final Phase 5 gates: 174/174 application tests, 167/167 Phase 5
  database assertions plus complete Phase 2–4 database regressions, 122/122
  browser tests with zero axe violations, and the reproducible Android debug,
  unsigned release, and R8 mapping hashes.
- Replaced a timer-dependent Phase 5 loading assertion with a controlled
  request gate, then passed the complete 122-test browser suite with retries
  disabled.
- Closed the Android lint/R8 gates by declaring camera hardware optional,
  supplying ionbarcode's Gson 2.10.1 runtime dependency, modernizing Gradle
  assignments, and bounding release-build memory and worker concurrency.
- Recorded the successful GitHub Phase 5 quality and Android jobs plus the
  retained debug/release APK and lint artifact; credential-gated Supabase and
  Worker jobs remained deliberately inactive.
- Recorded the successful post-hardening GitHub quality/Android run and
  GET-only hosted-readiness audit. Existing Supabase and Stripe test
  credentials are reachable, while staging credentials, database migrations,
  Stripe Prices/webhook, and Workers-capable Cloudflare authority remain
  intentionally unresolved.

### Fixed

- Removed a README link to the not-yet-committed BS-05 local quickstart so
  repository navigation points only to files and commands that exist today.
- Added explicit `organization_id` and `brand_id` predicates to every mobile
  offline-bootstrap profile, shipment, and loyalty query instead of relying
  only on member RLS and `member_id`.
- Restored unauthenticated browser bootstrap for the existing member
  magic-link, callback, session, and logout routes while keeping protected APIs
  behind the production credential-presence gate.
- Updated Phase 1 authenticated-shell mocks for the fail-closed brand catalog
  and corrected the Phase 2 performance fixture's organization-overview shape,
  preventing setup errors from being misreported as browser regressions.
- Prevented an indeterminate custom-hostname deletion from being replayed
  blindly, prevented a provider-adjusted Avalara temporary quote from
  conflicting with its stable provider transaction code, and preserved each
  integration job's configured attempt ceiling beyond eight tries.
- Fixed older Phase 2 browser fixtures to cross the new fail-closed brand
  boundary without weakening production tenant isolation.
- Prevented stale email Workers from finalizing reclaimed work, accepted-email
  retries from changing provider identity, early webhooks from being discarded,
  and out-of-order events from regressing terminal delivery state.
- Prevented live cancel configuration edits from changing an in-flight
  attempt, unsafe confirm-step configurations, permanently pinned stale
  attempts, duplicate manual loyalty adjustments, referral first-delivery
  races, and all-time analytics from being truncated to the newest events.
- Completed Phase 3 multi-brand isolation, made birthday/pre-shipment calendar
  selection brand-time-zone aware, and kept final-stack test fixtures aligned
  with automatic retention seeding.
- Prevented cross-brand Phase 2 references, incomplete scheduled releases,
  conflicting command replays, duplicate active charges/refunds, mutable Stripe
  event replays, abandoned stale refunds, and member-auth deletion races.
- Made completed staff refunds replay their recorded terminal result before the
  refunded-shipment guard, without another Stripe or ledger call, and retained
  client command UUIDs across retryable HTTP 408/425/429 responses.
- Kept marketing text fully opaque during scroll motion so axe never evaluates
  transient low-contrast blends, and aligned the canonical local Playwright
  gate with CI's single-worker performance environment.
- Fixed Supabase PKCE reset and invitation completion so the established
  HTTP-only session is authoritative and optional invite metadata uses the API
  contract.
- Fixed signup rollback safety so an ambiguous committed organization is
  reconciled by owner identity before cleanup and no post-bootstrap Stripe or
  session failure deletes the tenant.

### Security

- Kept queue messages free of tenant, connection, provider, and customer
  identifiers; all authoritative work and leases remain in PostgreSQL.
- Required same-brand composite integrity and authorized mapping commands for
  Klaviyo/QuickBooks configuration, and blocked suspended/inactive tenants at
  enqueue, runtime credential resolution, and claim boundaries.
- Preserved the server-BFF boundary by keeping every Phase 3 mutation,
  analytics, scheduler, and provider-reconciliation RPC service-role-only in
  the final stack.
- Required exact UUID/SHA-256 command intent for cancellation, loyalty
  adjustment, reservation, and redemption replay, and enforced organization,
  brand, and member identity through composite foreign keys.
- Restricted Phase 2 security-definer command/recovery functions to the service
  role, bound results to same-brand audit evidence, and kept member PII out of
  resumable browser command storage.
- Required stable Stripe Customer/session idempotency, one nonterminal Checkout
  per immutable billing subject, and an `awaiting_webhook` state that prevents
  replacement Checkout creation before signed subscription reconciliation.
- Required current consent and encrypted-at-rest browser attribution for Meta,
  redaction on consent withdrawal, bounded verified envelope rotation, and
  normalized target hashes for Cloudflare custom hostnames, FCM, and
  ShipCompliant.
- Kept live Stripe independent from Worker deployment and default-denied behind
  disabled policy, separate authority, reviewed account/webhook/Worker/Price
  targets, immutable commit binding, and exact protected confirmations.
- Restricted catalog bootstrap to `sk_test_*`, the canonical four monthly plan
  contracts, an immutable `main` commit, an allowlisted account fingerprint,
  stable lookup/idempotency keys, and a workflow that cannot create customers,
  subscriptions, charges, refunds, portals, or webhooks.
- Made staging Worker deployment verify the configured Price IDs against the
  allowlisted Stripe test catalog before uploading any Worker version.
- Enforced Secure cookies in hosted staging as well as production.
- Rejected Stripe live credentials outside production and required the
  independent, default-off `LIVE_BILLING_ENABLED` authority for every Checkout
  and shipment charge/refund/retry/schedule path.
- Rejected QuickBooks production, Avalara production, and APNs production
  endpoints outside `APP_ENV=production`; Avalara now accepts only canonical
  sandbox or production origins.
- Kept production release Stripe test-only, required all 14 configuration
  capabilities before domain movement, retained an active Pages rollback
  target, and added automatic inverse restoration on failed cutover.
- Bound signed mobile artifacts to an immutable commit on `main`, validated the
  Android upload certificate fingerprint, restricted store delivery to fixed
  internal targets, and removed decoded signing material in always-run cleanup.
- Pinned every CI, readiness, production-control, and mobile-release GitHub
  Action to an immutable commit.
- Provisioned `staging`, `production`, and `mobile-release` GitHub environments
  with `main`-only deployment policies; production and mobile release require
  repository-owner review.
- Added repository-owner review to `staging`, covering catalog activation,
  hosted readiness, Supabase migration, and isolated Worker deployment.
- Added durable QuickBooks/Avalara refund checkpoints and crash reconciliation,
  including exact 4,863 + 4,862 = 9,725 cent convergence and SHA-256-derived
  Intuit request IDs.
- Expanded regression coverage for service-only privileges and exact-context
  HMAC authentication of web magic-link organization, brand, redirect, and
  member context.

### Deferred

- All external services remain disconnected by owner direction. No hosted,
  provider, DNS, store, or live-payment exit criterion is claimed.
- Phase 3 still requires hosted migration/pgTAP proof, a verified Resend domain,
  signed webhook round trips, real tenant triggers, hosted churn/cancel/loyalty
  records, and a Stripe test redemption before its operational exit can pass.
- Protected Stripe bootstrap run `30218801133` left its first test Price
  created-or-unknown before failing closed. No retry was attempted; activation
  must later reconcile the fixed lookup key before any create.
- The Stripe test account fingerprint is tracked from the completed read-only
  probe. Catalog reconciliation/bootstrap, Price-secret promotion, and staging
  webhook registration remain deferred activation steps.
- Hosted target IDs/hashes, staging-scoped provider credentials, production
  control-plane credentials, native signing credentials, store authority,
  provider round trips, physical-device QA, and Stripe live approval remain
  external activation work. The new workflows intentionally fail closed until
  each input is supplied and reviewed.

## [0.5.0] — 2026-07-26

### Added

- Multi-brand tenancy with additive default-brand backfill, brand-scoped staff
  grants, explicit privileged all-brand aggregates, brand-bound member access,
  shared or independent billing state, and forced PostgreSQL RLS.
- A server-only integration framework with versioned AES-256-GCM credential
  envelopes, explicit opt-in, leased/idempotent jobs, reconciliation, sanitized
  attempt logs, and fail-closed activation states.
- Klaviyo profile/list/engagement synchronization, QuickBooks Online OAuth and
  accounting synchronization, Avalara pre-charge tax calculation and
  reconciliation, and consent-gated Meta Conversions API delivery.
- White-label themes and Cloudflare for SaaS custom-hostname lifecycle with
  ownership/certificate gating and server-derived hostname-to-brand resolution.
- Capacitor 8 iOS and Android projects with secure mobile magic-link exchange,
  rotating server-revocable sessions, biometric/device-credential relock, APNs
  and FCM delivery adapters, barcode scanning, network recovery, minimized
  read-only offline data, allowlisted deep links, and store-directed updates.
- Phase 5 database migrations and pgTAP suites, service and browser tests,
  responsive/axe evidence, native security documentation, an architecture ADR,
  activation runbook, and QA report.
- A canonical mobile identity manifest, deterministic Vinifera native artwork
  generator, and drift gate for package/native versions, IDs, deep links, APNs
  modes, Gradle integrity, privacy declarations, and placeholder artwork.

### Changed

- Advanced the current source release to 0.5.0 with aligned web, Android, and
  iOS version identifiers and a Node 22.12-or-newer engine contract.
- Extended GitHub CI through the Phase 5 database gate and an Android API 36
  lint/debug build using Node 22.22.0 and Java 21.
- Pinned Supabase CLI 2.109.1 and isolated optional Worker deployment to the
  `vinifera-staging` environment. Available secrets are attached atomically to
  the version, and production custom-domain cutover remains human-controlled.
- Kept winery Klaviyo, Avalara, and Meta credentials in encrypted database
  envelopes. QuickBooks application OAuth configuration remains in Worker
  secrets while per-connection OAuth tokens use the same encrypted envelope
  boundary.
- Enabled Android Release R8 minification/resource shrinking, pinned the
  Gradle distribution checksum, replaced default native artwork, narrowed the
  `FileProvider`, and fixed the generated instrumentation identity test.

### Security

- Required tenant and brand authorization in both database policies and
  service-role application queries; a browser-supplied brand identifier never
  grants access.
- Rechecked marketing consent immediately before provider disclosure, hashed
  Meta identifiers before transport construction, and kept provider payloads,
  mobile tokens, and credentials out of browser-readable logs and storage.
- Kept native sessions in Keychain/Keystore-backed storage, made refresh-token
  reuse revoke its token family, disabled Android cleartext traffic and broad
  backup, and constrained native web connectivity with a build-time CSP.
- Bound one-time mobile exchanges to the registered redirect URI, verified
  Klaviyo's canonical signed batch envelope, enforced tax-inclusive shipment
  billing identities, and limited each brand to one safely replaceable or
  disableable sender identity.
- Bound APNs to an explicit sandbox/production host and the signed iOS bundle
  identity; aligned native deep links to one exact scheme/host/route contract
  and completed the iOS privacy plus native permission/data inventory.

### Deferred

- Hosted Supabase migration, live/sandbox provider account validation, custom
  winery DNS and certificates, Stripe live-mode transition, signed
  physical-device push testing, App Store/TestFlight distribution, and Play
  internal-track distribution require external credentials or human authority.
- The public custom domain remains the verified static Cloudflare Pages
  rollback baseline until the hosted activation and regression gates pass.

## [0.4.0] — 2026-07-26

### Added

- Tenant-scoped analytics event, daily aggregate, cohort, dashboard-layout,
  and scheduled-report architecture backed only by production operational
  facts.
- Responsive revenue, member, shipment, engagement, cohort, LTV, and
  acquisition dashboards with accessible chart tables and CSV exports.
- Deterministic L2 logistic churn trainer with immutable snapshots, temporal
  holdout, five expanding folds, calibration, confusion matrix, rules
  baseline, heuristic model score bands, feature attribution, drift
  monitoring, and nightly batch scoring architecture.
- Fail-closed model lifecycle gates for production provenance, minimum data
  volume, ROC AUC, rules-baseline superiority, and a completed 30-day A/B test.
- Estate/Reserve benchmark opt-in, progressively coarsened k-anonymous peer
  groups, percentile comparisons, and polished quarterly PDF/email reports.
- Connection-ready ShipCompliant OAuth adapter, auditable compliance ledger,
  tax estimates, provider response IDs, provider-health states, dashboard, and
  mandatory post-charge/pre-label checks.
- Compliance input fingerprints and durable EasyPost label attempts that
  persist the carrier shipment before purchase, reuse successful outcomes, and
  support resume or reconciliation without blind duplicate purchases.
- Phase 4 ADR, model card, ShipCompliant activation runbook, database verifier,
  browser QA, and visual/PDF evidence.
- A passing Phase 4 local architecture gate with 121/121 embedded database
  assertions, a keyboard-only browser workflow, deterministic sub-500ms chart
  rendering evidence, and measured database scale checks. Hosted real-data,
  model-accuracy, peer-cohort, and ShipCompliant activation remain deferred.

### Changed

- Routed the implemented label path through the Phase 4 provider-backed
  fail-closed boundary. The Phase 2 whitelist remains historical code and is
  not legal authority; hosted ShipCompliant activation is still pending.
- Made the keyboard-only analytics QA use portable native-select key navigation
  so Linux Chromium cannot interpret Enter as an early form submission.
- Extended the Worker schedule for daily analytics/features/predictions,
  monthly candidate training, scheduled summaries, and quarterly benchmarks.
- Extended setup, architecture, CI, secret contracts, and configuration health
  for credential-deferred compliance activation.

### Security

- Forced row-level security across every Phase 4 tenant table and restricted
  cross-tenant aggregation/model lifecycle RPCs to the service role.
- Rejected identifying analytics payload fields, suppressed peer metrics below
  ten wineries, prevented synthetic model promotion, and kept all
  ShipCompliant credentials server-side.

## [0.3.0] — 2026-07-26

### Added

- Tenant-owned transactional email templates, durable outbox claims, delivery
  log, six lifecycle triggers, preview/test sends, and signed unsubscribe links.
- Fail-closed Resend batch adapter with idempotency and raw-body Svix webhook
  verification; test-only deterministic delivery remains unavailable in
  production.
- Explainable rules-based churn scoring with nightly snapshots, risk queue,
  filters, and contributing-factor detail.
- Configurable four-step cancellation interception with pause, downgrade,
  shipment swap, final cancellation, and outcome analytics.
- Append-only loyalty lots and ledger with shipment, referral, event, birthday,
  anniversary, manual adjustment, 24-month expiration, and FIFO redemption.
- Loyalty-adjusted Stripe shipment charge, retry, and refund convergence.
- Phase 3 ADR, Resend activation runbook, QA report, visual evidence, and
  reproducible embedded database verification in CI.

### Changed

- Added birthday and same-tenant referrer data to member management.
- Extended the hourly Worker schedule for email, churn, and loyalty maintenance.
- Made Phase 2 and Phase 3 embedded database gates locked, repeatable CI steps.
- Extended setup, architecture, continuity, and secret contracts for Phase 3.

### Security

- Forced row-level security across every Phase 3 tenant table.
- Restricted scheduled and redemption-finalization RPCs to the service role.
- Sanitized email HTML, kept provider secrets server-side, replay-protected
  delivery events, and rejected production simulators.

## [0.2.0] — 2026-07-26

### Added

- React 19 + Tailwind/Vite staff and member applications with code-split `/app/*` and `/portal/*` routes.
- Express 5 backend-for-frontend packaged with static assets in one Cloudflare Worker.
- Secure staff password, reset, Google OAuth, invitation, and protected-route flows.
- Passwordless member magic-link flow with isolated staff/member HTTP-only cookie sessions.
- Supabase foundation migration with forced RLS, server-derived JWT claims, super-admin access, tenant indexes, atomic invitation consumption, and pgTAP suites.
- Stripe test-mode Checkout, Customer Portal, signed webhook processing, idempotency, out-of-order protection, and seven/fourteen-day access reconciliation.
- Configuration health and typed activation gates so real provider connections can be enabled later without production mocks.
- GitHub-hosted CI for dependency audit, type-checking, unit/integration tests, Worker packaging, Playwright/axe QA, conditional Supabase migration, and Worker deployment.
- Phase 1 architecture ADR and QA report.
- Reproducible Phase 2 embedded database verification with plan-balanced
  schema, tenant-RLS, server-RPC assertions, and measured 50-shipment and
  1,000-row import performance gates.
- Phase 2 tenant-owned club tiers, release snapshots, shipments, billing attempts, durable CSV imports, and tamper-evident audit chain.
- Member CRM, tier management, release calendar, decline recovery, fulfillment station, import workflow, and data-connected member shipment portal.
- Stripe off-session shipment PaymentIntents, partial-success release batches, manual and automatic retries, refunds, and signed webhook convergence.
- EasyPost address verification and adult-signature label adapter behind a fail-closed shipping provider boundary.
- Hourly due-release processing, retry claiming, in-flight attempt recovery, and idempotent resume behavior.
- Phase 2 ADR, provider activation runbook, QA report, embedded performance gates, and breakpoint visual evidence.

### Changed

- Required a nonblank winery name/company and phone in shipping-origin addresses used for adult-signature labels.
- Replaced the static `/app` deployment artifact with a production React shell while retaining the original `app` file as the visual reference.
- Moved runtime configuration from Pages `wrangler.toml` to Worker `wrangler.jsonc`.
- Stopped tracking generated `dist/` output; CI and deployments now build it from source.
- Updated setup, architecture, continuity, rollback, and repository documentation for the Phase 1 production foundation.
- Extended the Worker API, cron, CI secret contract, and operational documentation for the Phase 2 core club loop.

### Fixed

- Replaced the accidentally Base64-encoded `.gitignore` with active ignore rules that prevent local environment files, Worker secrets, dependencies, build output, and QA artifacts from being committed.
- Removed a timer-based Express rate-limit middleware that is incompatible with Cloudflare Worker global scope; member magic-link limits are enforced atomically in PostgreSQL.
- Normalized database RPC and API session contracts, including Stripe event return shapes and camel-cased browser payloads.
- Refreshed newly bootstrapped Supabase sessions so database-derived tenant claims are immediately available.
- Made disconnected session probes fail closed without producing noisy browser errors.
- Gated Worker deployment behind an explicit activation flag after the existing Cloudflare token proved to lack Workers Scripts permission.
- Updated GitHub checkout, Node setup, and artifact actions to their Node 24-based v7 releases.
- Preserved the verified static `/app` prototype in Cloudflare Pages builds while keeping Worker builds on the React application.

---

## [0.1.0] — 2026-07-26

### Added
- Initial repository created from `github-deploy-template`
- `AGENTS.md` — agent collaboration guide
- `CONTINUITY_BRIEF.md` — drop-in context for new agent sessions
- `CHANGELOG.md` — this file
- `REVERT.md` — stable baseline and rollback guide
- `.env.example` — non-secret environment variable template
- `docs/architecture.md` — system architecture documentation
- `docs/setup.md` — setup and deployment guide
- `docs/decisions/` — ADR directory
- `docs/runbooks/` — runbooks directory
- `.github/workflows/deploy.yml` — CI/CD pipeline
- Cloudflare Pages project `vinifera` created and configured
- Custom domain `vinifera.edstratumlabs.ai` with SSL
- GitHub Secrets injected: `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, `SCHUBERT_SSH_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- Landing page (`index.html`) with hero vineyard illustration, feature grid, workflow illustrations, pricing, CTA sunset gradient
- App prototype (`app`) with 13 functional areas, 27 KPI cards, sidebar navigation, KPI watermarks, empty-state illustration
- Investor's guide (`guide`) with 8-part content, sticky TOC sidebar, reading progress bar, scroll-spy navigation, feature grid, tech stack, timeline, pricing, stats strip
- Four hero animations: vine line drawing, gold glow pulse, grape cluster sway, CTA shimmer sweep
- `prefers-reduced-motion` fallback for all animations (CSS + SVG SMIL)
- Extensionless `app` and `guide` files for Cloudflare Pages routing
- `_redirects` routing rules for `/app/*` and `/guide/*`
- `_headers` security headers and Content-Type overrides
- "Investor's Guide" nav links in desktop nav, mobile drawer, and footer

### Fixed
- Mobile navigation: hamburger visibility, positioning, and drawer functionality
- Landing page CTA links pointing to `index.html` instead of `/app/`
- App hamburger menu not opening on mobile
- App mobile pipeline overflow at 375px viewport
- Hero illustration visibility — gradient too dramatic, SVG opacities too low
- Grape cluster rendering — CSS `transform: rotate()` overriding SVG `transform="translate()"` attribute, switched to SVG `<animateTransform additive="sum">`
- Mobile grape cluster overlap with hero-proof text
- WCAG 2.1 AA color-contrast violations across landing, app, and guide pages (20+ elements)
- WCAG 1.4.3 `btn-gold` contrast: white text on gold (2.59:1) → wine-dark text (6.47:1)
- Guide page ARIA table role violations (`aria-required-children`, `aria-required-parent`)
- Guide page `--text-3` color contrast: `#9C8C78` (3.26:1) → `#6B5D4A` (6.38:1)
- Guide page gold stat-value contrast: `#C9993A` (2.59:1) → `#9A7510` (3.5:1)
- Missing `<main>` and `<header>` HTML landmarks
- Touch targets below 44px (WCAG 2.5.5) — 16 elements fixed
- Footer color contrast on dark background
- Guide page `aria-label` on divs without valid ARIA roles — added `role="group"`

### Changed
- Hero gradient from dramatic near-black-to-gold to uniform deep burgundy for SVG illustration visibility
- `--text-3` from `#9C8C78` to `#6B5D4A` for WCAG 2.1 AA compliance
- `--text-muted` from `#9CA3AF` to `#5B6470` for WCAG 2.1 AA compliance
- `--success` from `#16A34A` to `#15803D` for WCAG 2.1 AA compliance
- `--danger` from `#DC2626` to `#B91C1C` for WCAG 2.1 AA compliance
- `.btn-gold` text color from `--white` to `--wine-dark` for WCAG 1.4.3 compliance
- Template files updated with actual vinifera project details (replaced all `[REPO-NAME]` placeholders)
- README.md rewritten with professional project overview, features, tech stack, and EdStratum Labs about section
