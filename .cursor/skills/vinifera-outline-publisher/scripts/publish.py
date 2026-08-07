#!/usr/bin/env python3
"""Safe, idempotent Outline publisher for the private Vinifera collection."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import getpass
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
from typing import Any


SKILL_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = SKILL_ROOT / "config" / "outline-map.json"

REMOTE_CLIENT = r"""
import json, sys, urllib.error, urllib.request
envelope = json.load(sys.stdin)
url = envelope["api_base_url"].rstrip("/") + "/" + envelope["endpoint"]
body = json.dumps(envelope.get("payload", {})).encode("utf-8")
request = urllib.request.Request(
    url,
    data=body,
    method="POST",
    headers={
        "Authorization": "Bearer " + envelope["token"],
        "Content-Type": "application/json",
        "Accept": "application/json",
    },
)
try:
    with urllib.request.urlopen(request, timeout=30) as response:
        sys.stdout.buffer.write(response.read())
except urllib.error.HTTPError as exc:
    payload = exc.read().decode("utf-8", "replace")
    print(json.dumps({"ok": False, "status": exc.code, "error": payload}))
    sys.exit(22)
"""


class PublishError(RuntimeError):
    pass


def load_config(path: str | None = None) -> dict[str, Any]:
    config_path = Path(path).expanduser().resolve() if path else CONFIG_PATH
    return json.loads(config_path.read_text(encoding="utf-8"))


def resolve_token(config: dict[str, Any]) -> str:
    token = os.environ.get("OUTLINE_API_TOKEN", "").strip()
    if token:
        return token
    service = config["keychain"]["service"]
    account = os.environ.get("USER") or getpass.getuser()
    result = subprocess.run(
        ["security", "find-generic-password", "-s", service, "-a", account, "-w"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode == 0 and result.stdout.strip():
        return result.stdout.strip()
    raise PublishError(
        "Outline token not found. Run: "
        f"python3 {Path(__file__).resolve()} configure-keychain"
    )


def configure_keychain(config: dict[str, Any]) -> None:
    if sys.platform != "darwin":
        raise PublishError("Keychain setup is supported on macOS only.")
    token = getpass.getpass("Outline API token (input hidden): ").strip()
    if not token:
        raise PublishError("No token supplied.")
    service = config["keychain"]["service"]
    account = os.environ.get("USER") or getpass.getuser()
    result = subprocess.run(
        [
            "security",
            "add-generic-password",
            "-U",
            "-s",
            service,
            "-a",
            account,
            "-w",
        ],
        input=token + "\n",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    token = ""
    if result.returncode != 0:
        raise PublishError("macOS Keychain rejected the credential.")
    print(f"Keychain credential installed for service '{service}'.")


def api(config: dict[str, Any], endpoint: str, payload: dict[str, Any]) -> Any:
    envelope = {
        "api_base_url": config["api_base_url"],
        "endpoint": endpoint,
        "payload": payload,
        "token": resolve_token(config),
    }
    result = subprocess.run(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            config["ssh_host"],
            f"python3 -c {shlex.quote(REMOTE_CLIENT)}",
        ],
        input=json.dumps(envelope),
        capture_output=True,
        text=True,
        check=False,
    )
    envelope["token"] = ""
    if result.returncode != 0:
        raise PublishError(
            f"Outline API call '{endpoint}' failed through SSH "
            f"(exit {result.returncode})."
        )
    try:
        response = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise PublishError(f"Outline returned invalid JSON for '{endpoint}'.") from exc
    if response.get("ok") is False:
        raise PublishError(f"Outline rejected '{endpoint}'.")
    return response.get("data")


def list_documents(config: dict[str, Any]) -> list[dict[str, Any]]:
    collection_id = config["collection"]["id"]
    data = api(config, "collections.documents", {"id": collection_id})
    if not isinstance(data, list):
        raise PublishError("Unexpected collections.documents response.")

    flattened: list[dict[str, Any]] = []

    def visit(nodes: list[dict[str, Any]], parent_id: str | None = None) -> None:
        for node in nodes:
            flattened.append(
                {
                    "id": node.get("id"),
                    "title": node.get("title"),
                    "url": node.get("url"),
                    "parentDocumentId": parent_id,
                }
            )
            children = node.get("children", [])
            if isinstance(children, list):
                visit(children, node.get("id"))

    visit(data)
    return flattened


def by_title(documents: list[dict[str, Any]], title: str) -> dict[str, Any] | None:
    matches = [doc for doc in documents if doc.get("title") == title]
    if len(matches) > 1:
        raise PublishError(f"Ambiguous document title: {title!r}")
    return matches[0] if matches else None


def document_id(config: dict[str, Any], documents: list[dict[str, Any]], title: str) -> str | None:
    configured = config.get("documents", {}).get(title)
    if configured:
        match = next((doc for doc in documents if doc.get("id") == configured), None)
        if not match:
            raise PublishError(f"Mapped document is missing: {title!r}")
        if match.get("title") != title:
            raise PublishError(f"Mapped document title drifted: {title!r}")
        return configured
    match = by_title(documents, title)
    return match.get("id") if match else None


def membership_count(config: dict[str, Any]) -> int:
    collection_id = config["collection"]["id"]
    data = api(config, "collections.memberships", {"id": collection_id, "limit": 100})
    if not isinstance(data, dict) or not isinstance(data.get("memberships"), list):
        raise PublishError("Could not verify collection memberships.")
    return len(data["memberships"])


def active_user_count(config: dict[str, Any]) -> int:
    data = api(config, "users.list", {"limit": 100, "filter": "active"})
    if not isinstance(data, list):
        raise PublishError("Could not verify active users.")
    return len(data)


def public_share_count(config: dict[str, Any]) -> int:
    data = api(
        config,
        "shares.list",
        {"limit": 100},
    )
    if not isinstance(data, list):
        raise PublishError("Could not verify public shares.")
    return len([share for share in data if share.get("published") is not False])


def verify(config: dict[str, Any], quiet: bool = False) -> list[dict[str, Any]]:
    expected = config["collection"]
    collection = api(config, "collections.info", {"id": expected["id"]})
    if collection.get("name") != expected["name"]:
        raise PublishError("Collection identity mismatch.")
    if expected.get("sharing_must_be_disabled") and collection.get("sharing") is not False:
        raise PublishError("Collection sharing is not disabled.")
    required_permission = expected.get("required_permission")
    if collection.get("permission") != required_permission:
        raise PublishError(
            "Collection permission mismatch: "
            f"expected {required_permission!r}, found {collection.get('permission')!r}."
        )

    memberships = membership_count(config)
    users = active_user_count(config)
    shares = public_share_count(config)
    if memberships > expected["max_memberships"]:
        raise PublishError(f"Collection has {memberships} memberships; expected at most 1.")
    if users > expected["max_active_users"]:
        raise PublishError(f"Workspace has {users} active users; expected at most 1.")
    if shares:
        raise PublishError(f"Collection has {shares} published shares.")

    documents = list_documents(config)
    for title, mapped_id in config.get("documents", {}).items():
        if mapped_id:
            document_id(config, documents, title)
    if not quiet:
        print(
            "Privacy preflight passed: "
            f"{len(documents)} documents, {memberships} membership, "
            f"{users} active user, {shares} public shares."
        )
    return documents


def print_inventory(config: dict[str, Any]) -> None:
    documents = verify(config, quiet=True)
    rows = [
        {
            "id": doc.get("id"),
            "title": doc.get("title"),
            "parentDocumentId": doc.get("parentDocumentId"),
            "url": doc.get("url"),
        }
        for doc in documents
    ]
    print(json.dumps(rows, indent=2, sort_keys=True))


def assert_vault_target(
    config: dict[str, Any], documents: list[dict[str, Any]], title: str, parent_title: str | None
) -> None:
    vault_title = config["vault_root_title"]
    if title == vault_title:
        return
    target = by_title(documents, title)
    vault = by_title(documents, vault_title)
    if not vault:
        raise PublishError("Vault root is missing.")
    if target and target.get("parentDocumentId") == vault.get("id"):
        return
    if not target and parent_title == vault_title:
        return
    raise PublishError("Vault writes must target the vault root or one of its direct children.")


def upsert(config: dict[str, Any], args: argparse.Namespace) -> None:
    text_path = Path(args.text_file).expanduser().resolve()
    if not text_path.is_file():
        raise PublishError(f"Markdown source not found: {text_path}")
    documents = verify(config, quiet=True)
    if args.vault:
        assert_vault_target(config, documents, args.title, args.parent_title)
    target_id = document_id(config, documents, args.title)

    if target_id:
        action = "update"
        endpoint = "documents.update"
        payload = {"id": target_id, "title": args.title}
    else:
        if not args.allow_create:
            raise PublishError(
                f"Document {args.title!r} does not exist; use --allow-create with a canonical parent."
            )
        if not args.parent_title:
            raise PublishError("New documents require --parent-title.")
        parent_id = document_id(config, documents, args.parent_title)
        if not parent_id:
            raise PublishError(f"Parent document is missing: {args.parent_title!r}")
        action = "create"
        endpoint = "documents.create"
        payload = {
            "collectionId": config["collection"]["id"],
            "parentDocumentId": parent_id,
            "title": args.title,
            "publish": True,
        }

    text = text_path.read_text(encoding="utf-8")
    metadata = []
    if args.added_at:
        added_at = (
            datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            if args.added_at == "now"
            else args.added_at
        )
        metadata.append(f"Added to Outline: {added_at}")
    if args.source_date:
        metadata.append(f"Source date: {args.source_date}")
    if args.classification:
        metadata.append(f"Classification: {args.classification}")
    if metadata:
        text = f"> {' · '.join(metadata)}\n\n{text}"
    payload["text"] = text
    if not args.apply:
        label = "vault content withheld" if args.vault else f"{len(payload['text'])} characters"
        print(f"DRY RUN: would {action} {args.title!r} ({label}).")
        return
    result = api(config, endpoint, payload)
    print(f"Applied: {action}d {args.title!r} ({result.get('id', target_id)}).")


def append_log(config: dict[str, Any], args: argparse.Namespace) -> None:
    entry_path = Path(args.entry_file).expanduser().resolve()
    if not entry_path.is_file():
        raise PublishError(f"Update-log entry not found: {entry_path}")
    documents = verify(config, quiet=True)
    title = config["update_log_title"]
    target_id = document_id(config, documents, title)
    if not target_id:
        raise PublishError("Update log document is missing.")
    current = api(config, "documents.info", {"id": target_id})
    existing = current.get("text", "").rstrip()
    entry = entry_path.read_text(encoding="utf-8").strip()
    if not entry:
        raise PublishError("Update-log entry is empty.")
    if entry in existing:
        print("No change: identical update-log entry already exists.")
        return
    updated = f"{existing}\n\n---\n\n{entry}\n"
    if not args.apply:
        print(f"DRY RUN: would append {len(entry)} characters to {title!r}.")
        return
    api(config, "documents.update", {"id": target_id, "title": title, "text": updated})
    print(f"Applied: appended update-log entry to {title!r}.")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    root.add_argument(
        "--config",
        help="Alternate collection map (defaults to the Vinifera collection).",
    )
    sub = root.add_subparsers(dest="command", required=True)
    sub.add_parser("configure-keychain", help="Install or rotate the API token in macOS Keychain.")
    sub.add_parser("verify", help="Run read-only privacy and identity checks.")
    sub.add_parser("inventory", help="Print a sanitized document inventory.")

    write = sub.add_parser("upsert", help="Create or update one canonical Markdown document.")
    write.add_argument("--title", required=True)
    write.add_argument("--parent-title")
    write.add_argument("--text-file", required=True)
    write.add_argument("--allow-create", action="store_true")
    write.add_argument("--vault", action="store_true")
    write.add_argument("--added-at", help="ISO timestamp, or 'now'.")
    write.add_argument("--source-date", help="Source date shown in document metadata.")
    write.add_argument("--classification", help="Classification shown in document metadata.")
    write.add_argument("--apply", action="store_true")

    log = sub.add_parser("append-log", help="Append a dated Markdown entry to the update log.")
    log.add_argument("--entry-file", required=True)
    log.add_argument("--apply", action="store_true")
    return root


def main() -> int:
    args = parser().parse_args()
    config = load_config(args.config)
    try:
        if args.command == "configure-keychain":
            configure_keychain(config)
        elif args.command == "verify":
            verify(config)
        elif args.command == "inventory":
            print_inventory(config)
        elif args.command == "upsert":
            upsert(config, args)
        elif args.command == "append-log":
            append_log(config, args)
        else:
            raise PublishError("Unknown command.")
        return 0
    except PublishError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
