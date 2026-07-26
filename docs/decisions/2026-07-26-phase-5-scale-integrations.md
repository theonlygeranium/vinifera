# ADR: Phase 5 scale, integration, brand, and mobile boundaries

- **Status:** Accepted
- **Date:** 2026-07-26
- **Owners:** Vinifera engineering

## Context

Phase 5 adds four external data processors, multi-brand operations,
white-label domains, and native mobile distribution. None of the provider or
store credentials are available in the implementation environment. The
architecture therefore has to be complete and testable without treating a
simulator, an empty secret, or a static Pages response as production proof.

The build specification also contains two tensions that need one
implementation rule:

1. Avalara replaces the Phase 4 tax estimate, but ShipCompliant remains the
   authority for alcohol-shipping compliance.
2. Meta requires hashed identifiers, while Klaviyo, QuickBooks, and Avalara
   cannot perform their documented work with universally hashed customer data.

## Decision

### Connector and secret boundary

Every provider implements one server-only connector contract with:

- an explicit `activation_required`, `configured`, `active`, or `degraded`
  health state;
- an encrypted credential envelope separate from staff-readable connection
  metadata;
- a versioned API contract and allowlisted HTTPS origin;
- a leased, idempotent sync job and append-only attempt log;
- retry classification, bounded backoff, reconciliation, and dead-letter
  behavior; and
- provider response IDs without raw credential or customer payload logging.

Credential envelopes use AES-256-GCM with a random nonce, authenticated
context, and key version. The wrapping key is a Worker secret, never a
database column or client binding. OAuth refresh replaces both access and
rolling refresh tokens atomically under a single refresh lease.

Provider simulators are test-only. Production rejects simulator flags and
missing credentials instead of reporting a connected integration.

### Consent and data minimization

An organization must opt in to each connector before a job can disclose data.
Member-level marketing/ad consent is checked at claim time and immediately
before transmission.

- Meta identifiers are normalized and SHA-256 hashed before the outbound
  request object is created. Raw identifiers are neither persisted in the
  conversion ledger nor passed to the network transport.
- Klaviyo receives only the profile and segmentation fields selected by the
  organization's field mapping.
- QuickBooks receives accounting facts and the minimum customer reference
  required for the selected sales-receipt workflow.
- Avalara receives the minimum origin, destination, exemption, item, and
  payable facts required to calculate and record tax.

Logs contain counts, stable internal correlation IDs, provider IDs, error
classes, and sanitized diagnostics—not request bodies or PII.

### Provider-specific reliability

- Klaviyo profile/status changes enqueue real-time upserts and list changes.
  Engagement uses signed system webhooks when the account supports that
  capability and cursor-based hourly Events API polling as a durable fallback.
  System webhooks use Klaviyo's raw-body-then-HTTP-date HMAC contract, require
  matching header/body webhook IDs, and process only allowlisted events from
  the provider's bounded batch envelope.
- QuickBooks derives a stable `requestid` from the operation identity with
  SHA-256, persists provider transaction IDs, reconciles ambiguous outcomes
  before retry, and serializes rolling OAuth refresh.
- Avalara calculates tax before Stripe PaymentIntent creation or confirmation.
  An opted-in, connected Avalara failure fails the charge closed. A successful
  charge commits the matching transaction; reconciliation handles an
  indeterminate commit. Each cumulative partial or full refund queues durable
  refund work against the original committed transaction and records a
  committed `ReturnInvoice`; liability reports subtract returns from sales.
  QuickBooks and Avalara progress is checkpointed independently before
  acknowledgement, so reconciliation after a crash resumes only the missing
  provider operation. The regression case applies 4,863-cent and 4,862-cent
  increments and converges to exactly 9,725 cents without a duplicate write.
  ShipCompliant still performs the post-charge and pre-label alcohol-shipping
  checks.
- Meta uses a stable `event_id` for browser/server deduplication. A conversion
  that lacks affirmative consent is suppressed, not retried.

### Multi-brand authorization

The migration creates one default brand per existing organization and
backfills existing rows additively. Existing single-brand behavior remains
valid.

