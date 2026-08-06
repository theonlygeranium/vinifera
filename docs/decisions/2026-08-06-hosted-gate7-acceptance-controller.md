# ADR: Automate hosted Gate 7 acceptance with scoped synthetic fixtures

- **Status:** Accepted
- **Date:** 2026-08-06

## Context

Gate 7 requires current hosted proof across two-tenant RLS, staff and member
Auth, Stripe test Checkout and webhooks, and the subscription access lifecycle.
Local fixtures and isolated Worker health cannot prove these combined provider
and database contracts. Repeating the proof manually also makes cleanup and
evidence consistency unreliable.

## Decision

Add an explicit opt-in step to the protected staging deployment job. The
controller uses only staging secrets and a dedicated owner-controlled email
base, creates uniquely scoped synthetic tenants and Auth users, runs the full
acceptance contract, and attempts cleanup in a `finally` path. Its artifact is
sanitized to booleans, timestamps, target class, and failure text; it excludes
credentials, cookies, callback codes, emails, and provider identifiers.

The controller remains disabled unless
`STAGING_HOSTED_ACCEPTANCE_ENABLED=true`. A source-complete controller does not
change Gate 7 status; only a successful reviewed exact-candidate run does.

## Consequences

- Gate 7 obtains repeatable provider-backed evidence instead of relying on
  local fixtures or manual recollection.
- Synthetic staging records and test-mode Stripe resources are scoped per run
  and cleanup is always attempted and reported.
- Failure remains visible without publishing credential or customer data.
- Production, DNS, live billing, and real winery records are out of scope.
