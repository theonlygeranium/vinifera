# ADR: Gate 14 protected provider acceptance

**Date:** 2026-08-06
**Status:** Accepted

## Decision

Gate 14 uses a trusted-main, protected, manually dispatched acceptance
controller. An exact hashed immutable scope identifies one organization, brand,
credential-keyring version set, four integration connections, and provider
lifecycle results. Exact Worker and Supabase target hashes plus both the
current staging merge revision and its tree-identical deployed promotion
candidate prevent evidence reuse across environments, and the deployed
Worker must report the same authorized Supabase origin, active-key version,
and complete key-version-set hashes. The runtime validator must also decrypt
the four accepted connection-scoped envelopes and report both their
connection-ID-set hash and an exact tenant/provider/ciphertext/IV/key-version
scope hash. Placeholder envelopes cannot substitute for the policy-bound
evidence. A protected service-role read carries the staging Cloudflare Access
service-token headers and also requires those exact four
connections to be active, opted in, and scoped to the manifest tenant/brand,
using a database-level brand-filtered relation before any secret row is
returned, then hashes the stored ciphertext, IV, and key versions and compares that database
scope with both the manifest and runtime decryption proof. Every envelope key
ID must belong to that observed runtime keyring.
Observation results are collected after policy promotion and must use a
strictly round-tripping, timezone-qualified RFC3339 instant; evidence older
than 30 minutes is rejected.
The candidate revision is excluded from the checked-in scope hash to avoid a
self-referential commit SHA. It is supplied only after immutability through the
protected manifest/dispatch and remains exact in staging-tree and live-runtime
comparisons.
The staging merge commit must resolve to a merged same-repository
`dev → staging` PR whose recorded head SHA is that exact candidate.
Canonical `main`, `staging`, promotion provenance, and staging/candidate tree
identity are force-refreshed after setup and again after live acceptance. Any
drift or ref/promotion lookup failure before retention rewrites the report to
`passed: false` and fails the run. A rewrite failure removes the report from
the always-running uploader's path rather than retaining `passed: true`.

The manifest proves winery-specific AES-256-GCM envelopes without containing
credential plaintext. Klaviyo bulk, mapping, inbound engagement, signature,
and disconnect behavior; QuickBooks OAuth, 100-transaction, mapping, expected
sale/refund receipts, exact 4,863-plus-4,862-cent refund convergence,
single-refresh generation, ambiguity, and zero-difference reconciliation;
Avalara calculation, commit, exact partial and completing refund tax deltas,
strict liability reduction, failure, and interrupted-provider checkpoint
recovery without replaying the completed write; and Meta
consent, hashing, deduplication, withdrawal, test-mode removal, all four mapped
event sends and stable-ID Events Manager observations, and
acknowledgement timing are all mandatory.

## Consequences

The checked-in policy is disabled and empty. A run emits connection IDs,
aggregate counts/timings, and hashes only, retains them for 90 days, and never
claims activation completion. Creating provider accounts, accepting terms,
granting filing authority, or completing OAuth remains an external blocker.
The controller script and policy are classified as authority-high-risk.
