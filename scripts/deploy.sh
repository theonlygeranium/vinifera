#!/usr/bin/env bash
# scripts/deploy.sh
# Called by GitHub Actions (self-hosted runner) and manual deploys.
# Run as: sudo bash scripts/deploy.sh

set -euo pipefail

PROJECT_DIR="/opt/[REPO-NAME]"
SERVICE_NAME="[SERVICE-NAME].service"

echo "=== [PROJECT NAME] Deploy Script ==="
echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── Pull latest code ──────────────────────────────────────────────────────────
echo "→ Pulling latest from main..."
cd "$PROJECT_DIR"
sudo -u z121532 git pull origin main

# ── Install/update dependencies ───────────────────────────────────────────────
# TODO: uncomment and adapt for your stack
# echo "→ Installing dependencies..."
# npm install --prefix "$PROJECT_DIR/frontend"
# pip install -r "$PROJECT_DIR/backend/requirements.txt"

# ── Build ─────────────────────────────────────────────────────────────────────
# TODO: uncomment and adapt for your stack
# echo "→ Building..."
# npm run build --prefix "$PROJECT_DIR/frontend"

# ── Restart service ───────────────────────────────────────────────────────────
echo "→ Restarting $SERVICE_NAME..."
systemctl restart "$SERVICE_NAME"
sleep 3

# ── Verify ────────────────────────────────────────────────────────────────────
echo "→ Verifying service status..."
systemctl is-active "$SERVICE_NAME" && echo "✓ $SERVICE_NAME is running" || {
  echo "✗ $SERVICE_NAME failed to start"
  journalctl -u "$SERVICE_NAME" -n 20 --no-pager
  exit 1
}

echo "=== Deploy complete ==="
