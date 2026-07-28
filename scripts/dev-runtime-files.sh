#!/usr/bin/env bash

create_vinifera_runtime_file() {
  local purpose="$1"
  mktemp "${TMPDIR:-/tmp}/vinifera-${purpose}.XXXXXX"
}

remove_vinifera_runtime_file() {
  local file_path="$1"
  if [[ -n "$file_path" ]]; then
    rm -f -- "$file_path"
  fi
}
