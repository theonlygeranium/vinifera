# ADR 2026-07-28: AGENTS.md Ownership and Governance Policy Update

**Date:** 2026-07-28
**Status:** Accepted
**Deciders:** Human owner (EdStratum Labs) + Writer Agent
**Branch:** docs/agents-md-rewrite

---

## Context

`AGENTS.md` is the primary collaboration contract for all agents working in the `vinifera` repository. It defines prime directives, file ownership, branching rules, CI/CD topology, and review protocol.

The file was previously marked as **"Human owner only"** in the ownership table — requiring direct human editing for any update. This created a practical bottleneck: documentation drift could not be corrected by agents, and even purely editorial changes (fixing stale workflow names, updating test counts) required manual human commits.

Separately, Greptile and CodeRabbit review findings on PR #21 identified that the prior AGENTS.md contained incorrect workflow filenames and stale test counts — defects that could not be fixed autonomously under the previous governance policy.

---

## Decision

The ownership policy for `AGENTS.md` is updated from:

> **Human owner only**

to:

> **Any agent via PR — human owner must review and merge**

This means:
- Agents may open PRs that modify `AGENTS.md`.
- The human owner must review and merge every such PR — no auto-merge.
- Changes to Section 2 (Prime Directives) or the ownership table itself require a corresponding ADR in `docs/decisions/`.
- All other Agent Guide sections (structure, tooling references, workflow names, test counts) may be updated by agents via the standard PR/review cycle.

---

## Rationale

**Why allow agent PRs to AGENTS.md:**
- The file must stay current with the actual codebase. Stale workflow names, incorrect test counts, and outdated file-ownership entries are active liabilities — they cause agents executing later tasks to operate on false context.
- The human review gate is preserved. No agent can merge its own AGENTS.md PR; the owner sees every change before it lands on `main`.
- This mirrors the established governance model for all other documentation in the repository (README.md, CONTINUITY_BRIEF.md, ADRs) — human-reviewed, not human-only.

**Why require an ADR for Prime Directive changes:**
- Section 2 (Prime Directives) and the ownership table are high-leverage governance surfaces. Changing them requires a documented rationale that future agents can read to understand why the policy exists in its current form.
- This ADR is the evidence record for the ownership change itself.

**Why not require an ADR for every AGENTS.md edit:**
- Tool names, workflow filenames, test counts, and structural maps are factual records of the codebase state, not architectural decisions. Requiring an ADR for every count update would create unnecessary friction without governance benefit.

---

## Consequences

**Positive:**
- Agents can fix documentation drift in AGENTS.md autonomously, closing a loop that previously required human intervention for even trivial corrections.
- Greptile and CodeRabbit can review proposed changes before they land, providing an additional quality gate.
- The human owner retains final merge authority, preserving governance integrity.

**Negative / Risks:**
- An agent could misrepresent reality in AGENTS.md (e.g., marking a pending activation gate as complete). Mitigation: the human review gate is non-waivable, and CI must pass before merge.
- Prime Directive creep is possible if agents add self-serving rules. Mitigation: any change to Section 2 or the ownership table requires an ADR, which must survive human review.

---

## Implementation Notes

This ADR is filed as part of PR #21 (`docs/agents-md-rewrite`), which is the first PR to take effect under the updated governance policy. The ownership table in AGENTS.md is updated in the same commit that creates this ADR.
