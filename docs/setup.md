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

The pinned repository CLIs require no global Supabase or Wrangler install.
`npm run dev` verifies Docker, starts Supabase, runs a local database reset
(including `supabase/seed.sql`), creates local-only Auth users, starts the
Worker at `http://127.0.0.1:8788`, starts Vite at
`http://127.0.0.1:5173`, and runs authenticated smoke checks. It derives
ephemeral local keys without printing them and deletes the temporary Worker
environment file before terminating its child process trees. Port 5173 is
strict: an occupied port stops the launcher instead of silently selecting a
different URL.

BS-05 proved this workflow on the integrated baseline with Supabase CLI
2.109.1 against a native Docker-compatible runtime. One native
`supabase db reset --local` passed all 22 migrations plus the configured seed.
Separately, the credential-independent verifier applies the seed twice and
compares fixed brand identities across independent clean databases. The Auth
bootstrap and authenticated HTTP/UI checks also pass on the integrated head. Read
[local-dev-notes.md](./build-specs/local-dev-notes.md) for the exact
clean-replay corrections and evidence. BS-05 records partial local
prerequisites for Gates 1, 7, and 15; all 20 composite activation gates remain
pending until their complete hosted or provider evidence is proved.

The Vite-only server is appropriate for focused application visual work that
does not require the API:

```bash
npm run dev:frontend
```

The browser talks only to the Worker. `VITE_API_BASE_URL` may select a
credential-free HTTPS origin or loopback HTTP; production defaults to the
same origin. `npm run dev` forces browser mode and pins both its integrated
build and Vite process to the loopback Worker regardless of ambient shell or
contributor-file values.
Do not put secrets in Vite-prefixed variables. Staging and production require
`APP_ORIGIN`; only local development and tests may derive a fallback request
origin or use loopback HTTP. Hosted and non-loopback origins require HTTPS. A
missing or unknown `APP_ENV` also fails closed when `APP_ORIGIN` is absent.

## Local environment

Start from the minimal Worker template:

```bash
cp .dev.vars.example .dev.vars
chmod 600 .dev.vars
```

Then merge only the values needed for the local capability you are activating:

1. Open `.env.example` as the comprehensive variable inventory and the ignored
   `.dev.vars` copy side by side.
2. Copy each required assignment into `.dev.vars`, remove its leading comment
   marker when present, and replace the placeholder only in `.dev.vars`.
3. If the key already exists in `.dev.vars`, edit that one assignment instead
   of adding a duplicate.
4. Keep `SENTRY_DSN=` empty unless a real local project DSN is available.

Do not copy `.env.example` over `.dev.vars`, append the entire inventory, or
edit either tracked example with local values. Local `.dev.vars`, `.env`, and
`.env.*` files are ignored; the documented `.env.example` exception remains
tracked. Never commit local environment files or paste their values into logs.

Required Phase 1 runtime values:

