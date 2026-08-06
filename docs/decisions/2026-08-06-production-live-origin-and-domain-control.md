# ADR: Production live origin and domain control

- **Date:** 2026-08-06
- **Status:** Accepted

## Context

Vinifera has two production-facing Cloudflare Pages projects with different
purposes. `vinifera.edstratumlabs.ai` is the public marketing and static
prototype surface. `vinifera-live.edstratumlabs.ai` is the application rollback
surface intended to become the production Worker origin after hosted activation
passes. Some mobile, Worker, and release-control configuration still treated
the marketing hostname as the production application origin. The protected
production controller could deploy Worker versions but could neither attach the
intended application hostname nor restore its Pages fallback. A failed hosted
smoke after deployment also stopped without automatically restoring the prior
sole-active Worker version.

## Decision

`https://vinifera-live.edstratumlabs.ai` is the canonical production
application origin for the Worker API, browser CORS, mobile API traffic,
Universal Links, Android App Links, and association files.
`https://vinifera.edstratumlabs.ai` remains the marketing and static prototype
hostname and is excluded from production Worker domain operations.

The protected production workflow adds two explicit domain operations:

- `attach-live-domain` attaches only `vinifera-live.edstratumlabs.ai` to the
  exact reviewed, sole-active production Worker version after policy hashes,
  release ancestry, immutable artifact, staging soak, target identity, current
  topology, and exact confirmation are revalidated. It verifies the exact
  Cloudflare Worker-domain record and then the complete hosted HTTPS health
  contract, which is the certificate-readiness proof available at the public
  boundary. If either check or the final marketing-content invariant fails, it
  removes the attempted Worker custom domain and restores the existing
  `vinifera-live` Pages hostname.
- `restore-live-pages` removes only that Worker custom domain and restores only
  that hostname to the authorized `vinifera-live` Pages project after the
  separate restore confirmation passes.

Gate 20 attachment additionally consumes a 90-day, exact-current-`main`
activation-exit artifact generated from the checked-in canonical ledger. The
artifact can be created only when Gates 1 through 19 occur exactly once and
each is `live-passed` with retained evidence. Readiness reports and pending
entries cannot satisfy this contract.

The domain controller is convergent across all valid restart states: Pages
active, Worker active, or neither attached. It rejects the invalid both-active
state. Attachment verifies the exact production revision, complete capability
profile, root, staff app, member portal, and both signed-mobile association
payloads. Restoration binds the retained Pages project to its approved
production branch and current production deployment, then verifies exact
checked-in root and prototype content digests. It does not depend on an
expiring staging artifact. Both directions re-establish and fully verify the
prior serving topology if the requested transition fails, and both hash the
separate marketing root/app/guide surfaces before and after mutation.
If a restore begins from the valid neither-attached state and Pages attachment
fails, recovery removes any partially visible Pages claim and verifies that the
hostname remains unowned; it never invents a Worker attachment that was absent
from the captured topology.

Before Gate 20, signed internal mobile builds use the allowlisted production
`workers.dev` origin and prove its exact revision plus the relevant association
payload before signing. The final canonical live hostname remains embedded in
the application identity and becomes routable only through Gate 20; this
removes the prior Gates 17/18-to-20 circular dependency.
Production Worker versions also use that pre-cutover Worker origin for
`APP_ORIGIN`, so emailed mobile Auth callbacks reach the same executable Worker
before the live hostname is attached. Browser CORS permits both the Worker
origin and the future live hostname.

Before a production Worker version deployment or explicit rollback, the
workflow captures the current sole-active version and its exact annotated Git
SHA. If either mutation command or its hosted smoke fails, the workflow
automatically restores that captured version, verifies it is again sole active,
and re-runs exact-revision core health before failing the release run.

Cloudflare domain identity is retained without inventing a certificate field;
successful bounded HTTPS probes provide the certificate readiness evidence.

## Consequences

Mobile builds and production browser/API configuration now agree on one
application origin. The marketing Pages project is not part of Gate 20 and
cannot be selected by the release policy. Gate 20 remains pending until the
protected operation is executed with current hosted evidence and the live
health/rollback result is retained. This decision does not implement or approve
Gate 19 live financial proof; billing cutover remains a separate protected
control plane.
