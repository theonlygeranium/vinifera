# ADR: Fail-closed documentation-only CI lane

**Date:** 2026-07-27
**Status:** Accepted
**Decided by:** Human owner, implemented by Codex

## Context

Vinifera's complete pull-request suite validates application code, five
database architecture phases, Worker and Pages builds, browser accessibility
and responsive behavior, and Android packages. Those gates are necessary for
runtime-affecting changes but unnecessarily expensive for changes proven to
contain only approved Markdown documentation.

The protected required check is named `Type, test, build, and package`. A
conditional heavy job cannot retain that protection safely because a skipped
required job may leave a missing or misleading context. Classification is also
a security boundary: labels, author claims, untrusted PR scripts, ambiguous
diffs, and classifier errors must not bypass full validation.

## Decision

CI computes the pull request diff from the event's exact base and head commit
SHAs with sufficient Git history. A change is documentation-only only when
every path is one of:

- `AGENTS.md`
- `CHANGELOG.md`
- `CONTINUITY_BRIEF.md`
- `README.md`
- `REVERT.md`
- Markdown files matching `docs/**/*.md`

Renames are evaluated using both old and new paths. A rename wholly within the
allowlist may use the docs lane. Copies, deletions, unsupported statuses,
empty/missing diffs, parsing or checkout failures, and every non-allowlisted
path select full validation or fail the policy gate. Pushes to `main`, manual
runs, and any future scheduled runs always select full validation.

The classifier logic lives inline in the protected workflow. The docs lane
also runs a repository-owned validator, but the classifier independently
forces changes to `.github/**`—including that validator—through full CI. The
workflow uses `pull_request`, never `pull_request_target`, and introduces no
third-party path-filter action.

The documentation lane checks out the exact head, uses `.nvmrc`, installs the
lockfile, audits dependencies, runs `git diff --check`, revalidates the
allowlist and mandatory `CHANGELOG.md` update, validates changed local
Markdown links, verifies the `.nvmrc`/package/AGENTS/README Node contract,
scans added lines for high-confidence credential patterns, and writes the
exact SHAs, paths, checks, lane, and result to the job summary. It does not run
database, Worker-build, Playwright, or Android work.

The existing heavy quality job is renamed
`Full type, test, build, and package`. Android remains a conditional full-lane
job. A small `if: always()` aggregation/policy job retains the exact protected
name `Type, test, build, and package` and depends on the classifier, docs job,
full-quality job, and Android job. It succeeds only when classification
succeeded, exactly the selected lane ran, every selected job passed, and every
unselected job skipped. Failed, cancelled, missing, unknown, both-lane, and
neither-lane states fail.

Activation-gated migration/deployment jobs continue to require the protected
aggregate and remain disabled on pull requests. Greptile, direct-push
protection, Cloudflare Pages preview, strict branch currency, conversation
resolution, administrator enforcement, and force-push/deletion restrictions
remain independent and unchanged.

## Rationale

An explicit allowlist makes the small safe set reviewable and sends new paths
to full CI automatically. Exact SHAs avoid merge-base guesses, label trust, and
commit-message heuristics. Independent inline classification prevents a
changed PR-head validator from granting itself the fast path. The stable
aggregate check preserves branch-protection compatibility while making every
conditional result explicit.

## Alternatives Considered

- A `docs-only` label was rejected because mutable metadata does not prove the
  changed paths.
- GitHub `paths-ignore` was rejected because it can omit the required check and
  cannot enforce the selected-lane result policy.
- `pull_request_target` was rejected because executing untrusted PR code in a
  privileged base-repository context is unnecessary and unsafe.
- A floating third-party path-filter action was rejected in favor of
  dependency-free workflow logic.
- Trusting only a classifier script from the PR head was rejected because the
  script could classify its own modification as documentation-only.
- A recurring scheduled full run was deferred because runner usage and cost
  were not assessed; full validation on every `main` push is the required
  backstop.

## Consequences

- Strict Markdown-only PRs receive faster feedback while retaining dependency,
  diff, link, changelog, Node-contract, and credential-pattern evidence.
- Runtime-affecting and unrecognized changes retain the complete suite.
- The required aggregate now waits for Android on the full lane, so its success
  proves both full quality and native validation.
- A classifier infrastructure failure blocks the PR rather than silently
  selecting the docs lane.
- The optimization PR itself changes `.github/**` and therefore must run the
  full lane.
- No application, deployment target, provider, secret, hosted database, or
  activation state changes.

## Verification

- Run `node --test .github/scripts/docs-ci-policy.policy.mjs` and confirm all allowlist,
  rename, deletion, copy, unknown-path, event-default, and aggregate-result
  cases pass.
- Parse every workflow as YAML and run the direct-push policy suite.
- Run `npm ci`, `npm audit --audit-level=moderate`, `npm run check`, and
  `npm run qa:e2e`.
- Run `git diff --check` and the credential-pattern scan over the exact diff.
- Confirm this workflow-changing PR selects full quality plus Android.
- Confirm branch protection still requires the unchanged aggregate, Greptile,
  and direct-push check names without any settings mutation.
