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
base. It reuses two acceptance-only tenants and Auth users so immutable audit
records do not make per-run deletion unreliable, runs the full acceptance
contract, expires an open Checkout Session, and restores the billing fixture
to its baseline in a `finally` path. Cleanup failure fails the job. Its artifact
is sanitized to booleans, timestamps, target class, and failure text; it
excludes credentials, cookies, callback codes, emails, and provider identifiers.

Member Auth consumes the real emailed PKCE magic link. The job emits an
ephemeral public key and run-bound handoff identifier, then polls a protected
environment variable for a hybrid-encrypted envelope. The operator automation
retrieves the matching message, encrypts the URL with
`scripts/encrypt-hosted-gate7-link.mjs`, and updates the variable. The private
key exists only in the running job. The protected
`STAGING_GITHUB_VARIABLES_TOKEN` credential lets the job read that environment
variable at runtime. The controller validates the Supabase
origin, verify path, magic-link type, callback origin/path, and state before
following the link.

Lifecycle time compression modifies only the dedicated fixture timestamps and
invokes global reconciliation with the current time. It never advances the
database-wide clock, so unrelated staging organizations cannot be restricted
or suspended early.

The controller remains disabled unless
`STAGING_HOSTED_ACCEPTANCE_ENABLED=true`. A source-complete controller does not
change Gate 7 status; only a successful reviewed exact-candidate run does.

## Consequences

- Gate 7 obtains repeatable provider-backed evidence instead of relying on
  local fixtures or manual recollection.
- Acceptance staging identities are stable and explicitly dedicated; their
  audit history is retained while mutable billing state is restored after each
  run.
- The real email and PKCE callback path is exercised without persisting the
  magic link in logs or artifacts.
- Reconciliation remains safe for unrelated staging tenants because every
  invocation uses current wall-clock time.
- Failure remains visible without publishing credential or customer data.
- Production, DNS, live billing, and real winery records are out of scope.
