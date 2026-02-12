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

import json
import os
import sys
from collections.abc import Callable
from dataclasses import dataclass
from functools import reduce
from typing import Any, Final

import httpx

# --- [CONSTANTS] --------------------------------------------------------------
BASE: Final = "https://api.tavily.com"
KEY_ENV: Final = "TAVILY_API_KEY"
TIMEOUT: Final = 120
TIMEOUT_RESEARCH: Final = 300

DEFAULTS: Final[dict[str, Any]] = {
    "topic": "general",
    "search_depth": "basic",
    "max_results": 10,
    "extract_depth": "basic",
    "format": "markdown",
    "max_depth": 1,
    "max_breadth": 20,
    "limit": 50,
    "model": "auto",
}

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

# --- [TYPES] ------------------------------------------------------------------
type CommandFn = Callable[[dict[str, Any]], dict]


# --- [FUNCTIONS] --------------------------------------------------------------
def _split(value: str) -> list[str]:
    """Split comma-separated string, strip whitespace, filter empty.

    Args:
        value: Comma-separated string.

    Returns:
        List of non-empty stripped segments.
    """
    return [segment.strip() for segment in value.split(",") if segment.strip()] if value else []


def _post(path: str, body: dict, timeout: int = TIMEOUT) -> dict:
    """POST JSON with API key.

    Args:
        path: API endpoint path.
        body: Request body dict (api_key is injected).
        timeout: Request timeout in seconds.

    Returns:
        Parsed JSON response.
    """
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
    """Parse --flag value and --flag=value patterns via functional fold.

    Args:
        args: Tuple of CLI argument strings.

    Returns:
        Dict of parsed flags.
    """
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

    return reduce(
        _fold,
        enumerate(args),
        _FlagState(opts={}, skip_next=False),
    ).opts


# --- [COMMANDS] ---------------------------------------------------------------
def _search(opts: dict[str, Any]) -> dict:
    """Web search with AI-powered results.

    Args:
        opts: Parsed flag dict with 'query' required.

    Returns:
        Search result dict.
    """
    body: dict[str, Any] = {
        "query": opts["query"],
        "topic": opts.get("topic") or DEFAULTS["topic"],
        "search_depth": opts.get("search_depth") or DEFAULTS["search_depth"],
        "max_results": opts.get("max_results") or DEFAULTS["max_results"],
        "include_images": opts.get("include_images", False),
        "include_image_descriptions": opts.get("include_image_descriptions", False),
        "include_raw_content": opts.get("include_raw_content", False),
        "include_favicon": opts.get("include_favicon", False),
        **({"include_domains": _split(opts["include_domains"])} if opts.get("include_domains") else {}),
        **({"exclude_domains": _split(opts["exclude_domains"])} if opts.get("exclude_domains") else {}),
        **{key: opts[key] for key in ("time_range", "days", "country", "start_date", "end_date") if opts.get(key)},
    }
    response = _post("/search", body)
    return {"status": "success", "query": opts["query"], "results": response.get("results", []), "images": response.get("images", []), "answer": response.get("answer", "")}


def _extract(opts: dict[str, Any]) -> dict:
    """Extract content from URLs.

    Args:
        opts: Parsed flag dict with 'urls' required.

    Returns:
        Extraction result dict.
    """
    url_list = _split(opts["urls"])
    body = {
        "urls": url_list,
        "extract_depth": opts.get("extract_depth") or DEFAULTS["extract_depth"],
        "format": opts.get("format") or DEFAULTS["format"],
        "include_images": opts.get("include_images", False),
        "include_favicon": opts.get("include_favicon", False),
    }
    response = _post("/extract", body)
    return {"status": "success", "urls": url_list, "results": response.get("results", []), "failed": response.get("failed_results", [])}


def _crawl(opts: dict[str, Any]) -> dict:
    """Crawl website from base URL.

    Args:
        opts: Parsed flag dict with 'url' required.

    Returns:
        Crawl result dict.
    """
    body: dict[str, Any] = {
        "url": opts["url"],
        "max_depth": opts.get("max_depth") or DEFAULTS["max_depth"],
        "max_breadth": opts.get("max_breadth") or DEFAULTS["max_breadth"],
        "limit": opts.get("limit") or DEFAULTS["limit"],
        "extract_depth": opts.get("extract_depth") or DEFAULTS["extract_depth"],
        "format": opts.get("format") or DEFAULTS["format"],
        "allow_external": opts.get("allow_external", False),
        "include_favicon": opts.get("include_favicon", False),
        **({"select_paths": _split(opts["select_paths"])} if opts.get("select_paths") else {}),
        **({"select_domains": _split(opts["select_domains"])} if opts.get("select_domains") else {}),
        **({"instructions": opts["instructions"]} if opts.get("instructions") else {}),
    }
    response = _post("/crawl", body)
    results = response.get("results", [])
    return {"status": "success", "base_url": opts["url"], "results": results, "urls_crawled": len(results)}


def _map_site(opts: dict[str, Any]) -> dict:
    """Map website structure.

    Args:
        opts: Parsed flag dict with 'url' required.

    Returns:
        Site map result dict.
    """
    body: dict[str, Any] = {
        "url": opts["url"],
        "max_depth": opts.get("max_depth") or DEFAULTS["max_depth"],
        "max_breadth": opts.get("max_breadth") or DEFAULTS["max_breadth"],
        "limit": opts.get("limit") or DEFAULTS["limit"],
        "allow_external": opts.get("allow_external", False),
        **({"select_paths": _split(opts["select_paths"])} if opts.get("select_paths") else {}),
        **({"select_domains": _split(opts["select_domains"])} if opts.get("select_domains") else {}),
        **({"instructions": opts["instructions"]} if opts.get("instructions") else {}),
    }
    response = _post("/map", body)
    urls = response.get("urls", [])
    return {"status": "success", "base_url": opts["url"], "urls": urls, "total_mapped": len(urls)}


def _research(opts: dict[str, Any]) -> dict:
    """Multi-step deep research with structured report.

    Args:
        opts: Parsed flag dict with 'query' required.

    Returns:
        Research result dict.
    """
    body: dict[str, Any] = {
        "query": opts["query"],
        "model": opts.get("model") or DEFAULTS["model"],
    }
    response = _post("/research", body, TIMEOUT_RESEARCH)
    return {
        "status": "success",
        "query": opts["query"],
        "report": response.get("report", response.get("content", "")),
        "sources": response.get("sources", []),
    }


# --- [DISPATCH_TABLES] --------------------------------------------------------
COMMAND_TABLE: Final[dict[str, CommandFn]] = {
    "search": _search,
    "extract": _extract,
    "crawl": _crawl,
    "map": _map_site,
    "research": _research,
}


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """Dispatch command and print JSON output.

    Returns:
        Exit code: 0 for success, 1 for failure.
    """
    match sys.argv[1:]:
        case [command, *rest] if command in COMMAND_TABLE:
            opts = _parse_flags(tuple(rest))
            required_flag = REQUIRED[command]
            if required_flag not in opts:
                sys.stdout.write(f"[ERROR] Missing required: --{required_flag.replace('_', '-')}\n")
                return 1
            try:
                result = COMMAND_TABLE[command](opts)
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
