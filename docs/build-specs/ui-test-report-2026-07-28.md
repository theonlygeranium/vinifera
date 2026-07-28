# Vinifera Comprehensive UI Test Report — 2026-07-28

## Executive summary

This mission exercised the public, staff, member, administrative, analytics,
retention, communications, scale, and shared application surfaces specified by
the 2026-07-28 handoff. Testing combined authenticated Chrome inspection in the
Jeff - Pro profile, automated Playwright/axe coverage, source-contract review,
API fixture inspection, and an integrated local verification branch.

- Baseline `origin/dev` (`4d0ba11`): `npm run check` passed 448/448 tests and
  `npm run qa:e2e` passed 145/145 tests.
- Integrated candidate: `npm run check` passed 454/454 tests and the final
  complete `npm run qa:e2e` run passed 149/149 tests.
- Broad route matrix: 75/75 accessibility/layout cases passed, with 69 Worker
  route cases plus six static fallbacks for `/` and `/guide`.
- Broad responsive matrix: 125/125 route/viewport cases passed, with 115 Worker
  route cases plus ten static fallbacks for `/` and `/guide`.
- Final authenticated Chrome spot check: landing at 375px and 1440px and
  `/app/brands` at 375px had zero axe violations, zero horizontal overflow, and
  zero console errors.
- Fifteen scoped defect PRs and one test-manifest PR were opened against `dev`.
  No PR was merged during this mission.
- None of the mission PRs is merge-ready: Octopus is a required review gate,
  but its workflow opens PRs to `main` and therefore could not run within the
  mandatory `dev` target.

The integrated branch is local verification evidence only. Each production
change remains isolated in its own review-gated PR.

## Method and evidence boundaries

Authenticated inspection used the existing Jeff - Pro Chrome profile and its
signed-in GitHub session. Automated application routes ran against the local
Worker. Because the Vite application server does not serve `/` or `/guide`,
those public pages were inspected through the repository's static artifacts in
the broad route sweeps. Static fallback evidence is therefore not represented
as Worker-route evidence.

Network-dependent providers, hosted database mutations, billing, email, push,
and deployment activation were not enabled. API fixture and source-contract
results are identified separately from browser transport results.

## Test workstream results

| Workstream | Scope | Result | Material findings |
|---|---|---:|---|
| SA01 | Landing, guide, authentication | 50 pass, 3 initial findings | Pricing and signup CTA defects fixed; login tab order includes the useful Forgot Password link |
| SA02 | Staff shell and navigation | 41 pass, 1 nonblocking | Single-brand users still see the brand switcher when `canViewAllBrands` is true |
| SA03 | Dashboard | 20/20 pass | Mobile brand-breakdown copy has tight visual spacing |
| SA04 | Members, tiers, releases | 26 pass, 1 initial finding | Release rows now expose tier |
| SA05 | Fulfillment and member import | 27 pass, 1 initial finding | Import-preview focus ownership fixed |
| SA06 | Churn, communications, retention, loyalty | 18 pass, 2 product gaps | No active cancellation-attempt list; no explicit staff Redeem action |
| SA07 | Analytics and intelligence | 20 pass, 1 initial finding, 1 browser-not-tested | AUC/ROC display fixed; CSV formula sanitization has source/unit evidence |
| SA08 | Brand, team, integrations, white label | 28 pass, 5 initial findings | Brand status, role gate, and HTTPS logo fixed; roster and Owner invitation remain contract questions |
| SA09 | Member portal | 22 pass, 1 initial finding | Branded portal title fixed |
| SA10 | Shared components and error states | 32 pass, 2 initial findings | Empty FormFeedback and LoadingScreen status semantics fixed |
| SA11 | Accessibility and layout sweep | 75/75 pass after fixes | Exact skip link and robust focus indicator added |
| SA12 | Responsive and navigation sweep | 125/125 pass after fix | Mobile brand select now uses a 16px font and retains a 44px target |

The workstream counts overlap by design: the broad matrices re-exercise routes
already covered by the feature workstreams.

## Defects and pull requests

