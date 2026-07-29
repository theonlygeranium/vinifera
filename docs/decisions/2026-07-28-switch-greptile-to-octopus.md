# ADR: Switch AI Code Review from Greptile to Octopus (Self-Hosted)

**Date:** 2026-07-28  
**Status:** Accepted  
**Author:** Founder & Principal

---

## Context

Vinifera used Greptile as its AI code review tool, configured as a required status check
on the `main` branch. Greptile operates on a per-developer credit model: each active
developer receives 50 credits per billing period (1 credit = 1 completed review).

During the July 28 2026 release cycle — which involved three PRs with multiple
conflict-resolution pushes each — the organization exhausted its 50 included credits in
a single session. The root cause was a combination of high commit velocity from AI agents
(Codex) and Greptile's default `triggerOnUpdates` behavior, which fires a fresh review on
every head update to an open PR.

Additionally, Vinifera has an AI server capable of self-hosting the full review pipeline.
Keeping code review infrastructure on owned hardware aligns with the project's data
sovereignty posture and eliminates per-review billing entirely.

---

## Decision

Replace Greptile with **Octopus** (octopus-review.ai, `octopusreview/octopus`) as the
primary AI code review tool.

- Octopus is self-hosted via Docker Compose on the project AI server.
- It uses BYOK (bring your own API keys) — LLM costs are paid directly to the provider
  (Anthropic or OpenAI) with no per-review platform fee.
- The full RAG pipeline (Qdrant vector search + LLM) runs on owned infrastructure; source
  code is processed in-memory and never persisted externally.
- Architectural boundary rules from `.greptile/rules.md` are migrated to `.octopus/rules.md`
  unchanged — they are tool-agnostic.

Greptile is removed as a required GitHub branch protection status check. The `main` branch
now requires only:
- `Type, test, build, and package`
- `Block direct push to main`

CodeRabbit remains active and unchanged.

Octopus is a mandatory workflow review gate for every pull request. The GitHub
workflow listens to `opened`, `synchronize`, `reopened`, and `ready_for_review`
activity, plus `edited` retargeting, on PRs targeting `dev`, `staging`, or
`main` and invokes the self-hosted
`PR Quality Gates` runbook in the `Development` environment. It is not a GitHub
branch-protection status check because the self-hosted service can be unavailable;
an unavailable or missing Octopus review still blocks merge under `AGENTS.md`.
The workflow uses `pull_request_target`, checks out only the trusted default
branch with persisted credentials disabled, and passes the pull-request branch
and number strictly as data. It never checks out or executes pull-request code
in a job that receives repository, Octopus, or Cloudflare Access secrets.
Before a secret-bearing job can start, an unprivileged validation job rejects
fork pull requests and branch names outside
`[A-Za-z0-9][A-Za-z0-9._/-]{0,199}` and Git's own branch-name contract. Only
that validated output reaches the runbook prompt, preventing shell syntax from
crossing into the self-hosted checkout script.
Rejected source validation produces an explicit failing `Run PR Quality Gates`
job; it cannot turn the mandatory reviewer into a skipped-success state.
The event's immutable head, base ref, and base SHA are also passed as required
prompts. The runbook compares all three with live GitHub PR metadata before
checkout and fails if the head advanced or the base changed, preventing a
result from being published for a revision or comparison the runbook did not
inspect. The commit-status description carries the attested base SHA so a
consumer can reject an otherwise successful head status after the PR's base
revision changes.

The current self-hosted Octopus Server predates the Executions API required by
`run-runbook-action` v3 and newer. Until the server is upgraded to at least
2022.3.5512, the workflow uses a small Node bridge implementing Octopus's
documented REST flow for prompted runbooks: resolve exact resources, map prompt
names through the preview form, create the published run, poll its task, and
cancel after 15 minutes. The bridge rejects non-HTTPS endpoints, fails closed
on missing prompts/resources or unexpected API shapes, and never logs prompt
values. Because the Octopus hostname is protected by Cloudflare Access, GitHub
Actions also supplies a narrowly scoped Access service token through encrypted
`OCTOPUS_CF_ACCESS_CLIENT_ID` and `OCTOPUS_CF_ACCESS_CLIENT_SECRET` secrets.
The Access application must use a Service Auth policy restricted to that token.
The bridge refuses to submit `GitHubPAT` unless the runbook preview explicitly
identifies that prompt as sensitive. A future Octopus configuration change
should move the PAT to a runbook-scoped sensitive project variable, after which
the per-run prompt and GitHub secret input can be removed together.
The server upgrade is an operational follow-up; switching to v4 must be
validated in a PR before removing this bridge.

