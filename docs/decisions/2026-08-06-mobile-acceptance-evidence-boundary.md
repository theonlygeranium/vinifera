# ADR: Signed exact-release evidence for mobile activation

**Date:** 2026-08-06
**Status:** Accepted for source implementation; activation remains disabled

## Context

The signed mobile release workflow proves that Android and iOS artifacts were
built, signature-checked, and optionally uploaded. Those facts do not prove
physical-device behavior, App Store Connect or Google Play processing, or an
installation from either internal track. Gates 17 and 18 therefore need an
acceptance boundary that cannot convert build or upload success into a hosted
gate pass.

Physical-device output can contain device and tester details that do not
belong in GitHub logs. The retained gate artifact should identify the exact
release while retaining only integrity hashes.

## Decision

Add one protected, manual `Mobile activation acceptance` controller with two
separate modes:

- Gate 17 accepts a signed, schema-strict attestation covering one iOS and one
  Android physical device, all required mobile behaviors, APNs/FCM identity,
  the authorized API origin, distribution-signing identities, and the exact
  signed-release run and current `main` commit.
- Gate 18 accepts a separate signed attestation for processed, installed, and
  launched TestFlight and Play internal-track builds. It additionally requires
  the successful Gate 17 run and the same successful `upload-internal` release
  run for the same commit.

The controller runs only from the protected `mobile-release` environment and
current canonical `main`. It revalidates the merged `staging → main` promotion
and emergency labels both before evidence processing and immediately before
acceptance publication, plus the exact workflow name/path/repository/branch/SHA/run ID,
and the signed release evidence for both platforms. Attestations use Ed25519;
the public key, API origin, and both signing identities must match reviewed
SHA-256 allowlists. Unknown fields, stale evidence, missing checks, duplicate
platforms, direct installs for Gate 18, and partial results fail closed.

The checked-in policy is disabled and its allowlists are empty. Activation
requires a reviewed policy update and the protected public-key secret. The
controller performs no signing, provider upload, device operation, store
submission, merge, promotion, or gate-status mutation.

## Consequences

- Signed-build, physical-device, and internal-track evidence remain distinct.
- Gate 18 is cryptographically and operationally downstream of Gate 17 for the
  exact same release.
- Raw screenshots, logs, device identifiers, push tokens, and tester identities
  remain outside GitHub; the retained 90-day artifact contains only hashes and
  exact release coordinates.
- Any advance of `main`, release rebuild, signing-identity change, or API-origin
  change requires a fresh exact-release acceptance sequence.
