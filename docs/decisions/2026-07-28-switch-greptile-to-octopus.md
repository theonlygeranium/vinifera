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

Octopus is a mandatory workflow review gate for every agent-authored pull request
targeting `dev`. The GitHub workflow listens to `opened`, `synchronize`, `reopened`,
and `ready_for_review` activity on `dev` pull requests and invokes the self-hosted
`PR Quality Gates` runbook in the `Development` environment. It is not a GitHub
branch-protection status check because the self-hosted service can be unavailable;
an unavailable or missing Octopus review still blocks merge under `AGENTS.md`.

The current self-hosted Octopus Server predates the Executions API required by
`run-runbook-action` v3 and newer. Until the server is upgraded to at least
2022.3.5512, the workflow pins the official legacy CLI installer to an immutable
commit SHA and invokes the documented `octo run-runbook` command directly. This
allows each prompted variable to be passed as a separate argument and enables
`--waitForRun`, progress reporting, a 15-minute bound, and cancellation on
timeout so the GitHub job represents the completed runbook result. The server
upgrade is an operational follow-up; switching to v4 must be validated in a PR
before removing this bridge.

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

### Bootstrap correction

The initial workflow listened only for pull requests targeting `main`, while the
three-tier governance model routes every agent-authored pull request to `dev`. The
workflow itself therefore could not receive an Octopus review before correcting its
base-branch filter. The human owner explicitly authorized this one-time bootstrap
exception on 2026-07-28: the correction may merge after CI, CodeRabbit, manual diff
review, and zero unresolved threads. After that merge, all open product pull requests
must be re-triggered and pass Octopus before merging.

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
