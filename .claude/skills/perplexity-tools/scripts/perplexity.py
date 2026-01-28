#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["httpx"]
# ///
"""Perplexity AI CLI — web research via REST API.

Commands:
    ask <query>                   Quick question with citations (sonar)
    research <query> [strip]      Deep research (sonar-deep-research, strip=strip thinking)
    reason <query> [strip]        Reasoning task (sonar-reasoning-pro, strip=strip thinking)
    search <query> [max] [country] Web search returning citations (default: 10)
"""
from __future__ import annotations

import json
import os
import re
import sys
from collections.abc import Callable
from typing import Final

import httpx

# --- [CONSTANTS] --------------------------------------------------------------
BASE: Final = "https://api.perplexity.ai"
KEY_ENV: Final = "PERPLEXITY_API_KEY"
TIMEOUT: Final = 240
TIMEOUT_DEEP: Final = 600
MAX_RESULTS: Final = 10

MODEL_ASK: Final = "sonar"
MODEL_RESEARCH: Final = "sonar-deep-research"
MODEL_REASON: Final = "sonar-reasoning-pro"

# --- [DISPATCH] ---------------------------------------------------------------
CMDS: Final[dict[str, tuple[Callable[..., dict], int, str, int]]] = {}


def cmd(argc: int, model: str, timeout: int = TIMEOUT) -> Callable[[Callable[..., dict]], Callable[..., dict]]:
    """Register command with required arg count, model, and timeout."""
    def register(fn: Callable[..., dict]) -> Callable[..., dict]:
        CMDS[fn.__name__] = (fn, argc, model, timeout)
        return fn
    return register


# --- [HTTP] -------------------------------------------------------------------
def _post(model: str, messages: list[dict], timeout: int) -> dict:
    """POST to chat completions endpoint."""
    headers = {"Authorization": f"Bearer {os.environ.get(KEY_ENV, '')}", "Content-Type": "application/json"}
    body = {"model": model, "messages": messages}
    with httpx.Client(timeout=timeout) as c:
        r = c.post(f"{BASE}/chat/completions", headers=headers, json=body)
        r.raise_for_status()
        return r.json()


def _content(r: dict) -> str:
    """Extract content from response."""
    return r["choices"][0]["message"]["content"]


def _citations(r: dict) -> list:
    """Extract citations from response."""
    return r.get("citations", [])


def _strip_think(content: str, should_strip: bool) -> str:
    """Remove <think> tags when requested."""
    return re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip() if should_strip else content


# --- [COMMANDS] ---------------------------------------------------------------
@cmd(1, MODEL_ASK)
def ask(query: str) -> dict:
    """Quick question with citations."""
    r = _post(MODEL_ASK, [{"role": "user", "content": query}], TIMEOUT)
    return {"status": "success", "query": query, "response": _content(r), "citations": _citations(r)}


@cmd(1, MODEL_RESEARCH, TIMEOUT_DEEP)
def research(query: str, strip: str = "") -> dict:
    """Deep research with optional thinking removal."""
    r = _post(MODEL_RESEARCH, [{"role": "user", "content": query}], TIMEOUT_DEEP)
    return {"status": "success", "query": query, "response": _strip_think(_content(r), strip == "strip"), "citations": _citations(r)}


@cmd(1, MODEL_REASON, TIMEOUT_DEEP)
def reason(query: str, strip: str = "") -> dict:
    """Reasoning task with optional thinking removal."""
    r = _post(MODEL_REASON, [{"role": "user", "content": query}], TIMEOUT_DEEP)
    return {"status": "success", "query": query, "response": _strip_think(_content(r), strip == "strip")}


@cmd(1, MODEL_ASK)
def search(query: str, max_: str = "10", country: str = "") -> dict:
    """Web search returning citations."""
    prompt = f"Search: {query}" + (f" (focus: {country})" if country else "")
    r = _post(MODEL_ASK, [{"role": "user", "content": prompt}], TIMEOUT)
    return {"status": "success", "query": query, "results": _citations(r)[:int(max_)]}


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """Dispatch command and print JSON output."""
    match sys.argv[1:]:
        case [cmd_name, *cmd_args] if (entry := CMDS.get(cmd_name)):
            fn, argc, _, _ = entry
            if len(cmd_args) < argc:
                print(f"Usage: perplexity.py {cmd_name} {' '.join(f'<arg{i+1}>' for i in range(argc))}")
                return 1
            try:
                result = fn(*cmd_args[:argc + 2])  # required + up to 2 optional
                print(json.dumps(result, indent=2))
                return 0 if result["status"] == "success" else 1
            except httpx.HTTPStatusError as e:
                print(json.dumps({"status": "error", "code": e.response.status_code, "message": e.response.text[:200]}))
                return 1
            except httpx.RequestError as e:
                print(json.dumps({"status": "error", "message": str(e)}))
                return 1
        case [cmd_name, *_]:
            print(f"[ERROR] Unknown command '{cmd_name}'\n")
            print(__doc__)
            return 1
        case _:
            print(__doc__)
            return 1


if __name__ == "__main__":
    sys.exit(main())
