# ADR: Classify hosted target policy as authority-high-risk

**Date:** 2026-08-05
**Status:** Accepted

## Context

`config/hosted-target-allowlist.json` controls which normalized provider
targets may cross a protected hosted-activation boundary. The development
delivery classifier did not recognize this path, so an authorized staging
Cloudflare account-hash update failed closed as `unknown_path_fail_closed`
before selecting a validation lane.

## Decision

Classify `config/hosted-target-allowlist.json` as both high-risk and
authority-high-risk. A change to this policy therefore uses the `high-risk`
development lane, requires the Octopus boundary, and cannot fall through a
routine or documentation fast path. Retain unknown-path failure for every
other unclassified path.

## Consequences

- Reviewed hosted target-policy changes receive a valid, conservative CI lane.
- Exact type, build, focused test, and authority review evidence remain
  mandatory before merge.
- The classification changes no allowlist semantics and grants no provider
  authority by itself.

## Verification

- `.github/scripts/delivery-policy.policy.mjs`
- `tests/server/activation-hardening.test.mjs`
- `npm run check`
