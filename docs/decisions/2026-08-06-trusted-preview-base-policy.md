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

An isolated validation job with read-only repository permissions validates the
live same-repository PR identity, extracts
`.github/scripts/delivery-policy.mjs` from the exact base SHA, and imports it in
a subprocess whose environment contains neither GitHub credentials nor runner
output/control paths. That runner is discarded after classification.

A separate privileged job starts from a fresh trusted default-branch checkout,
re-downloads the exact candidate artifact, and revalidates its PR, head, base,
repository, applicability, and live-open state against the isolated job's
outputs. It never imports or executes the base policy or PR-head code. Only
after that revalidation may the job install the trusted Wrangler toolchain and
make Pages credentials available to the deploy step.

The artifact-supplied applicability must still equal the independently derived
base-policy result. Invalid metadata, a moved base/head, unknown paths under the
current base policy, or any classification error remains terminal.

## Consequences

- Preview classification follows the exact trusted policy governing the PR.
- `main`/`dev` promotion lag no longer creates false unknown-path failures.
- Base and PR-head code remain data-only beside Pages credentials.
- Existing emergency labels, same-repository checks, and exact-head evidence
  remain unchanged.

## Verification

- `node --test .github/scripts/delivery-policy.policy.mjs`
- `npm run check`
- `git diff --check`
