# Agent Workflow Guide

> Canonical instructions for AI coding agents (WRITER Agent, Codex, Claude Code) working on vinifera.
> Every change to this repo must flow through a pull request — never commit directly to `main`.

## Why PRs are required

- **Greptile** runs an automated AI code review on every PR, flagging logic errors, security issues, type safety problems, and architectural concerns before code reaches production.
- **CI checks** (type, test, build, Cloudflare Pages) must pass before merging.
- Every merge to `main` triggers a live deploy. Unreviewed code = unreviewed production.

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
- Commit all changes to that branch.
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
- Commit changes to that branch only.
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
- Commit and push your changes, then open a PR targeting main.
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
- [ ] `Type, test, build, and package` CI check passes
- [ ] Cloudflare Pages preview deploy succeeded
- [ ] PR description explains what changed and why
- [ ] No secrets, API keys, or credentials in the diff

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
