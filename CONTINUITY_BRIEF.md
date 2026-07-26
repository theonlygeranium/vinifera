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
- EasyPost address/label adapter with fail-closed activation and a test-only deterministic simulator
- Durable Resend email outbox, six lifecycle triggers, signed delivery webhooks, and unsubscribe handling
- Explainable nightly churn snapshots, a configurable four-step cancellation flow, and a FIFO loyalty ledger
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
- Cloudflare for SaaS custom-hostname lifecycle and WCAG-validated white-label
  portal themes
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
- CI is configured for Node 22.22.0, Phase 2–5 embedded database gates, Worker
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
  sanitized account SHA-256 fingerprint is now tracked; bootstrap remains a
  separate protected operation and no Product/Price is yet claimed as created.
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
4. After the account-fingerprint authorization commit passes CI,
   bootstrap/verify the four recurring Stripe test Prices, then register
   `/api/billing/webhook` and add its signing secret.
5. Add an EasyPost test key, configure the winery origin, and keep the production shipping simulator disabled.
6. Create ten Stripe test members and run the Phase 2 billing, decline, label, pack, delivery, and refund proof.
7. Run the complete hosted two-tenant RLS, staff, member magic-link, Checkout, webhook, grace-period, and suspension tests.
8. Verify a Resend sending domain, signed webhook, and at least two real staging triggers.
9. Apply the Phase 4 migration to hosted Supabase and run native tenant/RPC
   tests.
10. Connect a winery with real Phase 2/3 operations and verify every analytics
    metric and CSV export against source records.
11. Accumulate at least 500 labeled members and 50 cancellations, train on
    production history, meet held-out AUC-ROC 0.82 without underperforming
    rules, and complete the superior 30-day A/B gate before promotion.
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

The human supervisor explicitly authorized credential-gated integrations to remain connection-ready while architecture work continues. Keep every deferred provider fail-closed and do not describe a hosted exit criterion as passed without redacted runtime evidence.
