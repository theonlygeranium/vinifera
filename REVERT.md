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

Version 0.5.0 contains the complete Phase 1–5 source architecture, but it is a
release candidate rather than the custom-domain stable baseline. Hosted
Supabase, Stripe, EasyPost, Resend, ShipCompliant, Klaviyo, QuickBooks,
Avalara/Meta, custom-domain, native signing, physical-device, and store-track
verification must pass before that designation changes.

---

## How to Roll Back

### Option 1 — Source rollback through the protected branch pipeline
```bash
git fetch origin
git switch -c fix/revert-<description> origin/dev
git revert <commit-sha>
git push -u origin fix/revert-<description>
# Open the reviewed PR against dev; use the protected promotion path afterward.
```

Do not push or force-push `main` or `staging`. The optional CI deployment targets only the isolated
`vinifera-staging` Worker. The protected production release workflow can create
or version a separate Worker without moving the domain. If that Worker has not
been attached to the custom domain, the Pages baseline is already the public
rollback surface.

The standard production Worker workflow does not move the public domain or
restore Pages. After a separately authorized domain cutover, follow the
allowlisted legacy restoration procedure in
`docs/runbooks/production-cutover-rollback.md`; verify the static root and
prototype marker without deleting the retained Pages project.

Before reverting an activated Phase 5 connection, first stop or disconnect its
jobs, preserve sanitized reconciliation history, revoke provider tokens when
supported, and rotate any exposed envelope key. Brand-column migrations are
forward-only once populated; restore a verified database backup rather than
dropping Phase 5 tables in place. Reverting Git does not undo winery DNS,
Cloudflare custom hostnames, Stripe dashboard keys/webhooks, or app-store
releases.

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
- Phase 1–5 provider connections remain intentionally fail-closed pending
  hosted activation evidence; the ML production gate also requires sufficient
  real outcomes and a completed shadow comparison.
- Winery Klaviyo, Avalara, and Meta credentials have no hosted validation yet.
  QuickBooks application OAuth and encrypted per-connection tokens also await an
  Intuit sandbox/company.
- Custom winery DNS and Cloudflare certificate activation are not complete.
- Stripe live-mode transition, signed physical-device APNs/FCM testing,
  TestFlight, Play internal track, and public store review remain
  human/credential-bound.
- Production release and signed internal-store workflows are source-complete
  but their target allowlists or credential sets are intentionally incomplete;
  no source-only pass is live activation evidence.
- The workflow illustration for step 4 ("Ship & Track") renders as a shipping box with arrow rather than a delivery truck — minor visual discrepancy, not a functional issue
- Playwright WebKit ≠ real Safari iOS — ~30% of iOS-specific behaviors not reproducible. For production sign-off, test on a real iOS device or BrowserStack

---

## History of Stable Tags

| Tag | SHA | Date | Notes |
|-----|-----|------|-------|
| *(not yet tagged)* | `0807b519` | 2026-07-26 | Pages rollback baseline, successful CI, and live root/app/guide verification |
| *(historical)* | `7e4bbba` | 2026-07-26 | Investor's guide added, WCAG fixes applied, three static pages passed QA |
