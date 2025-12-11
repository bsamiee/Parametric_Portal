#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["httpx"]
# ///
"""Perplexity AI — polymorphic HTTP client for centralized error control."""

# --- [IMPORTS] ----------------------------------------------------------------
import json
import os
import re
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
    base_url: str = "https://api.perplexity.ai"
    key_env: str = "PERPLEXITY_API_KEY"
    timeout_default: int = 240
    timeout_research: int = 600
    max_results: int = 10
    model_ask: str = "sonar"
    model_research: str = "sonar-deep-research"
    model_reason: str = "sonar-reasoning-pro"
    http_method: str = "POST"
    http_path: str = "/chat/completions"
    header_auth: str = "Authorization"
    header_content_type: str = "Content-Type"
    content_type_json: str = "application/json"
    search_prefix: str = "Search: "
    search_focus_prefix: str = " (focus: "
    search_focus_suffix: str = ")"


B: Final[_B] = _B()

SCRIPT_PATH: Final[str] = "uv run .claude/skills/perplexity-tools/scripts/perplexity.py"

COMMANDS: Final[dict[str, dict[str, str]]] = {
    "ask": {
        "desc": "Quick question with citations",
        "opts": "--query TEXT",
        "req": "--query",
    },
    "research": {
        "desc": "Deep research with thinking",
        "opts": "--query TEXT [--strip-thinking]",
        "req": "--query",
    },
    "reason": {
        "desc": "Reasoning task",
        "opts": "--query TEXT [--strip-thinking]",
        "req": "--query",
    },
    "search": {
        "desc": "Web search returning citations",
        "opts": "--query TEXT [--max-results 10] [--country CODE]",
        "req": "--query",
    },
}

REQUIRED: Final[dict[str, tuple[str, ...]]] = {
    "ask": ("query",),
    "research": ("query",),
    "reason": ("query",),
    "search": ("query",),
}

_COERCE: Final[dict[str, type]] = {"max_results": int}


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
        lines.append(f'  {SCRIPT_PATH} ask --query "What is Effect-TS?"')
        lines.append(
            f'  {SCRIPT_PATH} research --query "React 19 features" --strip-thinking'
        )
        lines.append(f'  {SCRIPT_PATH} search --query "Nx 22 Crystal" --max-results 5')

    return {"status": "error", "message": "\n".join(lines)}


def _validate_args(cmd: str, args: dict[str, Any]) -> list[str]:
    """Returns missing required arguments for command."""
    return [
        f"--{k.replace('_', '-')}" for k in REQUIRED.get(cmd, ()) if not args.get(k)
    ]


def _strip_think(content: str, should_strip: bool) -> str:
    """Strips <think> tags when requested."""
    return (
        re.sub("<think>.*?</think>", "", content, flags=re.DOTALL).strip()
        if should_strip
        else content
    )


def extract_content(response: dict[str, Any]) -> str:
    return response["choices"][0]["message"]["content"]


def extract_citations(response: dict[str, Any]) -> list[Any]:
    return response.get("citations", [])


# --- [REGISTRY] ---------------------------------------------------------------
_tools: dict[str, tuple[ToolFn, ToolConfig]] = {}


def tool(**cfg: Any) -> Callable[[ToolFn], ToolFn]:
    """Registers tool—HTTP config: method, path, transform, model."""

    def register(fn: ToolFn) -> ToolFn:
        _tools[fn.__name__] = (
            fn,
            {"method": B.http_method, "path": B.http_path, **cfg},
        )
        return fn

    return register


# --- [TOOLS] ------------------------------------------------------------------
@tool(
    model=B.model_ask,
    transform=lambda r, a: {
        "query": a["query"],
        "response": extract_content(r),
        "citations": extract_citations(r),
    },
)
def ask(query: str) -> dict:
    """Quick question—returns citations."""
    return {"messages": [{"role": "user", "content": query}]}


@tool(
    model=B.model_research,
    transform=lambda r, a: {
        "query": a["query"],
        "response": _strip_think(extract_content(r), a.get("strip_thinking", False)),
        "citations": extract_citations(r),
    },
)
def research(query: str, strip_thinking: bool) -> dict:
    """Deep research—optional thinking removal."""
    return {"messages": [{"role": "user", "content": query}]}


@tool(
    model=B.model_reason,
    transform=lambda r, a: {
        "query": a["query"],
        "response": _strip_think(extract_content(r), a.get("strip_thinking", False)),
    },
)
def reason(query: str, strip_thinking: bool) -> dict:
    """Executes reasoning task."""
    return {"messages": [{"role": "user", "content": query}]}


@tool(
    model=B.model_ask,
    transform=lambda r, a: {
        "query": a["query"],
        "results": extract_citations(r)[: a.get("max_results", B.max_results)],
    },
)
def search(query: str, max_results: int, country: str) -> dict:
    """Web search returning citations."""
    return {
        "messages": [
            {
                "role": "user",
                "content": B.search_prefix
                + query
                + (
                    B.search_focus_prefix + country + B.search_focus_suffix
                    if country
                    else ""
                ),
            }
        ]
    }


# --- [DISPATCH] ---------------------------------------------------------------
TIMEOUT_MAP: Final[dict[str, int]] = {
    "research": B.timeout_research,
    "reason": B.timeout_research,
}


def dispatch(cmd: str, args: dict[str, Any]) -> dict[str, Any]:
    """Execute registered tool via HTTP — pure dispatch, no branching."""
    fn, cfg = _tools[cmd]
    sig = fn.__code__.co_varnames[: fn.__code__.co_argcount]
    body = {**fn(**{k: args.get(k, "") for k in sig}), "model": cfg["model"]}
    headers = {
        B.header_auth: f"Bearer {os.environ.get(B.key_env, '')}",
        B.header_content_type: B.content_type_json,
    }
    timeout = TIMEOUT_MAP.get(cmd, B.timeout_default)
    try:
        with httpx.Client(timeout=timeout) as c:
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
        "strip_thinking": False,
        "max_results": B.max_results,
        "country": "",
    }
    i = 1
    while i < len(args):
        arg = args[i]
        if arg.startswith("--"):
            if "=" in arg:
                key, val = arg[2:].split("=", 1)
                opts[key.replace("-", "_")] = val
            elif arg == "--strip-thinking":
                opts["strip_thinking"] = True
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
