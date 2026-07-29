# Vinifera — Agent Continuity Brief

**Last updated:** 2026-07-29
**Purpose:** Current handoff for any engineer or agent continuing the production build.

## Project identity

- Owner: EdStratum Labs
- Repository: `https://github.com/theonlygeranium/vinifera`
- Default branch: `main`
- Public domain: `https://vinifera.edstratumlabs.ai`
- Build specifications: `docs/build-specs/`

Read `AGENTS.md`, the phase specification, and this brief before editing.

## Current production state

The public custom domain still serves the verified static Cloudflare Pages
prototype. A 2026-07-26 probe returned static HTML from `/api/health` rather
than the Worker JSON health contract, so the production application has not
replaced that baseline. Version 0.5.0 contains the complete Phase 1–5
connection-ready source architecture:

- Runtime signing/hash material is purpose-separated: rate-limit hashing and
  member-brand context signing require distinct, independently generated
  32-byte-or-longer secrets. Runtime configuration, staging activation, and
  production release guards all fail closed when either binding is missing,
  weak, whitespace-padded, or equal; no Supabase or static fallback remains.
- React 19 + Tailwind/Vite staff and member applications
- Express 5 API in a Cloudflare Worker with Static Assets
- Supabase Auth/PostgreSQL migration with forced tenant RLS
- Stripe test-mode subscription and webhook adapters
- Tenant-owned tiers, member CRM, release snapshots, shipments, recovery, fulfillment, and durable CSV import
- Stripe test-mode shipment PaymentIntents, retries, refunds, and an hourly resumable release runner
- Transactional UUID/SHA-256 command replay protection with atomic business,
  audit, result, and leased provider-outbox persistence; browser resumption
  stores no raw PII
- Same-brand composite integrity, complete scheduled-release aggregates,
  immutable Stripe event convergence, and bounded stale-refund recovery leases
- A final live-reference check before member provider-identity deletion
- EasyPost address/label adapter with fail-closed activation and a test-only deterministic simulator
- Durable Resend email outbox with lease-token completion, one stable provider
  key per logical message, bounded concurrency, early-webhook inbox,
  monotonic delivery convergence, six lifecycle triggers, and deterministic
  signed unsubscribe handling
- Explainable nightly churn snapshots, immutable/expiring four-step
  cancellation attempts, resumable pauses, command-idempotent loyalty
  mutations, paginated ledgers, and FIFO point lots
- Brand-complete Phase 3 defaults, composite organization/brand/member
  integrity, validated winery time zones, and an independent durable daily
  retention scheduler
- Operational-fact analytics, saved dashboard layouts, CSV exports, and
  scheduled summary reports
- A guarded L2 logistic training, scoring, A/B, drift, promotion, and
  rules-fallback lifecycle that cannot activate from synthetic evidence
- Estate/Reserve benchmark consent, k-anonymous aggregate publication, and
  quarterly report generation
- A ShipCompliant provider adapter, audit ledger, post-charge/pre-label guard,
  compliance-input fingerprints, and durable EasyPost label recovery
- Brand-scoped tenancy with forced RLS, restricted staff grants, explicit
  privileged all-brand aggregates, member brand binding, and shared or
  independent billing state; the client tenant boundary remounts operational
  state on scope changes, keeps explicit all-brand analytics in the URL, and
  rejects late responses from a prior brand
- A common leased/idempotent connector framework for Klaviyo, QuickBooks,
  Avalara, and Meta with encrypted credential envelopes, reconciliation, and
  sanitized attempt logs; database generations serialize QuickBooks rolling
  refresh tokens across Worker isolates, while authorized same-brand mapping
  commands drive Klaviyo churn/list execution and QuickBooks membership and
  shipping references from the existing Integration page
- Stripe billing-subject Customer locks, opaque idempotent Checkout/portal
  attempts, one nonterminal Checkout per subject, and signed-webhook
  reconciliation from `awaiting_webhook`
- Recoverable signup bootstrap plus organization Customer creation when Stripe
  is connected; disconnected and uncertain writes remain explicit and use the
  same idempotent path later
- Owner/admin Team invitations with role-aware manager/staff denial and
  session-backed invite acceptance
- Consent-gated encrypted Meta attribution with withdrawal redaction and
  resumable integration/attribution/push envelope rotation
- Separately persisted QuickBooks shipping, Avalara wine/shipping mappings,
  exemptions, and filing snapshots
- Cloudflare for SaaS custom-hostname lifecycle and WCAG-validated white-label
  portal themes, a retry-safe hostname write ledger, staff brand controls, and
  per-brand Resend sender verification
