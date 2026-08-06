# ADR: Retry exact staging runtime verification during Worker propagation

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Cloudflare accepted and deployed the exact Vinifera staging Worker version at
100% traffic, but an immediate workers.dev request still received the prior
placeholder response. The origin converged to the correct JSON health contract
within seconds. A single request therefore treated normal edge propagation as
a release failure even though the deployed version was correct.

## Decision

Retry the complete isolated staging runtime contract up to six times with a
two-second delay. A retry is allowed for transport, status, JSON, stale SHA,
configuration, or database-route validation failures. Evidence is written only
after one attempt passes health, required capabilities, the database-backed
route, and the exact packaged Git SHA together.

## Consequences

- Expected workers.dev propagation no longer causes a false-negative release.
- Mixed old/new endpoint responses cannot be combined into passing evidence.
- Exhausted retries retain fail-closed behavior and publish no live evidence.
- Production deployment and verification behavior is unchanged.
