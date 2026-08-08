# Gate 8 Release-Candidate Package Sequencing

## Background

During Gate 8 re-test #6 (2026-08-08), the staging deployment failed with
"No successful immutable package exists for this candidate" because the
`release-candidate-package.yml` workflow was not dispatched before merging
the dev-to-staging promotion PR.

## Correct Sequence

1. Open the dev-to-staging promotion PR.
2. Wait for CI to pass (Vinifera Promotion Gate + Octopus PR Quality Gates).
3. **Dispatch `release-candidate-package.yml` from the GitHub Actions UI**
   on the `main` branch with:
   - `candidate_sha` = the dev HEAD SHA
   - `promotion_pr_number` = the promotion PR number
4. Wait for the package build to complete and upload the artifact
   `release-candidate-<candidate_sha>`.
5. Merge the promotion PR. The staging CI will find the artifact, deploy
   the Worker, and run Gate 8 acceptance.

## Why This Matters

The `deploy-staging` CI job downloads the immutable release-candidate
package artifact and uses it to deploy the Worker. Without the artifact,
the deploy fails and Gate 8 acceptance is skipped. The package must be
built from `main` while the promotion PR is still open, ensuring the
candidate SHA matches the dev HEAD at merge time.

## Verification Checks Performed by the Workflow

The `release-candidate-package.yml` workflow verifies:
- `RUN_REF == refs/heads/main` (dispatched from main)
- `current_dev == candidate_sha` (dev HEAD matches the candidate)
- PR `state == open` (promotion PR is still open)
- PR `base.ref == staging` (targeting staging)
- PR `head.ref == dev` (from dev)
- PR `head.sha == candidate_sha` (PR head matches candidate)
- Vinifera Promotion Gate check is `success`
- Octopus PR Quality Gates status is `success`

The artifact is named `release-candidate-<candidate_sha>` with 30-day retention.
