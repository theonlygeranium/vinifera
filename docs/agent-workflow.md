# Agent Workflow Guide

> Canonical instructions for AI coding agents (WRITER Agent, Codex, Claude Code) working on vinifera.
> Every change to this repo must flow through a pull request — never commit directly to `main`.

## Why PRs are required

- **Greptile** runs an automated AI code review on every PR, flagging logic errors, security issues, type safety problems, and architectural concerns before code reaches production.
- **CI checks** (type, test, build, Cloudflare Pages) must pass before merging.
- Every merge to `main` triggers a live deploy. Unreviewed code = unreviewed production.

The credential-independent CI database contract runs the Phase 1-5 embedded
PostgreSQL gates and `npm run qa:local-seed`. The latter replays every
migration and applies the deterministic seed twice in PGlite, so local-fixture
idempotence is enforced without Docker or hosted credentials.

## Path-aware validation lanes

CI selects one lane from the pull request's exact base and head commits. A
label, title, checklist, or author assertion cannot select the fast path.

- The documentation-only lane is available only when every changed path is
  `AGENTS.md`, `CHANGELOG.md`, `CONTINUITY_BRIEF.md`, `README.md`, `REVERT.md`,
  or a Markdown file beneath `docs/`. It installs locked dependencies, audits
  them, checks patch whitespace, revalidates the allowlist and required
  changelog update, checks local Markdown links and repository paths, verifies
  the `.nvmrc`/package/documentation Node contract, and scans added lines for
  high-confidence credential patterns.
- The full lane runs the existing type, unit/integration, Phase 1–5 database,
  static/Worker build, Playwright/axe/responsive, Pages rollback, and Android
  lint/package gates. It is mandatory for source, tests, workflows,
  configuration, dependencies, scripts, database, deployment, security,
  mobile, unknown paths, copies, deletions, unsupported diff statuses, and
  classification failures.
- Renames are evaluated as both their old and new paths. A rename entirely
  within the documentation allowlist may use the docs lane; moving a document
  outside it runs full validation.
- Pushes to `main`, manual validation, and any future scheduled validation
  always run the full lane.

The required `Type, test, build, and package` check is an `if: always()`
aggregation/policy job. It depends on classification and both conditional
lanes, requires exactly the selected lane to run and pass, requires Android for
the full lane, and rejects failed, cancelled, skipped-selected, missing,
unknown, both-lane, and neither-lane states. Greptile, direct-push protection,
strict/current-with-main enforcement, conversation resolution, and the
Cloudflare Pages preview remain independent controls. Every new PR head must
produce fresh required checks even when it qualifies for the docs lane.

## Mandatory commit contract

Every commit must update `CHANGELOG.md` and use the repository's Conventional
Commits format:

```text
<type>(<scope>): <short summary>

<body explaining what changed and why>

Verification: <exact checks run>
```

The prompt templates below inherit this contract. A branch or PR is not ready
for review if its commits omit the body, `Verification:` section, or changelog
entry.

---

## Mandatory PR ownership and completion loop

> After opening a PR, remain responsible for it until completion. Wait for
> Greptile and all required CI checks. Inspect every unresolved review thread;
> fix actionable findings, reply with an evidence-based disposition for
> non-actionable or intentionally deferred findings, and resolve threads only
> after verification. Rerun affected tests and wait for Greptile/CI after every
> push. Repeat until all required checks pass and zero unresolved review
> threads remain. Merge only when explicitly authorized; otherwise leave the
> PR ready and report its status.

**“Remain responsible” is a terminal condition.** Opening a PR, posting a
status update, or starting a review does not end the task. The owning agent must
use an available wait or monitoring mechanism and continue until one of these
terminal states is reached:

1. every required check passes, the branch is current with `main`, zero
   unresolved review threads remain, and the PR has either been merged under
   explicit authority or left ready and unmerged; or
2. a documented human-review boundary, repeated-failure limit, unavailable
   external dependency, or missing authority prevents safe progress.

### Operational loop

1. Open the PR with an accurate description, verification evidence, and
   activation impact. Apply `codex-managed` when the recurring monitor should
   provide a safety net.
2. Wait for Greptile, `Type, test, build, and package`,
   `Block direct push to main`, and the relevant preview/deployment checks.
   Record the CI-selected lane; do not infer it from labels or checkboxes. Do
   not repeatedly report unchanged pending state.
3. Fetch thread-aware review state. Flat comment lists are insufficient; use
   Greptile MCP when available or GitHub GraphQL review threads so
   `isResolved`, outdated state, file, and line anchors are visible.
4. Classify every unresolved finding:
   - **Actionable:** implement the smallest correct in-scope fix, update
     required documentation and tests, and record verification.
   - **Non-actionable:** reply with concrete code, test, specification, or
     runtime evidence explaining why no change is required.
   - **Intentionally deferred:** reply with the reason, owner or prerequisite,
     and durable tracking location. Deferral cannot be used to conceal a
     required acceptance criterion.
   - **Human review required:** stop mutation and escalate under the boundaries
     below.
