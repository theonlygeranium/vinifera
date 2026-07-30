# ADR: PR Ownership and Automation Governance

**Date:** 2026-07-27
**Status:** Accepted
**Decided by:** Human owner, implemented by Codex

> **Amended 2026-07-30:** The principal-orchestrator candidate-delivery ADR
> reduces the repair limit from three to two substantive cycles, makes
> CodeRabbit optional while unavailable, reserves Octopus for promotion and
> high-risk work, and validates routine post-merge state on `dev` rather than
> `main`. Its exact-candidate and emergency-label rules supersede conflicting
> statements below.

## Context

The repository already required pull requests, CI, Greptile, and a direct-push
guard, but its prompts treated opening a PR as the agent's stopping point.
That split implementation context from review ownership and left no durable
safety net when an agent task ended, crashed, or lost context. GitHub also did
not require review conversations to be resolved before merge.

## Decision

Use three complementary enforcement layers:

1. The implementation agent remains the long-running owner of its PR. Opening
   the PR is not completion; the agent must use an available wait or monitor
   mechanism until every required check passes and zero unresolved review
   threads remain.
2. A recurring Codex repository monitor runs every 15 minutes and inspects only
   PRs labeled `codex-managed`. The additional labels `codex-auto-fix`,
   `codex-auto-merge`, `human-review-required`, and `do-not-merge` grant or
   restrict specific actions. The monitor cannot grant itself authority.
3. GitHub branch protection independently requires the protected CI and
   Greptile checks, a branch current with `main`, resolved conversations,
   pull-request-only updates, administrator enforcement, and no force pushes
   or branch deletion.

`do-not-merge` is an absolute prohibition. `human-review-required` blocks
every automated mutation, including replies and thread resolution; the monitor
may only inspect, notify the human owner, and stop. `codex-auto-fix` authorizes
only localized, low-risk fixes on a `codex-managed` PR.
`codex-auto-merge` is explicit standing merge authority only after every gate
passes and neither blocking label is present.

Architecture, authentication, authorization, database migrations, billing,
production configuration, provider activation, security tradeoffs,
destructive actions, and materially expanded scope always require human
review. The monitor stops after two substantive fix/review cycles or when
the same finding reappears.

## Rationale

The implementation agent has the strongest context for resolving review
feedback, while a label-scoped recurring monitor covers abandoned tasks
without receiving blanket repository authority. Branch protection remains the
independent enforcement boundary if either agent layer fails.

Explicit label precedence makes automation authority observable and
revocable. Requiring a fresh review and affected tests after every push avoids
treating stale evidence as approval.

## Alternatives Considered

- Ending when the PR opens was rejected because it abandons the review and CI
  lifecycle.
- A repository-wide bot with implicit write and merge authority was rejected
  because it could modify unrelated PRs or expand scope silently.
- Automation-only enforcement was rejected because a failed or misconfigured
  monitor must not weaken GitHub's merge gates.
- Human-only polling was rejected because it does not cover unattended or
  crashed agent tasks.

## Consequences

- Agents must budget time for the complete review loop and cannot report PR
  creation as terminal success.
- Pending checks produce no repeated status noise; state changes, escalation,
  and completion are reported.
- Low-risk fixes can proceed only under label authority, while sensitive or
  repeated findings stop for human review.
- Automatic merge is possible only under explicit label authority and after
  exact-candidate checks are revalidated immediately before merge to `dev`;
  the resulting `dev` revision and applicable stable-dev evidence are then
  verified separately.
- The external Codex automation and GitHub settings must be audited alongside
  repository documentation.

## References

- [`AGENTS.md`](../../AGENTS.md)
- [`docs/agent-workflow.md`](../agent-workflow.md)
- [`.github/pull_request_template.md`](../../.github/pull_request_template.md)
- [`docs/build-specs/governance-notes.md`](../build-specs/governance-notes.md)
- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
