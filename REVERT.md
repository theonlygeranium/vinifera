# REVERT.md — Stable Baseline & Rollback Guide

This document records the most recent verified stable state of the project and provides instructions for rolling back to it.

---

## Current Stable Baseline

| Field | Value |
|-------|-------|
| **Tag** | Not yet tagged — static Pages baseline |
| **Commit SHA** | `7e4bbba` |
| **Date** | 2026-07-26 |
| **Verified by** | Writer Agent (thread 85816652) |
| **What was verified** | Static landing, app prototype, and guide: 0 axe-core violations, responsive QA, FCP < 370ms, CLS 0.0000, and security headers |

The Phase 1 Worker is a release candidate, not the custom-domain stable baseline, until hosted Supabase and Stripe test-mode verification passes.

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

- The baseline is a visual prototype, not the data-connected Phase 1 application.
- The workflow illustration for step 4 ("Ship & Track") renders as a shipping box with arrow rather than a delivery truck — minor visual discrepancy, not a functional issue
- Playwright WebKit ≠ real Safari iOS — ~30% of iOS-specific behaviors not reproducible. For production sign-off, test on a real iOS device or BrowserStack

---

## History of Stable Tags

| Tag | SHA | Date | Notes |
|-----|-----|------|-------|
| *(not yet tagged)* | `7e4bbba` | 2026-07-26 | Investor's guide added, all WCAG fixes applied, 3 pages pass QA 100/100 |
