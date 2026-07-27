# ADR: Separate Rate-Limit and Member-Context Secrets

**Date:** 2026-07-27
**Status:** Accepted

## Context

The rate-limit IP hash and signed member-brand context serve different
security purposes. Their production paths previously permitted fallback to a
Supabase credential, another application secret, or a static placeholder.
That coupling could hide an incomplete deployment and expand the impact of one
secret's disclosure or rotation.

## Decision

`RATE_LIMIT_PEPPER` and `MEMBER_BRAND_CONTEXT_SECRET` are mandatory,
purpose-specific Worker secrets:

- each value is generated independently and contains at least 32 UTF-8 bytes;
- neither value has surrounding whitespace;
- the values must differ;
- runtime code does not fall back to provider credentials, static strings, or
  one another; and
- validation failures return a sanitized `configuration_error` without
  exposing secret material.

`server/lib/security-secrets.ts` owns the Worker-runtime contract. The
deployment-neutral `scripts/lib/security-secret-guard.mjs` enforces the same
constraints before staging secret upload and production release-bundle
assembly. The configuration health report exposes only configured/missing
binding names through its `security` capability.

The Worker owner keeps equality validation synchronous because both the
configuration report and dependent service entry points consume it
synchronously. Its bounded byte loop evaluates only validated values and
returns the same equality predicate as the Node deployment guard. The Node
guard hashes first because Node's `timingSafeEqual` requires equal-length
buffers; changing the Worker path to `crypto.subtle.digest` would make the
configuration API asynchronous without changing the accepted or rejected
secret set.

Tests use values created by `tests/fixtures/security-secrets.ts`. The fixture
is explicitly test-only, is not imported by runtime code, and prevents tests
from relying on production fallbacks.

## Consequences

Staging and production deployments must install and rotate the two bindings
independently. An environment that supplied only one value, reused a value, or
depended on a historical fallback becomes unavailable for the affected
operation and reports a sanitized configuration failure. This is intentional
fail-closed behavior.

The helper lives under `server/lib/`, so the BS-03 extracted services gain no
new service-to-service dependency or import cycle. No route, database schema,
Pages artifact, or provider endpoint changes.

## Deployment

Store local values only in ignored `.dev.vars`. Store hosted values as
environment-scoped encrypted GitHub/Cloudflare secrets:

```text
STAGING_RATE_LIMIT_PEPPER
STAGING_MEMBER_BRAND_CONTEXT_SECRET
PRODUCTION_RATE_LIMIT_PEPPER
PRODUCTION_MEMBER_BRAND_CONTEXT_SECRET
```

Never paste values into source, workflow logs, artifacts, or pull-request
discussion. Staging validates before `wrangler versions secret bulk`;
production validates before building its ephemeral secret bundle.

## Verification

```bash
npm run typecheck
npx vitest run tests/server/security-secrets.test.ts tests/scripts/security-secret-guard.test.mjs
npx vitest run tests/server/config.test.ts tests/server/member-auth-link-context.test.ts
npx vitest run tests/server/production-release.test.mjs tests/server/activation-hardening.test.mjs
npm run check
npm run qa:production-release
npm audit --audit-level=moderate
git diff --check
```

The focused `security-secrets` suite recursively scans `server/**/*.ts` and
requires the two binding identifiers to appear only in `server/types.ts` and
their neutral owner, `server/lib/security-secrets.ts`. Direct member and mobile
service-path tests additionally prove that provider credentials cannot replace
either binding.

## Reversal

Reversal requires an explicit replacement design that preserves
purpose-specific independent secrets. Reintroducing provider-key, static, or
cross-purpose fallbacks is not an acceptable rollback.
