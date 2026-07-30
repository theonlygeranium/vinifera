# GitHub Governance Snapshot — 2026-07-30

## Scope

This snapshot records the live repository controls immediately before the
risk-based development auto-merge implementation. It contains no credential
values. The source of truth for current state remains the GitHub API.

## Pre-change state

| Control | Observed state |
| --- | --- |
| `dev` branch protection | Not configured |
| `staging` branch protection | Not configured |
| `main` branch protection | Strict required checks enabled |
| `main` required contexts | `Type, test, build, and package`; `Block direct push to main` |
| `main` required PR reviews | None |
| `main` conversation resolution | Required |
| `main` administrator enforcement | Disabled |
| `main` force pushes / deletion | Disabled / disabled |
| Default Actions token | Write |
| Actions may approve PR reviews | Enabled |
| `codex-auto-merge` label | Present |
| Emergency labels | `human-review-required` and `do-not-merge` present |

## Authorized non-production change

Protect `dev` with:

- pull-request-only updates;
- strict `Dev fast checks`;
- required conversation resolution;
- no force pushes;
- no branch deletion; and
- administrator enforcement where the repository plan supports it.

Set the default Actions token to read-only and disable workflow approval of
pull-request reviews. Individual trusted workflows must declare every write
permission they need. The trusted development auto-merge workflow is the only
new writer in this delivery unit, and it declares `contents: write` and
`pull-requests: write` explicitly.

The workflow source can merge automatically only after it reaches the
repository default branch. Until then, this PR establishes and tests the
control but does not claim that autonomous merge is active.

## Post-change verification

The GitHub API confirmed the authorized settings were applied:

| Control | Verified state |
| --- | --- |
| `dev` required context | Strict `Dev fast checks` |
| `dev` pull-request rule | Enabled with zero mandatory approvals |
| `dev` conversation resolution | Required |
| `dev` administrator enforcement | Enabled |
| `dev` linear history | Required |
| `dev` force pushes / deletion | Disabled / disabled |
| Default Actions token | Read |
| Actions may approve PR reviews | Disabled |

`main`, production environments, production reviewers, and deployment targets
were not changed.

## Rollback

If the control causes an unexpected development-only blockage:

1. disable `Trusted development auto-merge`;
2. remove `codex-auto-merge` from affected PRs;
3. restore the pre-change default Actions setting only if a named workflow is
   proven to require it, then add explicit least-privilege permissions instead;
4. remove or amend `dev` protection through the GitHub API using the recorded
   settings above; and
5. retain `human-review-required`, `do-not-merge`, `main`, production
   environment, and production approval protections unchanged.

Removing `dev` protection is a temporary rollback, not the desired steady
state. The preferred repair is to restore the exact aggregate or permission
contract.
