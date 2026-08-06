# ADR: Create Gate 7 Checkout before synthetic subscription activation

- **Status:** Accepted
- **Date:** 2026-08-06

## Context

The hosted Gate 7 controller must prove both Stripe test Checkout creation and
the signed subscription lifecycle. Its reusable fixture begins in
`onboarding`, while member magic-link contexts require `active` or `grace`.
The original sequence therefore delivered a synthetic signed `active` webhook
before the member Auth proof, but it also attempted Checkout afterward. The
webhook persisted its synthetic subscription ID, and the production billing
service correctly refused to treat that non-provider ID as reconcilable.

## Decision

Create and validate the real Stripe test Checkout Session while the reusable
fixture remains in its clean `onboarding` baseline. Record the session for
expiration during cleanup only after its URL uses the exact HTTPS
`checkout.stripe.com` host and contains a `cs_test_` Session path. Then deliver
the signed synthetic `active` webhook before requesting the member magic link,
preserving the operational-state requirement for portal Auth. Duplicate,
forged, past-due, restriction, suspension, recovery, and cleanup checks retain
their existing order.

## Consequences

- Checkout exercises the real provider without encountering test-injected
  subscription state.
- Member Auth still proves the `active` authorization boundary.
- The controller continues to expire open Checkout Sessions and restore the
  reusable organization billing fields in its mandatory cleanup path.
- Production, live billing, DNS, and real winery records remain out of scope.
