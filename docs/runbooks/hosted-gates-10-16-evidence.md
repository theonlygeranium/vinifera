# Gates 10-16 hosted readiness evidence

**Scope:** Shared exact-revision and configuration-readiness evidence for the
analytics, ML, benchmark, compliance, integration, multi-brand, and custom
hostname gates.

**Boundary:** This procedure never completes a gate. Gates other than 15 are
read-only readiness probes. Gate 15 additionally creates and cleans one
run-scoped synthetic organization through the bounded core controller; it does
not retain fixture data, create provider resources, import winery data, qualify
a model, connect an external account, configure a hostname, or change DNS.

## Request one gate

Set only the intended protected staging environment variable to `true`:

```bash
gh variable set STAGING_GATE_10_EVIDENCE_ENABLED --env staging --body true
gh variable set STAGING_GATE_11_EVIDENCE_ENABLED --env staging --body true
gh variable set STAGING_GATE_12_EVIDENCE_ENABLED --env staging --body true
gh variable set STAGING_GATE_13_EVIDENCE_ENABLED --env staging --body true
gh variable set STAGING_GATE_14_EVIDENCE_ENABLED --env staging --body true
gh variable set STAGING_GATE_15_EVIDENCE_ENABLED --env staging --body true
gh variable set STAGING_GATE_16_EVIDENCE_ENABLED --env staging --body true
```

Run exactly one of these commands for the gate being evaluated, not the whole
block.

Promote and deploy the reviewed candidate through the normal protected staging
path. The deployment runs `scripts/hosted-gates10-16-evidence.mjs` after the
immutable Worker version is live. Clear the variable after the requested
attempt so an unrelated later deployment does not repeat the probe.

Gate 11 also requires the protected staging secret
`STAGING_ML_PLATFORM_ACTOR_USER_ID`. The report retains only a presence
boolean. Active platform-super-admin status is verified later by the guarded
qualification RPC and cannot be inferred from this probe.

Gate 15 also requires `STAGING_GATE15_ACCEPTANCE_EMAIL_BASE` and the protected
Supabase/Access bindings. Before enabling its toggle, the exact staging
Supabase URL origin must be reviewed in the hosted-target allowlist. A passing
Gate 15 report contains the nested `hosted-core-partial` result and cleanup
ledger; see `gate15-core-isolation-acceptance.md`.

## Run the collector directly

The protected workflow invokes the same operator command after deployment. A
read-only direct probe can be run against an already reviewed staging version:

```bash
npm run ops:hosted-gates10-16:evidence -- \
  --gate 10 \
  --origin https://vinifera-staging.edstratum-labs-staging.workers.dev \
  --expected-revision 0123456789abcdef0123456789abcdef01234567 \
  --enabled true \
  --confirmation "COLLECT VINIFERA GATE 10 READINESS EVIDENCE" \
  --output ./hosted-gate-10-readiness.json
```

Replace the gate, exact revision, confirmation gate number, and output path as
one consistent set. Exit code `0` means the requested readiness checks passed,
`2` means a valid report was written with blockers, and `1` means arguments or
collection failed. The direct command writes only the named local JSON file;
the protected staging workflow uploads the corresponding sanitized
exact-candidate artifact for 90 days. For Gates other than 15 the collector is
read-only. Gate 15's direct command is valid only with the protected
Supabase/Access bindings and creates a temporary synthetic fixture that must
clean successfully. The collector never deploys, creates provider resources,
imports data, qualifies models, connects external accounts, or changes DNS. It
accepts only the protected
`vinifera-staging.edstratum-labs-staging.workers.dev` origin; arbitrary HTTPS
targets are rejected before any request.

## Inspect the artifact

Download `hosted-gates10-16-readiness-<candidate-sha>` and verify:

- `candidateRevision` equals the deployed reviewed candidate;
- `runtime.environment` is `staging`;
- `runtime.exactRevision` is `true`;
- every requested configuration group is configured;
- `blockers` is empty for a ready result;
- `completionClaimed` is `false`; and
- `externalEvidenceRemaining` still names the gate-specific proof to collect.

For Gate 15 also require `gateSpecificEvidence.result=core-ready`, zero failed
cleanup steps, and only `hostname-context-after-gate-16` remaining.

The index contains summaries only. Individual gate reports contain the
allowlisted configuration state and missing binding names, never values.

## Continue with gate-specific proof

- Gates 10-12: follow `phase-4-data-ml-benchmark-activation.md`.
- Gate 13: follow `phase-4-shipcompliant-activation.md`.
- Gates 14-16: follow `phase-5-provider-mobile-activation.md`.

After the complete gate-specific evidence passes, rerun its relevant unit,
database, browser/accessibility, isolation, provider-idempotency, and cleanup
checks. Update the canonical readiness ledger through a reviewed PR. Do not use
this readiness artifact as the completion evidence.
