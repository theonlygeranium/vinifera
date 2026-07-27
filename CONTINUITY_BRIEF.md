# Vinifera — Agent Continuity Brief

**Last updated:** 2026-07-26
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
  independent billing state
- A common leased/idempotent connector framework for Klaviyo, QuickBooks,
  Avalara, and Meta with encrypted credential envelopes, reconciliation, and
  sanitized attempt logs
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
  network recovery, offline read-only data, and store-directed updates
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
wrangler.jsonc          Worker/static assets/cron configuration
```

The extensionless root `app` file is the accepted visual prototype. It is
copied only when Cloudflare Pages injects `CF_PAGES=1`, preserving the public
rollback baseline; Worker builds omit it and serve React at `/app/*`.

## Release evidence

- Phase 1–4 local architecture gates and the 94-test browser regression were
  recorded as passing in their phase QA reports.
- Version 0.5.0 aligns the package, Android, and iOS source release and contains
  Phase 5 database, service, client, responsive/axe, and native-shell test
  coverage.
- `npm run qa:mobile:identity` enforces cross-platform application IDs,
  versions, link allowlists, APNs entitlement modes, Gradle integrity, privacy
  declarations, and replacement of the default Capacitor artwork.
- CI is configured for Node 22.22.0, Phase 1–5 embedded database gates, Worker
  dry-run, browser QA, Java 21/Android API 36 lint plus debug/R8 release APK
  assembly, and pinned Supabase CLI 2.109.1.
- Optional Worker deployment targets only the isolated `vinifera-staging`
  environment, requires hash-authorized targets, runs hosted pgTAP/RLS, attaches
  available secrets atomically, and requires the core configuration report.
- Production Worker bootstrap/version/deploy/domain/rollback/Pages restore is
  wired as a protected manual workflow. Account, zone, and Worker-origin hashes
  remain empty, so no production mutation can run yet.
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
- The current credential-independent architecture gate passes: dependency
  audit 0, TypeScript green, Vitest 323/323, Phase 1 database 92/92, Phase 2
  231/231, Phase 3 199/199 (138 point-in-time plus 61 current-stack
  hardening), Phase 4 158/158, Phase 5 438/438, and Playwright 143/143 with
  Phase 4 at 20/20, zero axe violations, and 375/768/1440 coverage. Phase 3
  scores 1,000 members in 155.11 ms and claims 100 emails in 7.48 ms; the
  single-worker 100-member roster renders in 943.50 ms, latest LCP is 436 ms,
  and CLS is 0. Phase 4 scores 10,000 members in 13,846.77 ms, renders the
  365-day analytics query in 58.40 ms, and renders five charts 24.20 ms after
  the response. Pages and default Worker dry-run builds pass, as do
  production release 14/14, mobile release 7/7, Stripe catalog 16/16, mobile
  identity, and compile-only Capacitor Android/iOS sync.
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
- GitHub Actions artifact/log retention is configured at the allowed 90-day
  maximum, and Playwright login/signup captures at 375, 768, and 1440 are
  explicitly retained for 90 days. Android setup is pinned to v4.0.1/Node 24
  in normal CI and the protected mobile-release workflow.
- GitHub environments `staging`, `production`, and `mobile-release` are
  restricted to `main` and require review by `theonlygeranium`; self-review is
  currently allowed because no second human reviewer is configured.
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
