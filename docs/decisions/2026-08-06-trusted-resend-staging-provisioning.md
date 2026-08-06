# ADR: Provision staging Resend and DNS through exact hashed targets

- **Status:** Accepted
- **Date:** 2026-08-06

## Context

Gate 8 needs a verified Resend sending domain, a signed webhook bound to the
isolated staging Worker, and exact DNS records. The generated DKIM, SPF,
return-path, and tracking values cannot be approved before Resend creates or
inventories the domain, while DNS mutation must not proceed from an unreviewed
provider response.

The webhook signing secret must reach the protected staging Worker bundle
without appearing in logs or artifacts. Provider and DNS mutations must execute
trusted default-branch code and fail closed on ambiguous existing resources,
stale target policy, or an unrelated Cloudflare zone.

## Decision

Add a manual workflow using the main-branch-only
`staging-acceptance-control` environment that executes only an immutable commit
equal to canonical `main`. It uses a full-access Resend provisioning credential,
Cloudflare credentials, the protected staging Worker origin, exact operation
confirmation, and `config/resend-staging-provisioning-policy.json`. The runtime
Worker never receives the provisioning credential.

The policy ships disabled with empty hashes. Enabling it requires exactly one
reviewed SHA-256 hash for the Cloudflare account, Cloudflare zone, Resend sending
domain, and exact staging `/api/webhooks/resend` endpoint. Bootstrap also creates
one `sending_access` runtime API key with Resend's exact `domain_id` restriction;
its returned ID hash joins the generated DNS hashes in the second reviewed
policy change. No guessed hashes are committed. The delivery classifier treats
the policy, provisioning controller, and workflow as authority-high-risk, so a
hash-only or control-path change cannot bypass exact-head Octopus review.

Provisioning uses four operations:

1. `probe` inventories exact targets without mutation.
2. `bootstrap` idempotently creates or inventories the domain and webhook,
   creates or inventories the webhook, creates the separate domain-restricted
   sending-only runtime key when absent, normalizes the provider-generated DNS
   tuples, and publishes only provider/key IDs and DNS name/value hashes, type,
   priority, and non-sensitive label. It does not write DNS.
3. A reviewed policy change adds the runtime-key ID hash and every exact returned
   DNS tuple. `apply` then
   requires complete set equality, creates only absent DNS records, refuses to
   overwrite conflicts, requests asynchronous Resend verification, and requires
   the verified domain, records, sending capability, and webhook contract.
4. `verify` performs the same provider and Cloudflare inventory without
   mutation and requires every readiness condition.

After any mutation, the controller discards mutation responses as readiness
proof. It refetches the exact Resend domain, webhook, and runtime-key inventory,
re-inventories the Cloudflare zone and every DNS record, and derives readiness
only from those post-mutation reads. Existing provider DNS records must match
the normalized tuple and report `proxied: false`; trailing DNS dots are removed
before suffix checks and comparisons.

Domain, webhook, and runtime-key inventory traverses every Resend cursor page
before matching and must resolve to zero or one exact resource; duplicates
fail. Creation is forbidden until the complete inventory proves absence.
Existing webhooks are updated only under `bootstrap` or `apply` to the exact
endpoint, enabled state, and complete application email event set. No provider
or DNS deletion is supported.

During bootstrap, the full-access provisioning key creates the domain-scoped,
sending-only runtime key. The controller streams only that runtime token and the
official webhook signing secret to `gh secret set` over stdin. Before an
omitted webhook ID can require another provider request, the controller stores
the one-time signing secret and exact endpoint hash together in one protected
recovery envelope. It then stores the signing secret in `staging`, binds the
webhook ID hash in the main-only `staging-acceptance-control` environment, and
removes the recovery envelope. An interrupted ID lookup can therefore resume
only against the single exact inventoried endpoint, while a recoverable failed
write deletes the just-created webhook. The controller requires the exact ID
binding or this controlled recovery before accepting any inventoried webhook.
It never writes the provisioning key to a Worker
binding. A stable unsubscribe signing secret is supplied by the trusted
controller environment and copied unchanged on every retry; the controller
never generates or rotates it. Because Resend exposes a newly created runtime
token only once, the controller first persists the token and exact domain-ID
hash in one protected recovery envelope before missing-ID inventory, DNS work,
or any other fallible postcheck. It then writes `STAGING_RESEND_API_KEY`, binds
the exact provider-key ID hash, and removes the recovery envelope. A protected
bootstrap retry can therefore finalize the single exact inventoried runtime-key
name after an interrupted ID lookup. A failed token write deletes only the API
key created by that attempt when its ID can be recovered. The same rollback
covers a missing or malformed one-time token response. The
staging deployment workflow already maps these environment
secrets into its immutable Worker version upload.

Evidence contains the validated exact git SHA, policy-file digest, canonical
repository, workflow run ID/attempt, target hashes, provider/runtime-key
identifier hashes, DNS tuple hashes, dispositions, event names, post-read
readiness booleans, and secret names only. It excludes credentials, signing
secrets, domains, endpoint hosts, DNS values, and raw provider identifiers.

Source completion does not mark Gate 8 passed. The exact target hashes, provider
bootstrap evidence, reviewed DNS tuple policy, successful apply/verify run, and
separate real lifecycle acceptance remain required.

## Consequences

- Generated DNS values cross a reviewed policy boundary before DNS mutation.
- Re-running bootstrap/apply is idempotent for exact resources and fails on
  ambiguity or conflicting DNS instead of overwriting it.
- The webhook secret never crosses a workflow output, shell log, or artifact.
- A missing webhook ID cannot strand its one-time signing secret: the exact
  endpoint-bound recovery envelope is durable before inventory and removed
  only after the runtime secret and ID binding are durable.
- A missing runtime-key ID follows the same two-phase contract with an exact
  domain-bound token envelope; existing keys require the persisted ID binding
  or that controlled bootstrap recovery.
- The Worker receives only a domain-restricted `sending_access` credential, not
  the provisioning administrator credential.
- The operation cannot run from pull-request code, staging code, or a stale
  default-branch commit.
- DNS/domain ownership mutation remains protected by the separate main-only
  acceptance-control environment and explicitly confirmed; the staging
  deployment environment's branch policy is not broadened.
