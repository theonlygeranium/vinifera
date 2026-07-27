# BS-04 observability and rate-limiting QA report

**Date:** 2026-07-27
**Branch:** `feat/bs-04-observability-rate-limiting`
**Production activation:** Not performed

## Implemented scope

- Added an optional `@sentry/cloudflare` Worker wrapper. A missing
  `SENTRY_DSN` returns no SDK options, so Sentry remains disabled without a
  secret.
- Added a PII-minimized centralized error handler with request correlation,
  known error mapping, stable JSON responses, structured logs, and 5xx capture.
- Added native Cloudflare rate limiting for auth, general API, webhook, and
  admin routes. Each route checks both a tenant key and a hashed actor key.
- Added rate-limit bindings to the development, staging, and production
  Wrangler environments.
- Added focused unit coverage for Sentry gating, error mapping, response
  safety, request correlation, binding failures, route exclusions, and
  throttled responses.

## Middleware order

The Worker-level Sentry wrapper is the outer request boundary. Express applies
CORS first, then the specialized rate-limit middleware before route handlers.
Webhook paths retain their raw-body handlers because rate limiting does not
consume or parse request bodies. `errorHandler` is the final middleware
registered before `createApp` returns.

## Security review

- `SENTRY_DSN` appears only as a documented variable name or a synthetic
  placeholder. No provider credential is committed.
- Sentry data collection disables cookies, request and response bodies, URL
  query strings, default user information, database query data, generative-AI
  inputs and outputs, and stack-frame variables. Its final event hook removes
  exception and log messages while retaining error types and stack locations.
- Authorization, cookie, and IP material is SHA-256 hashed before use as a
  rate-limit or error-correlation identifier.
- Error responses do not include stack traces or unknown exception messages.
- Missing production rate-limit bindings fail closed.

## Platform limits

Cloudflare's native binding supports 10-second or 60-second periods. BS-04
therefore uses a 60-second period for all route groups, including the 20-request
auth policy. Counters are per Cloudflare location and eventually consistent;
they are abuse controls rather than exact billing or quota meters. The durable
member magic-link database limiter remains in place.

## Verification

| Check | Result |
|---|---|
| `npm audit --audit-level=moderate` | Passed; 0 vulnerabilities |
| `npm run typecheck` | Passed; Wrangler bindings generated and TypeScript clean |
| `npm run qa:worker-types` | Passed; generated declaration current |
| Focused BS-04 Vitest run | Passed; 13/13 tests in 3 files |
| `npm run test:unit` | Passed; 367/367 tests in 35 files |
| `npm run check` | Passed; aggregate type, binding, test, build, and Worker dry-run gate |
| `npm run build` | Passed; Vite/Worker Static Assets output built |
| `npm run build:pages` | Passed; static Pages rollback output retained |
| Development Worker dry run | Passed; all four rate-limit bindings recognized |
| Staging Worker dry run | Passed; all four isolated bindings recognized |
| Production Worker version dry run | Passed; all four isolated bindings recognized |
| `npm run qa:e2e` | Passed; 145/145 Playwright cases in 3.5 minutes with no axe failure |
| Changed-file credential-pattern scan | Passed; no real provider credential pattern found |
| `git diff --check` | Passed |

The browser suite covered 360, 375, 412, 430, 768, and 1440 pixel Phase 5
viewports as well as the Phase 1–4 responsive/accessibility gates. The 375
pixel mobile requirement and 44-by-44-pixel touch-target gate passed. BS-04
does not change a visual surface.

## Deployment impact and remaining activation

The source and Wrangler bindings are ready without provider credentials.
Sentry remains inactive until `SENTRY_DSN` is stored as a Worker secret. The
public custom domain continues to use the static Cloudflare Pages baseline;
this change does not authorize or perform a Worker deployment or domain
cutover.
