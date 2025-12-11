#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["httpx"]
# ///
"""Tavily AI — polymorphic HTTP client; centralized error control."""

# --- [IMPORTS] ----------------------------------------------------------------
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
type TransformFn = Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]]


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
    topic_choices: tuple[str, ...] = ("general", "news")
    depth_choices: tuple[str, ...] = ("basic", "advanced")
    format_choices: tuple[str, ...] = ("markdown", "text")


B: Final[_B] = _B()

SCRIPT_PATH: Final[str] = "uv run .claude/skills/tavily-tools/scripts/tavily.py"

COMMANDS: Final[dict[str, dict[str, str]]] = {
    "search": {
        "desc": "Web search with AI-powered results",
        "opts": "--query TEXT [--topic general|news] [--search-depth basic|advanced] [--max-results 10]",
        "req": "--query",
    },
    "extract": {
        "desc": "Extract content from URLs",
        "opts": "--urls URL1,URL2 [--extract-depth basic|advanced] [--format markdown|text]",
        "req": "--urls",
    },
    "crawl": {
        "desc": "Crawl website from base URL",
        "opts": "--url URL [--max-depth 1] [--max-breadth 20] [--limit 50]",
        "req": "--url",
    },
    "map": {
        "desc": "Map website structure",
        "opts": "--url URL [--max-depth 1] [--max-breadth 20] [--limit 50]",
        "req": "--url",
    },
}

REQUIRED: Final[dict[str, tuple[str, ...]]] = {
    "search": ("query",),
    "extract": ("urls",),
    "crawl": ("url",),
    "map": ("url",),
}

_COERCE: Final[dict[str, type]] = {
    "max_results": int,
    "days": int,
    "max_depth": int,
    "max_breadth": int,
    "limit": int,
}


# --- [PURE_FUNCTIONS] ---------------------------------------------------------
def _usage_error(message: str, cmd: str | None = None) -> dict[str, Any]:
    """Generates usage error for correct syntax."""
    lines = [f"[ERROR] {message}", "", "[USAGE]"]

    if cmd and cmd in COMMANDS:
        lines.append(f"  {SCRIPT_PATH} {cmd} {COMMANDS[cmd]['opts']}")
        lines.append(f"  Required: {COMMANDS[cmd]['req']}")
    else:
        lines.append(f"  {SCRIPT_PATH} <command> [options]")
        lines.append("")
        lines.append("[COMMANDS]")
        for name, info in COMMANDS.items():
            lines.append(f"  {name:<10} {info['desc']}")
        lines.append("")
        lines.append("[EXAMPLES]")
        lines.append(f'  {SCRIPT_PATH} search --query "Vite 7 new features"')
        lines.append(f'  {SCRIPT_PATH} extract --urls "https://example.com"')
        lines.append(f'  {SCRIPT_PATH} crawl --url "https://docs.effect.website"')
        lines.append(f'  {SCRIPT_PATH} map --url "https://nx.dev"')

    return {"status": "error", "message": "\n".join(lines)}


def _validate_args(cmd: str, args: dict[str, Any]) -> list[str]:
    """Returns missing required arguments for command."""
    return [
        f"--{k.replace('_', '-')}" for k in REQUIRED.get(cmd, ()) if not args.get(k)
    ]


def _split(s: str) -> list[str]:
    """Splits comma-separated string—strips whitespace, filters empty."""
    return [x.strip() for x in s.split(",") if x.strip()] if s else []


def _merge(base: dict, **optionals: Any) -> dict:
    """Merges base dict with non-empty optional values."""
    return {**base, **{k: v for k, v in optionals.items() if v}}


# --- [REGISTRY] ---------------------------------------------------------------
_tools: dict[str, tuple[ToolFn, ToolConfig]] = {}


def tool(**cfg: Any) -> Callable[[ToolFn], ToolFn]:
    """Registers tool—HTTP config: method, path, transform."""

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
    """Executes web search—returns AI-powered results, optional images."""
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
    """Extracts content from URLs."""
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
    """Crawls website from base URL—controls depth and breadth."""
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
    """Maps website structure—discovers URLs."""
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
    """Executes registered tool via HTTP—expression-based status check."""
    fn_name = "map_site" if cmd == "map" else cmd
    fn, cfg = _tools[fn_name]
    sig = fn.__code__.co_varnames[: fn.__code__.co_argcount]
    body = fn(**{k: args.get(k, "") for k in sig})
    body["api_key"] = os.environ.get(B.key_env, "")

    method: str = cfg["method"]
    path: str = cfg["path"]
    transform: TransformFn = cfg["transform"]

    try:
        with httpx.Client(timeout=B.timeout) as c:
            r = c.request(method, f"{B.base_url}{path}", json=body)
            r.raise_for_status()
            return {"status": "success", **transform(r.json(), args)}
    except httpx.HTTPStatusError as e:
        return {"status": "error", "message": str(e), "code": e.response.status_code}
    except httpx.RequestError as e:
        return {"status": "error", "message": str(e)}


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """CLI entry point—centralizes error control."""
    if not (args := sys.argv[1:]) or args[0] in ("-h", "--help"):
        return print(json.dumps(_usage_error("No command specified"), indent=2)) or 1
    if (cmd := args[0]) not in COMMANDS:
        return print(json.dumps(_usage_error(f"Unknown command: {cmd}"), indent=2)) or 1

    # Parse flags (--key value or --key=value)
    opts: dict[str, Any] = {
        "topic": B.topic,
        "search_depth": B.search_depth,
        "max_results": B.max_results,
        "time_range": "",
        "days": 0,
        "include_domains": "",
        "exclude_domains": "",
        "include_images": False,
        "include_image_descriptions": False,
        "include_raw_content": False,
        "include_favicon": False,
        "country": "",
        "start_date": "",
        "end_date": "",
        "extract_depth": B.extract_depth,
        "fmt": B.fmt,
        "max_depth": B.max_depth,
        "max_breadth": B.max_breadth,
        "limit": B.limit,
        "instructions": "",
        "select_paths": "",
        "select_domains": "",
        "allow_external": False,
    }

    i = 1
    while i < len(args):
        arg = args[i]
        if arg.startswith("--"):
            if "=" in arg:
                key, val = arg[2:].split("=", 1)
                opts[key.replace("-", "_")] = val
            elif arg in (
                "--include-images",
                "--include-image-descriptions",
                "--include-raw-content",
                "--include-favicon",
                "--allow-external",
            ):
                opts[arg[2:].replace("-", "_")] = True
            elif i + 1 < len(args) and not args[i + 1].startswith("--"):
                key = arg[2:].replace("-", "_")
                val = args[i + 1]
                opts[key] = _COERCE.get(key, str)(val)
                i += 1
            else:
                opts[arg[2:].replace("-", "_")] = True
        i += 1

    # Handle --format -> fmt
    if "format" in opts:
        opts["fmt"] = opts.pop("format")

    if missing := _validate_args(cmd, opts):
        return (
            print(
                json.dumps(
                    _usage_error(f"Missing required: {', '.join(missing)}", cmd),
                    indent=2,
                )
            )
            or 1
        )

    result = dispatch(cmd, opts)
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "success" else 1


if __name__ == "__main__":
    sys.exit(main())
