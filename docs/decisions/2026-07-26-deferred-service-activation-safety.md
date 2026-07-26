# ADR: Complete service architecture before credential activation

- **Status:** Accepted
- **Date:** 2026-07-26
- **Decision owners:** Vinifera production engineering

## Context

The Phase 1–5 product architecture must be complete even when Supabase,
payments, email, tax, accounting, analytics, DNS, push, signing, and store
credentials are not yet available. A missing credential must not force a mock
production path, and adding a credential later must not silently authorize a
provider write, production target, domain cutover, or live payment.

Provider writes can also finish remotely while the caller receives no usable
response. Blindly retrying those operations can create duplicate customers,
billing sessions, catalog objects, custom hostnames, messages, or accounting
records.

## Decision

Vinifera separates **architecture completion** from **service activation**.
The source, database contracts, UI, adapters, release controls, and local QA
may pass while every external service remains disconnected. Hosted and
provider exit criteria remain open until redacted runtime evidence exists.

Connection-ready services follow these rules:

1. **Fail-closed activation.** Missing credentials or unresolved targets return
   `activation_required`, claim no provider work, and never substitute
   production mock data.
2. **Credential ownership.** Worker/application secrets remain environment
   bindings. Winery-specific connector secrets may use authenticated
   AES-256-GCM envelopes or the restricted
   `env://VINIFERA_INTEGRATION_SECRET_*` reference form. Browser responses
   expose only redacted connection metadata.
3. **Target authorization.** Supabase, Cloudflare, ShipCompliant, FCM, Stripe,
   Worker-origin, webhook, and custom-hostname targets are normalized and
   SHA-256 allowlisted in reviewed policy. Empty lists deny mutation.
4. **Retry safety.** Stripe customer creation and billing sessions use stable
   idempotency keys plus database leases. Organization signup provisions its
   Customer when an authorized key is connected and otherwise reports an
   explicit deferred state without a provider call. One nonterminal Checkout
   is allowed per immutable billing subject, and a completed Checkout remains
   `awaiting_webhook` until the signed subscription event reconciles it.
   Custom-hostname creation uses a durable write ledger and lookup-before-retry
   reconciliation when the provider result is unknown.
5. **Consent and minimization.** Meta attribution is accepted only with current
   consent. Raw browser attribution is encrypted at rest, used to derive hashed
   provider data, and redacted when consent is withdrawn. Provider logs retain
   sanitized identifiers and response hashes rather than secrets or raw
   customer payloads.
6. **Credential rotation.** Integration, Meta attribution, and mobile-push
   envelopes rotate through a leased, resumable, bounded job. The old key
   cannot be removed until verification reports zero remaining source-version
   envelopes.
7. **Independent launch authority.** Stripe live billing is default-deny and
   independent from Worker deployment. It requires a protected production
   environment, immutable commit, exact confirmations, separate authority,
   reviewed test/live account and webhook hashes, canonical Price contracts,
   and post-change health verification. Reversion to the authorized test
   bindings remains a separate controlled operation.
8. **Human-controlled activation.** DNS, provider terms, tax filing authority,
   live payments, production data mappings, signing, and store distribution
   remain human actions documented in activation runbooks.

The protected Stripe test-catalog bootstrap run `30218801133` is retained as an
explicit uncertain-write incident: the first test Price is
created-or-unknown, then the controller failed closed because the returned
Product was not expanded. The fixed controller now requests Product expansion
and uses stable lookup/idempotency keys, but no retry will occur while service
connections are deferred.

## Consequences

- The complete credential-independent architecture can be reviewed and tested
  now without overstating hosted readiness.
- Adding a secret later does not by itself start jobs, mutate a provider, move
  a hostname, enable filing, or turn on live billing.
- Operators must approve target hashes, opt-in/consent, and the smallest
  provider-specific activation step before data leaves Vinifera.
- Indeterminate external writes remain visible in durable reconciliation state
  and are looked up before another create is attempted.
- Old credential-encryption keys must coexist during rotation, increasing
  operational key-management work in exchange for resumability and safe
  rollback.
- The public Cloudflare Pages prototype remains the production rollback
  baseline until the complete hosted Phase 1–5 gate passes.

## Rejected alternatives

- **Block architecture work until every credential exists.** Rejected because
  it couples product completeness to external account timing and leaves unsafe
  seams undesigned.
- **Treat credential presence as activation.** Rejected because a valid key
  does not establish target, consent, environment, or mutation authority.
- **Retry provider creates after any error.** Rejected because an unknown
  response may follow a successful remote write.
- **Store raw target identifiers in policy.** Rejected because normalized
  hashes provide the equality authorization needed by the controls.
- **Enable live Stripe as part of production Worker deployment.** Rejected
  because code deployment and payment authority are separate risk decisions.

## Verification

- Run the TypeScript, Vitest, embedded PostgreSQL/pgTAP, Playwright/axe,
  release-control, mobile-identity, and build gates.
- Confirm all unresolved provider target arrays and activation switches remain
  empty or disabled.
- Confirm unconfigured connector and provider routes return
  `activation_required` without outbound calls.
- Confirm Stripe billing-subject concurrency, webhook-wait, Meta consent
  redaction, envelope rotation, target-hash denial, and hostname
  lookup-before-retry tests pass.
- Do not mark a hosted or provider exit criterion complete until its protected
  workflow produces redacted evidence.
