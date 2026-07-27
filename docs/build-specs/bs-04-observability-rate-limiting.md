# BS-04 — Observability Integration & API Rate Limiting

**Wave:** 1 (start after BS-01 merges; runs concurrently with BS-02, BS-03)
**Branch:** `feat/observability-and-rate-limiting`
**Estimated duration:** 2–3 hours
**Parallel-safe:** Yes — touches only `app.ts` middleware registration and new files; BS-02 touches route files only
**Spawns subagents:** Optional — error tracking and rate limiting can be parallelized
**Blocks:** Production readiness (BS-05 depends on a working error boundary for local dev)

---

## Mandatory pre-task reading

1. `AGENTS.md`
2. `CONTINUITY_BRIEF.md` — note the activation gate for the live Worker (Gate 1); observability must be wired before Gate 1 passes
3. `docs/agent-workflow.md`
4. `docs/codebase-assessment-2026-07-27.md` §4 — issues H-1 (observability), H-2 (rate limiting)
5. `package.json` — verify which packages are already installed before adding dependencies

---

## Context: why this ships before activation

The Vinifera Worker has no structured error capture today. When Gate 1 passes and real traffic hits the Worker, any unhandled exception becomes a silent 500 returned to a member with no visibility into what failed. Wiring Sentry (or equivalent) and rate limiting before activation means the first real error produces an actionable alert rather than a confused member.

Rate limiting addresses a distinct risk: once the custom domain routes to the Worker, the API endpoints are publicly reachable without authentication. A misconfigured client or a bad actor can exhaust Cloudflare Worker invocation quota within minutes.

---

## Task 1: Install dependencies

Check `package.json` to determine which packages are already present. Install only what is missing:

```bash
npm install @sentry/cloudflare hono-rate-limiter
# or if a rate-limiting package already exists, do not install a duplicate
```

If `@sentry/cloudflare` is already listed, skip the install and proceed to configuration.

---

## Task 2: Create `server/lib/` directory

This is a new directory for shared infrastructure utilities — not services (which are business logic), not routes (which are HTTP handlers). It holds middleware, error boundaries, and instrumentation.

```
server/lib/
  sentry.ts         ← Sentry init and error handler
  rate-limit.ts     ← rate limit middleware factory
  error-handler.ts  ← centralized Express error handler
```

---

## Task 3: Implement Sentry error tracking (`server/lib/sentry.ts`)

```typescript
import * as Sentry from '@sentry/cloudflare'

export function initSentry(dsn: string, environment: string) {
  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
    // Do not capture PII — vinifera handles member personal data
    sendDefaultPii: false,
  })
}

export { Sentry }
```

The DSN must come from an environment variable — never hardcoded. Use `SENTRY_DSN` as the variable name. Add it to:
- `.dev.vars.example` (new file if absent) as `SENTRY_DSN=your-dsn-here`
- `wrangler.toml` under `[vars]` as a placeholder comment: `# SENTRY_DSN = "set via Cloudflare dashboard"`

**Critical:** the actual DSN value must never appear in any committed file. If `wrangler.toml` already contains a `SENTRY_DSN` value, redact it and document the redaction in the PR body.

---

## Task 4: Implement rate limiting middleware (`server/lib/rate-limit.ts`)

Create a configurable rate limit factory. The limits below are starting points derived from the expected usage pattern of a wine club (seasonal spikes, not sustained high-frequency API traffic):

```typescript
import { Ratelimit } from '@upstash/ratelimit' // or the package already in package.json
// If using Cloudflare's built-in rate limiting KV, use that instead

export function createRateLimiter(config: {
  windowMs: number
  max: number
  message: string
}) {
  // Return an Express-compatible middleware
  // Implementation depends on the rate limiting package already in the project
  // Read package.json before writing this — use what's already installed
}

// Preset rate limits for different route groups
export const rateLimits = {
  // Public endpoints — most restrictive
  auth: createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20, message: 'Too many auth attempts' }),
  // Member-facing API — moderate
  api: createRateLimiter({ windowMs: 60 * 1000, max: 100, message: 'Rate limit exceeded' }),
  // Webhook endpoints — generous (Stripe/EasyPost send bursts)
  webhooks: createRateLimiter({ windowMs: 60 * 1000, max: 500, message: 'Webhook rate limit exceeded' }),
  // Admin endpoints — restrictive by IP
  admin: createRateLimiter({ windowMs: 60 * 1000, max: 30, message: 'Admin rate limit exceeded' }),
}
```

