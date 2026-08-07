---
name: two-speed-policy
description: How to determine which CI checks belong in Dev fast checks vs the Vinifera Promotion Gate, including policy test assertions and label enforcement rules.
paths:
  - ".github/workflows/**"
  - "tests/**"
---

# Two-Speed Policy Skill

This skill provides domain knowledge for the Vinifera two-speed validation model.

## The Two Speeds

### Dev Fast Checks
- Run on every PR targeting `dev`
- Include: lint, type-check, unit tests, integration tests, build verification
- Fast feedback for routine development

### Vinifera Promotion Gate
- Run only for promotions (`dev → staging`, `staging → main`)
- Include: all Dev fast checks plus hosted acceptance tests, database verification, Octopus deployment, deployment smoke tests
- Triggered by promotion workflows only

## Label Enforcement

### Preview Workflows
Preview/publish workflows (e.g., `frontend-preview-publish.yml`) must **NOT** contain `human-review-required` or `do-not-merge` label checks.

This is asserted by the project's own policy test:
- File: `tests/two-speed-review-policy.test.mjs`
- Line 159: deliberately asserts preview workflows should NOT contain these checks
- Adding these checks to preview workflows will fail the policy test

### Promotion Workflows
Promotion workflows **must** contain `human-review-required` and `do-not-merge` label checks. These are the gating mechanism for the Promotion Gate.

## Policy Test

The policy test (`two-speed-review-policy.test.mjs`) validates the workflow structure:
- It checks that preview workflows do NOT contain emergency label checks
- It checks that promotion workflows DO contain emergency label checks
- Any change to workflow files should be validated against this test

## Running the Policy Test

```bash
node tests/two-speed-review-policy.test.mjs
```

## What NOT to Do

1. **Do not add label checks to preview workflows** — the policy test explicitly forbids this
2. **Do not remove label checks from promotion workflows** — this weakens the Promotion Gate
3. **Do not create workflows that bypass the two-speed model**
4. **Do not add `auto-merge` or `auto-approve` steps** to any workflow
5. **Do not modify the `revalidate` step** in privileged `publish` jobs without understanding label TOCTOU implications

## Cloud Agent Interaction

Cursor cloud agents may fix CI failures on PRs they create, but only within the Dev fast checks lane:
- Cloud agents must not interact with promotion workflows
- If a CI failure appears to be in a promotion workflow, surface it for human review
- Cloud agents should not add or remove governance labels on any PR
