# ADR: Domain-scoped service decomposition

**Date:** 2026-07-27
**Status:** Accepted

## Context

`server/services/core-club.ts` and `server/services/integrations.ts` previously
contained most club, member, fulfillment, provider, and integration behavior in
two files of more than 6,000 lines each. The files were conflict-heavy, obscured
domain ownership, and made it difficult to review dependency direction or
change one provider boundary independently.

The decomposition had to preserve the existing public service classes, import
paths, authorization, tenant scope, activation gates, provider behavior, and
error semantics. Route extraction was happening in parallel, so callers also
needed a stable transition boundary.

## Decision

1. Split the two monoliths into domain owners under `server/services/`:
   `members.ts`, `clubs.ts`, `easypost.ts`, `stripe.ts`, `orders.ts`,
   `comms.ts`, and `webhooks.ts`.
2. Keep the pre-existing `analytics.ts`, `compliance.ts`, `retention.ts`, and
   `production-foundation.ts` services as independent owners rather than
   moving unrelated behavior during the extraction.
3. Keep provider-runtime helpers that are shared by communications and webhook
   processing in the non-public `integration-runtime.ts` module. Keep Stripe
   request construction that is shared across payment owners in
   `stripe-runtime.ts`.
4. Preserve dependency direction:

   ```text
   easypost → members → clubs → stripe → orders

   integration-runtime → comms → webhooks
   analytics ──────────────────→ webhooks
   ```

   Lower-level modules must not import a downstream owner. Shared primitives
   belong in a neutral runtime or library module when reuse would otherwise
   introduce a cycle.
5. Retain `core-club.ts` and `integrations.ts` as re-export-only compatibility
   barrels. Production runtime and route modules import the extracted domain
   owner directly; compatibility barrels exist only for callers that have not
   yet transitioned.
6. Use `server/services/index.ts` as the public service barrel. Internal runtime
   helpers are not exported from it.
7. Treat the initial move as extraction-only. Behavior changes require their
   own reviewed requirement, tests, and changelog evidence rather than being
   hidden inside a structural move.

## Consequences

- Domain changes have smaller review and merge-conflict surfaces, and
  directory-scoped review can reason about provider and tenant boundaries.
- The inheritance chain remains compatible with the existing
  `ProductionCoreClubService` and `ProductionIntegrationService` API.
- Compatibility barrels add a temporary second import path. Static checks must
  keep the barrels export-only and prevent production runtime code from
  regressing to legacy imports.
- The explicit dependency direction prevents service cycles but can require a
  neutral shared module for truly cross-domain primitives.
- Existing duplicate helpers or divergent provider metadata are not silently
  consolidated by the extraction. Any later cleanup must prove behavior and
  compatibility separately.

## Alternatives Considered

- Keeping the monoliths was rejected because it retained conflict-heavy
  ownership and prevented domain-focused review.
- Rewriting the services around new interfaces was rejected because it would
  combine architecture and behavior changes without an equivalence baseline.
- Removing the old import paths immediately was rejected because concurrent
  route and service work needed a stable integration boundary.
- Allowing sibling services to import in either direction was rejected because
  it would make cycles likely and blur which domain owns a behavior.
- Exporting internal runtime helpers from the public barrel was rejected
  because it would expose implementation details and create symbol collisions.

## References

- [`docs/build-specs/bs-03-service-decomposition.md`](../build-specs/bs-03-service-decomposition.md)
- [`docs/build-specs/service-manifest.md`](../build-specs/service-manifest.md)
- [`docs/architecture.md`](../architecture.md)
- [`server/services/index.ts`](../../server/services/index.ts)
- [`server/services/core-club.ts`](../../server/services/core-club.ts)
- [`server/services/integrations.ts`](../../server/services/integrations.ts)
