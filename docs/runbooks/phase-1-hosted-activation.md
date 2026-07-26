# Phase 1 hosted activation and exit proof

**Owner:** Vinifera release engineering

**Scope:** Isolated staging Supabase, Worker deployment, staff and member Auth,
Stripe test subscriptions, hosted RLS proof, and Phase 1 evidence collection

**Safety:** This runbook must never receive a production Supabase project,
Stripe live key, production custom domain, or live-billing authorization.
Credential values belong only in protected GitHub environment secrets or the
provider control plane.

## Current state

The Phase 1 application, migration, RLS, Auth surfaces, Stripe adapters, local
database tests, browser QA, and Worker bundle are implemented. The public
custom domain still serves the static Pages rollback baseline. Phase 1 remains
open until the hosted checks below pass against a dedicated non-production
project and Stripe test mode.

## 1. Provision the isolated staging boundary

1. Create a GitHub `staging` environment.
2. Add the staging Supabase project reference and Cloudflare account ID to the
   repository's reviewed, hashed target allowlist. Do not reuse a production
   target.
3. Set the staging management secrets interactively:

   ```text
   STAGING_SUPABASE_ACCESS_TOKEN
   STAGING_SUPABASE_PROJECT_ID
   STAGING_SUPABASE_DB_PASSWORD
   STAGING_CLOUDFLARE_ACCOUNT_ID
   STAGING_CLOUDFLARE_API_TOKEN
   ```

4. Set the minimum Worker runtime secrets:

   ```text
   STAGING_SUPABASE_URL
   STAGING_SUPABASE_PUBLISHABLE_KEY
   STAGING_SUPABASE_SECRET_KEY
   STAGING_RATE_LIMIT_PEPPER
   STAGING_INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION
   STAGING_INTEGRATION_CREDENTIAL_ENCRYPTION_KEYS
   STAGING_MEMBER_BRAND_CONTEXT_SECRET
   STAGING_MOBILE_AUTH_STATE_SIGNING_SECRET
   ```

5. Run the read-only hosted-readiness workflow. Save its redacted report and
   confirm it identifies only the staging target. A present secret name or
   valid token does not by itself authorize mutation.
6. Enable `STAGING_SUPABASE_MIGRATION_ENABLED` only after the target guard
   passes. Keep `STAGING_CLOUDFLARE_DEPLOY_ENABLED` off until the database
   migration and hosted database tests pass.

## 2. Apply and verify the hosted database

Run the staging workflow and require all of the following from the migration
job:

- every forward migration applies without destructive reset;
- the hosted pgTAP suites pass;
- all tenant tables have RLS enabled and forced;
- browser roles cannot execute service-only RPCs;
- the migration target matches the reviewed staging allowlist; and
- a redacted schema/test report is retained with the workflow.

Create two test organizations and at least one staff user in each. Exercise
browser-role queries as both organizations and prove that organization A
receives zero organization B rows for users, memberships, brands, and every
Phase 1 tenant table. Repeat a representative denial using an invented UUID to
prove that knowing an identifier does not bypass RLS.

Do not use the service-role key for the cross-tenant proof.

## 3. Configure Supabase Auth

In the staging Supabase dashboard:

1. Set the Site URL to the isolated staging Worker origin.
2. Add only the documented staff and member callback URLs.
3. Enable `public.custom_access_token_hook`.
4. Set email OTP expiry to 900 seconds.
5. Configure authenticated SMTP for invitation, reset, and magic-link mail.
6. Enable Google OAuth with a staging-only OAuth client and exact callback.
7. Keep member authentication passwordless.

Run and retain redacted evidence for:

- staff signup, verification, login, logout, and password reset;
- owner invitation and least-privileged staff acceptance;
- Google OAuth login;
- member magic-link request, callback, expiry, and five-per-hour limiter;
- simultaneous staff/member sessions with distinct HTTP-only cookies; and
- tampered redirect, organization, brand, member, and callback state denial.

No email body, token, callback code, or cookie value belongs in the evidence.

## 4. Deploy the isolated Worker

After the database gate passes:

1. Enable `STAGING_CLOUDFLARE_DEPLOY_ENABLED`.
2. Dispatch the staging workflow from the verified `main` commit.
3. Require the deployment to target only `vinifera-staging` on `workers.dev`.
4. Verify `/api/health` returns JSON with service `vinifera-api`.
5. Verify `/api/health/configuration` reports the Phase 1 database and Auth
   core configured before functional testing.
6. Verify hosted cookies are `Secure`, `HttpOnly`, and `SameSite=Lax`.
7. Verify HTTPS, restrictive CORS, CSP, HSTS, frame denial, `nosniff`,
   referrer policy, and permissions policy.

The Pages custom domain remains untouched during this phase.

## 5. Activate Stripe test subscriptions

Use a Stripe test secret only. Keep `LIVE_BILLING_ENABLED=false` or unset.
Create four recurring test Prices and set:

```text
STAGING_STRIPE_SECRET_KEY
STAGING_STRIPE_PRICE_VINE
STAGING_STRIPE_PRICE_CELLAR
STAGING_STRIPE_PRICE_ESTATE
STAGING_STRIPE_PRICE_RESERVE
```

Configure the test Customer Portal. Register the staging endpoint:

```text
POST https://<staging-worker>/api/billing/webhook
```

Subscribe it to the implemented subscription and invoice events, then set
`STAGING_STRIPE_WEBHOOK_SECRET`.

Prove:

- owner Checkout creates a test subscription at the selected Price;
- the signed webhook updates the organization or independent brand;
- duplicate delivery is idempotent;
- a forged signature and a live-mode event are rejected;
- payment failure begins the seven-day grace period;
- day eight restricts operational access;
- day fifteen suspends access; and
- a successful recovery restores the correct access state.

Never use a real card or replace the test key during this runbook.

## 6. Run the hosted QA gate

Run the complete browser suite against the staging Worker at 375, 768, and
1440 pixels. Require zero axe WCAG 2.1 AA violations, touch targets of at least
44 pixels, LCP below 2.5 seconds, CLS below 0.1, no horizontal overflow, and no
server secrets in browser source or storage.

The Phase 1 exit criterion passes only when one real test organization has an
active Stripe test subscription, staff and member Auth flows work end to end,
the empty staff and member dashboards render, and the two-organization hosted
RLS proof passes.

Save the workflow URL, immutable commit, staging Worker version, redacted
provider identifiers, database assertion counts, browser report, screenshots,
headers, and performance measurements in
`docs/build-specs/phase-1-qa-report.md`.

## 7. Failure and rollback

- Disable both staging activation variables to stop new migration/deploy jobs.
- Roll back a Worker version; do not attach the production custom domain.
- Correct database defects through a forward migration. Do not edit an applied
  migration or delete audit records.
- Disable Stripe test Checkout by removing the staging Price bindings; retain
  webhook history for reconciliation.
- Revoke and rotate any credential exposed outside the protected environment.
- Preserve the static Pages project and `REVERT.md` baseline throughout.