---

## Task 5: Implement centralized error handler (`server/lib/error-handler.ts`)

Replace any ad-hoc try/catch error responses scattered across route handlers with a single Express error handler that:

1. Logs to Sentry with the request context (route, method, user ID if authenticated — no PII)
2. Maps error types to HTTP status codes:
   - `ZodError` → 400 with structured field errors
   - Authentication errors → 401
   - Authorization errors → 403
   - `RecordNotFoundError` (if this type exists) → 404
   - All others → 500
3. Returns a consistent JSON error envelope:

```typescript
{
  error: {
    code: string,       // machine-readable: "VALIDATION_ERROR", "NOT_FOUND", etc.
    message: string,    // human-readable, safe to display
    requestId: string,  // correlates with Sentry trace
    // NO stack traces in production responses
  }
}
```

---

## Task 6: Wire into `app.ts`

In `app.ts`, register the middleware in order:

```typescript
import { initSentry } from './lib/sentry'
import { rateLimits } from './lib/rate-limit'
import { errorHandler } from './lib/error-handler'

// 1. Init Sentry first (before routes)
if (env.SENTRY_DSN) {
  initSentry(env.SENTRY_DSN, env.ENVIRONMENT ?? 'development')
}

// 2. Apply rate limits by route group (after auth middleware but before route handlers)
app.use('/api/auth', rateLimits.auth)
app.use('/api/webhooks', rateLimits.webhooks)
app.use('/api/admin', rateLimits.admin)
app.use('/api', rateLimits.api)

// ... route mounting (from BS-02) ...

// 3. Centralized error handler (must be registered LAST)
app.use(errorHandler)
```

**Coordination note:** if BS-02 is not yet merged, add a comment `// TODO(BS-02): mount routers here once merged` in place of the route mounting block. Do not create a merge dependency — ship error handling independently.

---

## Task 7: Create `.dev.vars.example`

If this file does not already exist, create it at the repo root. It provides local developers with a template of required environment variables without exposing real values:

```
# Sentry
SENTRY_DSN=https://your-key@oX.ingest.sentry.io/your-project

# Environment
ENVIRONMENT=development

# Add other variables from wrangler.toml [vars] here
```

Add `.dev.vars` (without `.example`) to `.gitignore` if not already present.

---

## Task 8: Write tests for the error handler

Add `tests/unit/error-handler.test.ts`:

- Test that `ZodError` returns 400 with field-level error detail
- Test that an unknown `Error` returns 500 without a stack trace in the response body
- Test that the response body always includes a `requestId` field
- Test that Sentry capture is called for 500-level errors (mock Sentry in tests)

Minimum: 4 tests. These must pass in `npm run test:unit`.

---

## CHANGELOG entry

```markdown
### Added
- `server/lib/sentry.ts`: Sentry Cloudflare SDK initialization, gated on `SENTRY_DSN` env var
- `server/lib/rate-limit.ts`: Configurable rate limiting middleware with presets for auth, API, webhook, and admin route groups
- `server/lib/error-handler.ts`: Centralized Express error handler; maps ZodError → 400, auth errors → 401/403, unknown errors → 500; captures to Sentry; returns consistent JSON envelope
- `.dev.vars.example`: Template for local environment variables
- `tests/unit/error-handler.test.ts`: 4 tests covering error mapping, response structure, and Sentry capture
```

---

## Acceptance criteria

- [ ] `server/lib/sentry.ts`, `server/lib/rate-limit.ts`, `server/lib/error-handler.ts` all exist
- [ ] `SENTRY_DSN` is in `.dev.vars.example` and `.gitignore` blocks `.dev.vars`
- [ ] No DSN value is hardcoded in any committed file
- [ ] Rate limits are applied to `/api/auth`, `/api/webhooks`, `/api/admin`, `/api` in `app.ts`
- [ ] `errorHandler` is the last middleware registered in `app.ts`
- [ ] `npm run typecheck` passes
- [ ] `npm run test:unit` passes (352+ tests — new tests added here)
- [ ] `CHANGELOG.md` updated
- [ ] PR body explains the order-sensitive middleware registration and the Sentry gating logic

---

## Greptile workflow

After opening the PR:
1. Comment `@greptileai check that no real credentials appear in any file in this diff`
2. Comment `@greptileai verify the error handler is registered last in app.ts`
3. Greptile will apply Rule 3 (no provider secrets in source) from BS-01's `.greptile/rules.md` — any DSN or key that slipped through will be caught