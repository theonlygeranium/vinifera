# ADR: Gate 16 protected hostname acceptance

**Date:** 2026-08-06
**Status:** Accepted

## Decision

Gate 16 uses a trusted-main protected controller with an independently
disabled one-shot switch and checked-in empty policy. A reviewed activation
policy binds the exact hostname, Cloudflare zone, fallback origin, staging
Supabase target by SHA-256. The exact evidence-manifest hash is supplied in
protected acceptance state only after the candidate is immutable, avoiding a
self-referential Git SHA while retaining exact-byte authorization. The manifest identifies one
organization, brand, provider hostname, expected public
branding, active ownership/hostname/certificate states, asset checks, the exact
candidate revision, and strict round-tripping RFC3339 observation and
certificate-expiry timestamps; the observation cannot be in the future.
Canonical `main` and `staging` are force-refreshed after dependency/test setup
and immediately after acceptance. A post-acceptance ref drift rewrites the
report to `passed: false` before the workflow fails, so retained evidence
cannot claim a stale authority snapshot.
Ref-refresh failures are invalidated identically, and a rewrite failure moves
the prior report outside the always-running uploader path.

The controller first uses a scoped Cloudflare token to read the exact zone,
custom-hostname record, certificate, and fallback-origin state. The provider
record ID, hostname, active statuses, per-host custom origin, and zone fallback origin must match the
reviewed manifest. A direct verified TLS handshake against the intended host,
rather than an assumed provider response field, must return the reviewed
future certificate expiry. It then requires the intended custom host's bounded `/api/health`
response to report the exact staging service, status, and candidate revision
with HSTS. Its bounded configuration response must report the SHA-256 hash of
the exact authorized staging Supabase origin, proving the deployed Worker is
bound to the reviewed database target. It then performs bounded live branding
probes against that host, a distinct sibling host, and a distinct unknown host.
Every host must report the same exact candidate revision and runtime database.
The intended host must return the exact expected custom brand plus hashed
organization and brand bindings, and the Cloudflare record's custom metadata
must bind the same brand. Both denied hosts must return
the unbranded canonical response. A separate HTTP probe must remain on the
same hostname while redirecting to HTTPS.
Positive HSTS `max-age` is parsed rather than inferred from the directive's
presence. The controller also downloads the actual portal document, exact web
manifest, at least two declared icons, and expected logo. It parses actual
`link` elements outside comments, scripts, and styles and requires a manifest
relationship whose resolved URL is the reviewed manifest URL. Each icon must
decode to dimensions matching one of its exact manifest `sizes` declarations. A real Chromium
navigation records every loaded request, DOM URL, and mixed-content console
message, plus request-failure and response status events, so HTTP resources or
failed/non-successful subresources introduced by linked CSS or application JavaScript
also fail. It rejects failed main navigation, any HTTP reference, missing manifest/icon, unavailable
asset, non-image response, mismatched icon dimensions, or image body that fails decoding. Every response
body is bounded while streaming and cancelled as soon as it exceeds its limit.
The application build ships the linked manifest and generates 192px and 512px
PNG icons from the reviewed mobile mark.

The Gate 16 repair also closes tenant-scope findings reached during full
Octopus review: default-brand lookup uses the existing tenant-aware RPC through
the authorized service-role client before the selected brand is rechecked
through the authenticated staff tenant boundary, and
brand creation plus optional profile fields use one atomic tenant-aware RPC;
every Avalara filing read carries organization and brand predicates; and
sender identity writes use a forward, authorization-checking RPC keyed by
organization and brand. Staff callers can set only sender name/address. The
RPC preserves verification state only for an unchanged active identity and
otherwise resets it to pending, leaving provider identity and verification
timestamps exclusively to the service-role verification seam. Phase 5 QA
loads uniquely allocated migration 035 and exercises both atomic rollback and sender-state rules.

## Consequences

DNS propagation alone cannot pass. Provider ownership, hostname, and
certificate states must all be active, and live routing denial is mandatory.
An evidence manifest cannot be reused for another candidate or substitute a
separate database secret for the Worker's observed runtime binding.
Manifest booleans cannot substitute for live Cloudflare or asset evidence. The
90-day artifact contains only hashes, IDs, expiry, and pass facts and sets
`completionClaimed` to `false`. The controller never creates or removes DNS or
Cloudflare resources.
The controller script and target policy are classified as authority-high-risk.
