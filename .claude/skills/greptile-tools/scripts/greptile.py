#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["httpx"]
# ///
"""Greptile CLI — codebase-aware queries via REST API.

Commands:
    index                         Trigger repository indexing
    status                        Check indexing status
    query <question> [genius]     Natural language Q&A (genius=deep analysis)
"""
from __future__ import annotations

import json
import os
import sys
from collections.abc import Callable
from typing import Final
from urllib.parse import quote

import httpx

# --- [CONSTANTS] --------------------------------------------------------------
BASE: Final = "https://api.greptile.com/v2"
TIMEOUT: Final = 60
TIMEOUT_QUERY: Final = 300

REPO: Final = "bsamiee/Parametric_Portal"
BRANCH: Final = "main"
REMOTE: Final = "github"

# --- [DISPATCH] ---------------------------------------------------------------
CMDS: Final[dict[str, tuple[Callable[..., dict], int]]] = {}


def cmd(argc: int) -> Callable[[Callable[..., dict]], Callable[..., dict]]:
    """Register command with required argument count."""
    def register(fn: Callable[..., dict]) -> Callable[..., dict]:
        CMDS[fn.__name__] = (fn, argc)
        return fn
    return register


# --- [HTTP] -------------------------------------------------------------------
def _headers() -> dict[str, str]:
    """Build auth headers."""
    return {
        "Authorization": f"Bearer {os.environ.get('GREPTILE_TOKEN', '')}",
        "X-GitHub-Token": os.environ.get("GITHUB_TOKEN", os.environ.get("GH_TOKEN", "")),
        "Content-Type": "application/json",
    }


def _repo_id() -> str:
    """Encode repo identifier."""
    return quote(f"{REMOTE}:{BRANCH}:{REPO}", safe="")


def _get(path: str) -> dict:
    """GET request."""
    with httpx.Client(timeout=TIMEOUT) as c:
        r = c.get(f"{BASE}{path}", headers=_headers())
        r.raise_for_status()
        return r.json()


def _post(path: str, body: dict, timeout: int = TIMEOUT) -> dict:
    """POST request."""
    with httpx.Client(timeout=timeout) as c:
        r = c.post(f"{BASE}{path}", headers=_headers(), json=body)
        r.raise_for_status()
        return r.json()


# --- [COMMANDS] ---------------------------------------------------------------
@cmd(0)
def index() -> dict:
    """Trigger repository indexing."""
    body = {"remote": REMOTE, "repository": REPO, "branch": BRANCH, "reload": True, "notify": False}
    r = _post("/repositories", body)
    return {"status": "success", "repo": REPO, "message": r.get("message", "Indexing started")}


@cmd(0)
def status() -> dict:
    """Check indexing status."""
    r = _get(f"/repositories/{_repo_id()}")
    return {
        "status": "success",
        "repo": r.get("repository", REPO),
        "indexing": r.get("status", "unknown"),
        "sha": r.get("sha") or "pending",
        "progress": f"{r.get('filesProcessed', 0)}/{r.get('numFiles', 0)}",
        "ready": r.get("status") == "COMPLETED",
    }


@cmd(1)
def query(question: str, genius: str = "") -> dict:
    """Natural language codebase Q&A."""
    body = {
        "messages": [{"id": "1", "content": question, "role": "user"}],
        "repositories": [{"remote": REMOTE, "branch": BRANCH, "repository": REPO}],
        "genius": genius == "genius",
        "stream": False,
    }
    r = _post("/query", body, TIMEOUT_QUERY)
    sources = [
        {"file": s.get("filepath", ""), "lines": f"{s.get('linestart')}-{s.get('lineend')}" if s.get("linestart") else None}
        for s in r.get("sources", []) if isinstance(s, dict)
    ]
    return {"status": "success", "query": question, "answer": r.get("message", ""), "sources": sources}


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """Dispatch command and print JSON output."""
    match sys.argv[1:]:
        case [cmd_name, *cmd_args] if (entry := CMDS.get(cmd_name)):
            fn, argc = entry
            if len(cmd_args) < argc:
                print(f"Usage: greptile.py {cmd_name} {' '.join(f'<arg{i+1}>' for i in range(argc))}")
                return 1
            try:
                result = fn(*cmd_args[:argc + 1])  # required + up to 1 optional
                print(json.dumps(result, indent=2))
                return 0 if result["status"] == "success" else 1
            except httpx.HTTPStatusError as e:
                retryable = e.response.status_code >= 500 or e.response.status_code == 429
                print(json.dumps({"status": "error", "code": e.response.status_code, "message": e.response.text[:200], "retryable": retryable}))
                return 1
            except httpx.RequestError as e:
                print(json.dumps({"status": "error", "message": str(e), "retryable": True}))
                return 1
        case [cmd_name, *_]:
            print(f"[ERROR] Unknown command '{cmd_name}'\n")
            print(__doc__)
            return 1
        case _:
            print(__doc__)
            return 1


if __name__ == "__main__":
    sys.exit(main())
