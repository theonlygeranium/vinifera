# REVERT.md — Stable Baseline & Rollback Guide

This document records the most recent verified stable state of the project and provides instructions for rolling back to it.

---

## Current Stable Baseline

| Field | Value |
|-------|-------|
| **Tag** | Not yet tagged — current HEAD is the stable state |
| **Commit SHA** | `7e4bbba` |
| **Date** | 2026-07-26 |
| **Verified by** | Writer Agent (thread 85816652) |
| **What was verified** | All 3 pages pass QA at 100/100 — 0 axe-core violations, 0 bugs, FCP < 370ms, CLS 0.0000, 6/6 security headers |

---

## How to Roll Back

### Option 1 — Git rollback (revert to a previous commit)
```bash
cd /workspace/.tmp/vinifera_repo
git log --oneline -20          # find the commit to roll back to
git revert <commit-sha>        # creates a revert commit
git push origin main           # Cloudflare Pages auto-deploys
```

### Option 2 — Force push to a known-good commit (requires human authorization)
```bash
git checkout 7e4bbba
git push origin HEAD:main --force   # requires human authorization
```

> Cloudflare Pages will auto-deploy whatever is on `main`. No manual deployment step is required.

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

- None — all three pages (landing, app, guide) pass full 8-phase QA at 100/100
- The workflow illustration for step 4 ("Ship & Track") renders as a shipping box with arrow rather than a delivery truck — minor visual discrepancy, not a functional issue
- Playwright WebKit ≠ real Safari iOS — ~30% of iOS-specific behaviors not reproducible. For production sign-off, test on a real iOS device or BrowserStack

---

## History of Stable Tags

| Tag | SHA | Date | Notes |
|-----|-----|------|-------|
| *(not yet tagged)* | `7e4bbba` | 2026-07-26 | Investor's guide added, all WCAG fixes applied, 3 pages pass QA 100/100 |
