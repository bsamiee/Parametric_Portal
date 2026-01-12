#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["httpx"]
# ///
"""Context7 CLI — library documentation via REST API.

Commands:
    resolve <library> [query]     List matching library IDs (JSON)
    docs <library-id> <query>     Fetch documentation (plain text)
    lookup <library> <query>      Resolve + fetch in one call (plain text)
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
BASE: Final = "https://context7.com"
KEY_ENV: Final = "CONTEXT7_API_KEY"
TIMEOUT: Final = 60
TOKENS: Final = 15000

# --- [DISPATCH] ---------------------------------------------------------------
CMDS: Final[dict[str, tuple[Callable[..., str], int]]] = {}


def cmd(argc: int) -> Callable[[Callable[..., str]], Callable[..., str]]:
    """Register command with argument count."""
    def register(fn: Callable[..., str]) -> Callable[..., str]:
        CMDS[fn.__name__] = (fn, argc)
        return fn
    return register


# --- [HTTP] -------------------------------------------------------------------
def _get(path: str) -> dict | str:
    """GET with optional bearer auth. Returns JSON or text based on content-type."""
    headers = {"Authorization": f"Bearer {k}"} if (k := os.environ.get(KEY_ENV)) else {}
    with httpx.Client(timeout=TIMEOUT) as c:
        r = c.get(f"{BASE}{path}", headers=headers)
        r.raise_for_status()
        return r.json() if "json" in r.headers.get("content-type", "") else r.text


def _search(lib: str, query: str = "") -> list[dict]:
    """Search libraries, return raw matches."""
    q = f"&query={quote(query)}" * bool(query)
    data = _get(f"/api/v2/libs/search?libraryName={quote(lib)}{q}")
    return data.get("results", data.get("libraries", [])) if isinstance(data, dict) else []


def _pick(matches: list[dict]) -> dict | None:
    """Select best match: VIP first, then highest benchmark score."""
    return next((m for m in matches if m.get("vip")), max(matches, key=lambda m: m.get("benchmarkScore", 0), default=None))


# --- [COMMANDS] ---------------------------------------------------------------
@cmd(1)
def resolve(lib: str, query: str = "") -> str:
    """Resolve library → JSON list of matching IDs with scores."""
    return json.dumps([
        {"id": m["id"], "title": m.get("title", ""), "score": m.get("benchmarkScore", 0), "vip": m.get("vip", False)}
        for m in _search(lib, query)[:5]
    ], indent=2)


@cmd(2)
def docs(lib_id: str, query: str) -> str:
    """Fetch documentation for library ID. Returns plain text."""
    lid = lib_id if lib_id.startswith("/") else f"/{lib_id}"
    text = _get(f"/api/v2/context?libraryId={quote(lid)}&query={quote(query)}&tokens={TOKENS}")
    return f"[{lid}]\n\n{text}" if isinstance(text, str) else json.dumps(text)


@cmd(2)
def lookup(lib: str, query: str) -> str:
    """Resolve library and fetch docs. Returns plain text."""
    match _pick(_search(lib, query)):
        case {"id": lib_id}:
            return docs(lib_id, query)
        case _:
            return f"[ERROR] No library found for '{lib}'"


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """Dispatch command and print output."""
    match sys.argv[1:]:
        case [cmd_name, *cmd_args] if (entry := CMDS.get(cmd_name)):
            fn, argc = entry
            match cmd_args:
                case _ if len(cmd_args) < argc:
                    print(f"Usage: context7.py {cmd_name} {' '.join(f'<arg{i+1}>' for i in range(argc))}")
                    return 1
                case _:
                    try:
                        print(fn(*cmd_args[:argc + 1]))
                        return 0
                    except httpx.HTTPStatusError as e:
                        print(f"[ERROR] {e.response.status_code}: {e.response.text[:200]}")
                        return 1
                    except httpx.RequestError as e:
                        print(f"[ERROR] {e}")
                        return 1
        case _:
            print(__doc__)
            return 1


if __name__ == "__main__":
    sys.exit(main())
