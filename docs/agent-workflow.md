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
- Do NOT merge the PR. Leave it open for Greptile review and CI.

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
- Do not merge. Leave open for Greptile + CI review.

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
- Do not merge until CI and Greptile are both green.

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

- [ ] Greptile Review check is green (or all comments addressed)
- [ ] `Block direct push to main` check passes on the pull request
- [ ] `Type, test, build, and package` CI check passes
- [ ] Cloudflare Pages preview deploy succeeded
- [ ] PR description explains what changed and why
- [ ] Commits include a body, `Verification:` section, and `CHANGELOG.md`
- [ ] No secrets, API keys, or credentials in the diff

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
the update before it occurs. Do not treat a green post-push workflow by itself
as branch-protection evidence.

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
