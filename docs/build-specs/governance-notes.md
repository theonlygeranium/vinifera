# Governance Notes

**Last verified:** 2026-07-27
**Risk:** Medium

## Current controls

GitHub API inspection confirms that `main` is protected, administrators are
subject to the protection rule, and the required status checks are Type/test/
build/package and Greptile. The rule currently requires zero approving reviews
and does not require a CODEOWNERS review.

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
