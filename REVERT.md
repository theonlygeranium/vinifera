# REVERT.md — Stable Baseline & Rollback Guide

This document records the most recent verified stable state of the project and provides instructions for rolling back to it.

---

## Current Stable Baseline

| Field | Value |
|-------|-------|
| **Tag** | Not yet tagged — static Pages baseline |
| **Commit SHA** | `0807b519b4adaa2fad21162c342c99f200617254` |
| **Date** | 2026-07-26 |
| **Verified by** | Codex production build QA |
| **What was verified** | Successful CI plus live `200` responses for landing, original `/app/` prototype, and guide; Pages rollback packaging prevents the unactivated Worker application from replacing the public baseline |

The Phase 1 and Phase 2 Worker source is a release candidate, not the
custom-domain stable baseline, until hosted Supabase, Stripe test-mode, and
EasyPost verification passes.

---

## How to Roll Back

### Option 1 — Git rollback (revert to a previous commit)
```bash
cd /Users/jeffgeronimo/Documents/vinifera
git log --oneline -20          # find the commit to roll back to
git revert <commit-sha>        # creates a revert commit
git push origin main           # Cloudflare Pages auto-deploys
```

Do not force-push `main`. If the Worker has not been attached to the custom domain, the Pages baseline is already the public rollback surface.

---

## Tagging a New Stable Release

When a release is verified stable:

```bash
git tag -a vX.Y-stable -m "Brief description of this stable state"
git push origin vX.Y-stable
```

Then update the table above with the new tag, SHA, date, and what was verified.

---

## Known Issues at Current Baseline

- The public baseline is a visual prototype, not the data-connected Worker application.
- Phase 1 and Phase 2 provider connections remain intentionally fail-closed pending hosted activation evidence.
- The workflow illustration for step 4 ("Ship & Track") renders as a shipping box with arrow rather than a delivery truck — minor visual discrepancy, not a functional issue
- Playwright WebKit ≠ real Safari iOS — ~30% of iOS-specific behaviors not reproducible. For production sign-off, test on a real iOS device or BrowserStack

---

## History of Stable Tags

| Tag | SHA | Date | Notes |
|-----|-----|------|-------|
| *(not yet tagged)* | `0807b519` | 2026-07-26 | Pages rollback baseline, successful CI, and live root/app/guide verification |
| *(historical)* | `7e4bbba` | 2026-07-26 | Investor's guide added, WCAG fixes applied, three static pages passed QA |
