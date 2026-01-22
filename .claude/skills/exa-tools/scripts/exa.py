#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["httpx"]
# ///
"""Exa AI CLI — semantic web search via REST API.

Commands:
    search <query> [type] [num]   Web search (type: auto|neural|keyword, default: auto 8)
    code <query> [num]            Code search via GitHub (default: 10 results)
"""
from __future__ import annotations

import json
import os
import sys
from collections.abc import Callable
from typing import Final

import httpx

# --- [CONSTANTS] --------------------------------------------------------------
BASE: Final = "https://api.exa.ai"
KEY_ENV: Final = "EXA_API_KEY"
TIMEOUT: Final = 30
MAX_CHARS: Final = 10000

# --- [DISPATCH] ---------------------------------------------------------------
CMDS: Final[dict[str, tuple[Callable[..., dict], int]]] = {}


def cmd(argc: int) -> Callable[[Callable[..., dict]], Callable[..., dict]]:
    """Register command with required argument count."""
    def register(fn: Callable[..., dict]) -> Callable[..., dict]:
        CMDS[fn.__name__] = (fn, argc)
        return fn
    return register


# --- [HTTP] -------------------------------------------------------------------
def _post(path: str, body: dict) -> dict:
    """POST JSON with API key auth."""
    headers = {"x-api-key": os.environ.get(KEY_ENV, ""), "Content-Type": "application/json"}
    with httpx.Client(timeout=TIMEOUT) as c:
        r = c.post(f"{BASE}{path}", headers=headers, json=body)
        r.raise_for_status()
        return r.json()


def _search_body(query: str, num: int, type_: str, category: str | None = None) -> dict:
    """Build search request body."""
    body = {"query": query, "numResults": num, "type": type_, "contents": {"text": True}}
    return {**body, "category": category} if category else body


# --- [COMMANDS] ---------------------------------------------------------------
@cmd(1)
def search(query: str, type_: str = "auto", num: str = "8") -> dict:
    """Web search with text content retrieval."""
    if type_ not in ("auto", "neural", "keyword"):
        return {"status": "error", "message": f"Invalid type '{type_}'. Use: auto, neural, keyword"}
    data = _post("/search", _search_body(query, int(num), type_))
    return {"status": "success", "query": query, "results": data.get("results", [])}


@cmd(1)
def code(query: str, num: str = "10") -> dict:
    """Code context search via GitHub category."""
    data = _post("/search", _search_body(query, int(num), "auto", "github"))
    return {"status": "success", "query": query, "context": data.get("results", [])}


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """Dispatch command and print JSON output."""
    match sys.argv[1:]:
        case [cmd_name, *cmd_args] if (entry := CMDS.get(cmd_name)):
            fn, argc = entry
            if len(cmd_args) < argc:
                print(f"Usage: exa.py {cmd_name} {' '.join(f'<arg{i+1}>' for i in range(argc))}")
                return 1
            try:
                result = fn(*cmd_args[:argc + 2])  # required + up to 2 optional
                print(json.dumps(result, indent=2))
                return 0 if result["status"] == "success" else 1
            except httpx.HTTPStatusError as e:
                print(json.dumps({"status": "error", "code": e.response.status_code, "message": e.response.text[:200]}))
                return 1
            except httpx.RequestError as e:
                print(json.dumps({"status": "error", "message": str(e)}))
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
