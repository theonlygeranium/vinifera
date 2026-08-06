# ADR: Bind trusted preview policy to the exact PR base

- **Date:** 2026-08-06
- **Status:** Accepted
- **Decision owner:** EdStratum Labs human owner
- **Scope:** Trusted frontend preview evidence classification
- **Amends:** `2026-07-30-principal-orchestrator-candidate-delivery.md`

## Context

The preview publisher checks out trusted default-branch code, then validates an
unprivileged candidate artifact against the live pull request. The repository's
default branch is `main`, while agent pull requests target `dev`. When `dev`
adds reviewed delivery-policy paths before production promotion, `main`'s older
classifier can reject the exact PR diff as `unknown_path_fail_closed` even
though the PR workflow correctly classified it from its current base.

## Decision

After the publisher validates the live same-repository PR identity and fetches
its exact base and head commits, it extracts only
`.github/scripts/delivery-policy.mjs` from the validated base SHA into a
runner-local file. The publisher imports that base-policy module to classify
the base-to-head diff. It never imports or executes policy or application code
from the PR head.

The artifact-supplied applicability must still equal the independently derived
base-policy result. Invalid metadata, a moved base/head, unknown paths under the
current base policy, or any classification error remains terminal.

## Consequences

- Preview classification follows the exact trusted policy governing the PR.
- `main`/`dev` promotion lag no longer creates false unknown-path failures.
- PR-head code remains data-only beside Pages credentials.
- Existing emergency labels, same-repository checks, and exact-head evidence
  remain unchanged.

## Verification

- `node --test .github/scripts/delivery-policy.policy.mjs`
- `npm run check`
- `git diff --check`