- Capacitor iOS/Android projects with secure mobile magic-link exchange,
  rotating sessions, biometric relock, APNs/FCM adapters, barcode scanning,
  network recovery, single-flight token rotation, biometric offline cold-start
  access to minimized read-only data, and store-directed updates
- GitHub-hosted CI with conditional migrations, an isolated
  `vinifera-staging` Worker deployment, Android lint/debug/minified-release,
  and Playwright/axe QA
- Credential-independent hosted release controls: GET-only readiness, hashed
  staging/production target authorization, linked hosted pgTAP/RLS, a retained
  Pages rollback controller, and ephemeral signed mobile/internal-track
  workflows
- A Stripe test-only catalog controller that probes an account fingerprint
  without writes, then creates or verifies the four canonical recurring Prices
  only after tracked account authorization and exact confirmation
- Restricted environment credential references, provider target hash policies,
  and independently disabled credential-rotation and Stripe live-billing
  controls

The Worker is connection-ready but must not replace the Pages custom-domain
baseline until the hosted Supabase, Stripe, provider, DNS, physical-device, and
store activation checks in the phase QA reports pass.

## 2026-07-29 two-speed delivery governance

The current delivery contract is defined by
`docs/decisions/2026-07-29-two-speed-delivery-governance.md`. It supersedes
older process descriptions below where they say every feature PR requires full
CI, Octopus, CodeRabbit, or automatic `dev → staging` readiness after each
`dev` push.

- Routine feature branches and PRs to `dev` use the always-present
  `Dev fast checks` aggregate. The fail-closed classifier selects
  documentation, routine, or high-risk focused work.
- Cloudflare Pages preview runs independently and records a branch alias plus
  immutable deployment URL. Preview evidence is not stable-dev, staging,
  production, database, or provider evidence.
- Consolidated `dev → staging`, `staging → main`, protected releases, and
  explicit full runs retain the exact
  `Type, test, build, and package` aggregate.
- `dev → staging` promotion starts manually or through an explicitly
  owner-authorized workflow. It does not start after every `dev` push.
- Octopus is required for the promotion comparison and available by request
  for high-risk feature work. It does not run automatically for every routine
  `dev` PR.
- CodeRabbit is optional and non-blocking while unavailable or rate-limited.
  Any substantive findings it does produce still require disposition.
- One logical PR or promotion receives one consolidated changelog entry. WIP
  commits are allowed only on an isolated feature branch and are squash-merged
  into `dev`; the final logical commit records a substantive body and exact
  verification.
- ADRs are required only for architectural, security, deployment,
  database-policy, or governance decisions.
- Staging and production remain exact-revision, protected operations.
  Standing owner authorization does not bypass environment controls, target
  hashes, confirmations, privacy, rollback, `human-review-required`, or
  `do-not-merge`.

Evidence must be reported as one of: local validation, fast GitHub validation,
full GitHub validation, preview deployment, staging deployment, production
deployment, or hosted/provider readiness. An HTTP 200 or healthy static page is
not sufficient environment evidence; hosted verification requires the expected
marker, build SHA/artifact digest, and API health contract.

Stable addresses remain:

- Dev: `https://vinifera-dev.edstratumlabs.ai`
- Staging: `https://vinifera-staging.edstratumlabs.ai`
- Live: `https://vinifera-live.edstratumlabs.ai`
- Marketing/static rollback: `https://vinifera.edstratumlabs.ai`

Feature preview URLs supplement the stable addresses. Cloudflare Access must
protect dev or preview surfaces that expose non-public application or test
data. Development and staging cannot use production credentials or production
customer data.

This implementation changes source governance and delivery workflow only. It
does not merge or promote an environment branch, provision a hosted target,
activate a provider, deploy an environment, move DNS, enable billing, or mark
any of the 20 activation gates complete.

## 2026-07-28 comprehensive UI testing mission

The original UI evidence is in
`docs/build-specs/ui-test-report-2026-07-28.md`. The authoritative cross-agent
attribution, merge audit, repair chronology, verification, waiver, blockers,
and next-step handoff is
`docs/build-specs/merge-cleanup-regression-audit-2026-07-28.md`. The mission
opened manifest PR #27, fifteen isolated defect PRs #28–#42, and report PR #43,
all against `dev`. PRs #27–#28, #31–#34, and #36–#43 were squash-merged. PRs
#30 and #35 were closed after direct resolution commits.

- Baseline `dev` at `4d0ba11` passed 448/448 checks and 145/145 Playwright
  tests.
- Local integrated snapshot `72d85f82d96384334f066763f5a2ee5d31744699`
  passed 454/454 checks and a final complete 149/149 Playwright run.
