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

## Build and verify

```bash
npm audit --audit-level=moderate
npm run typecheck
npm test
npm run build
npm run build:worker
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
