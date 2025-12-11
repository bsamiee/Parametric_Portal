#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["httpx"]
# ///
"""Exa AI — polymorphic HTTP client via decorator registration."""

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
    key_query: str = "query"
    key_results: str = "results"
    key_context: str = "context"
    key_status: str = "status"
    key_message: str = "message"
    key_code: str = "code"
    status_success: str = "success"
    status_error: str = "error"
    search_type_auto: str = "auto"
    search_type_neural: str = "neural"
    search_type_keyword: str = "keyword"
    category_github: str = "github"

    @property
    def search_types(self) -> list[str]:
        return [
            self.search_type_auto,
            self.search_type_neural,
            self.search_type_keyword,
        ]


B: Final[_B] = _B()


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


# --- [PURE_FUNCTIONS] ---------------------------------------------------------
def _make_tool_body(
    query: str, num_results: int, type: str, category: str | None = None
) -> dict[str, Any]:
    """Build request body with optional category."""
    base = {
        B.key_query: query,
        "numResults": num_results,
        "type": type,
        "contents": {"text": True},
    }
    return {**base, "category": category} if category else base


def _make_request(
    cfg: ToolConfig, headers: dict[str, str], body: dict[str, Any], args: dict[str, Any]
) -> dict[str, Any]:
    """Execute HTTP request with error handling."""
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


# --- [TOOLS] ------------------------------------------------------------------
@tool(
    transform=lambda r, a: {
        B.key_query: a[B.key_query],
        B.key_results: r.get(B.key_results, []),
    }
)
def search(query: str, num_results: int, type: str) -> dict:
    """Web search with text content retrieval."""
    return _make_tool_body(query, num_results, type)


@tool(
    transform=lambda r, a: {
        B.key_query: a[B.key_query],
        B.key_context: r.get(B.key_results, []),
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
    body = fn(**{k: args[k] for k in sig if k in args})
    headers = {
        B.key_header: os.environ.get(B.key_env, ""),
        "Content-Type": B.content_type,
    }
    return _make_request(cfg, headers, body, args)


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    [
        p.add_argument(a, **o)
        for a, o in [
            ("command", {"choices": _tools.keys()}),
            ("--query", {"required": True}),
            ("--num-results", {"type": int, "default": B.num_results}),
            ("--type", {"choices": B.search_types, "default": B.search_type_auto}),
        ]
    ]
    args = vars(p.parse_args())
    result = dispatch(args.pop("command"), args)
    print(json.dumps(result))
    return 0 if result[B.key_status] == B.status_success else 1


if __name__ == "__main__":
    sys.exit(main())
