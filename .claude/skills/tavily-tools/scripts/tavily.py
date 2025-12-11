#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["httpx"]
# ///
"""Tavily AI — polymorphic HTTP client via decorator registration."""

# --- [IMPORTS] ----------------------------------------------------------------
import argparse
import json
import os
import sys
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Final

import httpx


# --- [TYPES] ------------------------------------------------------------------
type ToolConfig = dict[str, Any]
type ToolFn = Callable[..., dict[str, Any]]


# --- [CONSTANTS] --------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class _B:
    base_url: str = "https://api.tavily.com"
    key_env: str = "TAVILY_API_KEY"
    timeout: int = 120
    max_results: int = 10
    search_depth: str = "basic"
    topic: str = "general"
    extract_depth: str = "basic"
    fmt: str = "markdown"
    max_depth: int = 1
    max_breadth: int = 20
    limit: int = 50
    http_method: str = "POST"
    empty_str: str = ""
    zero: int = 0
    topic_choices: tuple[str, ...] = ("general", "news")
    depth_choices: tuple[str, ...] = ("basic", "advanced")
    format_choices: tuple[str, ...] = ("markdown", "text")


B: Final[_B] = _B()


# --- [PURE_FUNCTIONS] ---------------------------------------------------------
def _split(s: str) -> list[str]:
    """Split comma-separated string, strip whitespace, filter empty."""
    return [x.strip() for x in s.split(",") if x.strip()] if s else []


def _merge(base: dict, **optionals: Any) -> dict:
    """Merge base dict with non-empty optional values."""
    return {**base, **{k: v for k, v in optionals.items() if v}}


# --- [REGISTRY] ---------------------------------------------------------------
_tools: dict[str, tuple[ToolFn, ToolConfig]] = {}


def tool(**cfg: Any) -> Callable[[ToolFn], ToolFn]:
    """Register tool with HTTP config — method, path, transform."""

    def register(fn: ToolFn) -> ToolFn:
        _tools[fn.__name__] = (fn, {"method": B.http_method, **cfg})
        return fn

    return register


# --- [TOOLS] ------------------------------------------------------------------
@tool(
    path="/search",
    transform=lambda r, a: {
        "query": a["query"],
        "results": r.get("results", []),
        "images": r.get("images", []),
        "answer": r.get("answer", ""),
    },
)
def search(
    query: str,
    topic: str,
    search_depth: str,
    max_results: int,
    time_range: str,
    days: int,
    include_domains: str,
    exclude_domains: str,
    include_images: bool,
    include_image_descriptions: bool,
    include_raw_content: bool,
    include_favicon: bool,
    country: str,
    start_date: str,
    end_date: str,
) -> dict:
    """Web search with AI-powered results and optional images."""
    return _merge(
        {
            "query": query,
            "topic": topic or B.topic,
            "search_depth": search_depth or B.search_depth,
            "max_results": max_results or B.max_results,
            "include_images": include_images,
            "include_image_descriptions": include_image_descriptions,
            "include_raw_content": include_raw_content,
            "include_favicon": include_favicon,
            "include_domains": _split(include_domains),
            "exclude_domains": _split(exclude_domains),
        },
        time_range=time_range,
        days=days,
        country=country,
        start_date=start_date,
        end_date=end_date,
    )


@tool(
    path="/extract",
    transform=lambda r, a: {
        "urls": _split(a["urls"]) if isinstance(a["urls"], str) else a["urls"],
        "results": r.get("results", []),
        "failed": r.get("failed_results", []),
    },
)
def extract(
    urls: str,
    extract_depth: str,
    include_images: bool,
    fmt: str,
    include_favicon: bool,
) -> dict:
    """Extract and process content from URLs."""
    return {
        "urls": _split(urls),
        "extract_depth": extract_depth or B.extract_depth,
        "include_images": include_images,
        "format": fmt or B.fmt,
        "include_favicon": include_favicon,
    }


