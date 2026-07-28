# Hosted environment provisioning

This runbook turns the connection-ready Phase 1–5 source into isolated hosted
environments without requiring every provider on day one. Missing optional
providers remain `activation_required`; no production simulator is substituted.

## Control model

Three GitHub environments separate authority:

| Environment | Purpose | Allowed authority |
| --- | --- | --- |
| `staging` | Supabase migration, native pgTAP, isolated Worker, read-only readiness | Stripe test mode and provider sandboxes only |
| `production` | Production Worker bootstrap/version/deploy/domain control | Stripe test mode only; no live-billing activation |
| `mobile-release` | Signed Android/iOS builds and optional internal-track upload | App signing and store-delivery authority only |

Configure required reviewers and prevent self-review where the GitHub plan
supports it. Do not place production credentials in `staging`.

Restrict the `staging` environment to the `staging` branch. Staging
migrations, Worker deployment, readiness probes, and Stripe test-catalog
operations must run from the immutable head of that branch after the
human-controlled `dev` to `staging` promotion. Keep `production` and
`mobile-release` restricted to `main`.

Generic repository secrets are deliberately limited to
`.github/workflows/hosted-readiness.yml`, which performs GET-only provider
checks and emits a credential-free report. Mutating workflows do not fall back
to them.

The architecture is currently complete but services are intentionally
disconnected. Do not treat the sections below as permission to dispatch a
mutation. Resume only the smallest provider-specific step after its credential,
target, and human authority are available.

## Staging target authorization

Resolve a dedicated Supabase project and Cloudflare account independently.
Never infer either from a key. Hash the exact normalized values locally:

```bash
SUPABASE_PROJECT_ID='<20-character staging ref>' \
  node scripts/verify-staging-activation.mjs hash supabase

CLOUDFLARE_ACCOUNT_ID='<32-character staging account id>' \
  node scripts/verify-staging-activation.mjs hash cloudflare
```

Review the hashes, then add only them to
`config/hosted-target-allowlist.json` under `staging`. If a production target is
known, add its hash to the matching `deniedProduction` array. Never add the
public Vinifera hostname as a staging custom-hostname origin.

The initial checked-in arrays are intentionally empty. Until they are updated,
all staging mutations fail before provider APIs are called.

Phase 4/5 provider calls have an additional target policy in
`config/provider-target-policy.json`. Review and hash the exact normalized
Cloudflare custom-hostname zone/fallback origin, FCM project, and
ShipCompliant sandbox/production origin in the appropriate environment scope.
Empty arrays fail with `activation_required`. ShipCompliant production mode
also requires its independent checked-in switch; a credential alone cannot
select a production endpoint.

## Staging environment contract

Minimum migration secrets:

```text
STAGING_SUPABASE_ACCESS_TOKEN
STAGING_SUPABASE_DB_PASSWORD
STAGING_SUPABASE_PROJECT_ID
```

Minimum Worker control and core runtime secrets:

```text
STAGING_CLOUDFLARE_ACCOUNT_ID
STAGING_CLOUDFLARE_API_TOKEN
STAGING_SUPABASE_URL
STAGING_SUPABASE_PUBLISHABLE_KEY or STAGING_SUPABASE_ANON_KEY
STAGING_SUPABASE_SECRET_KEY or STAGING_SUPABASE_SERVICE_ROLE_KEY
STAGING_STRIPE_SECRET_KEY              # sk_test_* only
STAGING_STRIPE_WEBHOOK_SECRET
STAGING_STRIPE_PRICE_VINE
STAGING_STRIPE_PRICE_CELLAR
STAGING_STRIPE_PRICE_ESTATE
STAGING_STRIPE_PRICE_RESERVE
STAGING_RATE_LIMIT_PEPPER
STAGING_MEMBER_BRAND_CONTEXT_SECRET
```

Provider, integration-vault, custom-hostname, email, mobile policy, and push
secrets use the `STAGING_` form of the names in `.env.example`. The staging
workflow rejects live Stripe, production QuickBooks, and production APNs
configuration.

Generate `STAGING_RATE_LIMIT_PEPPER` and
`STAGING_MEMBER_BRAND_CONTEXT_SECRET` independently. Each must contain at
least 32 UTF-8 bytes, neither may have surrounding whitespace, and their
values must differ. The staging deployment fails before secret upload when
this separation contract is not satisfied.

Set repository variables only after the corresponding target hash and
environment secrets are reviewed:

```text
STAGING_SUPABASE_MIGRATION_ENABLED=true
STAGING_CLOUDFLARE_DEPLOY_ENABLED=true
VITE_MOBILE_API_ORIGIN=https://vinifera-staging.<account-subdomain>.workers.dev
```

The migration job links the exact allowlisted project, applies migrations, and
runs `supabase test db --linked`. That suite includes tenant and brand isolation
proof. The Worker job deploys only `vinifera-staging`, then requires:

- `/api/health` identifies `vinifera-api` with status `ok`;
- `app`, `database`, `billing`, `security`, and `webhook` capabilities are
  configured;
- the origin is the isolated `vinifera-staging.*.workers.dev` form; and
- sanitized runtime evidence is retained as a workflow artifact.

