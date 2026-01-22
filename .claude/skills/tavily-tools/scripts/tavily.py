#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["httpx"]
# ///
"""Tavily AI CLI — web search and extraction via REST API.

Commands:
    search   --query TEXT [--topic general|news] [--search-depth basic|advanced] [--max-results N]
    extract  --urls URL1,URL2 [--extract-depth basic|advanced] [--format markdown|text]
    crawl    --url URL [--max-depth N] [--max-breadth N] [--limit N]
    map      --url URL [--max-depth N] [--max-breadth N] [--limit N]
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any, Final

import httpx

# --- [CONSTANTS] --------------------------------------------------------------
BASE: Final = "https://api.tavily.com"
KEY_ENV: Final = "TAVILY_API_KEY"
TIMEOUT: Final = 120

DEFAULTS: Final[dict[str, Any]] = {
    "topic": "general",
    "search_depth": "basic",
    "max_results": 10,
    "extract_depth": "basic",
    "format": "markdown",
    "max_depth": 1,
    "max_breadth": 20,
    "limit": 50,
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
}

# --- [HELPERS] ----------------------------------------------------------------
def _split(s: str) -> list[str]:
    """Split comma-separated string, strip whitespace, filter empty."""
    return [x.strip() for x in s.split(",") if x.strip()] if s else []


def _post(path: str, body: dict) -> dict:
    """POST JSON with API key."""
    body["api_key"] = os.environ.get(KEY_ENV, "")
    with httpx.Client(timeout=TIMEOUT) as c:
        r = c.post(f"{BASE}{path}", json=body)
        r.raise_for_status()
        return r.json()


# --- [COMMANDS] ---------------------------------------------------------------
def search(opts: dict[str, Any]) -> dict:
    """Web search with AI-powered results."""
    body: dict[str, Any] = {
        "query": opts["query"],
        "topic": opts.get("topic") or DEFAULTS["topic"],
        "search_depth": opts.get("search_depth") or DEFAULTS["search_depth"],
        "max_results": opts.get("max_results") or DEFAULTS["max_results"],
        "include_images": opts.get("include_images", False),
        "include_image_descriptions": opts.get("include_image_descriptions", False),
        "include_raw_content": opts.get("include_raw_content", False),
        "include_favicon": opts.get("include_favicon", False),
    }
    if opts.get("include_domains"):
        body["include_domains"] = _split(opts["include_domains"])
    if opts.get("exclude_domains"):
        body["exclude_domains"] = _split(opts["exclude_domains"])
    for key in ("time_range", "days", "country", "start_date", "end_date"):
        if opts.get(key):
            body[key] = opts[key]
    r = _post("/search", body)
    return {"status": "success", "query": opts["query"], "results": r.get("results", []), "images": r.get("images", []), "answer": r.get("answer", "")}


def extract(opts: dict[str, Any]) -> dict:
    """Extract content from URLs."""
    url_list = _split(opts["urls"])
    body = {
        "urls": url_list,
        "extract_depth": opts.get("extract_depth") or DEFAULTS["extract_depth"],
        "format": opts.get("format") or DEFAULTS["format"],
        "include_images": opts.get("include_images", False),
        "include_favicon": opts.get("include_favicon", False),
    }
    r = _post("/extract", body)
    return {"status": "success", "urls": url_list, "results": r.get("results", []), "failed": r.get("failed_results", [])}


def crawl(opts: dict[str, Any]) -> dict:
    """Crawl website from base URL."""
    body: dict[str, Any] = {
        "url": opts["url"],
        "max_depth": opts.get("max_depth") or DEFAULTS["max_depth"],
        "max_breadth": opts.get("max_breadth") or DEFAULTS["max_breadth"],
        "limit": opts.get("limit") or DEFAULTS["limit"],
        "extract_depth": opts.get("extract_depth") or DEFAULTS["extract_depth"],
        "format": opts.get("format") or DEFAULTS["format"],
        "allow_external": opts.get("allow_external", False),
        "include_favicon": opts.get("include_favicon", False),
    }
    if opts.get("select_paths"):
        body["select_paths"] = _split(opts["select_paths"])
    if opts.get("select_domains"):
        body["select_domains"] = _split(opts["select_domains"])
    if opts.get("instructions"):
        body["instructions"] = opts["instructions"]
    r = _post("/crawl", body)
    results = r.get("results", [])
    return {"status": "success", "base_url": opts["url"], "results": results, "urls_crawled": len(results)}


def map_site(opts: dict[str, Any]) -> dict:
    """Map website structure."""
    body: dict[str, Any] = {
        "url": opts["url"],
        "max_depth": opts.get("max_depth") or DEFAULTS["max_depth"],
        "max_breadth": opts.get("max_breadth") or DEFAULTS["max_breadth"],
        "limit": opts.get("limit") or DEFAULTS["limit"],
        "allow_external": opts.get("allow_external", False),
    }
    if opts.get("select_paths"):
        body["select_paths"] = _split(opts["select_paths"])
    if opts.get("select_domains"):
        body["select_domains"] = _split(opts["select_domains"])
    if opts.get("instructions"):
        body["instructions"] = opts["instructions"]
    r = _post("/map", body)
    urls = r.get("urls", [])
    return {"status": "success", "base_url": opts["url"], "urls": urls, "total_mapped": len(urls)}


CMDS: Final[dict[str, Any]] = {"search": search, "extract": extract, "crawl": crawl, "map": map_site}

# --- [FLAG_PARSER] ------------------------------------------------------------
def parse_flags(args: list[str]) -> dict[str, Any]:
    """Parse --flag value and --flag=value patterns."""
    opts: dict[str, Any] = {}
    i = 0
    while i < len(args):
        arg = args[i]
        if arg.startswith("--"):
            key = arg[2:].replace("-", "_")
            if "=" in key:
                key, val = key.split("=", 1)
                opts[key] = int(val) if key in INT_FLAGS else val
            elif key in BOOL_FLAGS:
                opts[key] = True
            elif i + 1 < len(args) and not args[i + 1].startswith("--"):
                val = args[i + 1]
                opts[key] = int(val) if key in INT_FLAGS else val
                i += 1
            else:
                opts[key] = True
        i += 1
    return opts


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """Dispatch command and print JSON output."""
    match sys.argv[1:]:
        case [cmd, *rest] if cmd in CMDS:
            opts = parse_flags(rest)
            req = REQUIRED[cmd]
            if req not in opts:
                print(f"[ERROR] Missing required: --{req.replace('_', '-')}")
                return 1
            try:
                result = CMDS[cmd](opts)
                print(json.dumps(result, indent=2))
                return 0 if result["status"] == "success" else 1
            except httpx.HTTPStatusError as e:
                print(json.dumps({"status": "error", "code": e.response.status_code, "message": e.response.text[:200]}))
                return 1
            except httpx.RequestError as e:
                print(json.dumps({"status": "error", "message": str(e)}))
                return 1
        case [cmd, *_]:
            print(f"[ERROR] Unknown command '{cmd}'\n")
            print(__doc__)
            return 1
        case _:
            print(__doc__)
            return 1


if __name__ == "__main__":
    sys.exit(main())
