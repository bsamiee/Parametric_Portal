#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["httpx"]
# ///
"""Exa AI — polymorphic HTTP client with centralized error control."""

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


# --- [CONSTANTS] --------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class _B:
    base_url: str = "https://api.exa.ai"
    key_env: str = "EXA_API_KEY"
    key_header: str = "x-api-key"
    timeout: int = 30
    num_results: int = 8
    num_results_code: int = 10
    max_chars: int = 10000
    http_method: str = "POST"
    search_path: str = "/search"
    content_type: str = "application/json"
    search_type_auto: str = "auto"
    search_type_neural: str = "neural"
    search_type_keyword: str = "keyword"
    category_github: str = "github"


B: Final[_B] = _B()

_SEARCH_TYPES: Final[tuple[str, ...]] = (
    B.search_type_auto,
    B.search_type_neural,
    B.search_type_keyword,
)

SCRIPT_PATH: Final[str] = "uv run .claude/skills/exa-tools/scripts/exa.py"

COMMANDS: Final[dict[str, dict[str, str]]] = {
    "search": {
        "desc": "Web search with AI-powered results",
        "opts": "--query TEXT [--num-results 8] [--type auto|neural|keyword]",
        "req": "--query",
    },
    "code": {
        "desc": "Code context search (GitHub)",
        "opts": "--query TEXT [--num-results 10]",
        "req": "--query",
    },
}

REQUIRED: Final[dict[str, tuple[str, ...]]] = {
    "search": ("query",),
    "code": ("query",),
}

_COERCE: Final[dict[str, type]] = {"num_results": int}


# --- [PURE_FUNCTIONS] ---------------------------------------------------------
def _usage_error(message: str, cmd: str | None = None) -> dict[str, Any]:
    """Generate usage error with correct syntax."""
    lines = [f"[ERROR] {message}", "", "[USAGE]"]

    if cmd and cmd in COMMANDS:
        lines.append(f"  {SCRIPT_PATH} {cmd} {COMMANDS[cmd]['opts']}")
        lines.append(f"  Required: {COMMANDS[cmd]['req']}")
    else:
        lines.append(f"  {SCRIPT_PATH} <command> [options]")
        lines.append("")
        lines.append("[COMMANDS]")
        for name, info in COMMANDS.items():
            lines.append(f"  {name:<8} {info['desc']}")
        lines.append("")
        lines.append("[EXAMPLES]")
        lines.append(f'  {SCRIPT_PATH} search --query "Vite 7 new features"')
        lines.append(f'  {SCRIPT_PATH} search --query "Effect-TS" --type neural')
        lines.append(f'  {SCRIPT_PATH} code --query "React hooks examples"')

    return {"status": "error", "message": "\n".join(lines)}


def _validate_args(cmd: str, args: dict[str, Any]) -> list[str]:
    """Return list of missing required arguments for command."""
    return [
        f"--{k.replace('_', '-')}" for k in REQUIRED.get(cmd, ()) if not args.get(k)
    ]


def _make_tool_body(
    query: str, num_results: int, type: str, category: str | None = None
) -> dict[str, Any]:
    """Build request body with optional category."""
    base = {
        "query": query,
        "numResults": num_results,
        "type": type,
        "contents": {"text": True},
    }
    return {**base, "category": category} if category else base


# --- [REGISTRY] ---------------------------------------------------------------
_tools: dict[str, tuple[ToolFn, ToolConfig]] = {}


def tool(**cfg: Any) -> Callable[[ToolFn], ToolFn]:
    """Register tool with HTTP config — method, path, transform."""

    def register(fn: ToolFn) -> ToolFn:
        _tools[fn.__name__] = (
            fn,
            {"method": B.http_method, "path": B.search_path, **cfg},
        )
        return fn

    return register


# --- [TOOLS] ------------------------------------------------------------------
@tool(
    transform=lambda r, a: {
        "query": a["query"],
        "results": r.get("results", []),
    }
)
def search(query: str, num_results: int, type: str) -> dict:
    """Web search with text content retrieval."""
    return _make_tool_body(query, num_results, type)


@tool(
    transform=lambda r, a: {
        "query": a["query"],
        "context": r.get("results", []),
    }
)
def code(query: str, num_results: int) -> dict:
    """Code context search via GitHub category."""
    return _make_tool_body(
        query, num_results or B.num_results_code, B.search_type_auto, B.category_github
    )


# --- [DISPATCH] ---------------------------------------------------------------
def dispatch(cmd: str, args: dict[str, Any]) -> dict[str, Any]:
    """Execute registered tool via HTTP — pure dispatch, no branching."""
    fn, cfg = _tools[cmd]
    sig = fn.__code__.co_varnames[: fn.__code__.co_argcount]
    body = fn(**{k: args.get(k, "") for k in sig})
    headers = {
        B.key_header: os.environ.get(B.key_env, ""),
        "Content-Type": B.content_type,
    }
    try:
        with httpx.Client(timeout=B.timeout) as c:
            r = c.request(
                cfg["method"], f"{B.base_url}{cfg['path']}", headers=headers, json=body
            )
            r.raise_for_status()
            return {"status": "success", **cfg["transform"](r.json(), args)}
    except httpx.HTTPStatusError as e:
        return {"status": "error", "message": str(e), "code": e.response.status_code}
    except httpx.RequestError as e:
        return {"status": "error", "message": str(e)}


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """CLI entry point — centralized error control."""
    if not (args := sys.argv[1:]) or args[0] in ("-h", "--help"):
        return print(json.dumps(_usage_error("No command specified"), indent=2)) or 1
    if (cmd := args[0]) not in COMMANDS:
        return print(json.dumps(_usage_error(f"Unknown command: {cmd}"), indent=2)) or 1

    # Parse flags (--key value or --key=value)
    opts: dict[str, Any] = {
        "num_results": B.num_results,
        "type": B.search_type_auto,
    }
    i = 1
    while i < len(args):
        arg = args[i]
        if arg.startswith("--"):
            if "=" in arg:
                key, val = arg[2:].split("=", 1)
                opts[key.replace("-", "_")] = val
            elif i + 1 < len(args) and not args[i + 1].startswith("--"):
                key = arg[2:].replace("-", "_")
                val = args[i + 1]
                opts[key] = _COERCE.get(key, str)(val)
                i += 1
            else:
                opts[arg[2:].replace("-", "_")] = True
        i += 1

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
