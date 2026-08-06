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
  topology, and exact confirmation are revalidated. It waits for a valid
  Cloudflare-managed certificate and the complete hosted health contract. If
  either fails, it removes the attempted Worker custom domain and restores the
  existing `vinifera-live` Pages hostname.
- `restore-live-pages` removes only that Worker custom domain and restores only
  that hostname to the authorized `vinifera-live` Pages project after the
  separate restore confirmation passes.

Before a production Worker version deployment, the workflow captures the
current sole-active version. If the deployed version fails its hosted smoke,
the workflow automatically rolls back to that captured version, verifies it is
again sole active, and re-runs core health before failing the release run.

Certificate identifiers and topology evidence are retained only as sanitized
SHA-256 fingerprints and boolean readiness fields.

## Consequences

Mobile builds and production browser/API configuration now agree on one
application origin. The marketing Pages project is not part of Gate 20 and
cannot be selected by the release policy. Gate 20 remains pending until the
protected operation is executed with current hosted evidence and the live
health/rollback result is retained. This decision does not implement or approve
Gate 19 live financial proof; billing cutover remains a separate protected
control plane.