- Authenticated Jeff - Pro Chrome spot checks at mobile and desktop reported
  zero axe violations, horizontal overflow, or console errors.
- The 14 squash merges are patch-identical to their reviewed PR diffs. The
  direct PR #30/#35 resolutions were not: they replaced current files, restored
  six obsolete marketing CTA destinations, and deleted merged Phase 1/5
  regression assertions. PR #49 repaired the WCAG focus/touch-target source;
  PR #51 restores the remaining signup behavior and recombines all deleted
  assertions with the intended pricing and HTTPS-logo changes. The restored
  trial links remain on pricing unless `/api/health/configuration` reports
  application-origin, database, and authentication-email readiness; generic
  runtime health alone cannot expose a signup route that is guaranteed to fail.
- Octopus still does not run on `dev` PRs because `pull_request_target` loads
  the workflow from GitHub's default branch. The current remote `main` head
  (`c5639547746a` at the 2026-07-29 audit) retains the old
  `pull_request`/main-only
  workflow and nonexistent action reference; the corrected
  `pull_request_target` definition visible on `dev` is not default-branch
  runtime code. The secure workflow and runbook bridge must be promoted to
  `main` before Octopus can be a real dev/staging gate. This implementation
  does not perform that promotion: after its feature PR is merged to `dev`,
  the owner must use the existing protected/manual path to place the reviewed
  bridge on `staging` and then `main`, configure the main-only
  `promotion-control` environment, and only then require the new contexts.
  The environment was created on 2026-07-29 with owner review and a custom
  `main`-only deployment branch policy, but its promotion PAT and staging
  probe secrets remain unset until the owner moves them from repository scope.
  The corrected bridge
  publishes its trusted runbook outcome as an explicit status on the PR head,
  because `pull_request_target` check runs attach to the base revision. The
  promotion gate additionally requires check-run association with the current
  PR, evidence timestamps no older than the current readiness attempt, and an
  Octopus description naming that PR. These bindings prevent a recreated PR
  at the same SHA from inheriting stale results. CodeRabbit is no longer part
  of this required evidence boundary under the 2026-07-29 policy. The
  runbook receives the event head SHA, base ref, and base SHA as required
  prompts and refuses checkout if GitHub's live PR metadata differs. Its
  aggregate and per-commit diffs are generated from the fetched immutable
  merge-base/head objects rather than mutable PR API artifacts. The published
  status attests the base SHA, which promotion captures and revalidates through
  its final readiness check. Rules 1–3 now require the task state and inspect
  tracked TypeScript with `git grep`, preventing missing-state false success
  and symlink traversal into the Octopus host.
  Octopus Deploy's authenticated `main` project view also shows no published
  runbook.
- Cloudflare Access now has one scoped `Vinifera GitHub Actions — Octopus`
  Service Auth policy on the Octopus application, selecting only the
  `Vinifera GitHub Actions` service token. The token has a one-year duration,
  and its client ID and one-time secret are installed as the encrypted
  `OCTOPUS_CF_ACCESS_CLIENT_ID` and `OCTOPUS_CF_ACCESS_CLIENT_SECRET` GitHub
  Actions secrets; neither value is recorded in source. The existing human OTP
  policy is unchanged.
- `.coderabbit.yaml` enables CodeRabbit auto-review for `dev` and `staging`,
  but the service is rate-limited. CodeRabbit is now optional and non-blocking;
  available substantive findings still require disposition. Full CI, Octopus
  promotion review, staging, and production controls remain independent.
- Remote branch cleanup was initially incomplete: the merged governance and
  WCAG branches remained after the report claimed only `main`, `dev`, and
  `staging`. The audit verified PRs #49/#50 were merged and then deleted both
  stale remote branches; only the active repair branch now supplements the
  three environment branches.
- Automated `dev → staging` readiness remains fail-closed because the isolated
  staging Supabase target and `STAGING_SUPABASE_URL` /
  `STAGING_SUPABASE_ANON_KEY` Actions secrets do not yet exist. Exact-head
  review also proved GitHub's merge API cannot atomically bind an expected base
  SHA, so the workflow now leaves every validated promotion PR open for a human
  merge. Normal and dry-run readiness both refresh the complete head/base,
  CI/status, review, and thread evidence after the second provider probe. Each
  readiness attempt has a timestamped PR marker; CI must name the captured base
  and head, and statuses/reviews must be newer than that attempt. Quality CI
  handles the marker's `edited` event, guaranteeing a fresh run when the
  promotion head itself has not changed.