@tool(
    path="/crawl",
    transform=lambda r, a: {
        "base_url": a["url"],
        "results": r.get("results", []),
        "urls_crawled": len(r.get("results", [])),
    },
)
def crawl(
    url: str,
    max_depth: int,
    max_breadth: int,
    limit: int,
    instructions: str,
    select_paths: str,
    select_domains: str,
    allow_external: bool,
    extract_depth: str,
    fmt: str,
    include_favicon: bool,
) -> dict:
    """Crawl website starting from base URL with depth/breadth control."""
    return _merge(
        {
            "url": url,
            "max_depth": max_depth or B.max_depth,
            "max_breadth": max_breadth or B.max_breadth,
            "limit": limit or B.limit,
            "allow_external": allow_external,
            "extract_depth": extract_depth or B.extract_depth,
            "format": fmt or B.fmt,
            "include_favicon": include_favicon,
            "select_paths": _split(select_paths),
            "select_domains": _split(select_domains),
        },
        instructions=instructions,
    )


@tool(
    path="/map",
    transform=lambda r, a: {
        "base_url": a["url"],
        "urls": r.get("urls", []),
        "total_mapped": len(r.get("urls", [])),
    },
)
def map_site(
    url: str,
    max_depth: int,
    max_breadth: int,
    limit: int,
    instructions: str,
    select_paths: str,
    select_domains: str,
    allow_external: bool,
) -> dict:
    """Map website structure and discover URLs."""
    return _merge(
        {
            "url": url,
            "max_depth": max_depth or B.max_depth,
            "max_breadth": max_breadth or B.max_breadth,
            "limit": limit or B.limit,
            "allow_external": allow_external,
            "select_paths": _split(select_paths),
            "select_domains": _split(select_domains),
        },
        instructions=instructions,
    )


# --- [DISPATCH] ---------------------------------------------------------------
def dispatch(cmd: str, args: dict[str, Any]) -> dict[str, Any]:
    """Execute registered tool via HTTP — expression-based status check."""
    fn, cfg = _tools[cmd]
    sig = fn.__code__.co_varnames[: fn.__code__.co_argcount]
    body = fn(**{k: args[k] for k in sig if k in args})
    body["api_key"] = os.environ.get(B.key_env, "")

    with httpx.Client(timeout=B.timeout) as c:
        r = c.request(cfg["method"], f"{B.base_url}{cfg['path']}", json=body)
        return (
            {"status": "success", **cfg["transform"](r.json(), args)}
            if r.is_success
            else (
                {"status": "error", "message": r.text, "code": r.status_code}
                if isinstance(r, httpx.Response)
                else {"status": "error", "message": str(r)}
            )
        )


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """CLI entry point — parse args and dispatch to tool."""
    p = argparse.ArgumentParser(description=__doc__)
    [
        p.add_argument(a, **o)
        for a, o in [
            ("command", {"choices": _tools.keys()}),
            ("--query", {}),
            ("--topic", {"default": B.topic, "choices": list(B.topic_choices)}),
            (
                "--search-depth",
                {"default": B.search_depth, "choices": list(B.depth_choices)},
            ),
            ("--max-results", {"type": int, "default": B.max_results}),
            ("--time-range", {"default": B.empty_str}),
            ("--days", {"type": int, "default": B.zero}),
            ("--include-domains", {"default": B.empty_str}),
            ("--exclude-domains", {"default": B.empty_str}),
            ("--include-images", {"action": "store_true"}),
            ("--include-image-descriptions", {"action": "store_true"}),
            ("--include-raw-content", {"action": "store_true"}),
            ("--include-favicon", {"action": "store_true"}),
            ("--country", {"default": B.empty_str}),
            ("--start-date", {"default": B.empty_str}),
            ("--end-date", {"default": B.empty_str}),
            ("--urls", {}),
            (
                "--extract-depth",
                {"default": B.extract_depth, "choices": list(B.depth_choices)},
            ),
            (
                "--format",
                {"default": B.fmt, "dest": "fmt", "choices": list(B.format_choices)},
            ),
            ("--url", {}),
            ("--max-depth", {"type": int, "default": B.max_depth}),
            ("--max-breadth", {"type": int, "default": B.max_breadth}),
            ("--limit", {"type": int, "default": B.limit}),
            ("--instructions", {"default": B.empty_str}),
            ("--select-paths", {"default": B.empty_str}),
            ("--select-domains", {"default": B.empty_str}),
            ("--allow-external", {"action": "store_true"}),
        ]
    ]
    args = vars(p.parse_args())
    result = dispatch(args.pop("command"), args)
    print(json.dumps(result))  # noqa: T201
    return 0 if result["status"] == "success" else 1


if __name__ == "__main__":
    sys.exit(main())
