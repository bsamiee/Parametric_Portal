#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.14"
# dependencies = ["httpx"]
# ///
"""Context7 CLI — library documentation via REST API.

Commands:
    resolve <library> [query]     List matching library IDs (JSON)
    docs <library-id> <query>     Fetch documentation (plain text)
    lookup <library> <query>      Resolve + fetch in one call (plain text)
"""

from collections.abc import Callable
import json
import os
import sys
from typing import Final
from urllib.parse import quote

import httpx


# --- [CONSTANTS] --------------------------------------------------------------
BASE: Final = "https://context7.com"
KEY_ENV: Final = "CONTEXT7_API_KEY"
TIMEOUT: Final = 60
TOKENS: Final = 15000

# --- [TYPES] ------------------------------------------------------------------
type CommandEntry = tuple[Callable[..., str], int]
type CommandRegistry = dict[str, CommandEntry]

# --- [DISPATCH] ---------------------------------------------------------------
CMDS: Final[CommandRegistry] = {}


def cmd(argc: int) -> Callable[[Callable[..., str]], Callable[..., str]]:
    """Register command with argument count."""

    def register(fn: Callable[..., str]) -> Callable[..., str]:
        CMDS[fn.__name__] = (fn, argc)
        return fn

    return register


# --- [FUNCTIONS] --------------------------------------------------------------
def _get(path: str) -> dict | str:
    """GET with optional bearer auth. Returns JSON or text based on content-type."""
    headers = {"Authorization": f"Bearer {token}"} if (token := os.environ.get(KEY_ENV)) else {}
    with httpx.Client(timeout=TIMEOUT) as client:
        response = client.get(f"{BASE}{path}", headers=headers)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        return response.json() if "json" in content_type else response.text


def _search(lib: str, query: str = "") -> list[dict]:
    """Search libraries, return raw matches."""
    query_param = f"&query={quote(query)}" * bool(query)
    match _get(f"/api/v2/libs/search?libraryName={quote(lib)}{query_param}"):
        case dict(data):
            return data.get("results", data.get("libraries", []))
        case _:
            return []


def _pick(matches: list[dict]) -> dict | None:
    """Select best match: VIP first, then highest benchmark score."""
    return next(
        (match for match in matches if match.get("vip")),
        max(matches, key=lambda match: match.get("benchmarkScore", 0), default=None),
    )


# --- [COMMANDS] ---------------------------------------------------------------
@cmd(1)
def resolve(lib: str, query: str = "") -> str:
    """Resolve library -> JSON list of matching IDs with scores."""
    return json.dumps(
        [
            {
                "id": match["id"],
                "title": match.get("title", ""),
                "score": match.get("benchmarkScore", 0),
                "vip": match.get("vip", False),
            }
            for match in _search(lib, query)[:5]
        ],
        indent=2,
    )


@cmd(2)
def docs(lib_id: str, query: str) -> str:
    """Fetch documentation for library ID. Returns plain text."""
    lid = lib_id if lib_id.startswith("/") else f"/{lib_id}"
    match _get(f"/api/v2/context?libraryId={quote(lid)}&query={quote(query)}&tokens={TOKENS}"):
        case str(text):
            return f"[{lid}]\n\n{text}"
        case data:
            return json.dumps(data)


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
        case [cmd_name, *cmd_args] if entry := CMDS.get(cmd_name):
            fn, argc = entry
            match cmd_args:
                case _ if len(cmd_args) < argc:
                    sys.stdout.write(
                        f"Usage: context7.py {cmd_name} {' '.join(f'<arg{index + 1}>' for index in range(argc))}\n"
                    )
                    return 1
                case _:
                    try:
                        sys.stdout.write(fn(*cmd_args[: argc + 1]) + "\n")
                        return 0
                    except httpx.HTTPStatusError as error:
                        sys.stdout.write(f"[ERROR] {error.response.status_code}: {error.response.text[:200]}\n")
                        return 1
                    except httpx.RequestError as error:
                        sys.stdout.write(f"[ERROR] {error}\n")
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
