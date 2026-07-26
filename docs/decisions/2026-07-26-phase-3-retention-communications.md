# ADR: Phase 3 retention and communications

- **Status:** Accepted
- **Date:** 2026-07-26
- **Decision owners:** Vinifera engineering

## Context

Phase 3 adds outbound email, explainable churn scoring, cancellation
interception, and loyalty value to the Phase 2 club loop. These workflows span
database transactions and external email delivery, and several are driven by
scheduled or retried events.

Provider credentials and winery DNS are not available during the architecture
build. The implementation must therefore be deployable before activation
without reporting simulated provider success in production.

## Decision

### Transactional email outbox

Application events enqueue tenant-owned email deliveries in PostgreSQL. A
scheduled Worker claims due rows in bounded batches, renders the selected
template, and submits the messages through a provider interface.

Resend is the first production provider. The adapter uses the REST batch
endpoint for up to 100 distinct messages, supplies a stable idempotency key,
and stores only provider identifiers and delivery state. Claims and retries
remain durable so an interrupted Worker can resume without sending a second
logical message.

The deterministic email provider is available only when the runtime is
non-production and test simulation is explicitly enabled. A production
runtime without a Resend key, verified sender, webhook secret, or unsubscribe
signing secret returns an activation error and leaves queued work pending.

### Templates, rendering, and delivery events

Each organization owns one customizable template per supported transactional
trigger. Subjects and bodies are sanitized and rendered into a responsive,
escaped HTML shell. Preview and test-send use the same renderer as scheduled
delivery.

Resend webhooks are verified against the raw request body and the
`svix-id`, `svix-timestamp`, and `svix-signature` headers before delivery state
is changed. Webhook identifiers are replay-protected. Sent, delivered,
bounced, complained, opened, and clicked events are retained as provider
evidence and as inputs to the rules-based engagement score.

Unsubscribe links contain a purpose-bound, expiring signature. Raw bearer
tokens are not stored. Unsubscribe affects optional transactional
communications while legally and operationally required messages remain
separately classifiable.

### Explainable churn snapshots

Phase 3 uses a deterministic rules engine, not a machine-learning claim. The
nightly job calculates a bounded score from shipment interaction, payment
declines, tenure, email engagement, portal activity, and tier downgrades. Each
snapshot stores its weighted contributing factors and calculation version.

The staff dashboard reads persisted snapshots. It does not calculate scores in
the browser or display fixture data. A member is considered scored only after
the nightly job produces a current snapshot.

### Cancel-flow state machine

An organization owns an ordered, enabled set of pause, downgrade, swap, and
confirmation steps. A member cancellation attempt creates one authenticated,
tenant-bound session. Every reached step and accepted outcome is appended for
analytics.

Accepting pause, downgrade, or swap applies that operation through the existing
club state machine and terminates the cancellation attempt as retained.
Completing enabled steps performs cancellation exactly once. Staff analytics
derive from the event ledger instead of mutable counters.

### Loyalty ledger and redemption

Loyalty value is append-only. Awards, manual adjustments, expirations, and
redemptions create ledger entries with a stable source-event key. Shipment,
referral, birthday, and anniversary jobs can therefore be retried safely.

Positive awards create expiring lots. Redemptions consume available lots in
first-expiring-first-out order and reserve the corresponding discount against
one upcoming shipment. Expired or already-consumed points are never included
in the available balance. Tier multipliers are captured at award time so later
tier edits do not rewrite history.

Manual adjustments require an authorized staff principal, a non-empty reason,
and an audit entry.

### Tenant and activation boundaries

All Phase 3 rows include an organization boundary or inherit one through a
composite foreign key. Row-level security is enabled and forced. Browser
sessions cannot invoke scheduled delivery, global scoring, expiration, or
provider reconciliation functions.

Provider activation is an operational gate, not an alternate code path.
Hosted exit evidence remains pending until Supabase migrations, Resend,
winery DNS, and the staging Worker are connected.

## Consequences

### Positive

- Email work survives Worker restarts and provider timeouts.
- Provider retries do not create duplicate logical messages.
- Churn scores and cancel-flow analytics remain explainable.
- Loyalty expiration and redemption are auditable at the point level.
- Credentials can be connected later without replacing application
  architecture.

### Tradeoffs

- Delivery and application state are eventually consistent.
- Resend DNS and webhook activation are required before hosted email claims can
  pass.
- A rules score is useful prioritization, not a validated prediction model.
- Lot-based loyalty accounting is more complex than a mutable balance column.

## Verification

- Migration reset, schema assertions, two-tenant RLS tests, and server-only RPC
  permission tests
- Idempotent outbox claim/send/retry and verified webhook replay tests
- Six trigger, sanitizer, preview, test-send, and unsubscribe-expiry tests
- Rules factor, threshold, nightly batch, and 1,000-member performance tests
- Four-step cancel-flow interruption/completion and analytics tests
- Award, multiplier, exact-once, expiration, adjustment, FIFO redemption, and
  shipment-discount tests
- Playwright functional, axe-core, mobile focus, breakpoint, layout, and web
  vital gates
