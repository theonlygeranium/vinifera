# ADR: Recoverable organization signup and deferred Stripe Customer creation

- **Status:** Accepted
- **Date:** 2026-07-26
- **Decision owners:** Vinifera production engineering

## Context

Phase 1 requires one Stripe Customer per organization as a consequence of
signup. Vinifera must also be deployable before Stripe credentials are
connected, and a network timeout can occur after either PostgreSQL or Stripe
has committed a write. Treating every error as a confirmed failure could
delete an auth identity for an organization that already exists or create a
duplicate Stripe Customer on retry.

## Decision

Organization signup uses the following ordered, recoverable workflow:

1. Supabase Auth creates the owner identity.
2. The idempotent `bootstrap_organization` RPC creates or returns the owner and
   tenant. If its response is ambiguous, the service looks up `staff_users` by
   the immutable owner ID. It reuses a recovered organization and deletes the
   auth identity only when a successful lookup proves that no staff row was
   committed. A failed reconciliation lookup retains the identity for safe
   recovery.
3. The service reads the durable `organizations.stripe_customer_id` value. An
   existing valid Customer is reported as `ready`, including when Stripe
   credentials were later disconnected.
4. When an authorized Stripe key is available, signup claims the organization
   billing subject through the database provisioning lease and creates the
   Customer with the stable
   `vinifera:customer:v1:organization:<org>:<org>` idempotency key. Stripe Price
   and webhook configuration are not prerequisites for this Customer-only
   step.
5. When Stripe is disconnected, signup performs no Stripe or provisioning-store
   call and reports `deferred`. Checkout retains the same claim and idempotency
   path, so a later connection can provision the Customer without changing the
   application contract.
6. An uncertain provider or database finalize result reports
   `reconciliation_required`. The organization and owner remain intact; a
   later billing retry reconciles through the same durable claim and
   idempotency key.
7. Session refresh happens after tenant and billing handling. A refresh failure
   never rolls back the owner or organization.

The signup response keeps `billingActivationRequired` for the existing
Checkout decision and adds `billingCustomerState` with exactly `ready`,
`deferred`, or `reconciliation_required`. The staff UI renders distinct,
truthful guidance for each state.

## Consequences

- Signup creates the required organization Customer immediately once Stripe
  test mode is connected, without waiting for Price or webhook activation.
- Credential-free deployments remain fully usable for architecture and local
  QA and transmit nothing to Stripe.
- A transient provider failure cannot destroy a successfully bootstrapped
  tenant or cause blind duplicate creation.
- Pre-connection organizations remain eligible for the same just-in-time
  Customer provisioning when their owner starts Checkout.
- Hosted proof still requires a real Stripe test Customer and signed billing
  lifecycle after activation.

## Rejected alternatives

- **Create the Customer before the tenant.** Rejected because the immutable
  tenant ID is the billing subject and idempotency input.
- **Delete the owner after every bootstrap error.** Rejected because a lost RPC
  response may follow a committed transaction.
- **Require Prices and webhook configuration before Customer creation.**
  Rejected because those capabilities are independent and would leave signup
  contrary to the Phase 1 contract.
- **Return only a generic activation boolean.** Rejected because it cannot
  distinguish a ready Customer from a disconnected or uncertain write.

## Verification

- `npm run typecheck`
- `npm test`
- `npm run qa:db:phase1`
- `npx playwright test tests/e2e/phase1.spec.ts`
- Confirm disconnected Customer tests invoke neither Stripe nor the
  provisioning store.
- Confirm existing, newly created, and uncertain Customers report `ready`,
  `deferred`, and `reconciliation_required` correctly.
- Confirm ambiguous bootstrap recovery never deletes an identity unless a
  successful database lookup proves the organization was not created.
