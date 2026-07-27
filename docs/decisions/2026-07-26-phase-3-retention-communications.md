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

Resend is the first production provider. Each outbox row is submitted with a
stable provider idempotency key derived only from its durable outbox identity.
The Worker processes no more than eight messages concurrently, while database
claims remain bounded to 100. A changing retry batch can therefore never
change a logical message's provider key.

Every claim receives a fresh completion token and expiring lease. Only the
current token may finalize the row, so an expired Worker cannot overwrite a
later claim. If the provider accepted a message but receipt persistence failed,
the row remains uncertain until the lease expires; the next attempt uses the
same provider key and reconciles the same provider message.

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
is changed. A durable inbox accepts events that arrive before the provider
message ID is attached to the email log and reconciles them afterward. Event
identifier replays must match the original provider message, type, timestamp,
and payload. Delivery states converge monotonically, so late `sent` or
`failed` events cannot regress a delivered or bounced message. Sent,
delivered, bounced, complained, opened, and clicked events are retained as
provider evidence and as inputs to the rules-based engagement score.

Unsubscribe links contain a purpose-bound, expiring signature. Raw bearer
tokens are not stored. Signing and expiration timestamps are persisted with
the outbox row, making the rendered request body deterministic across retries.
Unsubscribe affects optional transactional communications while legally and
operationally required messages remain separately classifiable.
The confirmation route sets `Cache-Control: no-store` and
`Referrer-Policy: no-referrer` before parsing or verifying the token, so valid,
expired, and invalid token-bearing responses cannot be cached or leak their
URL through a referrer even if the router is mounted without global security
middleware.

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

The complete four-step configuration is captured on attempt creation and is
the only configuration used while that attempt progresses. The confirmation
step must remain enabled and last. Starts are serialized per member, attempts
expire after 24 hours, and paused memberships are resumed by a bounded daily
job keyed to the brand's IANA-local date.

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
an audit entry, a caller-supplied UUID command, and a request fingerprint.
Cancellation, reservation, adjustment, and redemption commands store their
terminal results and reject a command UUID reused for different intent.

### Tenant and activation boundaries

All Phase 3 rows include organization and brand boundaries or inherit them
through composite foreign keys. New brands receive six email templates and a
safe four-step cancellation configuration. Per-brand IANA time zones control
birthday and pre-shipment calendar semantics. Row-level security is enabled
and forced. Browser sessions cannot invoke retention mutation, analytics,
scheduled delivery, global scoring, expiration, or provider reconciliation
functions; those operations remain behind the server BFF and service role.

The hourly Worker treats email enqueue, provider delivery, UTC timestamp work,
and brand-local calendar work as independent jobs. A provider outage cannot
suppress churn scoring, expiration, awards, cancel-attempt cleanup, or pause
resumption. The global routine persists one result per UTC date; each brand
persists one calendar result per local date and safely returns it on replay.

Provider activation is an operational gate, not an alternate code path.
Hosted exit evidence remains pending until Supabase migrations, Resend,
winery DNS, and the staging Worker are connected.

## Consequences

### Positive

- Email work survives Worker restarts and provider timeouts.
- Provider retries retain one logical provider idempotency identity.
- Early and out-of-order webhooks converge without losing terminal evidence.
- Churn scores and cancel-flow analytics remain explainable.
- Loyalty expiration and redemption are auditable at the point level.
- Multi-brand retention data cannot cross organization, brand, or member
  boundaries.
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
- Lease-owned outbox claim/send/retry and verified webhook convergence tests
- Six trigger, sanitizer, preview, test-send, and unsubscribe-expiry tests
- Direct-router unsubscribe confirmation and invalid-token privacy-header tests
- Rules factor, threshold, nightly batch, and 1,000-member performance tests
- Four-step cancel-flow snapshot, interruption/completion, expiry, and
  analytics tests
- Award, multiplier, exact-once, expiration, adjustment, FIFO redemption, and
  shipment-discount tests
- Current-stack multi-brand, command replay, same-brand foreign-key, scheduler,
  and service-role privilege tests
- Playwright functional, axe-core, mobile focus, breakpoint, layout, and web
  vital gates