5. Resolve a thread only after the fix or disposition is verified and the
   evidence-based reply is present. Never resolve merely to satisfy the merge
   gate.
6. Rerun the affected tests, update `CHANGELOG.md` in every follow-up commit,
   push, and wait for fresh Greptile and CI results on the new head.
7. Repeat until the exact current head is green and zero unresolved review
   threads remain. Stop after three unsuccessful fix/review cycles or when the
   same finding reappears; apply `human-review-required` and report the
   evidence.
8. Merge only under explicit task-specific human authority or the
   `codex-auto-merge` label. If merging, verify the resulting `main` commit,
   post-merge required workflows, Pages/deployment state, and branch cleanup.
   Otherwise leave the PR ready and report its exact status.

## Human supervision and automation authority

Only the human owner or an authorized maintainer may apply
`codex-auto-fix` or `codex-auto-merge`. Automation must never grant itself
either label. Label precedence is fail-closed:

| Label | Authority |
|---|---|
| `codex-managed` | Include the PR in recurring monitoring. When `human-review-required` is absent, authorizes read-only inspection plus evidence-based replies and resolution of verified non-actionable or intentionally deferred threads. |
| `codex-auto-fix` | With `codex-managed`, authorizes localized low-risk fixes on the existing branch, required documentation/tests, commits, and pushes. |
| `codex-auto-merge` | With `codex-managed`, provides explicit merge authority only after every merge gate passes. |
| `human-review-required` | Stop all automated mutation, preserve evidence, and notify the human owner. Automation may apply but must not remove this label. |
| `do-not-merge` | Absolute merge prohibition. Automation must not remove or override it. |

`do-not-merge` overrides all merge authority but does not prevent authorized
review dispositions or low-risk fixes. `human-review-required` overrides
`codex-managed` and both auto labels: the monitor may perform read-only
inspection and notify the human owner, but it must not reply, resolve, fix,
push, or merge. Missing `codex-auto-fix` means the recurring monitor may
inspect and report but must not change code. Missing `codex-auto-merge` means a
ready PR remains unmerged.

The recurring monitor must stop and request human review for architecture,
authentication, authorization, database migrations, billing, production
configuration, provider activation, security tradeoffs, destructive actions,
or materially expanded scope. These boundaries apply even when
`codex-auto-fix` is present.

### Recurring repository monitor

The external Codex automation runs every 15 minutes as a safety net for an
owner task that ended, crashed, or lost context. It follows this contract:

1. List open PRs in `theonlygeranium/vinifera` labeled `codex-managed`.
2. Inspect draft state, mergeability, whether the head is current with its
   base, required checks, Greptile, blocking labels, and thread-aware
   unresolved review state.
3. If `human-review-required` is already present, make no mutation, notify the
   human owner with the current evidence, and stop. If checks are pending, exit
   without reporting unchanged state.
4. If a low-risk actionable finding exists and `codex-auto-fix` is present,
   use an isolated worktree for the existing branch, implement and document the
   fix, run affected tests, commit, push, and restart the review loop.
5. For verified non-actionable or intentionally deferred feedback, post the
   evidence-based disposition and resolve only after verification.
6. Apply `human-review-required` and stop on a human-review boundary, the third
   unsuccessful cycle, or a repeated finding.
7. Merge only when `codex-auto-merge` is present, the PR is not a draft, its
   head is current with the base, every required check passes, zero unresolved
   threads remain, and neither blocking label exists.
8. After merge, verify the post-merge `main` workflows and report the final
   commit and deployment state.

---

## Agent prompt templates

Copy and paste the appropriate template when starting a coding task.

### WRITER Agent (general feature or fix)

```
Work on the vinifera repository (theonlygeranium/vinifera).

Branching rules (mandatory):
- NEVER commit directly to main.
- Create a branch named: <type>/<short-description>
  Branch types: feat/, fix/, chore/, refactor/, docs/, ci/
  Example: feat/churn-model-v2, fix/null-member-id
- Commit all changes to that branch using the mandatory commit contract above,
  including the `CHANGELOG.md` update.
- Open a pull request targeting main with:
    Title: <type>: <concise description>
    Body: what changed, why, and any risks or assumptions
- Follow the mandatory PR ownership and completion loop in
  docs/agent-workflow.md. Opening the PR is not completion.
- This template grants no merge authority. Leave the all-green,
  zero-unresolved-thread PR ready and unmerged unless the task explicitly
  authorizes merge.

Task:
[DESCRIBE YOUR TASK HERE]
```

---

### Codex (terminal / CLI)

