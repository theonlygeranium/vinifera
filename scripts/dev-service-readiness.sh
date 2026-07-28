#!/usr/bin/env bash

vinifera_http_ready() {
  curl \
    --fail \
    --silent \
    --connect-timeout 1 \
    --max-time 2 \
    "$1" \
    >/dev/null 2>&1
}

wait_for_vinifera_services() {
  local worker_pid="$1"
  local frontend_pid="$2"
  local worker_url="$3"
  local frontend_url="$4"
  local timeout_seconds="${5:-60}"
  local deadline=$((SECONDS + timeout_seconds))
  local worker_ready="false"
  local frontend_ready="false"

  while ((SECONDS < deadline)); do
    worker_ready="false"
    frontend_ready="false"

    if vinifera_http_ready "$worker_url"; then
      worker_ready="true"
    fi
    if vinifera_http_ready "$frontend_url"; then
      frontend_ready="true"
    fi
    if [[ "$worker_ready" == "true" && "$frontend_ready" == "true" ]]; then
      return 0
    fi

    if ! kill -0 "$worker_pid" >/dev/null 2>&1; then
      echo "The local Worker exited before becoming healthy." >&2
      return 1
    fi
    if ! kill -0 "$frontend_pid" >/dev/null 2>&1; then
      echo "The Vite frontend exited before becoming ready." >&2
      return 1
    fi

    if ((SECONDS < deadline)); then
      sleep 1
    fi
  done

  if [[ "$worker_ready" != "true" ]]; then
    echo "The local Worker did not become healthy within ${timeout_seconds} seconds." >&2
  fi
  if [[ "$frontend_ready" != "true" ]]; then
    echo "The Vite frontend did not become ready within ${timeout_seconds} seconds." >&2
  fi
  return 1
}