Brand-scoped staff can read and mutate only brands explicitly granted to them,
even inside the same organization. Organization owners/admins may switch to an
all-brands view and use service-defined aggregate queries. A client-supplied
`brand_id` never grants access. RLS derives allowed brands from authenticated
membership and enforces the relationship on every brand-scoped table.
Service-only privileged operations remain callable only through the trusted
server boundary; browser and ordinary authenticated roles are denied even when
they supply an otherwise valid organization or brand identifier.

Each brand can inherit the organization's Vinifera subscription or reference
its own Stripe customer/subscription. Stripe production keys are an explicit
human-controlled launch step and are never changed automatically.

An independent brand's suspension is authoritative for that brand even when
the parent organization remains active. Member access, releases, retries,
integration jobs, and new charges fail closed for the suspended brand. A shared
brand continues to inherit the organization's access state.

### White-label domains

Custom domains use Cloudflare for SaaS custom hostnames. Vinifera records the
provider hostname ID, required validation records, certificate status, and
last verification time. A domain becomes active only after both domain-control
validation and certificate activation succeed. Host routing resolves to an
active brand on the server; unverified hostnames never affect tenant context.

Brand colors are accepted only when the resolved theme maintains WCAG 2.1 AA
contrast. Unsafe writes are rejected; any unsafe legacy or corrupted value is
rendered with the canonical accessible Vinifera theme.

### Mobile wrapper and updates

The React application remains the source of truth. Capacitor wraps the built
web application and exposes narrow adapters for:

- push registration and notification navigation;
- a biometric-protected session handoff with magic-link fallback;
- camera barcode scanning at the staff pack station;
- network and app lifecycle events;
- a bounded, read-only offline cache for recent shipments and loyalty; and
- allowlisted deep links.

No secret or reusable raw session credential is written to Web Storage. Native
secrets use Keychain/Keystore-backed storage.

When one normalized member email can identify more than one brand, mobile
magic-link requests require the brand's normalized `clubCode`. The server never
guesses among multiple memberships. An invalid or unmatched code returns the
generic request response without sending mail; a missing selector for multiple
eligible memberships or a globally ambiguous code returns an explicit conflict
that asks the user to choose the winery's club code.

Web magic-link state is authenticated separately with an exact-context HMAC
covering the organization, brand, redirect, and member context. A valid token
cannot be replayed into a different tenant, brand, redirect, or member flow.

The native release identity is one version-controlled contract shared by the
runtime and verified against iOS, Android, Capacitor, AASA, and store-version
configuration. External navigation accepts one custom scheme, one canonical
host, and three exact routes. Debug and Release select development and
production APNs entitlements respectively; the Worker separately requires an
explicit sandbox/production APNs environment and exact bundle-ID agreement.

Android Release uses R8 minification and resource shrinking. Capacitor and
plugin consumer rules are retained, while the app adds only narrow WebView
bridge/annotation preservation. This was chosen because the native shell has
no reflection-heavy app layer and release shrinking materially reduces attack
surface and package size. Signed release smoke tests remain a gate because
only a store-signed binary can prove all plugin keep rules. The barcode
plugin's direct `@aar` dependency does not expose ionbarcode's runtime POM to
the app, so the app supplies the artifact's Gson 2.10.1 runtime dependency
explicitly. Camera hardware is optional at the manifest boundary, and Gradle is
bounded to a 3 GiB heap with at most two workers so the combined
lint/debug/release gate remains reproducible on constrained CI runners.

“Live update” means checking a signed version manifest and directing the user
to the appropriate store update when required. Phase 5 does not download
arbitrary executable JavaScript or self-update an APK/IPA outside store review.

Wine club payments are for physical goods. The mobile release notes will
explain that classification and the payment flow to app review. Store policy
and the final binaries still require review with the connected Apple and Google
developer accounts.

## Consequences

- All application, database, provider, white-label, and mobile boundaries can
  be implemented and locally tested without credentials.
- Provider and store activation remains a separate, evidence-producing
  operation. The Phase 5 hosted exit criterion cannot pass until real accounts,
  DNS, devices, and production Stripe approval are supplied.
- The system fails closed for tax, compliance, authorization, signatures, and
  consent, while non-authoritative marketing/accounting batch failures remain
  isolated and reconcilable.
- Cross-brand analytics is intentionally a privileged aggregate path rather
  than an RLS bypass in the browser.
