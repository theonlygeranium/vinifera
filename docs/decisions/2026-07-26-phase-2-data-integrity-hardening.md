# ADR: Phase 2 data-integrity hardening

- **Status:** Accepted
- **Date:** 2026-07-26
- **Decision owners:** Vinifera engineering

## Context

Phase 2 commands can mutate member records, schedule shipment liabilities,
charge cards, or refund money. Browsers and Workers retry, webhooks and
synchronous provider responses can arrive in either order, and multiple workers
can recover stale work. Multi-brand tenancy also requires protection below RLS.
The architecture must be complete before credentials are connected without
claiming local doubles as hosted provider evidence.

## Decision

### Transactional commands and provider outbox

Tier, member, portal, release, and scheduling mutations require a UUID and a
canonical SHA-256 request fingerprint. An identical replay returns the stored
result; conflicting reuse is rejected. The command, business mutation,
append-only audit row, result, and provider-side-effect intent commit
atomically. A composite foreign key binds the result to the exact same-brand
audit row.

The browser stores only pending UUIDs and fingerprints in `sessionStorage`, not
request bodies or PII. Provider intents are delivered later from a bounded
`SKIP LOCKED` lease queue with stable provider idempotency keys. Newer intents
supersede older unclaimed work.

### Relational and release integrity

Composite organization/brand foreign keys enforce same-brand member tiers and
referrals, tier upgrades, release tiers and wines, import members, shipment
items, and command audit results while retaining `SET NULL`/`RESTRICT`
semantics.

A release may become scheduled only when every snapshotted tier has items whose
quantities total its snapshotted bottle count. The rule applies to
draft-to-scheduled transitions and releases created directly as scheduled.
Failures roll back the release, audit result, and outbox work together.

### Stripe and refund convergence

Only one active charge/retry and one active refund may exist per shipment.
Non-refund PaymentIntent and shipment charge identifiers are unique. Stripe
event IDs are write-once; replay must match tenant, shipment, attempt, status,
and provider timestamp. Financial identifiers are immutable after attachment.
A synchronous terminal result can later attach its signed webhook timestamp
once without double-counting revenue or lifetime value.
The staff refund endpoint resolves an existing terminal attempt before checking
the shipment's now-refunded state, so a lost successful response can replay
without a second provider call. Changed refund details under the same UUID are
rejected.

Stale refunds are claimed using database time, bounded leases, unique tokens,
and `SKIP LOCKED`. Completion requires the token, retryable failures persist
backoff, and terminal completion clears recovery state even if a provider call
outlives its lease.

### Provider-identity deletion race

Immediately before deleting a member authentication identity, the worker
rechecks live member, staff, and platform references. Concurrent reassignment
returns `superseded` instead of deleting a live principal.

## Consequences

- Retried commands cannot duplicate business mutations.
- Audit evidence and references cannot cross brand boundaries.
- Incomplete releases cannot enter billing.
- Stripe synchronous results, webhooks, and refund recovery converge without
  duplicate financial effects.
- Connecting credentials later is activation and hosted proof, not an
  architectural rewrite.
- Command, outbox, event, and lease state must be retained and monitored.
- Local deterministic proof cannot satisfy hosted money-movement, carrier,
  store, or physical-device exits.

## Verification

- Phase 2 database: 231/231 assertions, comprising 170 point-in-time and 61
  current-stack transactional regressions.
- Vitest: focused Phase 2 72/72 and full suite 290/290.
- Playwright: Phase 2 38/38 and full suite 136/136, with zero axe violations at
  375, 768, and 1440.
- Regressions cover audit rollback, same-brand constraints, complete release
  aggregates, event replay/immutability, refund uniqueness, stale claims,
  second-worker exclusion, backoff/reclaim, and terminal cleanup.

Hosted Supabase native pgcrypto/pgTAP, Stripe test money movement, EasyPost
labels, signed store builds, and physical-device results remain deferred.
