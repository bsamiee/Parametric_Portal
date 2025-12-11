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
    http_method: str = "POST"
    http_path: str = "/chat/completions"
    header_auth: str = "Authorization"
    header_content_type: str = "Content-Type"
    content_type_json: str = "application/json"
    status_success: str = "success"
    status_error: str = "error"
    key_message: str = "message"
    key_code: str = "code"
    key_status: str = "status"
    search_prefix: str = "Search: "
    search_focus_prefix: str = " (focus: "
    search_focus_suffix: str = ")"


B: Final[_B] = _B()


# --- [PURE_FUNCTIONS] ---------------------------------------------------------
def strip_think(t: str) -> str:
    return re.sub("<think>.*?</think>", "", t, flags=re.DOTALL).strip()


def maybe_strip(content: str, should_strip: bool) -> str:
    return strip_think(content) if should_strip else content


def extract_content(response: dict[str, Any]) -> str:
    return response["choices"][0]["message"]["content"]


def extract_citations(response: dict[str, Any]) -> list[Any]:
    return response.get("citations", [])


# --- [REGISTRY] ---------------------------------------------------------------
_tools: dict[str, tuple[ToolFn, ToolConfig]] = {}


def tool(**cfg: Any) -> Callable[[ToolFn], ToolFn]:
    """Register tool with HTTP config — method, path, transform, model."""

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
    """Quick question with citations."""
    return {"messages": [{"role": "user", "content": query}]}


@tool(
    model=B.model_research,
    transform=lambda r, a: {
        "query": a["query"],
        "response": maybe_strip(extract_content(r), a.get("strip_thinking", False)),
        "citations": extract_citations(r),
    },
)
def research(query: str, strip_thinking: bool) -> dict:
    """Deep research with optional thinking removal."""
    return {"messages": [{"role": "user", "content": query}]}


@tool(
    model=B.model_reason,
    transform=lambda r, a: {
        "query": a["query"],
        "response": maybe_strip(extract_content(r), a.get("strip_thinking", False)),
    },
)
def reason(query: str, strip_thinking: bool) -> dict:
    """Reasoning task."""
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
def dispatch(cmd: str, args: dict[str, Any]) -> dict[str, Any]:
    """Execute registered tool via HTTP — pure dispatch, no branching."""
    fn, cfg = _tools[cmd]
    sig = fn.__code__.co_varnames[: fn.__code__.co_argcount]
    body = {**fn(**{k: args[k] for k in sig if k in args}), "model": cfg["model"]}
    headers = {
        B.header_auth: f"Bearer {os.environ.get(B.key_env, '')}",
        B.header_content_type: B.content_type_json,
    }
    try:
        with httpx.Client(timeout=B.timeout) as c:
            r = c.request(
                cfg["method"], f"{B.base_url}{cfg['path']}", headers=headers, json=body
            )
            r.raise_for_status()
            return {B.key_status: B.status_success, **cfg["transform"](r.json(), args)}
    except httpx.HTTPStatusError as e:
        return {
            B.key_status: B.status_error,
            B.key_message: str(e),
            B.key_code: e.response.status_code,
        }
    except httpx.RequestError as e:
        return {B.key_status: B.status_error, B.key_message: str(e)}


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
    return 0 if result[B.key_status] == B.status_success else 1


if __name__ == "__main__":
    sys.exit(main())