- GitHub Actions run `30407043361` passed the full and Android lanes plus the
  required aggregate for controlled-review-freeze head `8c7341e`. An earlier exact-head Codex
  review found that checkout did not persist `MERGE_BASE_SHA` for the isolated
  Rules 4–10 Octopus action; the follow-up repair persists it in task-scoped
  state. The following review also found that an unchanged head could be
  reviewed against a temporarily switched base; the bridge now requires the
  event's base ref and SHA to match live metadata. The controlled audit then
  found reduced-motion, hidden-focus, Worker marketing-CSP, and Rules 1–3
  host-boundary defects;
  their consolidated repair passed 490 Vitest tests, all five embedded
  database suites, 153 Playwright/axe tests, Worker and Pages builds, mobile
  identity, compile-only mobile-web preparation, actionlint 1.7.12, and a
  manual 375-pixel check in the Jeff Pro Chrome profile. Exact-head CI run
  `30408522282` passed, but the final Codex review correctly
  found that Rules 1 and 3 still converted operational `git grep` errors into
  false passes. The owner authorized one bounded correction batch. That local
  batch now preserves operational failures, resolves Rule 2 imports relative
  to tracked source blobs, binds check creation as well as start time to the
  readiness attempt, self-hosts Lucide under `script-src 'self'`, and hardens
  fragment navigation. The final local matrix passed 492 Vitest tests, all
  five embedded database suites, the independent clean-seed check, 153
  Playwright/axe tests, both static and Worker builds, mobile identity,
  Android synchronization, actionlint, and a fresh desktop/375-pixel Jeff Pro
  Chrome inspection. One final exact-head CI/Codex review remains mandatory
  after the single authorized push. Octopus has not run, so PR #51 is not yet
  merge-ready.
- Open product/API decisions include the retention attempt list, a staff
  loyalty Redeem action, Team roster data, the Owner invitation security
  contract, the single-brand switcher, mobile dashboard spacing, CSV browser
  transport proof, and the `/app/signup` cutover boundary.

All 20 activation gates remain pending. No provider, hosted-data, migration,
billing, email, push, deployment, or merge activation occurred.

## Runtime architecture

| Route | Implementation |
|---|---|
| `/`, `/guide/*` | Existing static marketing and guide assets |
| `/app/*` | React staff application |
| `/portal/*` | React member portal |
| `/api/*` | Express backend-for-frontend |
| `/.well-known/*` | Worker-generated Apple/Android app association documents |
| hourly cron | access reconciliation, releases/retries, email claims, churn, loyalty, analytics, connector sync/reconciliation, and mobile push |

Web staff and member JWTs live only in distinct secure HTTP-only cookies.
Winery Klaviyo, Avalara, and Meta credentials and QuickBooks connection tokens
are authenticated encrypted database envelopes whose wrapping key remains a
Worker secret. Production dashboards contain no mock rows.

## Source map

```text
web/                    Vite entry
src/client/             React application
server/                 Express API, provider adapters, Worker entry
server/integrations/    Provider, domains, mobile auth, and push transports
server/services/        Domain services plus compatibility and public barrels
supabase/migrations/    PostgreSQL source of truth
supabase/tests/         pgTAP schema, RLS, and RPC suites
tests/server/           API integration tests
tests/e2e/              Playwright/axe browser QA
android/                Capacitor Android source shell
ios/                    Capacitor iOS source shell
mobile/                 Native security and deep-link documentation
mobile/app-identity.json Canonical cross-platform ID and version contract
docs/decisions/         Architecture decisions
docs/build-specs/       Sequential phase specifications and QA reports
wrangler.jsonc          Worker/static assets/cron/queue configuration
```

The extensionless root `app` file is the accepted visual prototype. It is
copied only when Cloudflare Pages injects `CF_PAGES=1`, preserving the public
rollback baseline; Worker builds omit it and serve React at `/app/*`.

## Release evidence

- The previous docs/full classifier and full aggregate on routine PRs are
  historical. The 2026-07-29 two-speed contract now gives routine feature PRs
  `Dev fast checks`, preserves `Type, test, build, and package` for promotion,
  and selects Android only for mobile-relevant or explicitly scheduled/full
  work. Required aggregates remain `if: always()` fail-closed policy gates;
  skipped optional work cannot leave them pending, and skipped required work
  cannot be treated as success.
- PR ownership remains a terminal agent condition, but the applicable gate now
  depends on delivery level. Five precedence-ordered labels scope recurring
  monitoring; `human-review-required` pauses mutation and `do-not-merge` is
  absolute. Standing owner authority can cover routine reversible delivery
  through protected controls but cannot bypass either label.
