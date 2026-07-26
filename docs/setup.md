# Setup and deployment guide — Vinifera

## Prerequisites

- Node.js 22.12 or newer (CI uses Node 22.22.0)
- npm
- Git
- Docker Desktop only when running the complete local Supabase stack
- Provider credentials only when activating live integrations

Hosted targets and signed releases are intentionally credential-deferred. Start
with [hosted environment provisioning](./runbooks/hosted-environment-provisioning.md);
production domain control and mobile distribution have separate runbooks.

## Local development

```bash
git clone https://github.com/theonlygeranium/vinifera.git
cd vinifera
nvm use
npm ci
npm run dev
```

Vite serves the React staff application at `http://localhost:5173/app` and the member portal at `/portal`. Use the Worker server to exercise the marketing site, guide, API, and the complete production routing model.

The Vite-only server is appropriate for focused application visual work. Use the Worker development server when testing API routes or static-surface regressions:

```bash
npm run dev:worker
```

Do not put secrets in Vite-prefixed variables. The frontend intentionally has no direct provider credentials.

## Local environment

Copy the template only when activating provider-backed behavior:

```bash
cp .env.example .dev.vars
chmod 600 .dev.vars
```

`.dev.vars`, `.env`, and `.env.*` are ignored. Never commit them or paste their values into logs.

Required Phase 1 runtime values:

```text
APP_ORIGIN
ALLOWED_ORIGINS
AUTH_EMAIL_ENABLED
GOOGLE_OAUTH_ENABLED
RATE_LIMIT_PEPPER
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY)
SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_VINE
STRIPE_PRICE_CELLAR
STRIPE_PRICE_ESTATE
STRIPE_PRICE_RESERVE
```

Missing provider values are an explicit activation state. The API health report shows missing variable names without revealing values:

```bash
curl http://localhost:8787/api/health/configuration
```

`LIVE_BILLING_ENABLED` defaults off. A live Stripe secret without that separate
authority cannot create or confirm charges, process release billing, retry
payments, or start a Checkout session.

## Supabase

The migration source of truth is `supabase/migrations/`. Local configuration sets Auth OTP expiry to 900 seconds and points auth emails back to the local application.

```bash
npx supabase start
npx supabase db reset
npx supabase test db
```

Hosted migration deployment additionally requires encrypted CI secrets:

```text
SUPABASE_ACCESS_TOKEN
SUPABASE_PROJECT_ID
SUPABASE_DB_PASSWORD
```

The staging workflow uses the `STAGING_` forms of those names. It skips hosted
mutation until all three are configured, the exact 20-character project ref is
hash-allowlisted, and `STAGING_SUPABASE_MIGRATION_ENABLED=true`. After
`supabase db push`, it runs `supabase test db --linked`; migration success
without native pgTAP/RLS success is a failed activation. Runtime URL and API
keys are insufficient for PostgreSQL DDL.

After the migration is applied to a hosted project:

1. Enable the `public.custom_access_token_hook` Auth hook.
2. Enable staff email/password and Google OAuth.
3. Set site and redirect URLs for `/api/auth/staff/callback` and `/api/auth/member/callback`.
4. Configure authenticated SMTP for invitations, password resets, and member magic links.
5. Verify OTP expiry is 900 seconds.

## Stripe test mode

Create four monthly recurring test Prices and store their IDs in the matching `STRIPE_PRICE_*` secrets. Register:

```text
POST https://<staging-worker>/api/billing/webhook
```

Subscribe the endpoint to:

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

Store the resulting signing secret as `STRIPE_WEBHOOK_SECRET`. Configure the Stripe Customer Portal before testing `/api/billing/portal`.

Phases 1–4 remain in Stripe test mode. Phase 5 includes the independent-brand
billing architecture, but replacing test keys with approved live keys,
registering live webhooks, and running a controlled real charge/refund are
human-authorized launch operations.

The controlled production Worker workflow still accepts only `sk_test_*` and
sets `LIVE_BILLING_ENABLED=false`. Live keys, live webhook registration, and a
controlled real charge/refund use a future, separately approved procedure.

## Phase 2 shipment processing

Shipment charges reuse `STRIPE_SECRET_KEY` in test mode and require each member
to have a Stripe customer and saved default payment-method identifier. Vinifera
stores those identifiers only; card numbers and security codes never enter the
application.

EasyPost is the first shipping adapter. Store its test credential as an
encrypted server-only secret:

```text
SHIPPING_PROVIDER=easypost
EASYPOST_API_KEY
SHIPPING_SIMULATOR_ENABLED=false
```

The shipping simulator is accepted only in a non-production runtime with
`SHIPPING_SIMULATOR_ENABLED=true`. Production requests without an EasyPost key
fail with `activation_required`.

