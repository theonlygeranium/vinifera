# Gate 14 integration acceptance

Complete the provider-specific steps in
`phase-5-provider-mobile-activation.md`, then prepare one compact evidence
manifest for a single organization and brand. Include the exact candidate SHA
and observation time, active keyring version, four distinct connection IDs and
the complete key-version list, runtime-supported version-1 encrypted-envelope
metadata, exact Avalara partial/completing tax reductions and liability totals,
with each adjacent liability difference equal to its corresponding observed
refund tax reduction,
and interrupted-provider checkpoint resume counts, all four mapped Meta event
lifecycles with stable event-ID hashes and Events Manager observations, plus every
Klaviyo, QuickBooks, Avalara, and Meta lifecycle fact enforced by
`hosted-gate14-integration-acceptance.mjs`. The manifest contains no raw
credential, token, provider payload, member identifier, or customer record.

Hash the immutable acceptance scope (tenant/brand, keyring-version
bindings, connection IDs, and encrypted-envelope digests), isolated staging
Worker origin, and staging Supabase URL. In a reviewed change, add exactly one
hash per binding and set the policy `enabled` flag. The observation timestamp
and provider results are deliberately outside that immutable scope so a fresh
manifest can be collected after policy promotion. Configure
`STAGING_GATE14_ACCEPTANCE_ENABLED=true` and the fresh manifest secret in
`staging-acceptance-control` only for the run.

The observation must be a strictly round-tripping, timezone-qualified RFC3339
instant no more than 30 minutes old. The shared runtime
configuration endpoint from the Phase 4 acceptance control must validate the
deployed 256-bit keyring, decrypt the four exact accepted connection envelopes,
and report both the connection-ID-set hash and a tenant/provider/envelope-scope
hash (organization, brand, provider, connection, ciphertext, and key-version
and IV digests) plus the Supabase origin,
active-key-version, and complete key-version-set hashes. Provision the four
accepted encrypted envelopes and their contexts in
`STAGING_INTEGRATION_CREDENTIAL_ACCEPTANCE_PROOFS`;
the controller also reads the four exact tenant/brand-scoped active, opted-in
connections and encrypted envelopes from staging Supabase with the protected
service role plus the staging Cloudflare Access service-token headers, through
an inner connection relation filtered by organization and
brand before rows are returned, and requires their ciphertext/IV/key-version scope to match the
runtime decryption proof. The report exposes only hashes and never plaintext
or envelope bytes. Dispatch
`Gate 14 integration acceptance` from canonical `main` using its
exact control SHA, current exact `staging` merge SHA, the deployed promotion
candidate SHA whose tree must equal staging, and confirmation
`RUN VINIFERA GATE 14 INTEGRATION ACCEPTANCE`. Preserve the sanitized 90-day
artifact, then disable the switch and policy in the next reviewed change.
The controller force-refreshes canonical `main` and `staging`, re-resolves the
exact merged promotion relationship, and rechecks tree identity after setup
and again after live acceptance. If any authority drifts before retention, it
rewrites the report as failed and stops rather than retaining stale passing evidence.
A ref-fetch or exact-promotion API failure takes the same invalidation path;
if even report rewriting fails, the passing artifact is moved outside the
uploader's path so the always-running upload fails closed.
The candidate SHA is deliberately excluded from the checked-in scope hash so
the policy commit does not require a Git fixed point. It remains mandatory in
the protected post-immutable manifest and dispatch and must match the
tree-identical staging deployment plus the live Worker revision.
The workflow also resolves the merged same-repository `dev → staging` PR for
the exact staging merge SHA and requires its recorded head SHA to equal the
candidate, so a merely tree-equivalent repository commit is insufficient.

Gate 14 remains blocked until the winery-specific provider accounts,
credential keyring, QuickBooks application/OAuth grant, and real sandbox or
approved provider lifecycle evidence exist.