- The repository README now displays the CodeRabbit pull-request review badge,
  making automated review coverage visible without changing application,
  deployment, provider, or activation behavior.
- BS-03 decomposes the two service monoliths into member, club, order,
  analytics, Stripe, EasyPost, communications, webhook, and shared
  provider-runtime modules. `core-club.ts` and `integrations.ts` are now
  re-export-only compatibility barrels, and internal runtime consumers plus
  the system association route use direct domain imports. The integration
  preserves the complete 129-route BS-02 manifest, BS-04 Sentry/rate-limit
  middleware boundaries, and BS-06 mobile-bootstrap organization/brand
  predicates. This extraction changes no provider activation, deployment
  configuration, or static production surface. The integrated branch passes
  the direct-push policy 12/12, dependency audit 0, generated Worker type check,
  TypeScript, Vitest 388/388, database gates 92/250/199/158/513, Vite and Pages
  builds, default/staging/production Worker dry runs, Playwright/axe 145/145,
  mobile identity, mobile-release controls 7/7, and a non-routable compile-only
  Capacitor web bundle plus Android sync. Exact-head review additionally
  centralizes neutral concurrency, integration-pattern, and Supabase-admin
  primitives; narrows APNs activation deferral; binds EasyPost recovery to the
  persisted rate; validates QuickBooks lease generations; corrects the member
  address auth-user identity; and preserves integration-job completion while
  logging health-update failures. Focused review regressions pass 114/114 and
  the shared concurrency helper now rejects invalid limits without skipping
  `undefined` inputs. The 18-service/37-edge graph remains acyclic. This Mac has
  no Java runtime, so Android lint/assemble remains CI evidence rather than a
  local claim.
- The review-hardening branch closes the remaining aggregate-integrity,
  unsubscribe-privacy, direct-push timeout, checkout-credential, and setup
  documentation findings without changing provider activation. Release PATCH
  retries now preserve validated existing `release_wines.id` values through
  forward migration `202607260022_release_wine_identity_replay.sql`, allowing
  an exact lost-response retry to reach the durable command replay while
  rejecting create-time, duplicate, cross-brand, cross-release, or otherwise
  foreign wine IDs. The current branch passes the direct-push policy 12/12,
  dependency audit 0, generated Worker bindings, TypeScript, Vitest 382/382,
  database gates 92/250/199/158/513, focused production/mobile/catalog
  controls 14/7/16, mobile identity, Vite and Pages rollback builds,
  development/staging/production Worker dry runs, and Playwright/axe 145/145.
  Hosted Supabase native pgcrypto/pgTAP verification and all provider-backed
  activation evidence remain pending by design.
- BS-06 audits every database-calling function in `server/services/` against
  its then-current 21-migration tenancy model. It adds explicit organization
  and brand predicates to all mobile offline-bootstrap reads, a focused cross-brand
  query assertion, CODEOWNERS, a PR template, governance and Greptile guidance,
  and current architecture documentation with all 20 activation gates pending
  at that review point. The branch is integrated with the direct-push guard and
  BS-02/BS-04
  route and observability baseline. The integrated branch passes the direct-push
  policy 9/9, dependency audit 0, Worker type generation, TypeScript, Vitest
  378/378, database gates 92/231/199/158/494, Vite and Pages rollback builds,
  development/staging/production Worker dry runs, and Playwright/axe 145/145.
  No provider, hosted database, Worker, or production activation state changed.
- BS-02 decomposes all 129 Express registrations from the monolithic
  `server/app.ts` into domain-scoped `server/routes/` modules. The 82-line app
  entry point now retains only global middleware and ordered route mounting.
  BS-04 rate limits execute before every public/raw-webhook and protected route,
  and the centralized BS-04 error handler is the final middleware after the
  `/api` 404 boundary. Mechanical route/schema/handler comparison and the full
  credential-independent verification suite pass with no route, deployment, or
  provider activation behavior change. As of 2026-07-27, the current integrated
  BS-02 review branch passed the direct-push policy 9/9, dependency audit 0,
  generated Worker binding check, TypeScript, Vitest 377/377, database gates
  92/231/199/158/494, Vite and Pages rollback builds,
  development/staging/production Worker dry runs, and Playwright/axe 145/145.
- The BS-02 review follow-up adds the route-decomposition ADR and closes
  route-boundary findings for release consistency, partial template defaults,
  email normalization, callback redirects, raw webhook bodies, explicit
  loyalty validation, shared UUID schemas, order-sensitive mounts, and bounded
  multipart CSV framing. Cloudflare client-address headers are trusted only in
  staging/production for route audit fields and rate-limit actor keys; direct
  development/test requests use the socket address. The multipart path remains
  pre-buffered and Cloudflare Worker-compatible; no unproved Node stream
  middleware was added.
