#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"
source "$repository_root/scripts/dev-runtime-files.sh"
source "$repository_root/scripts/dev-service-readiness.sh"

if [[ ! -x node_modules/.bin/supabase || ! -x node_modules/.bin/wrangler ]]; then
  echo "Local development dependencies are missing. Run: npm ci" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required by Supabase local development and was not found." >&2
  echo "Install and start Docker Desktop or another Docker-compatible runtime." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but its daemon is not reachable." >&2
  echo "Start the Docker-compatible runtime, then rerun npm run dev." >&2
  exit 1
fi

status_file="$(create_vinifera_runtime_file "supabase-status")"
local_env_file="$(create_vinifera_runtime_file "worker-env")"
chmod 600 "$status_file" "$local_env_file"
worker_pid=""
frontend_pid=""

terminate_process_tree() {
  local parent_pid="$1"
  local child_pid
  while IFS= read -r child_pid; do
    if [[ -n "$child_pid" ]]; then
      terminate_process_tree "$child_pid"
    fi
  done < <(pgrep -P "$parent_pid" 2>/dev/null || true)
  kill "$parent_pid" >/dev/null 2>&1 || true
}

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  remove_vinifera_runtime_file "$status_file"
  remove_vinifera_runtime_file "$local_env_file"
  status_file=""
  local_env_file=""
  if [[ -n "$frontend_pid" ]]; then
    terminate_process_tree "$frontend_pid"
  fi
  if [[ -n "$worker_pid" ]]; then
    terminate_process_tree "$worker_pid"
  fi
  if [[ -n "$frontend_pid" ]]; then
    wait "$frontend_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$worker_pid" ]]; then
    wait "$worker_pid" >/dev/null 2>&1 || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

status_value() {
  node -e '
    const fs = require("node:fs");
    const [file, name] = process.argv.slice(1);
    const line = fs.readFileSync(file, "utf8")
      .split(/\r?\n/u)
      .find((candidate) => candidate.startsWith(`${name}=`));
    if (!line) process.exit(1);
    let value = line.slice(name.length + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("\x27") && value.endsWith("\x27"))
    ) {
      value = value.slice(1, -1);
    }
    process.stdout.write(value);
  ' "$status_file" "$1"
}

echo "[1/5] Starting the pinned Supabase local stack..."
npx --no-install supabase start >/dev/null

echo "[2/5] Replaying migrations and deterministic seed..."
npx --no-install supabase db reset --local
npx --no-install supabase status -o env >"$status_file"

supabase_url="$(status_value API_URL)"
supabase_anon_key="$(status_value ANON_KEY)"
supabase_service_role_key="$(status_value SERVICE_ROLE_KEY)"
remove_vinifera_runtime_file "$status_file"
status_file=""

echo "[3/5] Bootstrapping local-only Auth identities..."
SUPABASE_URL="$supabase_url" \
SUPABASE_SERVICE_ROLE_KEY="$supabase_service_role_key" \
  npm run dev:seed-auth

app_env="development"
app_origin="http://127.0.0.1:8788"
allowed_origins="http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:8788,http://localhost:8788"
auth_email_enabled="true"
google_oauth_enabled="false"
live_billing_enabled="false"
rate_limit_pepper="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
member_brand_context_secret="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"

