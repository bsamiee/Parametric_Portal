#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.14"
# dependencies = ["httpx"]
# ///
"""Tavily AI CLI -- web search, extraction, crawling, and research via REST API.

Commands:
    search   --query TEXT [--topic general|news] [--search-depth basic|advanced] [--max-results N]
    extract  --urls URL1,URL2 [--extract-depth basic|advanced] [--format markdown|text]
    crawl    --url URL [--max-depth N] [--max-breadth N] [--limit N]
    map      --url URL [--max-depth N] [--max-breadth N] [--limit N]
    research --query TEXT [--model mini|pro|auto]
"""
# LOC: 191

import json
import os
import sys
from dataclasses import dataclass
from functools import reduce
from typing import Any, Final

import httpx

from _commands import search, extract, crawl, map_site, research

# --- [CONSTANTS] --------------------------------------------------------------
BASE: Final = "https://api.tavily.com"
KEY_ENV: Final = "TAVILY_API_KEY"
TIMEOUT: Final = 120

BOOL_FLAGS: Final = frozenset({
    "include_images", "include_image_descriptions", "include_raw_content",
    "include_favicon", "allow_external",
})

INT_FLAGS: Final = frozenset({"max_results", "days", "max_depth", "max_breadth", "limit"})

REQUIRED: Final[dict[str, str]] = {
    "search": "query",
    "extract": "urls",
    "crawl": "url",
    "map": "url",
    "research": "query",
}


# --- [FUNCTIONS] --------------------------------------------------------------
def _post(path: str, body: dict, timeout: int = TIMEOUT) -> dict:
    """POST JSON with API key."""
    body["api_key"] = os.environ.get(KEY_ENV, "")
    with httpx.Client(timeout=timeout) as client:
        response = client.post(f"{BASE}{path}", json=body)
        response.raise_for_status()
        return response.json()


@dataclass(frozen=True, slots=True, kw_only=True)
class _FlagState:
    """Immutable accumulator for flag parsing fold."""
    opts: dict[str, Any]
    skip_next: bool


def _parse_flags(args: tuple[str, ...]) -> dict[str, Any]:
    """Parse --flag value and --flag=value patterns via functional fold."""
    def _fold(state: _FlagState, indexed: tuple[int, str]) -> _FlagState:
        """Process a single argument in the fold."""
        index, arg = indexed
        match (state.skip_next, arg.startswith("--")):
            case (True, _):
                return _FlagState(opts=state.opts, skip_next=False)
            case (_, True):
                raw = arg[2:].replace("-", "_")
                match raw.split("=", 1):
                    case [key, val]:
                        return _FlagState(
                            opts={**state.opts, key: int(val) if key in INT_FLAGS else val},
                            skip_next=False,
                        )
                    case [key] if key in BOOL_FLAGS:
                        return _FlagState(opts={**state.opts, key: True}, skip_next=False)
                    case [key]:
                        next_index = index + 1
                        has_value = next_index < len(args) and not args[next_index].startswith("--")
                        value = args[next_index] if has_value else True
                        parsed = int(value) if key in INT_FLAGS and isinstance(value, str) else value
                        return _FlagState(opts={**state.opts, key: parsed}, skip_next=has_value)
                    case _:
                        return state
            case _:
                return state

    return reduce(_fold, enumerate(args), _FlagState(opts={}, skip_next=False)).opts


# --- [DISPATCH_TABLES] --------------------------------------------------------
COMMAND_TABLE: Final[dict[str, Any]] = {
    "search": search,
    "extract": extract,
    "crawl": crawl,
    "map": map_site,
    "research": research,
}


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """Dispatch command and print JSON output."""
    match sys.argv[1:]:
        case [command, *rest] if command in COMMAND_TABLE:
            opts = _parse_flags(tuple(rest))
            required_flag = REQUIRED[command]
            if required_flag not in opts:
                sys.stdout.write(f"[ERROR] Missing required: --{required_flag.replace('_', '-')}\n")
                return 1
            try:
                result = COMMAND_TABLE[command](opts, _post)
                sys.stdout.write(json.dumps(result, indent=2) + "\n")
                return 0 if result["status"] == "success" else 1
            except httpx.HTTPStatusError as error:
                sys.stdout.write(json.dumps({"status": "error", "code": error.response.status_code, "message": error.response.text[:200]}) + "\n")
                return 1
            except httpx.RequestError as error:
                sys.stdout.write(json.dumps({"status": "error", "message": str(error)}) + "\n")
                return 1
        case [command, *_]:
            sys.stdout.write(f"[ERROR] Unknown command '{command}'\n\n")
            sys.stdout.write(__doc__ + "\n")
            return 1
        case _:
            sys.stdout.write(__doc__ + "\n")
            return 1


if __name__ == "__main__":
    sys.exit(main())
