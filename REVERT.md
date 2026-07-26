# REVERT.md — Stable Baseline & Rollback Guide

This document records the most recent verified stable state of the project and provides instructions for rolling back to it.

---

## Current Stable Baseline

| Field | Value |
|-------|-------|
| **Tag** | `v0.1-stable` *(update when first stable release is tagged)* |
| **Commit SHA** | `[SHA]` |
| **Date** | YYYY-MM-DD |
| **Verified by** | [agent name or human] |
| **What was verified** | Initial project structure — no application services yet |

---

## How to Roll Back

### Option 1 — Roll back on Schubert directly
```bash
cd /opt/[REPO-NAME]
sudo -u z121532 git fetch origin
sudo -u z121532 git checkout v0.1-stable
sudo bash scripts/deploy.sh
```

### Option 2 — Roll back via GitHub Actions
1. Go to **Actions → Deploy to Schubert → Run workflow**
2. Set `force_remote: true` if the self-hosted runner is offline
3. Trigger the run — it will deploy whatever is on `main`

> If rolling back to a tag, push the tag's commit to `main` first:
> ```bash
> git checkout v0.1-stable
> git push origin HEAD:main --force   # requires human authorization
> ```

---

## Tagging a New Stable Release

When a release is verified stable on Schubert:

```bash
git tag -a vX.Y-stable -m "Brief description of this stable state"
git push origin vX.Y-stable
```

Then update the table above with the new tag, SHA, date, and what was verified.

---

## Known Issues at Current Baseline

- None (initial template state)

---

## History of Stable Tags

| Tag | SHA | Date | Notes |
|-----|-----|------|-------|
| `v0.1-stable` | `[SHA]` | YYYY-MM-DD | Initial project structure |