- Direct-push governance now supplies the required
  `Block direct push to main` context on pull requests and verifies each
  resulting `main` push against GitHub's associated-pull-request evidence. It
  requires the exact recorded merge result for a closed PR targeting `main`,
  supports merge, squash, and rebase strategies, and rejects forced updates,
  conventional-commit heuristics, missing evidence, and API errors. Branch
  protection remains the pre-push enforcement boundary. Associated-PR lookup
  follows up to ten validated same-origin pages and retries missing index
  evidence twice over 20 seconds before failing closed.
- BS-01 repository hygiene migrates Greptile review policy from the legacy
  root JSON file to scoped `.greptile/` configuration and rules, removes the
  generated Worker declaration from version control while regenerating it
  before CI verification/typecheck, and records the Phase 5 closure evidence
  plus all 20 activation gates, which were pending at that review point. These
  changes do not alter runtime routes, provider activation, or the static
  production baseline.
- BS-04 adds a credential-independent error-observability and API-abuse
  boundary: optional PII-minimized Sentry capture at the Worker entry point, a
  centralized request-correlated Express error handler registered last, and
  native Cloudflare rate limits scoped by normalized route plus tenant and
  hashed actor. Sentry remains inactive without its Worker secret; the static
  production baseline remains unchanged.
  Its pre-BS-02 historical local verification passed audit 0, generated Worker
  types, TypeScript,
  367/367 Vitest tests, Vite and Pages builds, development/staging/production
  Worker dry runs, and 145/145 Playwright/axe cases including 375-pixel and
  touch-target coverage.
- The BS-01 review follow-up makes fresh-checkout local validation
  self-generating, restores public browser bootstrap for the existing member
  authentication endpoints without weakening protected-route enforcement, and
  aligns the Phase 1–2 browser fixtures with the current brand/overview
  contracts.
- BS-05 provides a pinned, single-command local Supabase/Worker/Vite workflow,
  schema-valid synthetic two-tenant fixtures, loopback-only Auth bootstrap,
  authenticated isolation smoke checks, and the 20-gate readiness ledger.
  The integrated 22-migration chain and deterministic seed replay twice, the
  full Vitest suite passes 448/448, and TypeScript passes. The same integrated
  head also passes the native Supabase CLI 2.109.1 reset/seed and real
  Worker/Auth flow with a populated nine-member Sunrise roster,
  Pacific-to-Sunrise 403, member session, local magic-link callback with an
  HTTP-only cookie, populated portal shipment history, desktop/375px UI, touch
  targets, zero axe-core violations, and fail-closed shutdown cleanup. That is
  partial local prerequisite evidence for Gates 1, 7, and 15; all 20 composite
  activation gates remain `pending` until their complete hosted or provider
  criteria are proved.
- Phase 1–4 local architecture gates and the 94-test browser regression were
  recorded as passing in their phase QA reports.
- Version 0.5.0 aligns the package, Android, and iOS source release and contains
  Phase 5 database, service, client, responsive/axe, and native-shell test
  coverage.
- `npm run qa:mobile:identity` enforces cross-platform application IDs,
  versions, link allowlists, APNs entitlement modes, Gradle integrity, privacy
  declarations, and replacement of the default Capacitor artwork.
- CI is configured for Node 22.22.0, Phase 1–5 embedded database gates,
  generated Worker type validation, Worker dry-run, browser QA, Java 21/Android
  API 36 lint plus debug/R8 release APK assembly, and pinned Supabase CLI
  2.109.1.
- Optional Worker deployment targets only the isolated `vinifera-staging`
  environment, requires hash-authorized targets, runs hosted pgTAP/RLS, attaches
  available secrets atomically, and requires the core configuration report.
- Production Worker bootstrap/version/deploy/Worker rollback is wired as a
  protected manual workflow. The standard dispatch no longer exposes legacy
  domain cutover or Pages restoration. Rollback keeps current `main` as the
  control authorization and independently verifies a prior reviewed release
  SHA plus a previously sole-active Worker version. Account and Worker-origin
  hashes remain empty, so no production mutation can run yet.
- Signed Android/iOS build and Play internal/TestFlight delivery are wired as a
  protected manual workflow. Normal CI remains explicitly compile-only.
- Commit `5cc1bda` passed the complete GitHub quality and Android run
  `30217201984`. The mutation jobs skipped because staging activation remains
  off.
- Read-only hosted run `30217462802` confirmed the generic Supabase and Stripe
  test credentials are reachable. The Supabase Phase 1/5 tables do not yet
  exist, Stripe still needs all four test Prices and its webhook secret, and
  the current Cloudflare token is valid but lacks Workers read capability.
