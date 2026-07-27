# Governance Notes

**Last verified:** 2026-07-27
**Risk:** Medium

## Change record

### What changed

BS-06 adds repository-wide ownership routing in `.github/CODEOWNERS`, expands
`.github/pull_request_template.md` to name the required verification evidence,
and records the current branch-protection and deployment-environment controls
below. It does not change those external GitHub settings.

### Why

The repository needs an honest distinction between assigning an owner and
requiring an independent approval. Recording the current controls prevents
CODEOWNERS or self-reviewable protected environments from being mistaken for a
two-person security boundary.

### Deployment impact

None. These repository governance files do not change application runtime,
routes, build output, hosted database state, provider activation, Worker
deployment, Pages deployment, or protected-environment configuration.

### Verification

Read-only GitHub API inspection on 2026-07-27 confirmed that `main` uses strict
required checks for `Type, test, build, and package`, `Greptile Review`, and
`Block direct push to main`; applies protection to administrators; requires
zero approvals; does not require CODEOWNERS review; and does not dismiss stale
approvals. The same inspection confirmed that `staging`, `production`, and
`mobile-release` each have only `@theonlygeranium` as reviewer with
`prevent_self_review=false`. Repository inspection cross-checked these results
against `.github/CODEOWNERS`, `.github/pull_request_template.md`,
`docs/agent-workflow.md`, and this note.

## Current controls

GitHub API inspection confirms that `main` is protected, administrators are
subject to the protection rule, and strict required-status checking is enabled.
The required checks are `Type, test, build, and package`, `Greptile Review`,
and `Block direct push to main`. The rule currently requires zero approving
reviews, does not require a CODEOWNERS review, and does not dismiss stale
approvals.

The `staging`, `production`, and `mobile-release` GitHub environments each name
`@theonlygeranium` as the only required reviewer. GitHub's
`prevent_self_review` setting is `false` on all three environments. A workflow
run initiated by the repository owner can therefore be approved by the same
account.

The repository now declares `@theonlygeranium` as the owner of every path in
`.github/CODEOWNERS`. This provides durable ownership routing, but CODEOWNERS
cannot provide independent approval while the owner is the only collaborator
and branch protection does not require code-owner review.

## Risk

One compromised or mistaken owner account can author, approve, and release a
change without independent human review. CI and Greptile remain valuable
technical gates, but neither is a substitute for a second authorized reviewer
on credential-bearing deployment environments.

## Recommended human configuration

- [ ] Add at least one trusted collaborator who can independently review
  production changes.
- [ ] Set `required_approving_review_count` to 1 for `main`.
- [ ] Enable required CODEOWNERS reviews for `main`.
- [ ] Enable dismissal of stale approvals when new commits are pushed.
- [ ] Set `prevent_self_review=true` for `staging`, `production`, and
  `mobile-release` after a second eligible reviewer is configured.
- [ ] Recheck that only `main` can deploy to each protected environment.

Do not enable `prevent_self_review` before a second eligible reviewer exists:
doing so would intentionally make releases impossible. These settings are
external GitHub controls and are not represented safely by repository code
alone.
