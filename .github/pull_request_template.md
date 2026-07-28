## Summary
<!-- What changed and why -->

## Type of change
- [ ] Bug fix
- [ ] New feature
- [ ] Refactor (no behavior change)
- [ ] Docs
- [ ] Chore / dependency update

## Testing
- CI-selected validation lane: <!-- `docs` or `full`; report the check result, do not self-authorize it -->
- Classifier evidence: <!-- exact base/head SHAs and reason from the CI summary -->
- [ ] Dependency security audit passes (`npm audit --audit-level=moderate`)
- [ ] Unit tests pass (`npm test`)
- [ ] Database gates pass (`npm run qa:db:phase1` through `npm run qa:db:phase5`)
- [ ] E2E tests pass (`npm run qa:e2e`)
- [ ] Typecheck passes (`npm run typecheck`)
- [ ] Static/Pages/Worker packages build (`npm run build`, `npm run build:pages`, `npm run build:worker`)
- [ ] Required checks pass: `Type, test, build, and package`, `Greptile Review`, and `Block direct push to main`
- [ ] Branch is current with `main`
<!-- Explain any intentionally inapplicable gate under Risks and assumptions. -->
<!-- Checkboxes and labels do not grant documentation-only status; CI alone classifies the exact diff. -->

## Review completion
- [ ] Every unresolved review thread was inspected
- [ ] Actionable findings were fixed, affected tests were rerun, and fresh Greptile/CI results passed
- [ ] Non-actionable or intentionally deferred findings have an evidence-based reply
- [ ] Zero unresolved review threads remain
- [ ] Merge is explicitly authorized; otherwise this PR will remain ready and unmerged

## Activation gates affected
<!-- List any of the 20 activation gates this PR touches or unblocks -->
None

## Risks and assumptions
<!-- Anything the reviewer should know -->
