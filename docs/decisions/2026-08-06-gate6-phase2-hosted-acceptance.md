# ADR: Gate 6 protected Phase 2 hosted acceptance

## Status

Accepted for implementation. The checked-in target policy and execution switch
remain disabled, so this decision does not activate Gate 6.

## Context

Gate 6 is the provider-backed exit proof for the core club loop. Local service
doubles prove orchestration, but cannot prove that Stripe test-mode
PaymentIntents and a refund completed or that EasyPost purchased labels after a
real ShipCompliant decision. Gate 13 must run first because every alcohol label
request now invokes the fail-closed compliance adapter.

The acceptance path creates provider objects and immutable financial, shipping,
compliance, and audit records. A retry therefore cannot use random fixtures or
blindly repeat provider calls.

## Decision

Add a dedicated, protected `workflow_dispatch` controller that:

- executes only from the exact current canonical `main` commit and targets the
  exact current `staging` commit;
- re-fetches and revalidates both branch heads after prerequisite retrieval and
  immediately before any provider mutation, so stale authority cannot consume
  the one-shot fixtures;
- requires the successful retained Gate 13 artifact for that same staging
  revision before any Gate 6 provider mutation;
- requires an independently disabled repository policy, staging environment
  switch, exact confirmation phrase, and reviewed stable hashes for the fixture
  contract, staging Worker, staging Supabase target, and Stripe test account;
- binds the per-run manifest to the exact immutable staging candidate, preserves
  its exact bytes, and authorizes its digest from protected environment state
  populated only after that candidate exists, avoiding a policy/candidate
  fixed point while keeping the stable fixture contract under review;
- rejects non-`sk_test_`
  Stripe credentials before client construction, and sends the Access token
  only to the two hashed staging ingress origins;
- accepts exactly ten dedicated, active, same-organization and same-brand
  members, one tier, one release, and ten known shipment IDs, with exactly one
  decline fixture;
- requires the dedicated fixture staff principal to be an active owner or admin
  before any provider object is created, matching the final refund authority;
- creates ten idempotent Stripe test Customers and PaymentMethods, proves nine
  initial charges plus one decline and recovery, purchases ten compliant
  EasyPost labels, completes pick/pack/ship/deliver, and performs exactly one
  test refund;
- queries every database evidence set with both `organization_id` and
  `brand_id`, proves the negative-control brand is active in another staging
  organization, and denies that exact cross-tenant request before provider work;
- relies on shipment-bound PaymentIntent, label-attempt, and refund ledgers plus
  deterministic provider idempotency keys so a network retry cannot create a
  second charge, label, or Customer;
- retires the ten dedicated members through a reversible soft-delete only after
  every evidence check passes; a failed run retains its fixtures for diagnosis
  and reports cleanup failure;
- verifies the organization audit segment's sequence/hash continuity and the
  exact release/shipment entities for every required lifecycle action; and
- uploads only a sanitized 90-day JSON artifact whose
  `completionClaimed` field is always `false`. Gate status changes remain a
  separate evidence-review action.

The workflow runs in `staging-acceptance-control`, has no deployment or
production authority, forces `LIVE_BILLING_ENABLED=false`, and requires the
real `easypost` and `shipcompliant` adapters with both simulators disabled.

## Consequences

- Gate 6 gains repeatable, exact-revision provider evidence rather than a local
  simulation claim.
- Each accepted fixture manifest is one-shot. A failed run is resumed only
  after its database/provider state is inspected; a completed run remains
  immutable evidence and its members stay reversibly retired.
- Gate 13 must be re-run against the exact eventual Gate 6 staging revision
  before Gate 6 can execute.
- The exact per-run manifest digest is short-lived protected environment state,
  not a checked-in value that would have to predict its own staging candidate.
- Checked-in defaults cannot contact Stripe, EasyPost, ShipCompliant, Supabase,
  or the staging Worker.

## Verification

```bash
npm run qa:gate6-acceptance
npm run check
npm run qa:db:phase2
```
