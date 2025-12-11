#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["httpx"]
# ///
"""Context7 — polymorphic HTTP client for centralized error control."""

# --- [IMPORTS] ----------------------------------------------------------------
import json
import os
import sys
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Final
from urllib.parse import quote

import httpx


# --- [TYPES] ------------------------------------------------------------------
type ToolConfig = dict[str, Any]
type ToolFn = Callable[..., str]


# --- [CONSTANTS] --------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class _B:
    base_url: str = "https://context7.com/api"
    key_env: str = "CONTEXT7_API_KEY"
    timeout: int = 30
    tokens: int = 5000
    limit: int = 10
    tokens_per_result: int = 100


B: Final[_B] = _B()

SCRIPT_PATH: Final[str] = "uv run .claude/skills/context7-tools/scripts/context7.py"

COMMANDS: Final[dict[str, dict[str, str]]] = {
    "resolve": {
        "desc": "Resolve library name to Context7 ID",
        "opts": "--library NAME",
        "req": "--library",
    },
    "docs": {
        "desc": "Fetch library documentation",
        "opts": "--library-id ID [--tokens 5000] [--topic TOPIC]",
        "req": "--library-id",
    },
}

REQUIRED: Final[dict[str, tuple[str, ...]]] = {
    "resolve": ("library",),
    "docs": ("library_id",),
}

_COERCE: Final[dict[str, type]] = {"tokens": int}


# --- [PURE_FUNCTIONS] ---------------------------------------------------------
def _usage_error(message: str, cmd: str | None = None) -> dict[str, Any]:
    """Generates usage error for proper syntax."""
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
        lines.append(f'  {SCRIPT_PATH} resolve --library "react"')
        lines.append(f'  {SCRIPT_PATH} docs --library-id "/facebook/react"')
        lines.append(
            f'  {SCRIPT_PATH} docs --library-id "/vercel/next.js" --topic "routing"'
        )

    return {"status": "error", "message": "\n".join(lines)}


def _validate_args(cmd: str, args: dict[str, Any]) -> list[str]:
    """Returns missing required arguments for command."""
    return [
        f"--{k.replace('_', '-')}" for k in REQUIRED.get(cmd, ()) if not args.get(k)
    ]


# --- [REGISTRY] ---------------------------------------------------------------
_tools: dict[str, tuple[ToolFn, ToolConfig]] = {}


def tool(**cfg: Any) -> Callable[[ToolFn], ToolFn]:
    """Registers tool using HTTP config — method, path builder, transform."""

    def register(fn: ToolFn) -> ToolFn:
        _tools[fn.__name__] = (fn, {"method": "GET", **cfg})
        return fn

    return register


# --- [TOOLS] ------------------------------------------------------------------
@tool(
    transform=lambda r, a: {
        "library": a["library"],
        "matches": r.get("results", r.get("libraries", [])),
    }
)
def resolve(library: str) -> str:
    """Resolves library name to Context7 ID."""
    return f"/v1/search?query={quote(library)}"


@tool(transform=lambda r, a: {"library_id": a["library_id"], "docs": r})
def docs(library_id: str, tokens: int, topic: str) -> str:
    """Fetches documentation for library."""
    params = (
        f"limit={tokens // B.tokens_per_result}"
        + (f"&topic={quote(topic)}" if topic else "")
        + "&type=txt"
    )
    return f"/v2/docs/code/{library_id.lstrip('/')}?{params}"


# --- [DISPATCH_TABLE] --------------------------------------------------------
_CONTENT_PARSERS: Final[dict[str, Callable[[httpx.Response], Any]]] = {
    "application/json": lambda r: r.json(),
}


# --- [DISPATCH] ---------------------------------------------------------------
def dispatch(cmd: str, args: dict[str, Any]) -> dict[str, Any]:
    """Executes registered tool via HTTP — pure dispatch without branching."""
    fn, cfg = _tools[cmd]
    sig = fn.__code__.co_varnames[: fn.__code__.co_argcount]
    path = fn(**{k: args.get(k, "") for k in sig})
    headers = {
        "Content-Type": "application/json",
        **({} if not (k := os.environ.get(B.key_env, "")) else {"X-API-Key": k}),
    }
    try:
        with httpx.Client(timeout=B.timeout) as c:
            r = c.request(cfg["method"], f"{B.base_url}{path}", headers=headers)
            r.raise_for_status()
            ct = r.headers.get("content-type", "").partition(";")[0]
            content = _CONTENT_PARSERS.get(ct, lambda x: x.text)(r)
            return {"status": "success", **cfg["transform"](content, args)}
    except httpx.HTTPStatusError as e:
        return {"status": "error", "message": str(e), "code": e.response.status_code}
    except httpx.RequestError as e:
        return {"status": "error", "message": str(e)}


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """CLI entry point — provides centralized error control."""
    if not (args := sys.argv[1:]) or args[0] in ("-h", "--help"):
        return print(json.dumps(_usage_error("No command specified"), indent=2)) or 1
    if (cmd := args[0]) not in COMMANDS:
        return print(json.dumps(_usage_error(f"Unknown command: {cmd}"), indent=2)) or 1

    # Parse flags: --key value or --key=value format
    opts: dict[str, Any] = {"tokens": B.tokens, "topic": ""}
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
