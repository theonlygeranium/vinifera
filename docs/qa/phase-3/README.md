# Phase 3 visual evidence

These screenshots exercise the production React surfaces with deterministic API
responses. They prove layout, rendering, and interaction behavior only.
Provider activation and hosted tenant data evidence are tracked separately in
`docs/build-specs/phase-3-qa-report.md`.

- `communications-desktop.png` — template editor and delivery log at 1440 px
- `churn-desktop.png` — explainable churn queue at 1440 px
- `cancel-mobile.png` — authenticated four-step cancellation flow at 375 px
- `loyalty-mobile.png` — member balance, redemption, and ledger at 375 px

The accompanying automated browser gate runs axe-core WCAG 2.1 AA, horizontal
overflow, 44 px effective touch target, focus containment/restoration, LCP, CLS,
and functional workflow assertions at 375, 768, and 1440 pixels. The current
Phase 3 gate is 27/27 and also covers unsaved-draft test delivery, current-tier
downgrade comparison, resumed cancellation steps, snapshot-keyset loyalty
ledgers, tenant-scoped retained command UUIDs across transient failure, reload,
and brand switches, and the direct rules-based churn surface.

Architecture commit `3b01c3a` passed GitHub Actions run
[`30229260377`](https://github.com/theonlygeranium/vinifera/actions/runs/30229260377).
Quality, Android lint/debug/minified release assembly, QA evidence upload, and
the Pages rollback artifact all passed; hosted mutation jobs remained
activation-gated.
