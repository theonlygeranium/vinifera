# ADR: File-backed trusted auto-merge evidence

**Date:** 2026-08-06

**Status:** Accepted

## Context

The trusted development auto-merge controller paginates all check runs and
commit statuses for an exact candidate. It previously serialized the complete
history into `jq --argjson` command-line arguments. PR #291 exceeded the
runner's operating-system argument limit before the exact candidate could be
evaluated.

## Decision

Write the paginated GitHub API responses to uniquely named runner-temporary
files and parse them with `jq --slurpfile`. Continue selecting required check
runs only when their pull-request number, base SHA, and head SHA match the live
candidate. Continue the immediate second evaluation before merge.

## Consequences

Historical check volume no longer imposes a process-argument size ceiling.
The files exist only for the trusted job's lifetime and contain the same
read-only metadata already returned by GitHub. Eligibility, review, emergency
label, risk, exact-revision, and required-context rules are unchanged.

## Verification

- Policy tests require both file-backed inputs and reject the former
  `--argjson` payloads.
- The focused trusted-auto-merge policy suite validates exact PR/base/head
  binding and pre-merge revalidation.