umask 077
APP_ENV="$app_env" \
APP_ORIGIN="$app_origin" \
ALLOWED_ORIGINS="$allowed_origins" \
AUTH_EMAIL_ENABLED="$auth_email_enabled" \
GOOGLE_OAUTH_ENABLED="$google_oauth_enabled" \
LIVE_BILLING_ENABLED="$live_billing_enabled" \
MEMBER_BRAND_CONTEXT_SECRET="$member_brand_context_secret" \
RATE_LIMIT_PEPPER="$rate_limit_pepper" \
SUPABASE_ANON_KEY="$supabase_anon_key" \
SUPABASE_SERVICE_ROLE_KEY="$supabase_service_role_key" \
SUPABASE_URL="$supabase_url" \
LOCAL_ENV_FILE="$local_env_file" \
  node -e '
  const fs = require("node:fs");
  const names = [
    "APP_ENV",
    "APP_ORIGIN",
    "ALLOWED_ORIGINS",
    "AUTH_EMAIL_ENABLED",
    "GOOGLE_OAUTH_ENABLED",
    "LIVE_BILLING_ENABLED",
    "MEMBER_BRAND_CONTEXT_SECRET",
    "RATE_LIMIT_PEPPER",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_URL",
  ];
  const body = names
    .map((name) => `${name}=${JSON.stringify(process.env[name])}`)
    .join("\n");
  fs.writeFileSync(process.env.LOCAL_ENV_FILE, `${body}\n`, { mode: 0o600 });
'

echo "[4/5] Building and starting the local Worker and Vite frontend..."
env \
  -u MEMBER_BRAND_CONTEXT_SECRET \
  -u RATE_LIMIT_PEPPER \
  -u SUPABASE_ANON_KEY \
  -u SUPABASE_SERVICE_ROLE_KEY \
  -u SUPABASE_URL \
  VITE_CAPACITOR_BUILD="false" \
  VITE_API_BASE_URL="http://127.0.0.1:8788" \
  npm run build
npx --no-install wrangler dev \
  --local \
  --ip 127.0.0.1 \
  --port 8788 \
  --persist-to .wrangler/local \
  --env-file "$local_env_file" \
  --show-interactive-dev-session=false &
worker_pid=$!

env \
  -u MEMBER_BRAND_CONTEXT_SECRET \
  -u RATE_LIMIT_PEPPER \
  -u SUPABASE_ANON_KEY \
  -u SUPABASE_SERVICE_ROLE_KEY \
  -u SUPABASE_URL \
  VITE_CAPACITOR_BUILD="false" \
  VITE_API_BASE_URL="http://127.0.0.1:8788" \
  npm run dev:frontend &
frontend_pid=$!

if ! wait_for_vinifera_services \
  "$worker_pid" \
  "$frontend_pid" \
  "http://127.0.0.1:8788/api/health" \
  "http://127.0.0.1:5173/app/" \
  60; then
  exit 1
fi

echo "[5/5] Running authenticated local smoke checks..."
SUPABASE_URL="$supabase_url" \
SUPABASE_ANON_KEY="$supabase_anon_key" \
SUPABASE_SERVICE_ROLE_KEY="$supabase_service_role_key" \
SUPABASE_MAILPIT_URL="http://127.0.0.1:54324" \
VINIFERA_LOCAL_WORKER_URL="http://127.0.0.1:8788" \
  npm run dev:smoke

if ! kill -0 "$worker_pid" >/dev/null 2>&1; then
  echo "The local Worker exited before local development became ready." >&2
  exit 1
fi
if ! kill -0 "$frontend_pid" >/dev/null 2>&1; then
  echo "The Vite frontend exited before local development became ready." >&2
  exit 1
fi
if ! vinifera_http_ready "http://127.0.0.1:8788/api/health"; then
  echo "The local Worker stopped responding after smoke checks." >&2
  exit 1
fi
if ! vinifera_http_ready "http://127.0.0.1:5173/app/"; then
  echo "The Vite frontend stopped responding after smoke checks." >&2
  exit 1
fi

echo
echo "Vinifera local development is ready:"
echo "  Integrated app: http://127.0.0.1:8788/app/"
echo "  Vite hot reload: http://127.0.0.1:5173/app/"
echo "  Supabase Studio: http://127.0.0.1:54323"
echo "Press Ctrl-C to stop the Worker and frontend."

while kill -0 "$worker_pid" >/dev/null 2>&1 &&
  kill -0 "$frontend_pid" >/dev/null 2>&1; do
  sleep 2
done

echo "A local development process exited unexpectedly." >&2
exit 1
