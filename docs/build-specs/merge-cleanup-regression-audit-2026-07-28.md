# Merge Cleanup Regression Audit and Agent Handoff

**Date:** 2026-07-28

**Repository:** `theonlygeranium/vinifera`

**Repair PR:** [#51](https://github.com/theonlygeranium/vinifera/pull/51)

**Base / branch:** `dev` / `fix/merge-cleanup-regressions`

**Audited pre-handoff head:** `97ceed6ca3b3108d29430c626d6468e0fce4a40d`

## Purpose

This report is the authoritative handoff for the merge-cleanup regression
mission. It identifies who performed each class of work, why the work was
necessary, what independent verification found, what was repaired, and which
release gates remain blocked. It supplements the earlier UI test report rather
than rewriting that historical record.

## Participants and authority

| Actor | Work performed | Reason and authority |
|---|---|---|
| AI Strategist / Writer Agent | Merged or directly resolved PRs #27–#43, removed merged branches, and delivered the PR #50 automated-promotion amendment | Consolidate the UI testing batch and automate `dev` to `staging` promotion |
| Codex implementation agent | Independently compared merged content, repaired regressions, hardened promotion and Octopus gates, restored accessibility behavior, validated CI/browser evidence, and maintained PR #51 | Human owner authorized cautious, aggressive repair and merging after validation |
| Codex GitHub reviewer | Reviewed successive PR #51 heads and reported actionable defects, including the final `MERGE_BASE_SHA` state-transfer defect at audited head `97ceed6` | Independent exact-head review required by repository governance |
| CodeRabbit | Reviewed earlier PR #51 revisions and raised findings that were dispositioned before the final revision | Automated review coverage; the human owner explicitly waived another final CodeRabbit run for PR #51 because the account was rate-limited |
| Human owner (Jeff / EdStratum Labs) | Supplied merge and repair authority; approved the Cloudflare Access service-token policy and encrypted secret transfer; explicitly approved the one-PR CodeRabbit bypass | Human-bound authorization for repository, access-policy, secret-transfer, and review-waiver decisions |
| Octopus Deploy | Intended mandatory PR quality gate | No successful PR #51 run occurred: the trusted bridge is absent from the GitHub default branch and the authenticated Vinifera project has no published `PR Quality Gates` snapshot |

The CodeRabbit waiver is limited to PR #51. It does not modify repository
policy or waive CI, Codex review, Octopus, staging, accessibility, or production
release gates.

## Audit of the strategist report

The independent audit confirmed that the 14 squash merges for PRs #27, #28,
#31–#34, and #36–#43 were patch-identical to their reviewed PR changes.
However, three material corrections were required:

1. The direct resolutions for PRs #30 and #35 were not patch-equivalent. They
   replaced newer files, restored six obsolete marketing CTA destinations, and
   deleted already-merged Phase 1 and Phase 5 regression assertions.
2. The claim that branch cleanup left only `main`, `dev`, and `staging` was
   premature. The merged PR #49 and #50 branches still existed and were removed
   only after the audit verified that both PRs were merged. The current remote
   set is `main`, `dev`, `staging`, plus the active PR #51 repair branch.
3. The reported `dev`/`staging` divergence was not merely squash-history
   structure. The environment branches contain materially different content
   and must be reconciled through reviewed promotions.

PR #50's promotion workflow also contained release-blocking behavior: it probed
before creating the promotion PR, relied on the event-suppressing default
`GITHUB_TOKEN`, polled itself into a deadlock, omitted required label handling,
could mask a failed merge, accepted stale or incomplete review results, and
left race windows between gate evaluation and merge.

## Repairs in PR #51

### Marketing and accessibility

- Recombined the intended Vine/Cellar pricing and HTTPS-logo changes with every
  previously merged regression assertion.
- Restored the six trial CTA destinations but made them fail closed to pricing
  unless the Worker configuration report proves application-origin, database,
  and authentication-email readiness.
- Moved marketing behavior into a self-hosted script compatible with the
  Worker's CSP.
- Restored focus to the visible mobile-menu trigger when Escape closes the
  menu, and retained 44-pixel mobile target coverage.

### Promotion governance

- Creates or updates the promotion PR before provider probes.
- Uses an event-producing credential so PR workflows and the staging push are
  not silently suppressed.
- Applies least-privilege permissions and excludes promotion jobs from their
  own exact-head polling.
- Paginates check/status lookup, binds results to the current PR instance and
  creation time, distinguishes required success from intentional skips, checks
  unresolved threads, repeats every gate immediately before merge, and verifies
  GitHub's exact-head merge result.

### Octopus trust boundary

- Runs secret-bearing bridge code only from the trusted default branch.
- Binds the prompted expected head SHA, base ref, and base SHA to GitHub's live
  PR metadata before checkout, then derives the aggregate and per-commit diffs
  from that immutable comparison. A queued review cannot reuse success after a
  base-branch switch. The status description attests the base SHA, and promotion
  captures and revalidates that base through the final merge check.
- Uses first-parent diffs so Rule 9 evaluates merge commits.
- Persists `MERGE_BASE_SHA` with the other task-scoped checkout state before
  the separate Rules 4–10 action sources it. The exact-head Codex review found
  this missing transfer at `97ceed6`; without the repair, `set -u` terminated
  the mandatory runbook before any change-aware rule executed.
- The next exact-head Codex review found that the runbook still trusted live
  base metadata. The follow-up passes and validates the event's base ref and
  SHA, preventing an unchanged head from receiving an attestation for a
  different or temporarily switched base.

### External access state

- Retained the existing `Vinifera GitHub Actions` Cloudflare Access service
  token; no duplicate token was created.
- Added the `Vinifera GitHub Actions — Octopus` Service Auth policy, scoped only
  to that token and application.
- Installed the one-time client ID and secret as encrypted GitHub Actions
  secrets. No secret value was printed, committed, or recorded in this report.

## Commit chronology before this handoff

| Commit | Purpose |
|---|---|
| `9618e79` | Restore UI behavior and tests lost during direct resolutions |
| `bea2ad4`–`495011a` | Make automated promotion fail closed and retry-observable |
| `dcf4913`–`8882e91` | Require completed reviews and cover non-default branches |
| `96e88c1` | Record verified remote-branch cleanup |
| `6a6b38d` | Reject incomplete CodeRabbit success states |
| `231dc60`–`9d8acd0` | Fail-safe signup capability checks and accessibility repair |
| `d238cc0`–`0f0b7f0` | Bind gates to PR/head and preserve intentional CI skips |
| `97e48ec`–`87302de` | Close final gate races and prevent stale PR-instance reuse |
| `9c2eae4` | Record the approved Cloudflare Access policy and secret transfer |
| `6b4c025`–`97ceed6` | Derive immutable Octopus artifacts and cover merge commits |

Use `git log --oneline origin/dev..fix/merge-cleanup-regressions` for the
complete one-commit-per-change trail, including this report's follow-up repair.

## Verification evidence

Evidence completed before the final documentation commit:

- Local `npm run check`: TypeScript, Worker bindings, Vitest, Vite, Worker
  dry-run, packaging, and related source gates passed; 49 test files and 489
  tests passed at the audited head.
- Focused promotion and Octopus contract suites passed 34/34.
- Phase 1 browser coverage passed 36/36 after the last rendered-page change;
  an earlier combined Phase 1/Phase 5 run passed 63/63, and subsequent changes
  did not alter Phase 5 UI source.
- `actionlint` 1.7.12 passed both edited workflows.
- GitHub Actions run
  [30402814978](https://github.com/theonlygeranium/vinifera/actions/runs/30402814978)
  passed classification, full quality, Android, and the required aggregate for
  exact head `97ceed6`; the Cloudflare Pages preview check also passed.
- The Jeff - Pro authenticated Chrome profile was used for desktop and 375px
  UI inspection. The compatible UI preview reported no observed axe violations,
  horizontal overflow, or console errors.
- The exact-head Codex review at `97ceed6` found the missing merge-base state
  transfer. That finding is repaired in the follow-up commit and must receive
  fresh exact-head CI and Codex review before merge.

No Octopus run, staging Worker deployment, database migration, provider
activation, PR merge, environment promotion, production deployment, or custom
domain cutover is claimed by this evidence.

## Current handoff state

- PR #51 remains open and must remain unmerged until its new exact head passes
  CI, fresh Codex review has no unresolved actionable finding, and Octopus
  genuinely passes or the owner explicitly grants a separate, narrowly scoped
  Octopus bootstrap exception.
- CodeRabbit is intentionally not rerun for PR #51 under the owner's one-time
  rate-limit waiver.
- The corrected Octopus bridge cannot run for `dev` PRs until trusted workflow
  code is present on GitHub's default branch. The authenticated Octopus project
  also lacks a published runnable snapshot, while the repository currently
  stores a Config-as-Code OCL definition.
- Automated `dev` to `staging` promotion remains fail closed because no
  isolated staging Supabase target or `STAGING_SUPABASE_URL` /
  `STAGING_SUPABASE_ANON_KEY` secrets exist.
- Production and the static Pages rollback baseline are untouched.

## Recommended next actions

1. Decide the Octopus operating model: publish a classic runbook snapshot that
   matches the bridge API, or revise the bridge for the supported
   Config-as-Code branch/commit execution contract.
2. Bootstrap the trusted default-branch Octopus workflow through a narrowly
   scoped owner-reviewed change or explicit one-time bootstrap exception, then
   execute it against a non-production PR and verify its exact-head status.
3. Merge PR #51 into `dev` only after the remaining CI/Codex/Octopus conditions
   above are satisfied. The CodeRabbit waiver alone is not an Octopus waiver.
4. Provision an isolated staging Supabase project (or approve the required
   account-plan change), install only its URL and anon key in the staging
   environment, and exercise the repaired automated promotion.
5. Reconcile `dev` to `staging`, run hosted Worker configuration/Auth/Realtime,
   desktop/375px browser, axe, and provider-readiness validation, then use a
   separately reviewed human promotion from `staging` to `main`.
6. Establish a stable release tag and update `REVERT.md` only after production
   cutover and rollback verification succeed.
