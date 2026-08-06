# ADR: Use a configured staging origin when Wrangler omits a preview URL

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

The protected staging activation uploads an immutable Worker version before
deploying it. Wrangler 4.118 successfully uploaded the exact candidate to the
dedicated staging account and returned one Worker version ID, but it did not
emit a `Version Preview URL`. The shared production parser intentionally
requires both values, so the staging workflow stopped after upload and before
traffic deployment even though the version and bindings were valid.

## Decision

Keep the production upload parser unchanged. Add a staging-only parser that
requires exactly one version ID, accepts at most one emitted preview URL, and
otherwise uses the protected GitHub environment variable
`STAGING_WORKER_ORIGIN`. The workflow still verifies the deployed runtime at
that origin against the exact packaged Git SHA before recording live evidence.

## Consequences

- Staging remains compatible with Wrangler output that omits a preview URL.
- A missing or invalid configured origin fails closed before deployment.
- Production release parsing retains its stricter explicit-preview contract.
- The staging Worker origin is operational configuration, not a credential.
