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

Add a separate, explicit staging toggle,
`STAGING_HOSTED_GATE8_ACCEPTANCE_ENABLED`. When it is `true`, the protected
staging deployment validates all required communications bindings before
upload, deploys those bindings atomically with the reviewed Worker version,
and runs `scripts/hosted-gate8-acceptance.mjs` with a bounded 70-minute wait.
The staging job has a 90-minute timeout to accommodate the next real hourly
Cron Trigger plus deployment and evidence work.

The controller treats Resend as read-only. It inventories the configured
sending domain and exact `/api/webhooks/resend` staging endpoint through
official provider APIs, requires verified DKIM and SPF, enabled sending, all
supported email events, and a timing-safe signing-secret match. It never
creates or modifies provider or DNS resources.

The controller reuses the dedicated Gate 7 staging organization, creates one
uniquely addressed member, tier, and release, and invokes the canonical
`enqueue_due_email_triggers` RPC twice to prove logical idempotency. It then
waits for the deployed hourly Worker to complete two outbox records, attach two
distinct provider message identifiers, and reconcile signed provider events.
The release follows the valid `scheduled → processing → completed` retirement
path, the member is cancelled and soft-deleted, and the tier is disabled.
Email logs, outbox records, delivery events, and audits remain durable.

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
- Synthetic staging records are retired without deleting immutable delivery
  or audit history.
- Missing, stale, or mismatched communications bindings stop deployment before
  the acceptance mutation begins.
- Production, live billing, real winery data, DNS mutation, and provider
  provisioning are outside this controller.
