# Phase 4 visual evidence

These captures use the deterministic Phase 4 Playwright API fixture. They verify
layout and presentation only; the values shown are not hosted production data.

## Accepted captures

| Surface | Test viewport | Evidence | Visual result |
| --- | --- | --- | --- |
| Analytics | 375 x 812 | `analytics-375.png` (375 x 4676 full page) | Mobile filters, KPI and widget cards, metric summaries, charts, tenure bars, decline reasons, and engagement signals stack without document overflow. The cohort table remains inside its focusable scroll region. |
| Analytics | 1440 x 1000 | `analytics-1440.png` (1440 x 2682 full page) | Desktop sidebar, KPI hierarchy, two-column charts, cohort table, CSV controls, and burgundy/gold data series remain aligned and unclipped. |
| AI Churn Watch | 768 x 1024 | `churn-intelligence-768.png` (768 x 1206 full page) | Tablet header, model status, A/B comparison, filters, heuristic score band, high-risk alert action, and explainability trigger remain legible with balanced spacing. |
| Peer Benchmarks | 375 x 812 | `benchmarks-375.png` (375 x 1269 full page) | Mobile peer summary, percentile cards, comparison bars, report toggle, and opt-out control stack cleanly without page overflow. |
| Compliance | 375 x 812 | `compliance-375.png` (375 x 2004 full page) | Mobile post-charge shipment checks render as stacked cards with member, destination, decision, reason, tax, provider response, freshness, and status-gated action visible without document overflow. |
| Quarterly benchmark report | US Letter | `benchmark-report.pdf` and `benchmark-report.png` | One-page burgundy/gold report has aligned metric columns, cohort bands, privacy notice, and page footer with no clipped or truncated copy. |

## Automated visual gate

`npx playwright test tests/e2e/phase4.spec.ts` passed all 18
tests. The matrix covers Analytics, AI Churn Watch, Peer Benchmarks, and
Compliance at 375, 768, and 1440px, plus their primary workflows. It verifies:

- 0 axe-core WCAG 2.1 AA violations;
- no document-level horizontal overflow;
- visible mobile interactive targets of at least 44 x 44px;
- LCP below 2.5 seconds and CLS below 0.1 in the deterministic harness;
- no framework overlay, browser console warning, or browser console error;
- a keyboard-only analytics workflow covering focus traversal, dialog
  activation/trapping/return, date-range application, and chart-table
  disclosure;
- an in-page chart-local timing mark: all five charts became visibly rendered
  24.80ms after the dashboard response ended in the full two-worker CI-equivalent
  94-test run, below
  the 500ms gate;
- accessible chart data-table alternatives and the canonical widget workflow.

Run the same gate with `UPDATE_PHASE4_QA_EVIDENCE=1` to regenerate the accepted
PNG captures after assertions pass:

```bash
UPDATE_PHASE4_QA_EVIDENCE=1 npx playwright test tests/e2e/phase4.spec.ts
```

Keyboard focus treatment is defined consistently for buttons, links, inputs,
selects, text areas, navigation items, and toggles with a visible 3px focus
outline and 2px offset.

The first 375px compliance inspection exposed a horizontally clipped table.
That gate correctly failed. The accepted capture was regenerated only after the
rows became accessible stacked cards and the full identifier remained available
to assistive technology behind a shortened visual form.

These screenshots use deterministic API fixtures. They demonstrate presentation
and browser behavior only. They do not show hosted winery data, an activated ML
model, a real peer cohort, or a live ShipCompliant decision.
