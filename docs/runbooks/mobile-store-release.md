# Signed mobile build and internal-store release

Normal CI proves that the Capacitor shells compile. It does not contain signing
credentials and is not store evidence. This runbook uses the protected
`mobile-release` GitHub environment to build signed artifacts and, only with a
second confirmation, deliver them to Google Play internal and Apple TestFlight.

Vinifera manages memberships and physical wine shipments. The native shells
reuse the same HTTPS application/API and do not embed alternate payment or
downloaded-code paths.

## Authorization

The workflow is manual and accepts:

- a full immutable commit SHA already contained in `main`;
- `build-only` or `upload-internal`;
- `BUILD SIGNED VINIFERA MOBILE RELEASE`; and
- for upload only, `UPLOAD VINIFERA MOBILE INTERNAL TRACKS`.

The workflow is restricted to `theonlygeranium/vinifera`, checks out that exact
SHA on every runner, and requires it to be an ancestor of `origin/main`.
`mobile-release` should require a human reviewer and should not permit
self-review.

Both platforms force:

```text
MOBILE_BUILD_PROFILE=production-authorized
MOBILE_PRODUCTION_ORIGIN_AUTHORIZED=true
VITE_MOBILE_API_ORIGIN=https://vinifera.edstratumlabs.ai
```

Any other origin fails before signing.

## Android credentials

Add these encrypted `mobile-release` secrets:

```text
MOBILE_ANDROID_KEYSTORE_BASE64
MOBILE_ANDROID_KEYSTORE_PASSWORD
MOBILE_ANDROID_KEY_ALIAS
MOBILE_ANDROID_KEY_PASSWORD
MOBILE_ANDROID_PACKAGE_NAME=ai.edstratumlabs.vinifera
MOBILE_ANDROID_SIGNING_CERT_SHA256
MOBILE_GOOGLE_SERVICES_JSON_BASE64
GOOGLE_PLAY_RELEASE_SERVICE_ACCOUNT_JSON_BASE64  # upload-internal only
```

Encode binary/JSON files without line wrapping before adding them. The release
service account should be dedicated to this app and granted only the permission
needed to upload and release to the internal track.

The workflow:

1. validates the package ID and production-origin policy;
2. writes the upload keystore and `google-services.json` to ephemeral paths;
3. compares the keystore alias certificate SHA-256 fingerprint to the approved
   secret;
4. runs the signed `bundleRelease` task;
5. verifies the AAB with `jarsigner -verify -strict`; and
6. retains the signed AAB for seven days.

The Gradle build permits unsigned `assembleRelease` for compile-only CI but
refuses `bundleRelease` when signing variables are absent or partial.

For `upload-internal`, the release script uses Google's official APIs directly:

```text
OAuth service-account token
  → create edit
  → upload AAB
  → update fixed internal track
  → commit edit
```

Commit occurs only after a successful internal-track update. The workflow
cannot select alpha, beta, or production.

## iOS credentials

Add these encrypted `mobile-release` secrets:

```text
MOBILE_IOS_DISTRIBUTION_CERTIFICATE_BASE64
MOBILE_IOS_DISTRIBUTION_CERTIFICATE_PASSWORD
MOBILE_IOS_APP_STORE_PROFILE_BASE64
MOBILE_IOS_BUNDLE_ID=ai.edstratumlabs.vinifera
MOBILE_APPLE_TEAM_ID
APP_STORE_CONNECT_API_KEY_ID                 # upload-internal only
APP_STORE_CONNECT_ISSUER_ID                  # upload-internal only
APP_STORE_CONNECT_API_PRIVATE_KEY_BASE64     # upload-internal only
```

Use an Apple Distribution certificate, an unexpired App Store provisioning
profile for the exact team and bundle, and a team App Store Connect API key.
The upload tooling does not use an Apple ID password.

The macOS runner:

1. creates an ephemeral keychain;
2. imports the distribution certificate and decodes the profile;
3. verifies team, bundle/application ID, UUID, expiration, and
   `get-task-allow=false`;
4. archives with manual signing;
5. exports an `app-store-connect` IPA marked
   `testFlightInternalTestingOnly=true`;
6. verifies the app signature, bundle ID, and signed application identifier;
   and
7. retains the signed IPA for seven days.

For `upload-internal`, the API private key is written only under an ephemeral
App Store Connect key directory. `xcrun altool` validates the IPA before
uploading it. A successful upload proves delivery to App Store Connect; wait
for processing and verify internal TestFlight availability separately.

## Cleanup and evidence

Always-run steps delete:

- `android/app/google-services.json`;
- the decoded Android keystore and temporary logs;
- the installed iOS provisioning profile;
- the ephemeral Apple keychain, certificate, API key, archive, and extracted
  app; and
- all runner-temporary signing directories.

Evidence artifacts contain only the immutable Git SHA, platform, action,
signed-build result, signature-verification result, and internal-upload result.
They exclude provider response bodies, edit IDs, access tokens, email
identities, certificate material, and private keys.

## QA after upload

Install from the actual TestFlight and Play internal tracks on physical devices
and record:

- exact build/version and signed store source;
- magic-link handoff and brand disambiguation;
- secure-storage persistence and session revocation;
- biometric/device-credential fallback and foreground relock;
- APNs/FCM foreground/background delivery;
- camera barcode permission and scanning;
- offline read-only restore and reconnect behavior;
- 375 px-equivalent layout, VoiceOver/TalkBack, Dynamic Type/font scaling, and
  44 px touch targets; and
- production API health with Stripe still in test mode.

Do not describe a signed build as store-installed until both internal tracks
and physical-device evidence are retained. Public store submission and Stripe
live billing are separate human-approved decisions.

## Rotation

If a signing or store credential may be exposed:

1. stop the `mobile-release` environment;
2. revoke/rotate the provider credential or upload key;
3. replace the GitHub environment secret;
4. review the store's signing-key recovery rules before creating a new
   keystore; and
5. run `build-only` before authorizing another internal upload.
