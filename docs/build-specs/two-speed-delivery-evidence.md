# Two-speed delivery performance evidence

**Date:** 2026-07-31
**Baseline:** `dev` at `55449cbe53e5982fab2085e07479cdc4b2b251a9`

## Evidence boundary

This report separates prior GitHub evidence, local proxy measurements, and
GitHub measurements that cannot exist until the new workflow is installed on
the default branch. Local timings are not represented as GitHub or Cloudflare
results.

## Before

GitHub Actions run
[`30411500908`](https://github.com/theonlygeranium/vinifera/actions/runs/30411500908)
for PR #51 measured:

- workflow wall time: 7 minutes 44 seconds;
- `Full type, test, build, and package`: 7 minutes 15 seconds;
- Android lint/debug/minified-release: 4 minutes 14 seconds; and
- the required aggregate completed after the full-quality job.

That release-quality critical path was also the routine-development path.

## After

The routine path removes these jobs:

- Phase 1–5 database architecture suites and local seed verification;
- complete Playwright/axe coverage;
- Android lint, debug assembly, and minified release assembly;
- staging/provider readiness probes;
- automatic Octopus review; and
- automatic `dev → staging` promotion dispatch.

It retains exact-diff classification, locked dependency installation,
TypeScript and Worker types, production web and Worker builds, focused tests,
whitespace and credential-pattern checks, and a two-test browser/accessibility
smoke. The external Cloudflare Pages check runs independently.

Local proxy measurements on the repository owner's Apple Silicon workstation:

- cold npm cache `npm ci`: 13.09 seconds;
- warm npm cache `npm ci`: 9.51 seconds;
- browser/accessibility smoke: 15.3 seconds for 2/2 tests; and
- production Vite build: under 1 second after dependency installation.

Observed exact-head feature runs for PRs #64–#66 completed `Dev fast checks`
successfully. The final PR #66 validation run `30528697926` completed in about
1 minute 55 seconds, within the three-minute design target. The resulting
`dev` merge at `55449cbe53e5` emitted successful unprivileged deployment
candidate run `30528910996`; that marker is not a Worker deployment. The
trusted preview, auto-merge, and Worker-release controllers remain inactive
until their reviewed definitions reach `main`.

The full-promotion duration is expected to remain near the measured 7-minute
15-second full-quality baseline, with Android removed from non-mobile
comparisons and retained for mobile diffs, explicit full-mobile requests, and
nightly drift detection.

## Execution reduction

The registered promotion workflow produced 17 automatic `dev`-push runs in the
observed 2026-07-28/29 delivery burst. The redesign reduces automatic promotion
runs from one per `dev` push to zero; monthly savings are:

```text
avoided promotion runs = monthly dev pushes - deliberate promotions
```

For planning, 17 pushes on each of 20 active delivery days with one deliberate
promotion per day would avoid about **320 promotion workflow runs per month**.
This is a workload-based projection, not a 30-day historical measurement.
Routine feature PRs also stop consuming full database, full browser, Android,
provider, and Octopus executions; their replacement is one bounded fast
workflow plus the independent Cloudflare preview.

## Follow-up measurement

After the default-branch bootstrap:

1. require `Dev fast checks` and the exact-head feature-preview check
   (`Cloudflare Pages: vinifera` in the current project configuration) on
   `dev` PRs;
2. run one representative routine frontend PR with an empty Actions cache;
3. rerun the same exact head with the lockfile/Node cache warm;
4. record aggregate start/end timestamps and the immutable/branch preview URLs;
5. run one deliberate non-mobile promotion and one scheduled Android gate; and
6. replace the projection above with a rolling 30-day Actions usage report.
