## Summary
<!-- What changed, why, and deployment/activation impact -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor (no behavior change)
- [ ] Docs
- [ ] Chore / dependency update
- [ ] Promotion / release

## Evidence level

<!-- Use only evidence actually collected. A preview or HTTP 200 is not hosted readiness. -->

- [ ] Local validation — exact commands/results:
- [ ] Fast GitHub validation — `Dev fast checks`:
- [ ] Full GitHub validation — `Vinifera Promotion Gate`:
- [ ] Preview deployment — branch alias:
- [ ] Preview deployment — immutable URL:
- [ ] Staging deployment — marker, SHA/digest, and API health:
- [ ] Production deployment — marker, SHA/digest, and API health:
- [ ] Hosted/provider readiness — redacted provider-specific evidence:

## Classifier and test selection

- Candidate state: ready / draft-not-candidate / exact manual dispatch
- Exact base SHA:
- Exact head SHA:
- Risk: low / medium / high
- Surface: docs / frontend / backend / workflow / test / mixed / unknown
- Selected lane and reason:
- Browser smoke: required / policy-approved non-applicability
- Frontend preview: required / policy-approved non-applicability
- Android selection and reason:
- Focused/local checks:
- Intentionally inapplicable checks:

## Review completion

- [ ] Applicable required aggregate passes on the exact current comparison
- [ ] Octopus passes for promotion or classified/labeled high-risk review
- [ ] `Frontend preview evidence` passes with exact URLs or policy-approved non-applicability when the trusted publisher is active
- [ ] Available CodeRabbit findings were inspected; CodeRabbit absence/rate limiting is non-blocking
- [ ] Actionable findings were fixed and affected tests rerun
- [ ] Findings were collected before editing and no more than two substantive repair/re-review cycles were used
- [ ] Non-actionable or intentionally deferred findings have an evidence-based reply
- [ ] Zero correctness, security, tenancy, accessibility, data-loss, or release-blocking threads remain
- [ ] Branch is current with its target base (`dev` for feature PRs)

## Logical delivery contract

- [ ] This PR has one consolidated `[Unreleased]` changelog entry
- [ ] WIP commits exist only on this isolated branch
- [ ] Final merge to `dev` will squash to one logical Conventional Commit
- [ ] Final commit body records what, why, impact, and exact verification
- [ ] An ADR is included only if this changes architecture, security, deployment, database policy, or governance
- [ ] No secret, production credential, production data, or private customer information is in the diff, logs, preview, fixture, or review prompt

## Environment and activation

<!-- List affected activation gates. Use "None" when no gate is changed. -->

Activation gates affected: None

- [ ] Dev/preview uses only non-production credentials and data
- [ ] Cloudflare Access protects non-public dev/preview data where applicable
- [ ] Stable dev/staging/live/marketing URLs and the Pages rollback baseline remain intact
- [ ] No provider, billing, email, DNS, database, Worker, mobile-store, or production gate is claimed active without its own evidence
- [ ] Neither `human-review-required` nor `do-not-merge` is present
- [ ] If `codex-auto-merge` is present: risk is low/medium, the PR is
      same-repository to current `dev`, applicable preview evidence succeeded,
      and zero review threads remain unresolved

## Risks, rollback, and assumptions

<!-- Include rollback target for a deployment or explain why no deployment occurs. -->
