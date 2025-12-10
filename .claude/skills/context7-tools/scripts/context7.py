#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["httpx"]
# ///
"""Context7 — polymorphic HTTP client via decorator registration."""

# --- [IMPORTS] ----------------------------------------------------------------
import argparse
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


# --- [REGISTRY] ---------------------------------------------------------------
_tools: dict[str, tuple[ToolFn, ToolConfig]] = {}


def tool(**cfg: Any) -> Callable[[ToolFn], ToolFn]:
    """Register tool with HTTP config — method, path builder, transform."""

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
    """Resolve library to Context7 ID."""
    return f"/v1/search?query={quote(library)}"


@tool(transform=lambda r, a: {"library_id": a["library_id"], "docs": r})
def docs(library_id: str, tokens: int, topic: str) -> str:
    """Fetch library documentation."""
    params = (
        f"limit={tokens // B.tokens_per_result}"
        + (f"&topic={quote(topic)}" if topic else "")
        + "&type=txt"
    )
    return f"/v2/docs/code/{library_id.lstrip('/')}?{params}"


# --- [PURE_FUNCTIONS] ---------------------------------------------------------
content_parsers: dict[str, Callable[[httpx.Response], Any]] = {
    "application/json": lambda r: r.json(),
}


def parse_content(r: httpx.Response) -> Any:
    ct = r.headers.get("content-type", "").partition(";")[0]
    return content_parsers.get(ct, lambda x: x.text)(r)


# --- [DISPATCH] ---------------------------------------------------------------
def dispatch(cmd: str, args: dict[str, Any]) -> dict[str, Any]:
    """Execute registered tool via HTTP — pure dispatch, no branching."""
    fn, cfg = _tools[cmd]
    sig = fn.__code__.co_varnames[: fn.__code__.co_argcount]
    path = fn(**{k: args[k] for k in sig if k in args})
    headers = {
        "Content-Type": "application/json",
        **({} if not (k := os.environ.get(B.key_env, "")) else {"X-API-Key": k}),
    }
    try:
        with httpx.Client(timeout=B.timeout) as c:
            r = c.request(cfg["method"], f"{B.base_url}{path}", headers=headers)
            r.raise_for_status()
            return {"status": "success", **cfg["transform"](parse_content(r), args)}
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
            ("--library", {"default": ""}),
            ("--library-id", {"default": ""}),
            ("--tokens", {"type": int, "default": B.tokens}),
            ("--topic", {"default": ""}),
        ]
    ]
    args = vars(p.parse_args())
    result = dispatch(args.pop("command"), args)
    print(json.dumps(result))
    return 0 if result["status"] == "success" else 1


if __name__ == "__main__":
    sys.exit(main())
