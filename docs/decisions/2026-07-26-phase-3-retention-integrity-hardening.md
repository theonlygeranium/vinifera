# ADR: Phase 3 retention integrity hardening

- **Status:** Accepted
- **Date:** 2026-07-26
- **Decision owners:** Vinifera engineering

## Context

The initial Phase 3 implementation contained the complete product surfaces and
provider adapters, but final-stack review found retry and tenancy seams that
did not require credentials to resolve:

- email completion was not owned by a lease token;
- provider idempotency changed when retry batches changed;
- early or out-of-order provider events could be lost or regress status;
- cancellation execution read mutable live configuration;
- manual loyalty adjustments and cancellation actions lacked exact-request
  command replay protection;
- Phase 5 brand columns did not make every Phase 3 relationship brand-safe;
- unverified brand senders could consume every durable email attempt;
- offset loyalty history could skip entries after concurrent inserts;
- cancel analytics counted open attempts and depended on an unsupported
  `viewed` client action;
- an email outage could prevent unrelated daily retention work; and
- one UTC calendar date could resume or award members on the wrong brand-local
  day;
- Phase 3 database QA did not execute against the final migration stack.

These are source-architecture concerns, so deferring them until provider
activation would make later connection unsafe.

## Decision

Migration `202607260014_phase_3_brand_retention_hardening.sql` is a forward
migration. Applied migrations 001–013 are not rewritten.

The migration establishes seven final contracts:

1. **Owned asynchronous work.** Email claims carry a completion UUID and lease.
   Only the current token may finalize a row. Stale reclaim is bounded.
2. **Convergent provider evidence.** One durable outbox ID maps to one stable
   provider idempotency key. A webhook inbox retains unmatched events,
   validates exact replays, and applies monotonic status transitions.
3. **Transactional user commands.** Cancellation and loyalty mutations use a
   client-retained UUID plus a canonical SHA-256 request fingerprint. The
   retained browser identity includes organization, authenticated subject,
   session brand, and staff active brand. Terminal results replay; conflicting
   intent is rejected.
4. **Brand-complete retention.** New brands receive retention defaults,
   relationship foreign keys include organization, brand, and member identity,
   and each brand owns a validated time zone.
5. **Activation-safe email claims.** Explicit pending or failed sender
   identities remain unclaimed and consume no attempts. Legacy in-flight
   leases are safely requeued before the completion-token constraint is
   validated during upgrade.
6. **Stable history and analytics.** Loyalty history is fenced by an immutable
   database insertion sequence and paged by keyset cursor. Retention divides
   retained members by completed retained-plus-cancelled decisions, and step
   reach derives from persisted decisions the application actually emits.
7. **Independent local-calendar schedules.** Email enqueue/delivery is
   isolated from timestamp work keyed once per UTC date and calendar work keyed
   once per brand-local date. Provider failure cannot block churn, expiration,
   awards, pause resumption, or stale-attempt cleanup.

Legacy RPC signatures remain only as service-role compatibility wrappers. The
final stack preserves the Phase 5 server-BFF boundary; authenticated browser
roles cannot execute retention mutation or analytics RPCs directly.

## Consequences

- Services can be connected later without changing retry, tenancy, or command
  semantics.
- A provider acceptance followed by a database write failure is treated as an
  uncertain delivery and reconciled with the same provider key.
- Active cancellation attempts are stable across staff configuration edits.
- Birthday, anniversary, pause-resume, and pre-shipment dates follow the winery
  brand's calendar.
- Connecting and verifying a sender later cannot discard email queued before
  activation.
- Concurrent ledger inserts cannot shift or duplicate an in-progress history
  snapshot.
- The database carries additional command, lease, event-inbox, and daily-run
  records in exchange for deterministic recovery.

## Verification

- Fresh migrations 001–014 apply in the embedded PostgreSQL runtime.
- Phase 3 passes 199 assertions: 138 point-in-time plus 61 current-stack
  hardening assertions.
- Phase 5 passes 401 assertions with migration 014 and the Phase 3 current-stack
  suite included.
- Server tests cover stable keys, bounded concurrency, uncertain receipt
  persistence, webhook ingestion, schedule isolation, snapshots, commands,
  and pagination.
- Browser tests cover retained UUIDs across transient failure/reload and brand
  switches, current-tier comparison, unsaved test content, resumed cancel
  steps, and snapshot-keyset ledgers.

Hosted Supabase, Resend, DNS, Stripe, and real-tenant evidence remain activation
gates and are not represented as passed by this decision.
