# Mobile activation acceptance — Gates 17 and 18

This runbook turns physical-device and internal-track observations into
fail-closed evidence for one exact production release. It does not build or
upload an app; use `Signed mobile internal release` first.

## One-time protected setup

1. Keep the `mobile-release` GitHub environment restricted to `main`.
2. Generate an Ed25519 evidence-signing key held by the test operator:

   ```bash
   openssl genpkey -algorithm ED25519 -out mobile-acceptance-private.pem
   openssl pkey -in mobile-acceptance-private.pem -pubout -out mobile-acceptance-public.pem
   ```

3. Base64-encode the public PEM without line wrapping and store it as the
   `mobile-release` environment secret
   `MOBILE_ACCEPTANCE_EVIDENCE_PUBLIC_KEY_PEM_BASE64`.
4. Hash the public key's DER representation, the normalized production API
   origin, the Android signing certificate, and the Apple distribution
   certificate:

   ```bash
   openssl pkey -pubin -in mobile-acceptance-public.pem -outform DER | shasum -a 256
   printf '%s' 'https://expected-production-origin.example' | shasum -a 256
   ```

   Normalize both signing certificates to DER before hashing. Record only the
   four lowercase SHA-256 values in
   `.github/mobile-acceptance/policy.json`, set `enabled` to `true`, and deliver
   that policy change through review and promotion before collecting evidence.

The checked-in policy is intentionally disabled with empty allowlists.

## Exact release prerequisite

Dispatch `Signed mobile internal release` from the current `main` commit. A
standalone Gate 17 rehearsal may use `build-only`, but the Gate 17 evidence
that Gate 18 consumes must use the same `upload-internal` run. Both Android and
iOS jobs must succeed and retain their sanitized evidence artifacts. Record
the workflow run ID.

The acceptance workflow rejects an ancestor release after `main` advances. If
the branch changes, build and test the new exact release.

## Gate 17 physical-device attestation

Copy `.github/mobile-acceptance/gate17-attestation.template.json` to a private
working directory.
Fill every field for the exact release:

- the current 40-character `main` SHA and signed-release run ID;
- the checked-in app ID, version name, and version code;
- a SHA-256 of the normalized production API origin;
- one iOS and one Android physical-device evidence-bundle SHA-256;
- the reviewed distribution-signing identity SHA-256 for each platform; and
- `true` only after every named behavior passed on that device.

The external evidence bundle should contain the operator's timestamped device
worksheet, screenshots or recordings, and sanitized logs. Do not add that raw
bundle to the repository or workflow input; retain it in the controlled test
record and submit only its SHA-256.

Sign the exact JSON bytes and prepare the two dispatch values:

```bash
openssl pkeyutl -sign -rawin \
  -inkey mobile-acceptance-private.pem \
  -in gate17-attestation.json \
  -out gate17-attestation.sig
base64 < gate17-attestation.json | tr -d '\n'
base64 < gate17-attestation.sig | tr -d '\n'
```

Dispatch `Mobile activation acceptance` from `main` with gate `17`, the exact
release SHA/run ID, an empty prior Gate 17 run, the two base64 values, and:

```text
ATTEST VINIFERA GATE 17 PHYSICAL DEVICE ACCEPTANCE
```

Gate 17 passes only when the workflow uploads
`gate17-mobile-acceptance-evidence` for that exact release.

## Gate 18 internal-track attestation

Wait until the same `upload-internal` release is processed and visible to the
configured internal testers. Install the iOS build through TestFlight and the
Android build through the Google Play internal track on physical devices.
Confirm the exact displayed version, successful launch, and store source.

Fill and sign `.github/mobile-acceptance/gate18-attestation.template.json`
using the same process.
Dispatch gate `18` with:

- the exact same release SHA and upload run ID;
- the successful Gate 17 acceptance run ID;
- the new signed attestation; and
- `ATTEST VINIFERA GATE 18 INTERNAL TRACK INSTALLS`.

Gate 18 fails if either platform was sideloaded, processing or installation is
incomplete, Gate 17 references another release, or any workflow coordinate is
stale or ambiguous.

## Retained evidence and QA

The workflow retains a 90-day artifact containing gate number, repository,
production environment marker, exact release SHA/run ID/action, attestation
and public-key hashes, timestamp, and `accepted: true`. It excludes raw device
records and platform identifiers.

Before enabling or dispatching the controller, run:

```bash
npm run qa:mobile-acceptance
npm run qa:mobile-release
npm run qa:mobile:identity
```

Gate 17 and Gate 18 remain pending until their respective protected hosted
runs and external evidence bundles pass. Local tests prove only controller
behavior.
