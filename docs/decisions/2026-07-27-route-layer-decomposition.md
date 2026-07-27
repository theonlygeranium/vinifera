# ADR: Domain-scoped Express route layer

**Date:** 2026-07-27
**Status:** Accepted

## Context

`server/app.ts` previously combined global middleware, shared request helpers,
service selection, validation schemas, and all 129 HTTP route registrations in
one file. The monolith made route ownership unclear, increased merge conflicts,
and prevented directory-scoped review rules from evaluating the HTTP boundary
independently.

The decomposition must preserve the existing public-versus-protected ordering.
In particular, signed provider webhooks require their raw request body before
global JSON parsing, while protected routes require trusted-origin and
authentication middleware. BS-04 also requires route-group rate limits before
handlers and one centralized error handler after the API fallback.

## Decision

1. Keep `server/app.ts` as the global middleware and ordered-mounting entry
   point. It owns Helmet, security headers, CORS, Cloudflare rate-limit
   middleware, JSON parsing, trusted-origin enforcement, and authentication
   presence.
2. Group route registrations by application domain under `server/routes/`:
   analytics, auth, billing, compliance, fulfillment, integrations,
   intelligence, members, mobile, releases, retention, system, tiers, and
   webhooks.
3. Preserve absolute route paths inside each router and mount the routers in
   their original registration order. This keeps overlapping and callback
   paths behaviorally equivalent to the pre-decomposition application.
4. Export three ordering functions from `server/routes/index.ts`:
   `mountPublicRoutes`, `mountRoutes`, and `mountRouteErrors`.
   `mountPublicRoutes` runs before JSON parsing so raw webhook signatures remain
   verifiable. `mountRoutes` runs only after origin and authentication checks.
   `mountRouteErrors` installs the `/api` 404 boundary and then the shared
   centralized error handler as the final middleware.
5. Use `RouteContext` from `server/routes/shared.ts` to carry the injected
   service factory, environment access, and the existing service capability
   selectors into domain routers. Selectors remain request-scoped and preserve
   the existing fail-closed `activation_required` behavior.
6. Keep route modules limited to HTTP concerns: input validation, request
   normalization, service invocation, and response serialization. They must
   not import a Supabase client directly. Inline business logic retained for
   extraction fidelity is marked for BS-03 service-layer movement.

## Consequences

- `server/app.ts` remains below the BS-02 100-line limit while retaining the
  global, order-sensitive middleware boundary.
- Route domains can be reviewed and changed independently without weakening
  raw-body, origin, authentication, rate-limit, fallback, or error-handling
  guarantees.
- `RouteContext` avoids circular imports and keeps tests able to inject service
  implementations without activating external providers.
- Absolute paths make extraction equivalence explicit, but route prefixes are
  not encapsulated by `app.use(prefix, router)`. A future prefix refactor would
  require a separate manifest comparison and behavior review.
- Some route modules temporarily retain normalization logic identified in the
  route manifest. BS-03 owns moving that logic into domain services.

## Alternatives Considered

- Keeping the monolithic application file was rejected because it preserves
  conflict-heavy ownership and obscures route-layer review boundaries.
- Mounting every router at a shortened prefix was rejected for this extraction
  because it would rewrite path declarations and increase ordering risk.
- Constructing services inside each route module was rejected because it would
  duplicate activation checks and weaken dependency injection in tests.
- Moving business logic during route extraction was rejected because
  structural and behavioral changes would be difficult to verify separately.

## References

- [`docs/build-specs/bs-02-route-decomposition.md`](../build-specs/bs-02-route-decomposition.md)
- [`docs/build-specs/route-manifest.md`](../build-specs/route-manifest.md)
- [`server/app.ts`](../../server/app.ts)
- [`server/routes/index.ts`](../../server/routes/index.ts)
- [`server/routes/shared.ts`](../../server/routes/shared.ts)
