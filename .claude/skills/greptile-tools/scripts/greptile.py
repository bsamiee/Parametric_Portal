#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.14"
# dependencies = ["httpx"]
# ///
"""Greptile CLI — codebase-aware queries via REST API v2.

Commands:
    index                         Trigger repository indexing
    status                        Check indexing status
    query <question> [genius]     Natural language Q&A (genius=deep analysis)
    search <question>             Code search (files only, no generated answer)
"""

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

# --- [TYPES] ------------------------------------------------------------------
type CommandEntry = tuple[Callable[..., dict], int]
type CommandRegistry = dict[str, CommandEntry]

# --- [DISPATCH] ---------------------------------------------------------------
CMDS: Final[CommandRegistry] = {}


def cmd(argc: int) -> Callable[[Callable[..., dict]], Callable[..., dict]]:
    """Register command with required argument count."""
    def register(fn: Callable[..., dict]) -> Callable[..., dict]:
        CMDS[fn.__name__] = (fn, argc)
        return fn
    return register


# --- [FUNCTIONS] --------------------------------------------------------------
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
    with httpx.Client(timeout=TIMEOUT) as client:
        response = client.get(f"{BASE}{path}", headers=_headers())
        response.raise_for_status()
        return response.json()


def _post(path: str, body: dict, timeout: int = TIMEOUT) -> dict:
    """POST request."""
    with httpx.Client(timeout=timeout) as client:
        response = client.post(f"{BASE}{path}", headers=_headers(), json=body)
        response.raise_for_status()
        return response.json()


def _repo_spec() -> dict:
    """Build repository specification for queries."""
    return {"remote": REMOTE, "branch": BRANCH, "repository": REPO}


def _format_sources(raw_sources: list) -> list[dict]:
    """Transform raw source references into structured format."""
    return [
        {
            "file": source.get("filepath", ""),
            "lines": f"{source.get('linestart')}-{source.get('lineend')}" if source.get("linestart") else None,
        }
        for source in raw_sources if isinstance(source, dict)
    ]


# --- [COMMANDS] ---------------------------------------------------------------
@cmd(0)
def index() -> dict:
    """Trigger repository indexing."""
    body = {"remote": REMOTE, "repository": REPO, "branch": BRANCH, "reload": True, "notify": False}
    response = _post("/repositories", body)
    return {"status": "success", "repo": REPO, "message": response.get("message", "Indexing started")}


@cmd(0)
def status() -> dict:
    """Check indexing status."""
    response = _get(f"/repositories/{_repo_id()}")
    return {
        "status": "success",
        "repo": response.get("repository", REPO),
        "indexing": response.get("status", "unknown"),
        "sha": response.get("sha") or "pending",
        "progress": f"{response.get('filesProcessed', 0)}/{response.get('numFiles', 0)}",
        "ready": response.get("status") == "COMPLETED",
    }


@cmd(1)
def query(question: str, genius: str = "") -> dict:
    """Natural language codebase Q&A."""
    body = {
        "messages": [{"id": "1", "content": question, "role": "user"}],
        "repositories": [_repo_spec()],
        "genius": genius == "genius",
        "stream": False,
    }
    response = _post("/query", body, TIMEOUT_QUERY)
    return {
        "status": "success",
        "query": question,
        "answer": response.get("message", ""),
        "sources": _format_sources(response.get("sources", [])),
    }


@cmd(1)
def search(question: str) -> dict:
    """Code search — returns matching files/functions without a generated answer."""
    body = {
        "messages": [{"id": "1", "content": question, "role": "user"}],
        "repositories": [_repo_spec()],
        "stream": False,
    }
    response = _post("/search", body, TIMEOUT_QUERY)
    results = [
        {
            "file": source.get("filepath", ""),
            "lines": f"{source.get('linestart')}-{source.get('lineend')}" if source.get("linestart") else None,
            "summary": source.get("summary", ""),
        }
        for source in response.get("sources", response) if isinstance(source, dict)
    ]
    return {"status": "success", "query": question, "results": results}


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """Dispatch command and print JSON output."""
    match sys.argv[1:]:
        case [cmd_name, *cmd_args] if (entry := CMDS.get(cmd_name)):
            fn, argc = entry
            match cmd_args:
                case _ if len(cmd_args) < argc:
                    sys.stdout.write(f"Usage: greptile.py {cmd_name} {' '.join(f'<arg{index + 1}>' for index in range(argc))}\n")
                    return 1
                case _:
                    try:
                        result = fn(*cmd_args[:argc + 1])
                        sys.stdout.write(json.dumps(result, indent=2) + "\n")
                        return 0 if result["status"] == "success" else 1
                    except httpx.HTTPStatusError as error:
                        retryable = error.response.status_code >= 500 or error.response.status_code == 429
                        sys.stdout.write(json.dumps({"status": "error", "code": error.response.status_code, "message": error.response.text[:200], "retryable": retryable}) + "\n")
                        return 1
                    except httpx.RequestError as error:
                        sys.stdout.write(json.dumps({"status": "error", "message": str(error), "retryable": True}) + "\n")
                        return 1
        case [cmd_name, *_]:
            sys.stdout.write(f"[ERROR] Unknown command '{cmd_name}'\n\n")
            sys.stdout.write(__doc__ + "\n")
            return 1
        case _:
            sys.stdout.write(__doc__ + "\n")
            return 1


if __name__ == "__main__":
    sys.exit(main())
