# Governance Notes

**Last verified:** 2026-07-27
**Risk:** Medium

## Change record

### What changed

The owner-authorized PR governance update makes end-to-end review ownership a
terminal condition for implementation agents, adds a label-scoped recurring
Codex monitor, expands `.github/pull_request_template.md`, and updates Codex
dispatch prompts to reference one canonical completion loop.

The external rollout adds five governance labels and enables required
conversation resolution on `main` while preserving strict required checks,
administrator enforcement, pull-request-only updates, and force-push/deletion
prohibitions.

### Why

Opening a PR was previously treated as the end of an agent task. That could
strand CI failures or unresolved review feedback after the agent with the
strongest implementation context exited. A recurring monitor is a useful
safety net, but it must not receive implicit authority over every PR or replace
independent GitHub enforcement.

### Deployment impact

No application deployment impact. These changes affect repository process,
GitHub branch protection and labels, and a local Codex automation. They do not
change runtime routes, build output, hosted database state, provider
activation, Worker deployment, Pages content, or activation gates.

### Verification

GitHub API inspection on 2026-07-27 confirmed that `main` uses strict required
checks for `Type, test, build, and package`, `Greptile Review`, and
`Block direct push to main`; requires conversation resolution; applies
protection to administrators; and prohibits force pushes and deletion. The
rule still requires zero approvals, does not require CODEOWNERS review, and
does not dismiss stale approvals. The five automation labels were read back
with their descriptions. The Codex automation definition, canonical workflow,
prompt references, and PR template are checked separately because they are not
part of GitHub's branch-protection response.

## Current controls

GitHub API inspection confirms that `main` is protected, administrators are
subject to the protection rule, and strict required-status checking is enabled.
The required checks are `Type, test, build, and package`, `Greptile Review`,
and `Block direct push to main`. Pull requests must be current with `main` and
all review conversations must be resolved. The rule currently requires zero
approving reviews, does not require a CODEOWNERS review, and does not dismiss
stale approvals.

The `staging`, `production`, and `mobile-release` GitHub environments each name
`@theonlygeranium` as the only required reviewer. GitHub's
`prevent_self_review` setting is `false` on all three environments. A workflow
run initiated by the repository owner can therefore be approved by the same
account.

The repository declares `@theonlygeranium` as the owner of every path in
`.github/CODEOWNERS`. This provides durable ownership routing, but CODEOWNERS
cannot provide independent approval while the owner is the only collaborator
and branch protection does not require code-owner review.

## Automation authority model

The recurring Codex monitor checks every 15 minutes but selects only open PRs
with `codex-managed`. It may inspect state and write an evidence-based
disposition for a verified non-actionable finding. It may change code only when
`codex-auto-fix` is also present, and then only for localized low-risk work on
the existing branch. It may merge only when `codex-auto-merge` is present and
every documented gate passes.

`do-not-merge` is an absolute merge prohibition. `human-review-required`
blocks merge, promotion, deployment, and the specific consequential owner
decision; the monitor continues safe diagnosis, localized repair, replies,
thread resolution, review, preview, packaging, and evidence gathering.
Automation may add
`human-review-required` when it encounters a sensitive boundary or repeated
failure, but it may not remove either blocking label or grant itself
`codex-auto-fix` or `codex-auto-merge`.

Human review is reserved for destructive or irreversible database work,
credible production data-loss or unresolved authentication, authorization,
tenant-isolation or secret-exposure risk, real-money billing decisions,
legal/regulatory judgment, suspected credential compromise, DNS/domain
ownership changes, materially undefined product choices, or failure without a
safe fallback. Additive migrations, staging/provider sandbox activation,
workflow repair, protected deployment, and automatic rollback may proceed
under standing authority and exact fail-closed controls.

## Risk

One compromised or mistaken owner account can author, approve, and release a
change without independent human review. CI and Greptile remain valuable
technical gates, but neither is a substitute for a second authorized reviewer
on credential-bearing deployment environments. Label-gated automation narrows
authority but does not create an independent human approval boundary.

## Owner decision (2026-08-07) — automation-first approvals

The owner has chosen to **minimize human approvals for reversible delivery** and
be **alerted only for critical escalations**. See
`docs/decisions/2026-08-07-automated-approval-delegation.md`. This is a
deliberate, owner-approved trade-off; agents must not reverse or re-tighten it
without the owner's explicit approval and a superseding ADR.

Under this decision the *security-hardening* recommendations below (second
reviewer, required approvals, `prevent_self_review=true`) are **intentionally
deferred** — they are the opposite of the owner's current goal. They remain
documented as the alternative direction if the owner later wants true
independent review on the production/billing tier.

### Owner GitHub settings to apply for the loosening

These are external GitHub controls (not representable by repository code) and
should be applied by the owner or via an admin-scoped token:

- [ ] Set required reviewers to **0** on the `promotion-control`, `staging`, and
  `development-worker` environments (keep them for secret scoping only).
- [ ] Keep required reviewers on `production` and `mobile-release` (these remain
  human-gated critical escalations).
- [ ] Confirm the two new workflows are present on the default branch so their
  `workflow_run`/`schedule` triggers activate.
- [ ] Optional: add an `ESCALATION_WEBHOOK_URL` secret to also receive alerts in
  Slack/Teams; the GitHub issue `@`-mention works without it.

## Recommended human configuration (deferred — security-hardening alternative)

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