- Stripe test-catalog probe
  [`30218422165`](https://github.com/theonlygeranium/vinifera/actions/runs/30218422165)
  passed against the generic test credential without a provider write. Its
  sanitized account SHA-256 fingerprint is now tracked. Protected bootstrap
  [`30218801133`](https://github.com/theonlygeranium/vinifera/actions/runs/30218801133)
  failed closed after its first idempotent provider create because the create
  response did not expand the Product; the controller now requests that
  expansion. Treat the first Price as created-or-unknown. Service connections
  are deferred, so no retry was attempted; reconcile the fixed lookup key only
  when activation is explicitly resumed.
- The historical pre-BS-01/BS-02 credential-independent architecture gate
  passed: dependency
  audit 0, generated Worker types and TypeScript green, Vitest 354/354,
  database gates 92/231/199/158/494, and Playwright 145/145 with zero axe
  violations and 360/375/412/430/768/1440 Phase 5 coverage. The single-worker
  100-member roster renders in 444.6 ms, Phase 5 LCP is 416 ms, CLS is 0, and
  multi-brand readiness is 920 ms. Phase 4 scores 10,000 members inside its
  five-minute gate, renders its 365-day dashboard inside two seconds, and
  renders five charts 24.20 ms after the response. Pages plus
  development/staging/production Worker dry-run builds pass, as do production
  release 14/14, mobile release 7/7, Stripe catalog 16/16, mobile identity, and
  compile-only Capacitor Android/iOS sync. Provider transports remained
  injected; no provider was contacted.
- Architecture commit `5d36471` passed GitHub Actions run
  [`30221722696`](https://github.com/theonlygeranium/vinifera/actions/runs/30221722696):
  quality completed in 5m23s, Java 21 Android lint/debug/minified release
  assembly completed in 4m37s, and credential-gated migration/deployment jobs
  skipped. This Mac still has no local Java runtime.
- Phase 1 architecture closure commit `a27f078` passed GitHub Actions run
  [`30223237016`](https://github.com/theonlygeranium/vinifera/actions/runs/30223237016):
  quality completed in 5m43s, Android lint/debug/minified release completed in
  4m44s, the 90-day `playwright-evidence` artifact was retained through
  2026-10-24, and hosted migration/deployment skipped while activation remains
  off.
- Phase 2 architecture closure commit `15c9942` passed GitHub Actions run
  [`30226397256`](https://github.com/theonlygeranium/vinifera/actions/runs/30226397256):
  quality completed in 5m15s, Android lint/debug/minified release completed in
  3m39s, QA/native evidence uploaded, and hosted migration/deployment skipped
  while activation remains off.
- Phase 3 architecture closure commit `3b01c3a` passed GitHub Actions run
  [`30229260377`](https://github.com/theonlygeranium/vinifera/actions/runs/30229260377):
  quality completed in 6m22s, Android lint/debug/minified release completed in
  4m25s, QA/native evidence uploaded, the Pages rollback artifact validated,
  and hosted migration/deployment skipped while activation remains off.
- Phase 4 architecture closure commit `623dd2a` passed GitHub Actions run
  [`30232327146`](https://github.com/theonlygeranium/vinifera/actions/runs/30232327146):
  quality/browser QA completed in 6m49s, Android lint/debug/minified release
  completed in 4m19s, the Pages rollback artifact validated, and hosted
  migration/deployment skipped while activation remains off. The static custom
  domain now returns CSP, COOP, HSTS, frame-deny, and MIME-sniffing headers;
  `/api/health` still returns the static HTML shell until Worker activation.
- Phase 5 architecture closure commit `5d3dadd` passed GitHub Actions run
  [`30235083942`](https://github.com/theonlygeranium/vinifera/actions/runs/30235083942):
  quality/database/browser/Pages rollback completed in 5m39s, Java 21 Android
  lint/debug/minified release completed in 4m10s, QA/native evidence uploaded,
  and hosted migration/Worker deployment skipped because activation remains
  off.
- GitHub Actions artifact/log retention is configured at the allowed 90-day
  maximum, and Playwright login/signup captures at 375, 768, and 1440 are
  explicitly retained for 90 days. Android setup is pinned to v4.0.1/Node 24
  in normal CI and the protected mobile-release workflow.
- The GitHub `staging` environment is restricted to the `staging` branch;
  `production` and `mobile-release` remain restricted to `main`. All three
  require review by `theonlygeranium`; self-review is currently allowed
  because no second human reviewer is configured.
- The current Phase 5 evidence and any remaining local checks belong in
  `docs/build-specs/phase-5-qa-report.md`; do not copy pending checks here as
  passes.

The Phase 1–5 source architecture is complete. Hosted Supabase native
pgcrypto/pgTAP, provider round trips, real-data model/benchmark results, custom
DNS/certificates, Stripe live mode, signed physical devices, push delivery, and
internal store-track evidence remain required before the hosted operational exit
criterion can pass.

## Activation gates

The code must remain fail-closed until these external connections are active:

1. Add staging-environment Supabase management credentials, then set the
   exact project hash and repository variable
   `STAGING_SUPABASE_MIGRATION_ENABLED=true` to apply `supabase/migrations/`
   and run `supabase test db --linked`.
2. Give the staging Cloudflare token Workers Scripts edit permission and set
   the exact account hash plus repository variable
   `STAGING_CLOUDFLARE_DEPLOY_ENABLED=true` only for the isolated
   `vinifera-staging` Worker.
3. Enable the custom access-token hook, 900-second email OTP expiry, Google OAuth, and SMTP.
4. When service activation is explicitly resumed, reconcile the
   created-or-unknown Stripe test Price from run `30218801133`, then
   bootstrap/verify the four recurring Prices without a blind retry, register
   `/api/billing/webhook`, and add its signing secret.
5. Add an EasyPost test key, configure the winery origin, and keep the production shipping simulator disabled.
6. Create ten Stripe test members and run the Phase 2 billing, decline, label, pack, delivery, and refund proof.
7. Run the complete hosted two-tenant RLS, staff, member magic-link, Checkout, webhook, grace-period, and suspension tests.
8. Verify a Resend sending domain, signed webhook, and at least two real staging triggers.
9. Apply Phase 4 migration 15 to hosted Supabase and run the 37 current-stack
   pgTAP assertions plus native tenant/RPC tests.
10. Connect a winery with real Phase 2/3 operations and verify every analytics
    metric and CSV export against source records.
11. Configure a dedicated active `ML_PLATFORM_ACTOR_USER_ID`, accumulate at
    least 500 labeled members and 50 cancellations, reconcile all six source
    families, dry-run and execute `ops:phase4:qualify-ml`, train on production
    history, meet held-out AUC-ROC 0.82 without underperforming rules, and
    complete the superior 30-day A/B gate before actor-audited promotion.
12. Opt an Estate/Reserve winery into a peer cohort with at least ten
    contributors and verify the quarterly report delivery.
13. Obtain vendor-approved ShipCompliant sandbox access, set the server-only
    credential and contract bindings, and prove compliant, non-compliant,
    unknown, timeout, tax, fingerprint invalidation, and label recovery cases.
14. Provision the integration credential keyring, then validate winery-specific
    Klaviyo, Avalara, and Meta envelopes and the QuickBooks application OAuth
    plus encrypted per-connection token lifecycle.
15. Create two production-like brands and prove database plus service-role
    cross-brand isolation, shared/independent billing, and hostname-derived
    member context.
16. Add one winery custom hostname, complete DNS ownership and certificate
    activation, and verify sibling/unknown hosts cannot select its brand.
17. Configure APNs and FCM, Apple/Google signing, privacy/store metadata, and
    prove magic links, secure storage, biometrics, push, camera, offline restore,
    and relock on physical devices.
18. Install signed builds from TestFlight and the Play internal track.
19. Replace Stripe test keys with approved live keys only under human
    supervision and run one controlled charge/refund.
20. Move the production custom domain only after every hosted exit criterion is
    evidenced.

Credential and target setup details are in
`docs/runbooks/hosted-environment-provisioning.md`. Domain rollback is in
`docs/runbooks/production-cutover-rollback.md`; signed distribution is in
`docs/runbooks/mobile-store-release.md`.

See `.env.example` and `docs/setup.md` for exact variable names. Never print or commit values.

## Build and QA

```bash
npm ci
npm audit --audit-level=moderate
npm run typecheck
npm test
npm run build
npm run build:worker
npm run build:worker:production
npm run qa:mobile-release
npm run qa:production-release
npm run qa:db:phase2
npm run qa:db:phase3
npm run qa:db:phase4
npm run qa:db:phase5
npm run qa:mobile:identity
npm run qa:e2e
npm run build:mobile:web
npm run build:mobile:android
```

The human supervisor directed the team to complete architecture now and connect
services later. Keep every deferred provider fail-closed; do not retry the
uncertain Stripe catalog write, populate target policies, dispatch provider
mutations, or describe a hosted exit criterion as passed without explicit
activation authority and redacted runtime evidence.
