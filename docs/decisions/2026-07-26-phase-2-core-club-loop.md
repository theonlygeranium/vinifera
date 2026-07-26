# ADR: Phase 2 core club loop

- **Status:** Accepted
- **Date:** 2026-07-26
- **Decision owners:** Vinifera engineering

## Context

Phase 2 turns the authenticated, tenant-isolated foundation into the operational
wine-club loop: tiers, members, releases, charges, decline recovery, labels,
packing, and shipment completion.

Three concerns must remain independently reliable:

1. PostgreSQL owns durable club and shipment state.
2. Stripe owns payment credentials and money movement.
3. A shipping provider owns address verification, rates, labels, and tracking.

The application must be fully wired before provider credentials are available,
without treating simulated data as a production success.

## Decision

### Durable release snapshots

Club-tier edits apply only to future releases. A scheduled release therefore
snapshots participating tiers, prices, wines, and quantities before processing.
Every shipment references that release snapshot instead of reading mutable tier
configuration while a billing run is active.

PostgreSQL functions enforce the allowed state transitions and create one
shipment per eligible member and release. Unique constraints and caller-supplied
idempotency keys make release processing safe to resume after partial failures.

### Payment orchestration

Shipment charges use Stripe PaymentIntents separately from Vinifera's own SaaS
subscription:

- Members store only Stripe customer, payment-method, and intent identifiers in
  Vinifera. Raw card details never enter the application.
- Off-session PaymentIntents use the release shipment ID as their idempotency
  key.
- Every attempt is appended to the billing-attempt ledger.
- A batch can contain both successful and declined shipments.
- Declines schedule retries for day 1, day 3, and day 7. Manual retries use the
  same state machine.
- Refunds are initiated through Stripe and reconciled into the append-only audit
  history.

Webhook signatures are verified before any payment state is applied.

### Shipping provider

Use EasyPost as the first carrier aggregator behind a Vinifera shipping-provider
interface. This supplies one contract for address verification, buying labels,
and tracking across UPS, FedEx, and additional carriers while avoiding
carrier-specific behavior in application routes.

The provider accepts only server-side `EASYPOST_API_KEY` credentials. A
deterministic simulator is available only when both the runtime is non-production
and test simulation is explicitly enabled. Missing production credentials
return `503 activation_required`; they never create a synthetic label.

The Phase 4 compliance adapter remains a separate pre-label decision. Until it
is connected, Phase 2 uses a versioned state whitelist and records the decision
on the shipment.

### CSV import

CSV import is a two-step operation:

1. Parse, normalize, map, validate, and preview without mutating member data.
2. Commit the validated import using the preview token and the same mapping.

The server, not the browser, enforces MIME/extension, size, row-count, required
field, email, duplicate, and tenant rules. Common Commerce7 and WineDirect
headers are normalized into the same member command. Row failures are returned
as structured errors and successful inserts are audited.

### Tenant and audit boundaries

Every Phase 2 table is tenant-owned directly or is reachable only through a
tenant-owned parent. RLS is enabled and forced. Server operations validate the
cookie-backed principal and pass the organization ID explicitly to
service-role-only database functions.

The audit log is append-only for every database role used by the application.
Each entry includes the previous entry hash and its own digest so missing or
rewritten history is detectable.

### Deferred activation

Supabase, Stripe, and EasyPost integrations are production adapters with typed
configuration reports. Local API tests inject deterministic doubles. Hosted
exit-criterion evidence remains pending until the corresponding test-mode
credentials and control-plane settings are activated.

## Consequences

### Positive

- A partially failed release can resume without duplicate charges or shipments.
- Tier edits cannot retroactively change money already scheduled or collected.
- Carrier choice can change without rewriting release or packing workflows.
- Credential activation is operational work rather than an architectural
  rewrite.
- Tenant isolation and shipment transitions remain enforceable below the UI.

### Tradeoffs

- EasyPost becomes an additional vendor in the shipping path.
- Release processing is an orchestrated batch, not one database transaction,
  because payment and label APIs are external.
- A fully live Phase 2 exit criterion cannot be claimed until Stripe test-mode,
  Supabase, and EasyPost test credentials are connected.

## Verification

- Unit and API integration tests for every command and activation gate
- PostgreSQL migration reset, pgTAP schema checks, and two-tenant RLS tests
- Idempotent batch, partial-decline, retry, refund, and shipment-transition tests
- CSV format, limit, validation, duplicate, preview, and commit tests
- Playwright functional, axe-core, breakpoint, layout, and performance gates
- Signed Stripe webhook replay and EasyPost test-label creation after activation