| Route/component | Finding | Severity | Resolution branch | PR | Status at report publication |
|---|---|---:|---|---:|---|
| `/app/releases` | Release rows omitted tier | Medium | `fix/ui-releases-show-tier` | [#28](https://github.com/theonlygeranium/vinifera/pull/28) | Fixed; CI/CodeRabbit clean; Octopus missing |
| Landing pricing CTA | Trial CTAs did not identify the signup destination | High | `fix/ui-landing-signup-cta` | [#29](https://github.com/theonlygeranium/vinifera/pull/29) | Fixed; CI/CodeRabbit clean; Octopus missing |
| Landing pricing | Canonical four-tier offer was not represented | High | `fix/ui-landing-pricing-tiers` | [#30](https://github.com/theonlygeranium/vinifera/pull/30) | Fixed; CI/CodeRabbit clean; Octopus missing |
| `/app/import` | Focus could remain inside hidden preview content | High | `fix/ui-import-preview-focus` | [#31](https://github.com/theonlygeranium/vinifera/pull/31) | Fixed; CI/CodeRabbit clean; Octopus missing |
| Landing header | Navigation targets did not resolve to their intended sections | Medium | `fix/ui-landing-nav-targets` | [#32](https://github.com/theonlygeranium/vinifera/pull/32) | Fixed; CI/CodeRabbit clean; Octopus missing |
| Churn model analytics | AUC was presented without the ROC relationship | Medium | `fix/ui-churn-auc-roc` | [#33](https://github.com/theonlygeranium/vinifera/pull/33) | Fixed; CI/CodeRabbit clean; Octopus missing |
| `/app/brands` | Brand creation was not restricted to Owner | High | `fix/ui-brand-create-role-gate` | [#34](https://github.com/theonlygeranium/vinifera/pull/34) | Fixed; CI/CodeRabbit clean; Octopus missing |
| White-label settings | Logo URL accepted non-HTTPS values | High | `fix/ui-white-label-https-logo` | [#35](https://github.com/theonlygeranium/vinifera/pull/35) | Fixed; CI/CodeRabbit clean; Octopus missing |
| Member portal | Document title did not reflect portal branding | Medium | `fix/ui-member-portal-title` | [#36](https://github.com/theonlygeranium/vinifera/pull/36) | Fixed; CI/CodeRabbit clean; Octopus missing |
| `/app/brands` | Brand status was not visible in the list | Medium | `fix/ui-brand-status` | [#37](https://github.com/theonlygeranium/vinifera/pull/37) | Fixed; CI/CodeRabbit clean; Octopus missing |
| Shared FormFeedback | Empty message produced an announced empty region | Medium | `fix/ui-empty-form-feedback` | [#38](https://github.com/theonlygeranium/vinifera/pull/38) | Fixed; CodeRabbit clean; unrelated CLS CI failure; Octopus missing |
| Shared LoadingScreen | Visible loading label lacked reliable status semantics | High | `fix/ui-loading-screen-status` | [#39](https://github.com/theonlygeranium/vinifera/pull/39) | Fixed; CI/CodeRabbit clean; Octopus missing |
| Staff shell | Required exact skip link was absent | High | `fix/ui-staff-skip-link` | [#40](https://github.com/theonlygeranium/vinifera/pull/40) | Fixed; CI/CodeRabbit clean; Octopus missing |
| Landing and app focus | Focus indicators were absent or too weak | High | `fix/ui-focus-indicators` | [#41](https://github.com/theonlygeranium/vinifera/pull/41) | Fixed; CI/CodeRabbit clean; Octopus missing |
| Mobile brand selector | 11px select text could trigger iOS zoom | Medium | `fix/ui-mobile-brand-select-font` | [#42](https://github.com/theonlygeranium/vinifera/pull/42) | Fixed; CI/CodeRabbit clean; Octopus missing |

The prerequisite manifest is tracked in
[#27](https://github.com/theonlygeranium/vinifera/pull/27). All PRs target
`dev`; none was merged.

## Integrated verification

The local `test/ui-fix-integration` branch cherry-picked the isolated fixes to
detect composition failures without changing their review boundaries.

| Gate | Result |
|---|---|
| Type, unit, build, Worker dry-run | 454/454 tests passed |
| Playwright/axe | Final complete run 149/149 passed |
| Mobile authenticated Chrome | Exact skip link, 3px focus, Enter-to-main focus, 16px/44px selector, role-aware brand creation, status labels |
| Public Chrome at 375px and 1440px | Exact four tiers; trial/contact CTA split; header targets; zero axe, overflow, and console findings |

Two earlier performance samples were above their strict thresholds: a tablet
loyalty CLS sample of `0.108670...` and a roster response sample of 1005.9ms.
No threshold was relaxed. The next complete integrated run passed, with the
roster sample at 460.3ms. PR #38's CI rerun reproduced the exact loyalty CLS
value (`0.10867015769084296`) on all three hosted attempts; the failure remains
visible rather than broadening that shared-component PR or relaxing the gate.

## Open findings and decisions

1. The staff login tab-order specification skips over a useful Forgot Password
   link. The implementation remains keyboard accessible; the written expected
   sequence should be reconciled with the product intent.
2. The brand switcher remains visible for a single-brand account when
   `canViewAllBrands` is true. This is not an access-control bypass.
3. Dashboard brand-breakdown content is functional on mobile but visually
   cramped.
4. Retention lacks an active cancellation-attempt list. The current API/product
   contract does not expose the required collection.
5. Staff loyalty lacks an explicit Redeem action. The current API/product
   contract does not authorize that mutation.
6. Team roster evidence is blocked by available data/API behavior.
7. Inviting another Owner conflicts with the current security model, which
   explicitly prevents Owner-role delegation.
8. CSV formula-injection stripping is covered by source and unit evidence, but
   the native browser download transport was not directly exercised.
9. Local Worker CSP blocks the inline CSS in the static landing page while the
   current Pages headers permit it with `unsafe-inline`. A future Worker/custom
   domain cutover needs an explicit security and deployment decision.
10. `/app/signup` is the future development Worker route. The current Pages
    `/app/*` rewrite continues to serve the static prototype until cutover.
11. The Octopus workflow opens PRs to `main`. Because every mission PR is
    required to target `dev`, Octopus could not run without silently changing
    governance.

## Activation boundary

All 20 activation gates confirmed pending — no gates were touched during this testing mission.

No provider credentials, production data, hosted migrations, deployment flags,
billing actions, email sends, push sends, or merge actions were activated.

## Reproduction

The exact locally tested integrated snapshot is
`72d85f82d96384334f066763f5a2ee5d31744699`. It was assembled from
`origin/dev` at `4d0ba11641b46620d4ef966a9401348fd6b6271b` by applying these
pinned PR heads in order:

| Order | PR | Tested head |
|---:|---:|---|
| 1 | #28 | `cf650b8` |
| 2 | #29 | `ef0a98e` |
| 3 | #30 | `1ea71c0` |
| 4 | #31 | `9823141` |
| 5 | #32 | `5661a79` |
| 6 | #33 | `d3910d2` |
| 7 | #34 | `8242180` |
| 8 | #35 | `f9369e8` |
| 9 | #36 | `65dcb5f` |
| 10 | #37 | `10c5c96` |
| 11 | #38 | `9221cb8` |
| 12 | #39 | `63aafb1` |
| 13 | #40 | `6de2488` |
| 14 | #41 | `bd3700e` |
| 15 | #42 | `ef25890` |

Check out the pinned base
`4d0ba11641b46620d4ef966a9401348fd6b6271b`, then cherry-pick all commits in
each `4d0ba11641b46620d4ef966a9401348fd6b6271b..head` range in chronological
order before moving to the next row. Do not substitute the moving `dev`
reference. Review follow-ups on #39–#41 landed after this integrated measurement
and were each validated separately with full `npm run check` and 145/145
Playwright runs.

From a clean checkout of the reconstructed snapshot or an individual PR:

```bash
npm ci
npm run check
npm run qa:e2e
```

For the final authenticated spot check, use the Jeff - Pro Chrome profile and
verify both 375px and 1440px where applicable. Confirm keyboard focus, axe
results, horizontal overflow, console output, and route behavior independently.
