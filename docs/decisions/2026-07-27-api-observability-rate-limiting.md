# ADR: Worker error observability and native rate limiting

**Date:** 2026-07-27
**Status:** Accepted

## Context

The Express API did not have a request-correlated error boundary or an
application error-tracking integration. It also relied only on the
database-backed member magic-link limiter, leaving other public API route
groups without abuse controls.

Vinifera runs in Cloudflare Workers. A process-memory limiter would reset with
isolates and would not coordinate across them. The build specification
suggested `hono-rate-limiter`, but the API uses Express rather than Hono.
Cloudflare's native Rate Limiting binding is runtime-compatible and requires no
external credential.

## Decision

1. Wrap the Worker entry point with `@sentry/cloudflare`. The wrapper receives
   options only when `SENTRY_DSN` is configured, so source integration can ship
   without enabling a provider.
2. Disable default PII, cookies, bodies, query strings, user data, database
   query data, and stack-frame variables in Sentry's data-collection options.
   Strip exception and log messages in the final event hook while retaining
   error types and stack locations. Error events receive only safe request
   metadata and an optional opaque user or hashed session identifier.
3. Register one centralized Express error handler last. It maps known errors
   to a stable JSON envelope, emits request-correlated structured logs, and
   sends only 5xx failures to Sentry.
4. Use four Cloudflare native Rate Limiting bindings for auth, general API,
   webhook, and admin traffic. The supported 60-second window is used for all
   four policies: 20, 100, 500, and 30 requests respectively.
5. Scope each counter by normalized route plus tenant and also by normalized
   route plus a SHA-256 actor fingerprint. Valid brand UUIDs identify tenants;
   the request host is the fallback. Authorization, cookie, and IP material is
   hashed before it becomes a counter key.
6. Fail closed with `503 configuration_error` when a runtime binding is
   missing outside the test environment. Unit tests may omit bindings to keep
   existing route fixtures isolated.

## Consequences

- The Sentry integration is inert until an operator stores `SENTRY_DSN` as a
  Worker secret. No credential is committed.
- Native counters are per Cloudflare location and eventually consistent. They
  are appropriate for abuse protection, not billing, quotas, or exact global
  accounting.
- Cloudflare currently supports only 10-second and 60-second periods, so the
  auth policy is 20 requests per minute rather than the specification's
  illustrative 15-minute window. The existing PostgreSQL magic-link limiter
  continues to provide durable, longer-window protection for that workflow.
- General API middleware explicitly skips the specialized auth, admin, and
  webhook prefixes so their selected policies are not unintentionally
  overridden by the 100-per-minute API policy.
- Worker deployments must retain the four rate-limit bindings in every named
  environment. The static Pages production baseline is unaffected until the
  Worker activation gate is approved.
