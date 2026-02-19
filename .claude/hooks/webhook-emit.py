#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["httpx"]
# ///
"""PostToolUse hook: Emit tool events to n8n webhook."""

# --- [IMPORTS] ----------------------------------------------------------------
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, UTC
import json
import os
import sys
from typing import cast, Final

import httpx


# --- [TYPES] ------------------------------------------------------------------
type ToolInput = dict[str, object]
type HookData = dict[str, object]


@dataclass(frozen=True, slots=True)
class ToolEvent:
    """Structured tool execution event for n8n."""

    timestamp: str
    session_id: str
    tool_name: str
    tool_input: ToolInput
    success: bool
    project: str


# --- [CONSTANTS] --------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class _B:
    """Immutable configuration constants."""

    webhook_url: str | None
    auth_token: str | None
    timeout: float = 2.0
    project: str = "Parametric_Portal"


B: Final[_B] = _B(
    webhook_url=os.environ.get("N8N_WEBHOOK_URL"),
    auth_token=os.environ.get("N8N_AUTH_TOKEN"),
)
DEBUG: Final[bool] = os.environ.get("CLAUDE_HOOK_DEBUG", "").lower() in ("1", "true")


# --- [PURE_FUNCTIONS] ---------------------------------------------------------
def _debug(msg: str) -> bool:
    if not DEBUG:
        return False
    print(f"[webhook-emit] {msg}", file=sys.stderr)
    return True


def _parse_input() -> HookData:
    payload = (sys.stdin.read() or "").strip()
    if payload == "":
        return {}
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError as exc:
        _debug(f"Malformed JSON from stdin: {exc}")
        return {}
    return cast("HookData", parsed) if isinstance(parsed, dict) else {}


def _extract_success(resp: object) -> bool:
    if not isinstance(resp, dict):
        return True
    return bool(resp.get("success", True))


def _build_headers() -> dict[str, str]:
    return (
        {"Content-Type": "application/json", "X-Auth-Token": B.auth_token}
        if B.auth_token
        else {"Content-Type": "application/json"}
    )


def _build_event(data: HookData) -> ToolEvent:
    """Transform hook input to structured event."""
    tool_input = data.get("tool_input")
    parsed_tool_input = {str(key): value for key, value in tool_input.items()} if isinstance(tool_input, dict) else {}
    return ToolEvent(
        timestamp=datetime.now(UTC).isoformat(),
        session_id=str(data.get("session_id", "unknown")),
        tool_name=str(data.get("tool_name", "unknown")),
        tool_input=parsed_tool_input,
        success=_extract_success(data.get("tool_response", {})),
        project=B.project,
    )


def _emit(event: ToolEvent, url: str) -> None:
    """Fire-and-forget POST to n8n webhook."""
    _debug(f"Emitting to {url}: {event.tool_name}")
    try:
        httpx.post(url, json=asdict(event), headers=_build_headers(), timeout=B.timeout)
    except httpx.HTTPError as exc:
        _debug(f"Webhook failed for {event.tool_name} at {url}: {exc}")


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> None:
    match (B.webhook_url, _parse_input()):
        case (None, _):
            _debug("Webhook URL not configured, exiting")
        case (_, {}):
            _debug("No input data")
        case (url, data) if url:
            _emit(_build_event(data), url)
        case _:
            _debug("Unhandled hook payload shape")
    sys.exit(0)


if __name__ == "__main__":
    main()
