# Gate 15 core same-organization isolation

## Boundary

This procedure collects partial Gate 15 evidence. It creates only run-scoped
synthetic staging rows and deletes them before the report completes. It does not
configure a custom hostname and never sets `completionClaimed` to true.

## Preconditions

1. Review and populate the exact staging `supabaseOriginSha256` hash and the
   denied production Supabase-origin hash in
   `config/hosted-target-allowlist.json`. Empty policy remains fail-closed.
2. Confirm the protected staging environment supplies the Supabase URL,
   anon/service keys, Cloudflare Access service token, and
   `STAGING_GATE15_ACCEPTANCE_EMAIL_BASE`.
3. Confirm all other Gates 10–16 evidence toggles and the legacy Gate 7 toggle
   are false.

## One-shot run

Set `STAGING_GATE_15_EVIDENCE_ENABLED=true` and use the normal protected
staging deployment for the reviewed candidate. The canonical collector first
requires the exact staging Worker revision and Gate 15 configuration groups,
then executes the core scenario.

After the job completes, return the toggle to false. No separate Gate 15
controller or artifact is expected.

## Artifact inspection

Download `hosted-gates10-16-readiness-<candidate-sha>` and inspect
`gate-15.json` plus `index.json`. Require:

- the top-level candidate and runtime exact revision match;
- `gateSpecificEvidence.result` is `core-ready`;
- all seven core checks are true;
- three cleanup phases were attempted and none failed;
- integration leasing used the organization-and-brand-scoped service RPC, and
  used the current run time for a non-expired lease while retaining historical
  queue timestamps only for deterministic ordering; the run-specific
  magic-link rate-limit row was removed by cleanup;
- Auth cleanup reconciled the independently generated fixture emails before
  deletion, covering a committed Auth create whose response was lost;
- the scoped claim rejected null organization, brand-set, worker, limit,
  lease-duration, and as-of parameters before any lease mutation;
- the failure stage is null and no raw identifiers or emails appear;
- the only remaining Gate 15 evidence is
  `hostname-context-after-gate-16`; and
- both evidence layers retain `completionClaimed: false`.

If a stage or cleanup is blocked, do not reuse identifiers from the report—the
report intentionally omits them. Inspect protected job diagnostics, repair the
controller or hosted prerequisite, and rerun with a new run-scoped fixture.

## QA

Run:

```bash
npx vitest run \
  tests/scripts/hosted-gate15-core-evidence.test.mjs \
  tests/scripts/hosted-gates10-16-evidence.test.mjs \
  tests/scripts/provider-target-activation.test.mjs
npm run check
```

Gate 15 remains pending until the successful partial artifact is inspected
together with Gate 16 hostname-context evidence.
