# Setup and deployment guide — Vinifera

## Prerequisites

- Node.js 22 (see `.nvmrc`; CI uses Node 22)
- npm
- Git
- Docker Desktop only when running the complete local Supabase stack
- Provider credentials only when activating live integrations

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

CI skips hosted migration mutation, with an explicit notice, until all three are configured. Runtime URL and API keys are insufficient for PostgreSQL DDL.

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

Phases 1–4 must remain in Stripe test mode.

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

## Build and verify

```bash
npm audit --audit-level=moderate
npm run typecheck
npm test
npm run build
npm run build:worker
npm run qa:db:phase2
npm run qa:db:phase3
npm run qa:db:phase4
npm run qa:e2e
```

`npm run build` runs Vite, then copies the marketing site, investor guide, and static metadata into `dist/`. The original `app` prototype is retained in source as a visual reference and is not included in the authenticated production bundle.

Cloudflare Pages automatically sets `CF_PAGES=1`; that build additionally copies
the original extensionless `app` file so the custom-domain rollback baseline is
not replaced before Worker activation. Reproduce that artifact locally with
`npm run build:pages`.

## CI/CD

`.github/workflows/ci.yml` uses GitHub-hosted runners:

1. Install locked dependencies.
2. Audit production dependencies.
3. Type-check and run automated tests.
4. Build static assets and validate the Worker bundle.
5. Run Chromium/Playwright accessibility, breakpoint, visual, and security QA.
6. Apply Supabase migrations only when management credentials are active.
7. Deploy the Worker and upload available runtime secrets.

The deployment job remains a successful no-op until
`CLOUDFLARE_WORKERS_DEPLOY_ENABLED=true` and the stored Cloudflare token has
Workers Scripts edit permission. The existing Cloudflare Pages custom-domain
deployment remains the rollback baseline during Phase 1. The Worker deploys to
its staging `workers.dev` address until the complete live gate passes; do not
move the custom domain early.

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
```

Required viewports are 375px, 768px, and 1440px. Run axe-core with zero WCAG 2.1 AA violations and confirm touch targets are at least 44×44px.
