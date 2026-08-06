# ADR: Align staging Auth callbacks with the isolated Worker origin

- **Status:** Accepted
- **Date:** 2026-08-06

## Context

Gate 2 deploys and verifies the application on a dedicated staging-account
`workers.dev` origin. The release command still configured `APP_ORIGIN` and
browser CORS with a staging custom hostname that has not been attached to that
Worker. Staff and member Auth therefore generated callbacks on a different
origin from the deployed application and its host-only cookies.

## Decision

Until custom-hostname Gate 16 passes, the protected staging release controller
uses `STAGING_WORKER_ORIGIN` for `APP_ORIGIN`, Auth callbacks, and the browser
CORS allowlist. The configured value must continue to pass the existing
isolated `vinifera-staging` `workers.dev` validation. Production origin and
custom-domain controls are unchanged.

## Consequences

- Hosted staff and member Auth complete on the same isolated origin that issued
  their cookies.
- Staging browser mutations use the verified deployed origin rather than an
  unattached hostname.
- Gate 16 remains the only path that can introduce a winery custom hostname.
- Production routing, DNS, and callback configuration are unchanged.