Before generating labels, configure the winery's return address and verify the
versioned state whitelist used by the temporary Phase 2 compliance gate.
ShipCompliant replaces that whitelist in Phase 4.

Phase 2 CSV imports accept generic mappings plus Commerce7 and WineDirect
headers. Preview and validation occur before commit; do not upload files that
contain full payment-card data.

## Phase 3 communications and retention

Email work is persisted before provider delivery. To activate Resend, configure
the following server-only bindings after the winery domain is verified:

```text
EMAIL_PROVIDER=resend
EMAIL_SIMULATOR_ENABLED=false
RESEND_API_KEY
RESEND_FROM
RESEND_SENDING_DOMAIN
RESEND_DOMAIN_VERIFIED=true
RESEND_WEBHOOK_SECRET
UNSUBSCRIBE_SIGNING_SECRET
```

Register `POST /api/webhooks/resend` and keep its raw-body signature
verification enabled. Missing or unverified configuration leaves email work
queued and returns an explicit activation state. A deterministic email adapter
is accepted only in the test runtime with both simulator gates enabled.

Nightly Worker scheduling recalculates explainable churn scores, enqueues due
messages, expires loyalty points, awards birthday/anniversary points, and
reclaims bounded outbox work. See
`docs/runbooks/phase-3-resend-activation.md` for DNS, webhook, trigger, and
rollback proof.

## Phase 4 analytics, ML, benchmarks, and compliance

Phase 4 analytics are derived from tenant-scoped operational facts. Empty
production history produces an explicit empty state; the browser never
substitutes fixture metrics. The scheduled Worker jobs refresh daily
analytics and feature snapshots, score active members with the current
eligible model or the Phase 3 rules fallback, queue scheduled analytics
reports, and refreshes privacy-thresholded benchmark aggregates.

The deterministic L2 logistic trainer runs against immutable
`production_history` snapshots. A candidate remains in shadow/A/B mode unless
all database-enforced gates pass: at least 500 members and 50 observed
cancellations, temporal holdout ROC AUC of at least 0.82, performance above the
rules baseline, production provenance, and a completed 30-day A/B comparison.
Synthetic fixtures validate the trainer only and can never be promoted.

ShipCompliant is wired behind a fail-closed OAuth adapter. Obtain the exact
sandbox origin, paths, contract version, account, and license values during
Sovos onboarding before enabling it:

```text
COMPLIANCE_PROVIDER=shipcompliant
COMPLIANCE_SIMULATOR_ENABLED=false
SHIPCOMPLIANT_BASE_URL
SHIPCOMPLIANT_TOKEN_PATH
SHIPCOMPLIANT_CHECK_PATH
SHIPCOMPLIANT_CONTRACT_VERSION
SHIPCOMPLIANT_API_KEY
SHIPCOMPLIANT_API_SECRET
SHIPCOMPLIANT_ACCOUNT_ID
SHIPCOMPLIANT_LICENSE_ID
```

Only an exact `compliant` response with a provider response identifier permits
label generation. The operational check runs after a successful charge and
immediately before label generation. `unknown`, timeouts, incomplete responses,
missing configuration, and `non_compliant` all block the label. The
deterministic compliance simulator is accepted only in an explicitly enabled
test runtime. See `docs/runbooks/phase-4-shipcompliant-activation.md` for
sandbox, mapping, label-block, tax, and rollback evidence.

## Phase 5 scale, brands, integrations, and mobile

Phase 5 adds a common server-only connector lifecycle. A connection begins as
`activation_required`, becomes `configured` only after opt-in and credential
validation, and becomes `active` only after its bootstrap/reconciliation gate.
Missing credentials do not create a simulated production connection or transmit
member data.

Winery-specific Klaviyo, Avalara, and Meta credentials are submitted through
the staff integration flow and persisted as versioned AES-256-GCM envelopes.
Configure the Worker keyring before accepting them:

```text
INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION
INTEGRATION_CREDENTIAL_ENCRYPTION_KEYS
```

QuickBooks uses Worker-level Intuit application OAuth configuration:

```text
QUICKBOOKS_CLIENT_ID
QUICKBOOKS_CLIENT_SECRET
QUICKBOOKS_ENVIRONMENT=sandbox
QUICKBOOKS_REDIRECT_URI
QUICKBOOKS_STATE_SIGNING_SECRET
```

The returned QuickBooks access and rolling refresh tokens are encrypted per
connection in the same database envelope boundary. They are not shared
environment variables.

Multi-brand rows are protected by forced RLS, and service-role queries validate
the active brand independently of browser input. Existing organizations receive
one additive default brand. Owners/admins may use explicit all-brand aggregate
routes; restricted staff and members remain bound to granted brands.

