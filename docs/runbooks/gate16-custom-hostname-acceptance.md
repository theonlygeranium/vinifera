# Gate 16 custom-hostname acceptance

First complete the custom-domain activation steps in
`phase-5-provider-mobile-activation.md`. Prepare one compact manifest with the
organization, brand, provider hostname ID, intended custom
host, distinct sibling and unknown probe hosts, Cloudflare zone, fallback
origin, staging Supabase URL, exact expected branding, provider ownership and
certificate states, certificate expiry, and mixed-content/manifest checks.
The manifest must also contain the exact candidate revision and a non-future,
strictly round-tripping RFC3339 `observedAt` timestamp, plus canonical `assets.portalPath`,
`assets.webManifestPath`, and at least two distinct `assets.iconPaths` values.

Hash every stable target named by the policy. In one reviewed control change,
enable the policy and add exactly one value per target hash. To derive those
hashes directly from your acceptance manifest without normalization mistakes,
run `npm run ops:gate-policy-hash -- gate16 --manifest <file>`; it validates the
manifest with the controller's own `validateManifest` and prints a paste-ready
policy object. After the
candidate is immutable, set `STAGING_GATE16_ACCEPTANCE_ENABLED=true` and the
manifest plus `STAGING_GATE16_ACCEPTANCE_MANIFEST_SHA256` secrets
(`npm run ops:gate-policy-hash -- manifest-sha256 --manifest <file>`) in
`staging-acceptance-control` only for the run. This preserves exact manifest
authorization without requiring the containing commit SHA to hash itself.
Provide its scoped
`CLOUDFLARE_API_TOKEN` secret so the controller can read the exact zone's
custom-hostname record and fallback origin.

Dispatch `Gate 16 custom hostname acceptance` from canonical `main` with its
exact control SHA, current exact `staging` SHA, and confirmation
`RUN VINIFERA GATE 16 CUSTOM HOSTNAME ACCEPTANCE`. Preserve the sanitized
90-day artifact. The controller force-refreshes canonical `main` and `staging`
after dependency/test setup and again after live acceptance. If either ref
drifts before artifact retention, it rewrites the report as failed and stops
instead of retaining stale passing evidence. Ref-refresh failures take the
same invalidation path; if report rewriting fails, the prior passing report is
moved outside the uploader path. Then disable the one-shot switch and policy in the next
reviewed change. The custom hostname itself must expose `/api/health` with the
exact staging marker, service, healthy status, and dispatched candidate SHA;
its `/api/health/configuration` response must report the SHA-256 hash of the
same authorized staging Supabase origin. The staging branch reference and a
separately supplied database URL are not runtime proof.
The run also requires the live Cloudflare record and certificate to be active,
its brand metadata and the public branding identity digests to match the
manifest, every denial host to serve the same candidate/database runtime,
the record-level custom origin and zone fallback origin to match, an exact
HTTP-to-default-HTTPS redirect that preserves path and query, a positive HSTS
max-age, and successful bounded fetches of the portal, web manifest, every
authorized icon, and expected logo. The portal must contain an actual parsed
`link[rel~=manifest]` whose resolved URL is the authorized manifest URL; text
inside comments, scripts, or styles is not evidence. Every image body must
decode successfully, and each icon's decoded dimensions must match one of its
exact manifest `sizes` declarations; an image content type alone is insufficient evidence. The canonical build
ships `/manifest.webmanifest` and generates `/icons/vinifera-192.png` and
`/icons/vinifera-512.png`; use those exact paths unless a reviewed branded
asset set replaces them. Body limits are enforced during streaming, not after
the complete response has been buffered.
The associated migration must be applied before the candidate is deployed:
brand creation and optional profile values are one transaction, while staff
sender updates expose no provider-status fields. Unchanged sender values keep
the service-owned verification result; changed or re-enabled values return to
pending verification. `npm run qa:db:phase5` loads uniquely allocated migration 035 and proves
both boundaries before hosted acceptance.
It verifies the served certificate expiry through a direct TLS handshake and
runs Chromium against the portal to reject mixed content loaded from linked
stylesheets, scripts, runtime DOM changes, or other browser requests. The
browser proof also rejects a failed main navigation, network-failed
subresources, and every non-successful JavaScript/CSS/image response.
Checked manifest booleans are not accepted as evidence.

Gate 16 remains blocked until an actual winery hostname has completed DNS
ownership and Cloudflare certificate activation and the three live host probes
can execute.
