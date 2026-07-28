# ADR: Align staging controls with the staging branch

- **Date:** 2026-07-28
- **Status:** Accepted

## Context

Vinifera now promotes `dev` to `staging` and then `staging` to `main`, but the
staging deployment workflow, Stripe test-catalog workflow, and GitHub
`staging` environment were still restricted to `main`. A read-only readiness
dispatch from `staging` therefore failed before its first step, and a push to
the promoted `staging` branch did not invoke the staging deployment pipeline.

## Decision

- Trigger the quality and optional staging deployment pipeline on pushes to
  `staging`.
- Bind the Stripe test-catalog workflow to the exact immutable head of
  `origin/staging`.
- Restrict the GitHub `staging` environment to the `staging` branch.
- Keep production Worker, live-billing, credential-rotation, and mobile-release
  controls bound to `main`.
- Retain pull-request quality validation for all PR bases; optional staging
  mutation jobs remain disabled for pull-request events.

## Consequences

The human-controlled `dev` to `staging` promotion becomes the only branch path
that can obtain staging credentials. Production controls cannot consume those
credentials through `main`, and staging cannot obtain production or
mobile-release authority. Updating the GitHub environment branch policy is an
external configuration step and must be recorded with the verification
evidence for this change.

No migration, Worker deployment, Stripe mutation, or production cutover occurs
from this source change alone. Existing activation variables, target hashes,
environment secrets, required review, and exact confirmations continue to fail
closed.