The quality runbook resolves the immutable PR head and base SHAs through the
GitHub API, fetches those exact commits with an ephemeral HTTP authorization
header, and removes the remote before inspecting pull-request content. It
derives the aggregate diff and each commit diff locally from those immutable
objects; mutable PR diff and commit-list endpoints are not used. Per-commit
artifacts use first-parent semantics so an ordinary merge commit cannot yield
an empty combined diff and evade Rule 9. Rules 1 and 3 require the task-scoped
checkout state and use `git grep` over tracked TypeScript pathspecs. Exit 1 is
treated as “no matches,” while operational errors remain blocking failures.
Rule 2 enumerates tracked TypeScript blobs through Git and resolves import
specifiers relative to each source path before checking layer boundaries.
These rules cannot fall back to an unrelated working directory, follow a
pull-request symlink into the Octopus host filesystem, or bypass a boundary
with `../` imports. Rules 4–10
consume the resulting merge-base-aware PR diff and inspect bounded source
windows around added calls, so the successful path includes tenant-isolation
Rule 8 without turning target-branch advances, multiline safe calls, or
grandfathered baseline findings into unrelated failures. Tenant checks require
an actual `.eq`, `.in`, or `.match` predicate outside comments and string
literals, and Rule 9 evaluates every commit independently.

Queued and running quality-gate tasks are not canceled by later invocations.
Each task uses its own state file and checkout, so every pull request owns an
independent required result even when several review events overlap. GitHub
authentication is passed to curl over stdin and to Git through environment
configuration, keeping the PAT out of process arguments.

The former `PR Comment Bot` and `Auto-Fix Suggestions` failure runbooks are
retired. Running `npm ci`, formatter binaries, or other pull-request-controlled
code on the self-hosted Octopus server would cross the trust boundary even when
lifecycle scripts are disabled. Failed rule output remains available in the
Octopus task and GitHub check logs; remediation is performed in a normal,
unprivileged feature-branch workflow.

---

## Consequences

### Positive
- Zero per-review credits; cost scales with LLM token usage only.
- Source code and vector embeddings remain on owned infrastructure.
- Self-hosted deployment supports air-gapped operation if needed.
- Octopus supports the same full-codebase RAG context model as Greptile.
- `excludeAuthors` configured to exclude bot accounts (`chatgpt-codex-connector`,
  `coderabbitai`) to prevent noise and unnecessary LLM spend.

### Negative / Risks
- Greptile's cloud service included managed indexing, updates, and SLA. Self-hosting
  transfers operational responsibility to the team.
- Greptile's learning model (thumbs-up/down feedback) is not replicated in Octopus out of
  the box; custom rules in `.octopus/rules.md` carry this function instead.
- If the AI server is unavailable, Octopus reviews will not fire. Octopus is not a
  branch-protection context, but its missing review blocks merge under the repository
  workflow until the service recovers or the human owner documents a one-time exception.
- Octopus no longer posts AI-generated failure comments or formatter patches.
  This intentionally trades convenience for a smaller secret-bearing execution
  surface.

### Bootstrap correction

The initial workflow listened only for pull requests targeting `main`, while the
three-tier governance model routes every agent-authored pull request to `dev`. The
workflow itself therefore could not receive an Octopus review before correcting its
base-branch filter. The human owner explicitly authorized this one-time bootstrap
exception on 2026-07-28: the correction may merge after CI, CodeRabbit, manual diff
review, and zero unresolved threads. After that merge, all open product pull requests
must be re-triggered and pass Octopus before merging.

`pull_request_target` workflows must exist on the default branch before GitHub
will dispatch them. The same bootstrap exception therefore covers promotion of
this reviewed workflow through `dev` and `staging` to `main`. No product PR may
use the exception. Once the workflow is on `main`, every product and promotion
PR must be re-triggered and pass the trusted Octopus gate.

### Rollback Path
Greptile can be reinstated by:
1. Re-adding `"Greptile Review"` (app_id 867647) to the `main` branch required status
   checks via the GitHub REST API or UI.
2. Uninstalling the Octopus webhook from the repository settings.
3. Reverting `.octopus/` to `.greptile/` and updating `AGENTS.md`.

---

## References
- Octopus source: https://github.com/octopusreview/octopus
- Octopus self-hosting: https://octopus-review.ai (Docker Compose)
- Greptile billing docs: https://www.greptile.com/docs/code-review-bot/billing-seats