White-label hostname activation additionally requires:

```text
CLOUDFLARE_CUSTOM_HOSTNAME_API_TOKEN
CLOUDFLARE_CUSTOM_HOSTNAME_ORIGIN
CLOUDFLARE_ZONE_ID
MEMBER_BRAND_CONTEXT_SECRET
```

A hostname is not active until Cloudflare reports both domain-control and
certificate activation. Winery DNS changes remain human-controlled.

The checked-in Capacitor projects use `VITE_MOBILE_API_ORIGIN` only as a
non-secret build-time HTTPS origin. They have no public-origin fallback.
Compile-only CI must use `https://unconfigured.invalid`; staging runtime QA must
use the isolated `vinifera-staging.*.workers.dev` origin; a signed production
build requires the explicit production profile and authorization. Mobile auth,
association files, store policy, APNs, and FCM use the server-only bindings
listed in `.env.example`. Signing files, Firebase application files,
provisioning profiles, and store credentials remain protected CI secrets and
must never be committed.

Build or synchronize the native projects with:

```bash
npm run qa:mobile:identity   # verify app IDs, versions, links, privacy, and assets
npm run generate:mobile:assets # regenerate branded native artwork from mobile/assets
npm run build:mobile           # prepare web bundle and sync both projects
npm run build:mobile:android   # sync Android and assemble a debug APK
npm run build:mobile:android:release # sync Android and exercise R8 shrinking
npm run build:mobile:ios       # sync and invoke the iOS build
```

The iOS simulator and Android debug/minified release APKs prove only native
compilation and shell behavior. APNs/FCM delivery and secure-storage behavior
on physical devices, release signing, TestFlight, Play internal track, privacy
metadata, and store
review remain activation evidence. See
`docs/runbooks/phase-5-provider-mobile-activation.md` and
`docs/runbooks/mobile-store-release.md`.

## Build and verify

```bash
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

`npm run build` runs Vite, then copies the marketing site, investor guide, and static metadata into `dist/`. The original `app` prototype is retained in source as a visual reference and is not included in the authenticated production bundle.

Cloudflare Pages automatically sets `CF_PAGES=1`; that build additionally copies
the original extensionless `app` file so the custom-domain rollback baseline is
not replaced before Worker activation. Reproduce that artifact locally with
`npm run build:pages`.

## CI/CD

`.github/workflows/ci.yml` uses GitHub-hosted runners and Node 22.22.0:

1. Install locked dependencies.
2. Audit production dependencies.
3. Type-check and run automated tests.
4. Run the Phase 2–5 embedded database gates.
5. Build static assets and validate the Worker bundle.
6. Run Chromium/Playwright accessibility, breakpoint, visual, and security QA.
7. Sync, lint, and assemble the Android API 36 debug shell with Java 21.
8. Apply Supabase migrations with pinned CLI 2.109.1 only when staging-scoped
   management credentials and the hashed target policy are active, then run the
   linked native pgTAP/RLS suite.
9. Optionally deploy the isolated `vinifera-staging` Worker, attaching available
   runtime secrets atomically to that version and verifying health plus the core
   app/database/test-billing/webhook configuration capabilities.

The migration and deployment jobs are skipped unless the repository variables
`STAGING_SUPABASE_MIGRATION_ENABLED=true` and
`STAGING_CLOUDFLARE_DEPLOY_ENABLED=true` are set. When explicitly enabled, the
jobs enter the protected `staging` environment and fail if its `STAGING_*`
credentials are incomplete or not sandbox-safe. Deployment targets only the
`vinifera-staging` Worker at its `workers.dev` address. The existing Cloudflare
Pages custom-domain deployment remains the rollback baseline; production
cutover must wait for the complete hosted gate.

Additional manual workflows provide:

- a GET-only hosted-readiness report that may classify legacy generic
  credentials but never mutates;
- protected production Worker bootstrap, immutable version upload/deploy,
  14-capability custom-domain cutover, Worker rollback, and Pages restoration;
  and
- protected signed Android/iOS builds with a separately confirmed Play
  internal/TestFlight upload.

The production target policy ships with unresolved account, zone, and Worker
origin hashes, so it is non-operational until those exact resources are
independently resolved and reviewed. See
`docs/runbooks/production-cutover-rollback.md`.

## Verification surfaces

Verify all of the following:

```text
/
/guide/
/app/login
/app/signup
/app/reset-password
/app
/portal/login
/portal
/api/health
/api/health/configuration
/.well-known/apple-app-site-association
/.well-known/assetlinks.json
```

Required Phase 5 browser viewports include 360, 375, 412, 430, 768, and 1440
pixels. Run axe-core with zero WCAG 2.1 AA violations and confirm touch targets
are at least 44×44px.
