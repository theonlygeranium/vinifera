# ADR: Automate reversible approvals and alert only on critical escalations

**Date:** 2026-08-07
**Status:** Accepted
**Decided by:** EdStratum Labs (human owner, `founder@edstratumlabs.ai`) — explicitly authorized in the originating task; implemented by a Cursor cloud agent.

## Context

Vinifera's delivery governance accumulated a large number of human-approval
checkpoints. Because the project currently has a **single collaborator**
(`@theonlygeranium`) and every protected GitHub environment has
`prevent_self_review = false`, most of those "approvals" are in practice
**self-approvals**: the same identity authors, approves, and releases. That adds
operational friction on every routine, reversible change while providing
essentially no independent-review security (a single account is both author and
approver).

The owner's stated intent is to **automate approvals as much as possible and be
alerted only for critical escalations that genuinely require a human decision.**

This ADR records that decision, the exact split between automated and
human-gated actions, the compensating controls that keep the automated path
safe, and — importantly — a **standing instruction that this loosening is
intentional and must not be reversed or re-tightened by an agent without the
owner's explicit approval.**

## Decision

### 1. Automated by default (no human click required)

- **Feature → `dev` merge** stays automated via `codex-auto-merge` +
  `.github/delivery-risk-contract.json` for low/medium-risk, same-repository PRs
  after exact-SHA revalidation. (Unchanged; already in place.)
- **`dev → staging` promotion is now hands-off.** A new dispatcher workflow
  (`.github/workflows/promote-dev-to-staging-auto.yml`) automatically invokes the
  existing, unchanged `promote-dev-to-staging.yml` when `dev` is ahead of
  `staging`, under a standing owner-approved automation reason, with
  `auto_merge=true`. **Every fail-closed gate in the promotion workflow remains
  in force** (staging Supabase REST probe ×2, exact-head/base `Vinifera
  Promotion Gate`, Octopus, active-review check, emergency-label check, exact-SHA
  merge guard).
- **Reversible protected environments** (`promotion-control`, `staging`,
  `development-worker`) should carry **zero required reviewers** in GitHub. They
  remain as environments for secret scoping and branch policy; the automated
  evidence gates — not a human click — authorize them. (This is a GitHub
  settings change tracked in `docs/build-specs/governance-notes.md`; it cannot be
  represented by repository code alone.)

### 2. Alert-only escalation channel

A new workflow (`.github/workflows/escalation-alert.yml`) opens a GitHub issue
that `@`-mentions the owner (and optionally posts to an `ESCALATION_WEBHOOK_URL`
if configured) whenever, and only whenever:

- an emergency label (`human-review-required` or `do-not-merge`) is applied to a
  PR; or
- a consequential protected workflow run is **requested** — `Production Worker
  release`, `Stripe live billing cutover`, `Stripe Gate 19 live charge and refund
  proof`, `Credential envelope key rotation`, or `Signed mobile internal
  release`.

The happy path stays silent; the owner is pinged only when a genuine decision is
pending.

### 3. Still human-gated — the "critical escalation" set (unchanged)

These remain human-authorized with their existing protected environments and
exact confirmation phrases, and are the boundaries the alert channel exists to
surface:

- Live / real-money billing (Stripe live keys, live charge/refund).
- Production Worker deploy and production domain cutover.
- DNS / domain-ownership changes.
- Destructive or irreversible database work (non-additive migrations, deletion).
- Credential rotation / suspected credential compromise.
- App-store submission (public release).
- Changes to Prime Directives (`AGENTS.md` §2), the ownership table, or anything
  that **weakens a hard-stop workflow or `.octopus` rule**.
- Legal/regulatory or materially-undefined product decisions.

The delivery-risk classifier intentionally continues to mark `.github/`,
`.octopus/`, `supabase/migrations/`, and auth/billing/credential/DNS paths as
high-risk so they are **never auto-merged** and always reach the owner. This is
deliberate and consistent with §4.

### 4. Locked decision — do not reverse without owner approval

This automation posture is a **deliberate, owner-approved trade-off**. A future
agent (or an automated reviewer such as Octopus/CodeRabbit) may reasonably read
"fewer human approvals" as a security regression. **It is not a defect and must
not be silently reversed, re-tightened, or re-escalated.**

Any change that would re-introduce a human approval removed here — for example
re-adding required reviewers to `promotion-control`/`staging`/`development-worker`,
reverting the auto-promotion dispatcher, disabling the escalation-alert workflow,
or narrowing `codex-auto-merge` eligibility — requires the **explicit approval of
the human owner** and a superseding ADR. Absent that, treat this ADR as binding.

Conversely, the human-gated boundaries in §3 must **not** be loosened further
without the same owner approval + superseding ADR.

## Rationale

- With one self-approving collaborator, the removed approvals were friction
  without independent-review value.
- The safety of the automated path does not depend on a human click; it depends
  on **compensating controls that remain fully in force**: exact-SHA head/base
  revalidation, hashed target allowlists (`config/*-policy.json`), fail-closed
  provider adapters, the delivery-risk classifier, Octopus rule checks,
  `direct-push-guard`, staging REST health probes, and automatic rollback to the
  prior reviewed Worker version.
- Concentrating human attention on the genuinely irreversible boundaries (money,
  DNS, credentials, production, public store, governance) matches where a human
  decision actually adds value.

## Alternatives Considered

- **Add a second reviewer and enable `prevent_self_review=true` / required
  approvals on `main`.** This is the *security-hardening* direction recommended
  in `docs/build-specs/governance-notes.md`. It is the opposite of the owner's
  goal and is deferred; it remains available for the production/billing/DNS tier
  if the owner later wants true four-eyes there.
- **Widen the delivery-risk classifier so `.github/`/migrations auto-merge.**
  Rejected: it conflicts with §3/§4 (governance changes should reach the owner)
  and would destabilize heavily-tested classification logic for little benefit,
  since reversible medium-risk changes already auto-merge.
- **Deeply rewrite `promote-dev-to-staging.yml` to self-trigger.** Rejected in
  favor of a thin, additive dispatcher so the battle-tested, fail-closed
  promotion logic stays byte-for-byte unchanged.

## Consequences

- Routine delivery from feature branch through `dev` and on to `staging` becomes
  hands-off when evidence is green; the owner stops clicking dispatch/approve for
  reversible steps.
- The owner receives a targeted alert only for emergency labels and consequential
  protected workflows.
- Production, billing, DNS, credentials, mobile-store, and governance changes are
  unchanged and still require the owner.
- New/changed files: `docs/decisions/2026-08-07-automated-approval-delegation.md`
  (this ADR), `.github/workflows/promote-dev-to-staging-auto.yml`,
  `.github/workflows/escalation-alert.yml`, plus locked-decision notes in
  `AGENTS.md`, `docs/agent-workflow.md`, and `docs/build-specs/governance-notes.md`.
- **Activation note:** like the other delivery controllers, the two new workflows
  only take effect once they reach the default branch and the referenced secrets
  (`GH_PAT_FOR_OCTOPUS`, `STAGING_*`, optional `ESCALATION_WEBHOOK_URL`) and
  environment settings are provisioned by the owner.

## References

- `docs/decisions/2026-07-28-automated-dev-staging-promotion.md` (amended by the
  auto-trigger dispatcher)
- `docs/decisions/2026-07-29-two-speed-delivery-governance.md`
- `docs/decisions/2026-08-05-narrow-human-review-stop-boundary.md`
- `docs/decisions/2026-07-30-principal-orchestrator-candidate-delivery.md`
- `docs/build-specs/governance-notes.md`
- `.github/delivery-risk-contract.json`
