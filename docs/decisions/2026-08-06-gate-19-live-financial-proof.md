# ADR: Gate 19 live financial proof control

- **Date:** 2026-08-06
- **Status:** Accepted for source; activation remains pending

## Context

The protected Stripe live-billing cutover changes the production Worker's
credential and Price bindings but deliberately performs no financial
transaction. Gate 19 separately requires one controlled live charge and
refund. Combining those responsibilities would let a binding operation create
money movement, make retries ambiguous, and obscure whether the application
actually processed signed live subscription webhooks.

Raw payment-card entry must remain entirely on Stripe's hosted surface. The
proof also needs a bounded recovery path if a run stops after the refund but
before subscription cleanup or application convergence.

## Decision

Gate 19 uses a distinct protected `stripe-live-proof.yml` workflow executing
trusted code from the exact current `main` release. Its policy ships disabled
with empty allowlists. Enabling it requires exactly one reviewed SHA-256 target
for the live Stripe account, dedicated customer, exact brand and organization,
live Price, plan name, maximum integer cent amount, production Supabase origin,
and production Worker origin, plus the exact owner phrase
`AUTHORIZE ONE VINIFERA LIVE CHARGE AND REFUND`.

The proof has two dispatches sharing one UUID nonce:

1. `prepare` verifies Worker billing/webhook health, the live account,
   customer, Price, maximum amount, and the hash-authorized independent-brand
   application mapping. It creates or reuses one idempotent subscription-mode
   Checkout Session only after verifying its exact line item, tenant metadata,
   immutable Git SHA, open/unpaid state, and expiration, then hands its
   `checkout.stripe.com` URL to the owner. It accepts no card data and performs
   no charge or refund.
2. `finalize` accepts only that completed `cs_live_` Session. It requires one
   succeeded PaymentIntent and exactly one captured Charge in the proof window,
   exact revision metadata and brand-scoped application subject, an applied
   live subscription event, and two duplicate responses to
   a freshly signed replay of the exact Stripe event before refunding. It
   creates at most one full refund under an idempotency key, resumes safely if
   that exact refund already exists, cancels renewal, waits for application
   `canceled` state, and repeats the signed-idempotency proof for the deletion
   event.

More than one proof-window payment or Charge, more than one refund, unrelated existing
refund metadata, an over-limit amount, an unbounded provider inventory, a
wrong tenant/brand mapping, absent live webhook persistence, or failed
application convergence stops the workflow. Sanitized evidence contains only
hashes, counts, booleans, timestamps, and final states.

## Consequences

The owner performs payment only on Stripe Checkout. Once the exact paid
subscription and single Charge are validated, every later failure enters an
idempotent refund-and-cancellation recovery boundary. A stopped finalize run
can continue cleanup without issuing another refund, but any distinct second
refund is a hard failure. The controller never claims active-to-canceled
convergence from a literal: first execution observes active application state,
while a recovery run requires the durable applied created event to prove that
prior state. A request to restore test bindings is recorded in evidence and must be
executed through the separate protected live-billing cutover workflow; the
proof controller has no Wrangler deployment or secret-update capability.

Gate 19 remains pending until both protected dispatches succeed against the
reviewed targets and their sanitized evidence is retained. Source readiness,
policy enablement, binding cutover, owner payment, and hosted proof are separate
states.
