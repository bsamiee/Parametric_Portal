#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["httpx"]
# ///
"""Exa AI — polymorphic HTTP client via decorator registration."""

# --- [IMPORTS] ----------------------------------------------------------------
import argparse
import json
import os
import subprocess
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


B: Final[_B] = _B()


# --- [PURE_FUNCTIONS] ---------------------------------------------------------
_OP_REFS: Final[dict[str, str]] = {"EXA_API_KEY": "op://Tokens/Exa API Key/token"}


def _op_read(ref: str) -> str:
    """Read secret from 1Password CLI, empty on failure."""
    try:
        return subprocess.run(["op", "read", ref], capture_output=True, text=True, check=True).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def _resolve_secret(key: str) -> str:
    """Resolve env var, expanding op:// via 1Password CLI with fallback."""
    val = os.environ.get(key, "")
    return (
        val if val and not val.startswith("op://") else
        _op_read(val if val.startswith("op://") else _OP_REFS.get(key, ""))
    )


# --- [REGISTRY] ---------------------------------------------------------------
_tools: dict[str, tuple[ToolFn, ToolConfig]] = {}


def tool(**cfg: Any) -> Callable[[ToolFn], ToolFn]:
    """Register tool with HTTP config — method, path, transform."""

    def register(fn: ToolFn) -> ToolFn:
        _tools[fn.__name__] = (fn, {"method": "POST", "path": "/search", **cfg})
        return fn

    return register


# --- [TOOLS] ------------------------------------------------------------------
@tool(transform=lambda r, a: {"query": a["query"], "results": r.get("results", [])})
def search(query: str, num_results: int, type: str) -> dict:
    """Web search with text content retrieval."""
    return {
        "query": query,
        "numResults": num_results,
        "type": type,
        "contents": {"text": True},
    }


@tool(transform=lambda r, a: {"query": a["query"], "context": r.get("results", [])})
def code(query: str, num_results: int) -> dict:
    """Code context search via GitHub category."""
    return {
        "query": query,
        "numResults": num_results or B.num_results_code,
        "type": "auto",
        "category": "github",
        "contents": {"text": True},
    }


# --- [DISPATCH] ---------------------------------------------------------------
def dispatch(cmd: str, args: dict[str, Any]) -> dict[str, Any]:
    """Execute registered tool via HTTP — pure dispatch, no branching."""
    fn, cfg = _tools[cmd]
    sig = fn.__code__.co_varnames[: fn.__code__.co_argcount]
    body = fn(**{k: args[k] for k in sig if k in args})
    headers = {
        B.key_header: _resolve_secret(B.key_env),
        "Content-Type": "application/json",
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
    p = argparse.ArgumentParser(description=__doc__)
    [
        p.add_argument(a, **o)
        for a, o in [
            ("command", {"choices": _tools.keys()}),
            ("--query", {"required": True}),
            ("--num-results", {"type": int, "default": B.num_results}),
            ("--type", {"choices": ["auto", "neural", "keyword"], "default": "auto"}),
        ]
    ]
    args = vars(p.parse_args())
    result = dispatch(args.pop("command"), args)
    print(json.dumps(result))
    return 0 if result["status"] == "success" else 1


if __name__ == "__main__":
    sys.exit(main())
