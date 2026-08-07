# ADR: Bind Gate 15 core isolation to the shared hosted evidence flow

- **Status:** Accepted
- **Date:** 2026-08-06
- **Owners:** Vinifera engineering

## Context

Gate 15 requires behavioral hosted proof across two brands in one organization,
not only configuration presence. The first controller design used a standalone
toggle and reusable mutable fixture. Review found that this duplicated the
canonical Gates 10–16 envelope and made partial failure cleanup too broad and
difficult to prove.

The core proof must exercise restricted staff and member RLS, owner aggregation,
shared-versus-independent billing behavior, brand-scoped integration claims,
and ambiguous same-email behavior. Custom-hostname selection remains Gate 16
evidence and cannot be claimed by this controller.

## Decision

Gate 15 runs inside `scripts/hosted-gates10-16-evidence.mjs` under the existing
one-shot `STAGING_GATE_15_EVIDENCE_ENABLED` toggle. Runtime health and exact
candidate revision must pass before the core controller is invoked. Both layers
retain one sanitized report in the required 90-day exact-candidate artifact.

The Worker target remains the single literal approved staging Worker origin.
Supabase clients cannot be constructed until the exact canonical `SUPABASE_URL`
origin passes the reviewed hashes in `config/hosted-target-allowlist.json` under
the new `supabaseOriginSha256` target. That list ships empty and therefore
fail-closed; its staging and denied-production hashes require the same reviewed
authority-high-risk change as the other hosted targets.

The controller creates one run-scoped synthetic organization, its shared
default brand, one independent sibling, staff/member Auth identities, and only
the rows required by the acceptance scenario. A cleanup ledger is created and
sealed before the first insert. Cleanup is dependency-ordered and all-settled:
run rows, the exact organization, and the recorded Auth user IDs are each
attempted even if another cleanup fails.
Every cleanup step is idempotent: exact-key database deletes accept an already
absent row, and Auth deletion treats an already absent recorded identity as
settled.

Integration leasing uses the forward-added, service-role-only
`claim_gate15_integration_sync_jobs_for_scope` RPC. Synthetic jobs carry an
exact run marker and future eligibility timestamp, so normal queue drains
cannot race them; the RPC atomically leases only the explicit run-owned job IDs.
Both expired-lease maintenance and candidate selection are constrained to the
generated organization and explicit two-brand set, so unrelated queued work
cannot be leased or mutated. The
magic-link request's unique normalized-email hash is also registered for exact
cleanup, preventing fixture traffic from consuming later rate-limit capacity.

Business mutations use explicit generated primary keys or exact discovered
primary keys plus organization and brand predicates. Mutation statements return
the affected rows and fail on unexpected counts. Analytics cleanup names the
two exact `(organization_id, brand_id, metric_date)` keys; it never deletes an
organization-wide analytics set.

All Worker and Supabase HTTP traffic is restricted to the two authorized
origins, uses `redirect: error`, a ten-second timeout, and a 64 KiB response
limit. Cloudflare Access headers are injected inside that bounded transport for
both the Worker and the Access-protected Supabase ingress and cannot reach any
other origin. Target authorization, client construction, stage failures, and cleanup
are represented only by allowlisted stage names and booleans/counts. Provider,
database, credential, email, UUID, cookie, and response-body values are absent
from evidence.

Successful core evidence uses `evidenceLevel: hosted-core-partial`, changes the
remaining Gate 15 dependency to `hostname-context-after-gate-16`, and keeps
`completionClaimed: false`. It cannot independently change Gate 15 status.

## Consequences

- One toggle and artifact bind readiness and core behavior to the same exact
  staging candidate.
- A missing Supabase-origin hash, preflight failure, partial mutation, or any
  cleanup failure blocks the protected run while preserving sanitized evidence.
- Reruns create a new isolated organization rather than overwriting an earlier
  fixture.
- Gate 16 remains the only source of hostname-derived member-context evidence.
