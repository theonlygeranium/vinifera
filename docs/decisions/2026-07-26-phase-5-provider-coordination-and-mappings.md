# ADR: Durable provider coordination and executable integration mappings

- **Date:** 2026-07-26
- **Status:** Accepted
- **Phase:** 5 — Scale and integrations

## Context

The credential-independent Phase 5 architecture could store connector
configuration before provider accounts were available, but several runtime gaps
remained:

1. QuickBooks rolling refresh tokens were serialized only inside one Worker
   isolate, so two isolates could use the same one-time refresh token.
2. Klaviyo and QuickBooks mapping tables were readable but had no authorized,
   tenant-safe mutation command connected to the existing Integration page
   save path.
3. Klaviyo profile execution used fixed fields and did not reconcile configured
   list memberships.
4. Provider work depended on the hourly schedule even when a database job was
   ready immediately.
5. An indeterminate custom-hostname DELETE had no durable lookup-required
   record, so a later caller could replay the mutation blindly.

Integration jobs also needed a database invariant preventing inactive or
suspended brands from enqueueing, resolving credentials, or claiming work.
Expired final-attempt leases needed a terminal recovery path. The Avalara
ledger additionally needed to support a provider-adjusted temporary quote
without violating the unique provider transaction code or replacing committed
facts.

## Decision

### QuickBooks credential generations

`integration_secrets` owns a monotonically increasing credential generation
and one hashed, expiring refresh lease. A service worker must:

1. claim the lease for the runtime generation;
2. exchange the rolling refresh token once;
3. encrypt the replacement credential envelope;
4. complete the lease with a generation-and-token compare-and-swap; and
5. use the refreshed access token only after that durable completion succeeds.

Busy and stale claims are retryable. Provider or encryption failure releases
the lease. The in-process promise map remains a latency optimization, not a
correctness boundary.

### Mapping commands and UI compatibility

Security-definer replacement commands validate the caller, resolve the
connection's organization and brand, and replace one connection's mappings in
one database statement. Composite foreign keys prevent a connection or club
tier from another brand being referenced.

The existing `syncConfig` fields remain the browser contract. The API
translates them as follows:

- Klaviyo email, tier, churn-risk, and default-list fields become field and
  list mapping rows.
- QuickBooks default deposit account and item fields become fallback
  membership and shipping mapping rows.

This keeps the shipped Integration page operational while allowing future
tier-specific rules to use the same database commands.

### Klaviyo execution

Each profile batch loads enabled field and list rules. Churn score and the
derived low/medium/high level are available mapping sources. After asynchronous
import completion, the worker resolves Klaviyo profile IDs, computes list
additions and removals against persisted membership state, applies grouped
membership changes, and stores the provider ID, payload hash, and resulting
list IDs. Missing profiles explicitly reported as failed by Klaviyo are
accepted as partial failures; unexplained missing profiles retry.

### Job and Avalara invariants

Integration enqueue, runtime, and claim functions join organization and brand
state. Suspended organizations and inactive or suspended brands are
ineligible. Claim recovery dead-letters an expired lease that has already
reached its attempt ceiling. Claims return each job's persisted
`max_attempts`; the service uses that value rather than imposing a second,
hard-coded ceiling.

Avalara calculation persistence conflicts on the unique provider transaction
code. A same-shipment temporary calculation can be replaced with a new request
hash and complete quote fields, including a transition to committed or voided.
Cross-shipment rebinding and mutation of committed facts are rejected.

### Queue wake signals

Cloudflare Queues is a latency trigger, not the job store. A wake message
contains only a fixed kind and timestamp. Every consumer invocation claims the
authoritative PostgreSQL job row, and the hourly schedule remains the recovery
sweep. The consumer emits an immediate continuation wake when more work may be
available and a separately delayed wake for the next persisted retry.

Generated Worker binding types are checked in CI. Development, staging, and
production use separate queue resources that are created only during later
environment activation.

### Custom-hostname deletion

Hostname deletion has a service-role-only lease ledger separate from hostname
creation. The first claim authorizes one DELETE. An error of unknown outcome
changes the durable state to `lookup_required`. A later caller must perform a
GET:

- a provider 404 confirms absence without replaying DELETE;
- a matching provider object authorizes exactly one counted DELETE retry; and
- an unavailable or mismatched lookup releases the lease without mutation.

After absence is confirmed, one database command disables the local domain,
completes the deletion attempt, and releases the old create generation so the
hostname can be safely reused by another brand.

### Tenant-bound client state

Changing brand scope remounts the staff data boundary and ignores stale
responses from the previous brand. Organization-wide analytics preserves raw
per-brand numerators and denominators before calculating rates. Native token
rotation is single-flight, and encrypted cached member data is exposed only in
a visibly read-only offline session.

## Consequences

- Provider credentials can remain absent until activation; all schema, API,
  execution, and retry contracts are testable without contacting providers.
- QuickBooks refresh correctness no longer depends on Worker isolate affinity.
- The visible integration configuration is no longer cosmetic.
- List removals are explicit and auditable through minimized mapping state.
- Queue delivery can be duplicated without duplicating provider work.
- Ambiguous destructive hostname writes are lookup-gated and recoverable.
- Hosted migration, provider account validation, and live round trips remain
  required before operational activation.

## Verification

- `npm run qa:db:phase5` — 494/494 embedded pgTAP assertions.
- `npx vitest run tests/server/phase5-backend-completion.test.ts tests/server/phase5-integrations.test.ts`
  — 49/49 focused server tests.
- Custom-hostname provider and coordination tests — 54/54.
- `npm run typecheck` — passed.
- `npm test` — 352/352 application tests.
- `npm run qa:e2e` — 145/145 browser tests with zero axe violations.
- All provider requests in the focused tests use injected fetch functions; no
  external provider was contacted.