```
Repository: theonlygeranium/vinifera

Branching rules (mandatory):
- Do not push to main directly.
- Create a branch: git checkout -b <type>/<short-description>
- Commit changes to that branch only using the mandatory commit contract
  above, including the `CHANGELOG.md` update.
- Push and open a PR with: gh pr create --base main --title "<type>: <description>" --body "<summary>"
- Follow the mandatory PR ownership and completion loop in
  docs/agent-workflow.md. Opening the PR is not completion.
- This template grants no merge authority. Leave the all-green,
  zero-unresolved-thread PR ready and unmerged unless the task explicitly
  authorizes merge.

Task:
[DESCRIBE YOUR TASK HERE]
```

---

### Claude Code (with Greptile MCP + /greploop)

```
Repository: theonlygeranium/vinifera

Branching rules (mandatory):
- Never commit to main directly.
- Create a branch: git checkout -b <type>/<short-description>
- Commit using the mandatory commit contract above, including the
  `CHANGELOG.md` update, then push and open a PR targeting main.
- After the PR is open, run /greploop to let Greptile review,
  fix all flagged issues, and iterate until the PR reaches 5/5 confidence.
- Follow the mandatory PR ownership and completion loop in
  docs/agent-workflow.md. Opening the PR is not completion.
- This template grants no merge authority. Leave the all-green,
  zero-unresolved-thread PR ready and unmerged unless the task explicitly
  authorizes merge.

Task:
[DESCRIBE YOUR TASK HERE]
```

---

## Branch naming conventions

| Prefix | Use for |
|---|---|
| `feat/` | New features |
| `fix/` | Bug fixes |
| `chore/` | Maintenance, deps, config |
| `refactor/` | Code restructuring without behavior change |
| `docs/` | Documentation only |
| `ci/` | GitHub Actions / workflow changes |
| `greptile/` | Greptile-specific review triggers (reserved) |

---

## Checklist before merging any PR

- [ ] The PR is not a draft and its head is current with `main`
- [ ] Greptile Review check is green on the current head
- [ ] `Block direct push to main` check passes on the pull request
- [ ] `Type, test, build, and package` CI check passes
- [ ] Cloudflare Pages preview deploy succeeded
- [ ] Every review thread has an evidence-backed disposition
- [ ] Zero unresolved review threads remain
- [ ] Affected tests were rerun after the final push
- [ ] PR description explains what changed and why
- [ ] Commits include a body, `Verification:` section, and `CHANGELOG.md`
- [ ] No secrets, API keys, or credentials in the diff
- [ ] Merge authority is explicit and neither `human-review-required` nor
      `do-not-merge` is present

---

## Direct-push enforcement

The `Block direct push to main` job runs in two modes:

- On every pull request targeting `main`, it runs its focused policy tests and
  supplies the required branch-protection check.
- After every push to `main`, it queries GitHub's associated-pull-request API
  for the pushed commit. It passes only when the pushed SHA is the recorded
  merge result of a closed, merged pull request targeting this repository's
  `main` branch. This supports GitHub merge commits, squash merges, and rebase
  merges without trusting commit-message text. The verifier follows at most
  ten same-origin API pages. Every GitHub request has a five-second
  `AbortController` deadline. A timeout consumes the current evidence attempt
  and uses the same ten-second backoff as an indexing miss; the verifier makes
  at most three evidence attempts over two backoff intervals and still fails
  closed if exact evidence never appears.

This timing policy prevents a stalled GitHub response body from consuming the
entire job without producing a governance decision, while retaining bounded
retries for normal associated-PR indexing delay. Its operational impact is
limited to the GitHub Actions evidence check: application, Pages, Worker,
database, provider, and activation behavior are unchanged. The focused policy
suite verifies timeout recovery, a timeout during JSON parsing, three-timeout
exhaustion, exact backoff counts, and fail-closed behavior (12/12).

The push-side run is a fail-closed audit after Git has already updated the
branch. Branch protection must require pull requests, require the
`Block direct push to main` check, and disallow administrator bypass to prevent
the update before it occurs. It must also use strict required checks so the PR
head is current with `main`, require `Greptile Review` and
`Type, test, build, and package`, and require conversation resolution. Do not
treat a green post-push workflow by itself as branch-protection evidence.

---

## Greptile quick reference

| Action | How |
|---|---|
| Trigger a review on any PR | Comment `@greptileai` on the PR |
| Ask a follow-up question | Reply `@greptileai <your question>` on any comment |
| Request alternative fix | Reply `@greptileai suggest another approach` |
| Train Greptile to ignore a pattern | 👎 react on a comment + brief explanation |
| Reinforce a pattern | 👍 react on a comment |
| Auto-fix all comments (Claude Code) | Run `/check-pr` in Claude Code terminal |
| Iterate to 5/5 score (Claude Code) | Run `/greploop` in Claude Code terminal |
