# ADR: Automate hosted Gate 8 acceptance through the real hourly scheduler

- **Status:** Accepted
- **Date:** 2026-08-06

## Context

Gate 8 requires current hosted proof that an exact Resend sending domain is
verified, the exact staging webhook is enabled with the complete event
contract and matching signing secret, and both welcome and pre-shipment
lifecycle messages reach the provider and reconcile through signed webhooks.
Static configuration, local simulation, or a direct invocation of internal
delivery functions cannot prove the deployed scheduled path.

Cloudflare does not expose a production API that manually invokes a deployed
Worker Cron Trigger. The local `/__scheduled` endpoint is a development-only
facility. A truthful hosted acceptance controller must therefore allow the
deployed hourly scheduler to perform delivery.

## Decision

Add a separate, explicit repository-level Actions toggle,
`STAGING_HOSTED_GATE8_ACCEPTANCE_ENABLED`. When it is `true`, the protected
staging deployment validates all required communications bindings before
upload, deploys those bindings atomically with the reviewed Worker version,
and then unlocks an isolated `gate8-acceptance` job. That job runs
`scripts/hosted-gate8-acceptance.mjs` with a controller-wide 70-minute
pre-cleanup deadline and a fresh 100-minute timeout: 15 minutes for runner
setup, at most 70 minutes shared by discovery, fixture setup, and provider
delivery, and 15 minutes for fixture retirement and evidence
upload. An activated staging Gate 8 workflow is not superseded by a later run;
routine full-validation runs retain cancellation of obsolete work.
Repository scope is required because workflow concurrency and job conditions
are evaluated before GitHub loads the protected `staging` environment.

The controller treats Resend as read-only. It inventories the configured
sending domain and exact `/api/webhooks/resend` staging endpoint through
official provider APIs, requires verified DKIM and SPF, enabled sending, all
supported email events, and a timing-safe signing-secret match. It never
creates or modifies provider or DNS resources.

The controller reuses the dedicated Gate 7 staging organization and creates one
uniquely addressed member, tier, and release. The member insert invokes the
canonical welcome trigger. Pre-shipment replay uses the service-role-only
`enqueue_scoped_pre_shipment_trigger` command twice with the exact organization,
brand, member, and release identifiers to prove logical idempotency without
scanning or enqueuing another tenant's due communications. It then waits for
the deployed hourly Worker to complete two outbox records, attach two distinct
provider message identifiers, and reconcile signed provider events.
All logical-message, outbox, and delivery-event polling is explicitly scoped
to the fixture organization and brand; exact brand-scoped email-log IDs are an
additional correlation boundary rather than a substitute for tenant filters.
The release follows the valid `scheduled → processing → completed` retirement
path, the member is cancelled and soft-deleted, and the tier is disabled.
Email logs, outbox records, delivery events, and audits remain durable.

Worker health and configuration probes carry the staging Access service-token
headers, reject redirects, and use a 15-second deadline. Resend domain and
webhook discovery traverses every cursor page before matching the exact target,
and every non-disabled sender identity on the acceptance brand must be verified.

The artifact contains booleans, counts, event names, verified DNS record
types, and SHA-256 digests of provider identifiers. It excludes credentials,
domain names, addresses, message content, raw provider identifiers, and
database fixture identifiers. Cleanup failure fails acceptance.

Provider/DNS provisioning remains a distinct protected operation. It must
bind an approved sending-domain and DNS-zone hash, use trusted default-branch
code, write the returned webhook signing secret directly into the staging
secret bundle, and retain sanitized evidence. Until that controller and its
target policy exist, operators provision the prerequisites under the runbook;
the acceptance controller fails closed when they are absent or mismatched.

A source-complete controller does not change Gate 8 status. Only successful
evidence from a reviewed exact staging candidate can mark the gate passed.

## Consequences

- Gate 8 proves the real deployed Cron, Resend delivery, and signed webhook
  path rather than a simulator or local shortcut.
- The opt-in run can wait until the next hour and should be disabled after its
  one-shot evidence is accepted.
- Activated Gate 8 runs consume a dedicated non-superseded job so another
  staging run cannot cancel fixture retirement and earlier deployment work
  cannot consume the cleanup timeout reserve.
- Synthetic staging records are retired without deleting immutable delivery
  or audit history.
- Missing, stale, or mismatched communications bindings stop deployment before
  the acceptance mutation begins.
- Production, live billing, real winery data, DNS mutation, and provider
  provisioning are outside this controller.
