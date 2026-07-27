# ADR: Direct-Push Guard Evidence

**Date:** 2026-07-27
**Status:** Accepted
**Decided by:** Codex under owner authorization

## Context

The repository requires the `Block direct push to main` status check, but the
original workflow ran only after pushes to `main`. Pull request commits could
therefore never produce the required context. The push-side policy also
accepted conventional commit-message prefixes, so a direct push could satisfy
the audit without passing through a reviewed pull request.

## Decision

Run the same named job for pull requests targeting `main` and for pushes to
`main`.

On pull requests, execute dependency-free policy tests and publish the required
status context. On pushes, query GitHub's
list-pull-requests-associated-with-a-commit endpoint for the pushed SHA and
pass only when one response is a closed, merged pull request whose base is this
repository's `main` branch and whose `merge_commit_sha` exactly matches the
pushed SHA. The verifier follows no more than ten pagination links after
confirming each retains the first request's origin and path. If complete
pagination returns no match, it retries twice at ten-second intervals to absorb
GitHub's normal post-merge indexing delay. Forced updates and unavailable,
untrusted, or malformed GitHub evidence fail closed.

Keep branch protection as the pre-push enforcement boundary. The push workflow
is a post-update audit and cannot undo a direct push.

## Rationale

GitHub records `merge_commit_sha` after a PR merge as the merge commit for a
merge strategy, the squashed commit for a squash strategy, or the commit to
which the base branch was updated for a rebase strategy. Matching that field
therefore supports all three repository merge methods without relying on
mutable commit-message conventions.

The associated-pull-request endpoint identifies the merged PR that introduced
a commit to the default branch. Requiring exact repository, base branch, merge
state, and merge-result SHA prevents an open PR or unrelated historical PR from
authorizing a direct update.

## Alternatives Considered

- Commit-message allowlists were rejected because commit text is user
  controlled and does not prove review or CI occurred.
- Actor or committer allowlists were rejected because the same maintainer can
  both merge a PR and push directly.
- Removing the required check was rejected because it would weaken the
  repository's documented merge gate.
- Using only the post-push workflow was rejected as prevention because a
  workflow failure cannot roll back an already-updated branch.

## Consequences

- Pull requests now receive the required status context.
- Merge commits, squash merges, and GitHub rebase merges are accepted from API
  evidence.
- A normal association-index delay receives three total evidence checks over
  20 seconds; longer delays still fail closed and may require a manual rerun.
- GitHub API outages and pagination beyond ten pages fail the post-push audit
  closed and may require rerunning the job after service recovery.
- Repository branch protection must require PRs and apply to administrators;
  that external setting is intentionally not changed by this ADR.

## References

- [GitHub REST API: List pull requests associated with a commit](https://docs.github.com/en/rest/commits/commits#list-pull-requests-associated-with-a-commit)
- [GitHub REST API: Pull request merge commit SHA semantics](https://docs.github.com/en/rest/pulls/pulls#about-pull-requests)
- [`docs/agent-workflow.md`](../agent-workflow.md)
- [`.github/workflows/direct-push-guard.yml`](../../.github/workflows/direct-push-guard.yml)