Optional capabilities may remain false in staging while their credentials are
pending. Their application paths continue returning explicit activation
states.

Winery connection secrets may be stored in an authenticated encrypted
database envelope or referenced by the exact
`env://VINIFERA_INTEGRATION_SECRET_<NAME>` form. The matching Worker binding
contains the provider credential JSON. Do not use a generic secret-manager URI
or store the credential value in the reference column.

## Production policy preparation

`config/production-release-policy.json` contains hashes for the known Pages
project, public hostname, and Worker name. Account, zone, and Worker-origin
arrays are empty until those exact resources are resolved and reviewed.

Generate the remaining hashes locally without writing raw values to tracked
files:

```bash
PRODUCTION_CLOUDFLARE_ACCOUNT_ID='<32-character account id>' \
  node scripts/production-release.mjs hash-target cloudflareAccountId

PRODUCTION_CLOUDFLARE_ZONE_ID='<32-character zone id>' \
  node scripts/production-release.mjs hash-target cloudflareZoneId

PRODUCTION_WORKER_ORIGIN='https://vinifera-production.<subdomain>.workers.dev' \
  node scripts/production-release.mjs hash-target workerOrigin
```

The same command supports `customHostname`, `pagesProjectName`, and
`workerName` for independent verification.

Provision a least-privilege `production` environment with:

```text
PRODUCTION_CLOUDFLARE_ACCOUNT_ID
PRODUCTION_CLOUDFLARE_API_TOKEN
PRODUCTION_CLOUDFLARE_ZONE_ID
PRODUCTION_CUSTOM_HOSTNAME
PRODUCTION_PAGES_PROJECT_NAME
PRODUCTION_WORKER_ORIGIN
```

Add runtime values using the `PRODUCTION_` names expected by the release
workflow. The workflow constructs an ephemeral Worker secret bundle, never
prints it, and removes it in an always-run cleanup step. The production policy
rejects a non-`sk_test_*` Stripe key and cannot set
`LIVE_BILLING_ENABLED=true`. The production release guard also requires
independently generated values for
`PRODUCTION_RATE_LIMIT_PEPPER` and
`PRODUCTION_MEMBER_BRAND_CONTEXT_SECRET` before it assembles the ephemeral
bundle. Both must contain at least 32 UTF-8 bytes, have no surrounding
whitespace, and differ.

First bootstrap creates only the named `vinifera-production` Worker on
`workers.dev`; it does not attach a route or custom domain. Later version
uploads are bound to an immutable full Git SHA and deployed separately.

Before domain cutover, all configuration capabilities listed in the production
policy must report configured. Follow
`production-cutover-rollback.md`; do not use Worker bootstrap or version upload
as proof that the public application is operational.

## Deferred production controls

Credential-envelope rotation is controlled by
`config/credential-envelope-rotation-policy.json` and the protected production
workflow. Its policy begins disabled with empty project/transition hashes. To
activate it later:

1. retain both source and target key versions in the production keyring;
2. authorize the exact Supabase project and key-version transition hashes;
3. bind the workflow to the immutable `main` commit and exact start/resume
   confirmation;
4. allow bounded leases to rotate integration, encrypted Meta-attribution, and
   mobile-push envelopes; and
5. run verify until all source-version counts are zero before deleting the old
   key.

Stripe live billing is controlled separately by
`config/stripe-live-billing-policy.json`. It is disabled by default and is not
part of Worker deployment or domain cutover. A later activation requires the
independent authority phrase, reviewed Cloudflare Worker, test/live Stripe
account and webhook hashes, canonical Price contracts, immutable commit, exact
confirmation, and post-change health evidence. Reversion restores only the
reviewed test bindings. Do not populate or execute this control while service
connections are deferred.

## Mobile-release environment

Compilation in normal CI uses:

```text
MOBILE_BUILD_PROFILE=compile-only
VITE_MOBILE_API_ORIGIN=https://unconfigured.invalid
MOBILE_PRODUCTION_ORIGIN_AUTHORIZED=false
```

Signed production releases require the protected `mobile-release` environment
and the credential matrix in `mobile-store-release.md`. Production native
builds reuse the exact public origin guard and cannot be made against a
different or credential-bearing URL.

## Read-only readiness

Run the **Hosted readiness probe** workflow at any time. It:

- prefers `STAGING_*` secrets and classifies generic fallback separately;
- verifies Cloudflare token/read access;
- probes Supabase Auth and Phase 1/5 table presence without selecting rows;
- calls Stripe `GET /v1/balance` only for `sk_test_*`;
- never calls Stripe with a live or unsupported secret; and
- retains only booleans, key classifications, and missing variable names.

The report recommends the next safe gate. It does not authorize mutation.

## Credential rotation and rollback

1. Disable the relevant activation variable or stop the protected workflow.
2. Rotate the provider credential at the provider.
3. Replace the environment secret without logging its value.
4. Re-run read-only readiness, then the smallest provider-specific validation.
5. Re-enable mutation only after target hashes and sandbox/production modes
   still match.

Database migrations are forward-only. Restore a verified hosted backup instead
of attempting to drop Phase 1–5 tables. Domain rollback is documented
separately and never deletes the Pages project.
