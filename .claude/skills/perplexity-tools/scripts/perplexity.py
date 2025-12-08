#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["httpx"]
# ///
"""Perplexity AI — polymorphic HTTP client via decorator registration."""

# --- [IMPORTS] ----------------------------------------------------------------
import argparse
import json
import os
import re
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
    base_url: str = "https://api.perplexity.ai"
    key_env: str = "PERPLEXITY_API_KEY"
    timeout: int = 60
    max_results: int = 10
    model_ask: str = "sonar"
    model_research: str = "sonar-deep-research"
    model_reason: str = "sonar-reasoning-pro"


B: Final[_B] = _B()


# --- [PURE_FUNCTIONS] ---------------------------------------------------------
_OP_REFS: Final[dict[str, str]] = {"PERPLEXITY_API_KEY": "op://Tokens/Perplexity Sonar API Key/uyypyebvpvscxrxeunr27wi3gm"}


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


def strip_think(t: str) -> str:
    return re.sub("<think>.*?</think>", "", t, flags=re.DOTALL).strip()


def maybe_strip(content: str, should_strip: bool) -> str:
    return strip_think(content) if should_strip else content


# --- [REGISTRY] ---------------------------------------------------------------
_tools: dict[str, tuple[ToolFn, ToolConfig]] = {}


def tool(**cfg: Any) -> Callable[[ToolFn], ToolFn]:
    """Register tool with HTTP config — method, path, transform, model."""

    def register(fn: ToolFn) -> ToolFn:
        _tools[fn.__name__] = (
            fn,
            {"method": "POST", "path": "/chat/completions", **cfg},
        )
        return fn

    return register


# --- [TOOLS] ------------------------------------------------------------------
@tool(
    model=B.model_ask,
    transform=lambda r, a: {
        "query": a["query"],
        "response": r["choices"][0]["message"]["content"],
        "citations": r.get("citations", []),
    },
)
def ask(query: str) -> dict:
    """Quick question with citations."""
    return {"messages": [{"role": "user", "content": query}]}


@tool(
    model=B.model_research,
    transform=lambda r, a: {
        "query": a["query"],
        "response": maybe_strip(
            r["choices"][0]["message"]["content"], a.get("strip_thinking", False)
        ),
        "citations": r.get("citations", []),
    },
)
def research(query: str, strip_thinking: bool) -> dict:
    """Deep research with optional thinking removal."""
    return {"messages": [{"role": "user", "content": query}]}


@tool(
    model=B.model_reason,
    transform=lambda r, a: {
        "query": a["query"],
        "response": maybe_strip(
            r["choices"][0]["message"]["content"], a.get("strip_thinking", False)
        ),
    },
)
def reason(query: str, strip_thinking: bool) -> dict:
    """Reasoning task."""
    return {"messages": [{"role": "user", "content": query}]}


@tool(
    model=B.model_ask,
    transform=lambda r, a: {
        "query": a["query"],
        "results": r.get("citations", [])[: a.get("max_results", B.max_results)],
    },
)
def search(query: str, max_results: int, country: str) -> dict:
    """Web search returning citations."""
    return {
        "messages": [
            {
                "role": "user",
                "content": f"Search: {query}"
                + (f" (focus: {country})" if country else ""),
            }
        ]
    }


# --- [DISPATCH] ---------------------------------------------------------------
def dispatch(cmd: str, args: dict[str, Any]) -> dict[str, Any]:
    """Execute registered tool via HTTP — pure dispatch, no branching."""
    fn, cfg = _tools[cmd]
    sig = fn.__code__.co_varnames[: fn.__code__.co_argcount]
    body = {**fn(**{k: args[k] for k in sig if k in args}), "model": cfg["model"]}
    headers = {
        "Authorization": f"Bearer {_resolve_secret(B.key_env)}",
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
            ("--strip-thinking", {"action": "store_true"}),
            ("--max-results", {"type": int, "default": B.max_results}),
            ("--country", {"default": ""}),
        ]
    ]
    args = vars(p.parse_args())
    result = dispatch(args.pop("command"), args)
    print(json.dumps(result))
    return 0 if result["status"] == "success" else 1


if __name__ == "__main__":
    sys.exit(main())
