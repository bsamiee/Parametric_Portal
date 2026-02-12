#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.14"
# dependencies = ["httpx"]
# ///
"""Exa AI CLI — semantic web search via REST API.

Commands:
    search <query> [type] [num]   Web search (type: auto|neural|keyword|fast|deep, default: auto 8)
    code <query> [num]            Code search via GitHub (default: 10 results)
    find-similar <url> [num]      Find pages similar to URL (default: 10 results)
    answer <query>                AI-generated answer with citations
"""

import json
import os
import sys
from collections.abc import Callable
from typing import Final

import httpx

# --- [CONSTANTS] --------------------------------------------------------------
BASE: Final = "https://api.exa.ai"
KEY_ENV: Final = "EXA_API_KEY"
TIMEOUT: Final = 60
TIMEOUT_ANSWER: Final = 240
MAX_CHARS: Final = 10000
VALID_TYPES: Final = frozenset({"auto", "neural", "keyword", "fast", "deep"})

# --- [TYPES] ------------------------------------------------------------------
type CommandEntry = tuple[Callable[..., dict], int]
type CommandRegistry = dict[str, CommandEntry]

# --- [DISPATCH] ---------------------------------------------------------------
CMDS: Final[CommandRegistry] = {}


def cmd(argc: int) -> Callable[[Callable[..., dict]], Callable[..., dict]]:
    """Register command with required argument count."""
    def register(fn: Callable[..., dict]) -> Callable[..., dict]:
        CMDS[fn.__name__.replace("_", "-")] = (fn, argc)
        return fn
    return register


# --- [FUNCTIONS] --------------------------------------------------------------
def _post(path: str, body: dict, timeout: int = TIMEOUT) -> dict:
    """POST JSON with API key auth."""
    headers = {"x-api-key": os.environ.get(KEY_ENV, ""), "Content-Type": "application/json"}
    with httpx.Client(timeout=timeout) as client:
        response = client.post(f"{BASE}{path}", headers=headers, json=body)
        response.raise_for_status()
        return response.json()


def _search_body(query: str, num: int, type_: str, category: str | None = None) -> dict:
    """Build search request body."""
    body: dict = {"query": query, "numResults": num, "type": type_, "contents": {"text": True}}
    return {**body, "category": category} if category else body


# --- [COMMANDS] ---------------------------------------------------------------
@cmd(1)
def search(query: str, type_: str = "auto", num: str = "8") -> dict:
    """Web search with text content retrieval."""
    match type_:
        case t if t in VALID_TYPES:
            data = _post("/search", _search_body(query, int(num), t))
            return {"status": "success", "query": query, "results": data.get("results", [])}
        case invalid:
            return {"status": "error", "message": f"Invalid type '{invalid}'. Use: {', '.join(sorted(VALID_TYPES))}"}


@cmd(1)
def code(query: str, num: str = "10") -> dict:
    """Code context search via GitHub category."""
    data = _post("/search", _search_body(query, int(num), "auto", "github"))
    return {"status": "success", "query": query, "context": data.get("results", [])}


@cmd(1)
def find_similar(url: str, num: str = "10") -> dict:
    """Find pages similar in meaning to the given URL."""
    body = {"url": url, "numResults": int(num), "contents": {"text": True}}
    data = _post("/findSimilar", body)
    return {"status": "success", "url": url, "results": data.get("results", [])}


@cmd(1)
def answer(query: str) -> dict:
    """AI-generated answer with web sources."""
    body = {"query": query, "text": True}
    data = _post("/answer", body, TIMEOUT_ANSWER)
    return {
        "status": "success",
        "query": query,
        "answer": data.get("answer", ""),
        "sources": data.get("results", []),
    }


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """Dispatch command and print JSON output."""
    match sys.argv[1:]:
        case [cmd_name, *cmd_args] if (entry := CMDS.get(cmd_name)):
            fn, argc = entry
            match cmd_args:
                case _ if len(cmd_args) < argc:
                    sys.stdout.write(f"Usage: exa.py {cmd_name} {' '.join(f'<arg{index + 1}>' for index in range(argc))}\n")
                    return 1
                case _:
                    try:
                        result = fn(*cmd_args[:argc + 2])
                        sys.stdout.write(json.dumps(result, indent=2) + "\n")
                        return 0 if result["status"] == "success" else 1
                    except httpx.HTTPStatusError as error:
                        sys.stdout.write(json.dumps({"status": "error", "code": error.response.status_code, "message": error.response.text[:200]}) + "\n")
                        return 1
                    except httpx.RequestError as error:
                        sys.stdout.write(json.dumps({"status": "error", "message": str(error)}) + "\n")
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
