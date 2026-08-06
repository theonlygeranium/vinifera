# ADR: Separate hosted readiness evidence from gate completion

- **Status:** Accepted
- **Date:** 2026-08-06
- **Owners:** Vinifera engineering

## Context

Hosted activation Gates 10 through 16 share two mechanical prerequisites: the
probe must identify the exact reviewed staging revision, and it must retain a
sanitized record of the relevant runtime configuration. Their actual exit
criteria are intentionally different and include lawful winery history,
elapsed experiments, peer contributors, provider decisions, tenant-isolation
flows, and DNS/certificate state.

Without a shared evidence envelope, later controllers would duplicate runtime
identity checks and could accidentally present credential presence as gate
completion. Gate 11 also consumes `ML_PLATFORM_ACTOR_USER_ID` in the Worker,
but the protected staging deployment did not include that binding in its
atomic secret bundle.

## Decision

The protected staging deployment may collect opt-in readiness evidence for
Gates 10 through 16 after the exact immutable Worker version is deployed.
Each gate has an independent environment variable:

```text
STAGING_GATE_10_EVIDENCE_ENABLED
STAGING_GATE_11_EVIDENCE_ENABLED
STAGING_GATE_12_EVIDENCE_ENABLED
STAGING_GATE_13_EVIDENCE_ENABLED
STAGING_GATE_14_EVIDENCE_ENABLED
STAGING_GATE_15_EVIDENCE_ENABLED
STAGING_GATE_16_EVIDENCE_ENABLED
```

An absent or non-`true` variable performs no probe. A requested probe verifies
the exact allowlisted protected staging Worker origin, staging runtime, exact
candidate SHA, and only the configuration groups
needed by that gate. Gate 11 additionally records only whether its actor
binding is present. The binding value is never written to evidence.

Every report is an allowlisted schema with `evidenceLevel` set to
`hosted-readiness` and `completionClaimed` fixed to `false`. It records public
runtime identity, configuration booleans and missing binding names, blockers,
and the external evidence that remains. Provider bodies, credentials, member
records, and operational payloads are excluded. Requested reports are retained
for 90 days in one exact-candidate artifact. A blocked requested probe fails
the protected run after the artifact is uploaded.

The protected staging Worker secret bundle now includes
`STAGING_ML_PLATFORM_ACTOR_USER_ID` as `ML_PLATFORM_ACTOR_USER_ID`. Presence is
readiness only; Gate 11 still requires the database to prove that the UUID is
an active platform super-admin and requires all source, metric, and elapsed
experiment gates.

## Consequences

- Later gate-specific controllers can reuse one exact-revision and sanitized
  evidence contract.
- Operators can request only the gate being evaluated and clear its variable
  after that one deployment attempt.
- A configuration-ready report cannot change a canonical gate status.
- Gate-specific hosted/provider evidence and regression QA remain mandatory.
- No provider resource, fixture, DNS record, model, or integration connection
  is created by this foundation.

## Verification

- Run `npx vitest run tests/scripts/hosted-gates10-16-evidence.test.mjs`.
- Run `npm run check` before promotion.
- On an authorized staging deployment, enable only the intended gate variable,
  inspect the `hosted-gates10-16-readiness-<candidate>` artifact, and confirm
  `completionClaimed` remains `false`.