```text
APP_ORIGIN
ALLOWED_ORIGINS
AUTH_EMAIL_ENABLED
GOOGLE_OAUTH_ENABLED
RATE_LIMIT_PEPPER
MEMBER_BRAND_CONTEXT_SECRET
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

`RATE_LIMIT_PEPPER` and `MEMBER_BRAND_CONTEXT_SECRET` are separate
cryptographic purposes. Generate each independently with at least 32 UTF-8
bytes, never copy one value into the other, and store them only in the local
ignored `.dev.vars` file or the target environment's encrypted Worker/GitHub
secret store. Startup configuration and deployment gates reject missing,
short, whitespace-padded, or equal values instead of falling back to a
Supabase credential or another application secret.

Missing provider values are an explicit activation state. The API health report shows missing variable names without revealing values:

```bash
curl http://localhost:8787/api/health/configuration
```

## API observability and rate limiting

The Worker entry point is wrapped with `@sentry/cloudflare`, but the SDK is
initialized only when the server-only `SENTRY_DSN` binding exists. Configure it
separately for each named Wrangler environment (or in the matching Cloudflare
dashboard environment):

```bash
npx wrangler secret put SENTRY_DSN --env staging
npx wrangler secret put SENTRY_DSN --env production
```

Run both commands when both environments are being activated. Local
development reads only the ignored `.dev.vars`; do not use an unscoped
`wrangler secret put` command as a substitute for the two named secrets.

Do not store the DSN in `wrangler.jsonc`, `.env.example`, logs, issue text, or
screenshots. Sentry is configured to exclude cookies, bodies, query strings,
default user information, database query data, generative-AI payloads, and
stack-frame variables. Its final event hook also removes exception and log
messages while preserving error types and stack-frame locations. The central
error handler captures only 5xx errors and adds a request ID, method, route,
status, machine code, and optional opaque actor identifier.

Four native Cloudflare Rate Limiting bindings protect the API:

| Route group | Limit | Wrangler binding |
|---|---:|---|
| `/api/auth/*` | 20/minute | `AUTH_RATE_LIMITER` |
| general `/api/*` | 100/minute | `API_RATE_LIMITER` |
| webhook routes | 500/minute | `WEBHOOK_RATE_LIMITER` |
| `/api/admin/*` | 30/minute | `ADMIN_RATE_LIMITER` |

Each request checks a normalized route/host key and a normalized route/IP key.
The edge-routed `Host` header—not client-selected brand or forwarded-host
headers—defines the tenant budget. The Cloudflare connecting IP defines the
actor budget; unverified authorization and cookie values cannot rotate it.
Each complete composite is SHA-256 hashed into Cloudflare's 64-byte key limit,
so route, host, and IP inputs do not enter the counter in raw form. The general
API policy skips the specialized prefixes. Outside tests, a missing binding
returns `503 configuration_error`.

Cloudflare's native service currently supports only 10-second or 60-second
periods, and counters are per Cloudflare location with eventual consistency.
Treat these policies as abuse controls, not billing or exact global quotas.
The database-backed member magic-link limiter remains the durable longer-window
control.

`LIVE_BILLING_ENABLED` defaults off. A live Stripe secret without that separate
authority cannot create or confirm charges, process release billing, retry
payments, or start a Checkout session. Production Worker deployment cannot
change this authority; the separate live-billing policy and workflow are also
disabled by default.

## Supabase

The migration source of truth is `supabase/migrations/`. Local configuration sets Auth OTP expiry to 900 seconds and points auth emails back to the local application.

```bash
npx supabase start
npx supabase db reset --local
npx supabase test db
```

The reset automatically runs `supabase/seed.sql` through `[db.seed]` in
`supabase/config.toml`; the current CLI has no `supabase db seed` command.

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

Use `.github/workflows/stripe-test-catalog.yml` to create the four monthly
recurring test Prices:

1. Dispatch `probe` from the exact `main` SHA with confirmation
   `PROBE VINIFERA STRIPE TEST ACCOUNT`.
2. Review the sanitized `accountIdSha256` value and add it to
   `config/stripe-test-catalog.json`.
3. Dispatch `bootstrap` from that reviewed commit with confirmation
   `BOOTSTRAP VINIFERA STRIPE TEST CATALOG`.
4. Store the returned non-secret Price IDs under the matching
   `STAGING_STRIPE_PRICE_*` environment secret names.
5. Dispatch `verify` with confirmation
   `VERIFY VINIFERA STRIPE TEST CATALOG` after any catalog change.

The workflow prefers `STAGING_STRIPE_SECRET_KEY`. Until that secret is
provisioned, only this catalog-specific workflow may use the pre-provisioned
generic test key for a write. The controller is account-hash allowlisted,
idempotent, and has no customer, subscription, payment, refund, portal, or
webhook operation.

Protected bootstrap run `30218801133` reached an indeterminate boundary: its
first test Price is created-or-unknown and the run then failed closed because
the Product was not expanded in the provider response. The controller now
requests Product expansion and retains the same lookup/idempotency key. Service
connections are currently deferred, so do not dispatch another bootstrap.
When activation resumes, reconcile the fixed lookup key before allowing any
create.

After the isolated Worker exists, register:

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

Runtime Customer creation is serialized per immutable organization, brand, or
member billing subject. Checkout and portal calls require an opaque billing
attempt ID and reuse stable idempotency keys. One nonterminal Checkout may
exist per billing subject; after Stripe reports completion, Vinifera keeps the
attempt in `awaiting_webhook` and refuses a replacement until the signed
subscription webhook reconciles it.

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

Every outbox row keeps one provider idempotency identity across retries. Claims
carry a completion token, and early webhook events remain in a durable inbox
until the matching provider receipt is attached. Brand sender identity and
IANA time zone are resolved before delivery or calendar-trigger selection.

Hourly Worker scheduling treats email enqueue/delivery independently from
retry-safe UTC/global and per-brand-local routines that recalculate explainable
churn scores, expire loyalty points, award birthday/anniversary points, clean
stale cancellation attempts, and resume due pauses. See
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

Set `ML_PLATFORM_ACTOR_USER_ID` only to a dedicated active platform
super-admin UUID. Without it, scheduled training reports an activation state
and leaves Phase 3 rules scoring active. A ready production snapshot must also
receive operator-attested source reconciliation before model registration.
Validate that evidence without a provider call:

```bash
ML_PLATFORM_ACTOR_USER_ID="<active-platform-super-admin-uuid>" \
  npm run ops:phase4:qualify-ml -- \
  --evidence "./private/phase-4-qualification.json" \
  --dry-run
```

The connected form additionally requires `SUPABASE_URL` and either
`SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`. See
`docs/runbooks/phase-4-data-ml-benchmark-activation.md` for the evidence schema,
the 95 percent per-source coverage contract, review, execution, and rollback.

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

As an alternative to a database envelope, a connection may store only an exact
`env://VINIFERA_INTEGRATION_SECRET_<NAME>` reference. The matching Worker
binding contains the credential JSON. Arbitrary secret-manager URIs, path
syntax, and browser-selected binding names are rejected.

Key rotation uses the protected credential-envelope rotation workflow and
`config/credential-envelope-rotation-policy.json`. Keep both source and target
versions in the keyring, authorize the exact Supabase project and key
transition by hash, run bounded start/resume batches, and require verify to
report zero old integration, Meta-attribution, and mobile-push envelopes before
removing the source key.

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
environment variables. Refresh uses a database lease plus
credential-generation compare-and-swap, so two Worker isolates cannot exchange
the same rolling token. QuickBooks transaction facts expose the persisted
shipping charge separately so mapped receipts do not silently classify freight
as wine revenue. The Integration page's account settings are persisted through
tenant-safe mapping commands and drive receipt/refund execution.

Klaviyo field and list settings use the same command boundary. Profile
execution resolves configured churn and member fields, then persists explicit
list additions and removals after the asynchronous import reaches a terminal
state.

Avalara activation requires brand-scoped wine and shipping tax-code mappings,
current exemption/customer/entity-use references, nexus review, and a
read-only filing-registration verification snapshot. Enabling the staff filing
toggle does not grant filing authority.

Meta browser attribution is accepted only after current member consent. Its
browser identifiers are encrypted at rest and never written to Web Storage;
the outbound conversion contains normalized hashes. Consent withdrawal redacts
the encrypted attribution while preserving minimized campaign and response
hashes for aggregate audit.

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
certificate activation. Winery DNS changes remain human-controlled. Before any
custom-hostname or FCM/ShipCompliant provider call, the normalized destination
must match `config/provider-target-policy.json`; empty hash arrays deny the
operation. Hostname create attempts use a durable write ledger, and an unknown
create result is looked up at Cloudflare before another create is allowed.
Deletion uses a separate durable lease. A lost DELETE response is persisted as
lookup-required, and another DELETE cannot run until a provider GET confirms
the old hostname still exists. Confirmed provider absence and the local disable
complete atomically and release the old hostname generation for safe reuse.

Staff manage the brand theme, WCAG contrast, HTTPS logo, portal title, custom
hostname, and transactional sender from the brand-scoped white-label page.
Resend creates or verifies the exact brand sender domain and returns DNS
records; delivery stays disabled until that sender identity is verified.

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

For the current architecture candidate, mobile identity, compile-only web
preparation, and Capacitor Android/iOS synchronization pass. Local Gradle cannot
start because this Mac has no Java runtime. Architecture commit `5d36471`
passed the Java 21 Android lint/debug/minified release job in GitHub Actions
run `30221722696`; documentation commit `0abeab1` passed the same gate in run
`30221936765`. Android setup is pinned to v4.0.1, whose action runtime is Node
24.

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
npm run qa:stripe-catalog
npm run qa:db:phase1
npm run qa:db:phase2
npm run qa:db:phase3
npm run qa:db:phase4
npm run qa:db:phase5
npm run qa:mobile:identity
npm run qa:e2e
npm run build:mobile:web
npm run build:mobile:android
```

`npm run typecheck` regenerates the ignored `worker-configuration.d.ts`
declaration before invoking TypeScript. `npm run lint` uses the same path, and
`npm run check` generates first, verifies the generated declaration is current,
then runs the remaining test and build gates. This keeps validation reproducible
from a fresh checkout while leaving the generated artifact untracked.

The current credential-independent architecture gate passes generated Worker
types, TypeScript, 560/560 Vitest tests, Phase 1 92/92, Phase 2 250/250, Phase
3 199/199, Phase 4 159/159, Phase 5 515/515 embedded PostgreSQL/pgTAP
assertions, and the integrated Playwright suite with 155 passed and three
hosted-only cases skipped, with zero axe violations in executed cases.
`test:e2e` is an alias of `qa:e2e`. Pages plus
development, staging, and production Worker dry-run builds pass. The focused
release controls pass 15/15, mobile-release controls 7/7, Stripe catalog
controls 16/16, and mobile identity passes. These are local architecture
results, not service-connection or hosted exit evidence.

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
4. Run the Phase 1–5 embedded database gates.
5. Build static assets and validate the Worker bundle.
6. Run Chromium/Playwright accessibility, breakpoint, visual, keyboard, and
   security QA, retaining the login/signup breakpoint captures for 90 days.
7. Sync, lint, and assemble the Android API 36 debug shell with Java 21.
8. Apply Supabase migrations with pinned CLI 2.109.1 only when staging-scoped
   management credentials and the hashed target policy are active, then run the
   linked native pgTAP/RLS suite.
9. Optionally deploy the isolated `vinifera-staging` Worker, attaching available
   runtime secrets atomically to that version and verifying health plus the core
   app/database/billing/security/webhook configuration capabilities.

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
- an account-hash-authorized, idempotent Stripe test Product/Price catalog
  probe/bootstrap/verifier;
- a target-hash-authorized, resumable credential-envelope rotation controller;
- an independently authorized, default-deny Stripe live/test cutover and
  reversion controller;
- protected production Worker bootstrap, immutable version upload/deploy, and
  Worker rollback without public-domain or Pages mutation; any legacy domain
  cutover or Pages restoration remains a separately authorized control;
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
