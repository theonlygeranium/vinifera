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
and functional workflow assertions at 375, 768, and 1440 pixels.
