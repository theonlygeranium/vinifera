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

Member Auth consumes the real emailed PKCE magic link. The job writes an
ephemeral public key and run-bound handoff identifier to a protected staging
environment variable, then polls a separate protected variable for a
hybrid-encrypted envelope. The operator automation
retrieves the matching message, encrypts the URL with
`scripts/encrypt-hosted-gate7-link.mjs`, and updates the variable. The private
key exists only in the running job. The protected
`STAGING_GITHUB_VARIABLES_TOKEN` credential lets the job read and write those
environment variables at runtime. It removes the public handoff variable when
the wait ends. The controller validates the Supabase
origin, verify path, magic-link type, callback origin/path, and state before
following the link.

The hosted Supabase project uses the exact staging Worker as its Auth Site URL
and allowlists the Worker's full callback namespace. Supabase otherwise falls
back when a requested redirect is not allowlisted, which detaches the emailed
action from the run-bound PKCE callback. The application inspects the
link-context registration and `signInWithOtp` results. A rejected provider
attempt revokes its new database context and does not replace an existing
browser link cookie; the cookie is written only after Supabase accepts the new
email operation. The anonymous route retains the same generic response as an
unknown member for both database and provider failures so outages cannot
become a membership oracle.

The controller's in-memory cookie jar follows browser deletion semantics:
`Max-Age=0` and already expired `Set-Cookie` records remove the named cookie,
and an empty value cannot satisfy an Auth-family assertion. This matters when
Supabase SSR clears a legacy unchunked base cookie while writing numeric chunks;
retaining the cleared base can shadow the valid chunks during reconstruction.
Before protected tenant assertions, each staff jar is validated directly with
Supabase SSR and through the Worker's public staff-session route. These
preflights retain only a sanitized Auth error code and boolean outcome.

The reusable fixture begins each run in its cleanup baseline of `onboarding`.
The controller therefore proves the signed Stripe `active` webhook first and
only then requests a member magic link, matching the database rule that member
link contexts require `active` or `grace` operational billing state. The later
duplicate, forged, past-due, restriction, suspension, and recovery checks reuse
that same lifecycle and event identity.

Lifecycle time compression modifies only the dedicated fixture timestamps and
invokes global reconciliation with the current time. It never advances the
database-wide clock, so unrelated staging organizations cannot be restricted
or suspended early.

The controller remains disabled unless
`STAGING_HOSTED_ACCEPTANCE_ENABLED=true`. A source-complete controller does not
change Gate 7 status; only a successful reviewed exact-candidate run does.

The defense-in-depth auth-presence middleware recognizes the same cookie family
as the Supabase SSR service client: the exact staff/member base name or a
numeric chunk suffix such as `.0` or `.1`. It parses cookie names rather than
using a broad prefix match, so link-context and malformed similarly prefixed
cookies do not satisfy the early presence gate. The service layer remains the
authoritative validator of the reconstructed session.

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
