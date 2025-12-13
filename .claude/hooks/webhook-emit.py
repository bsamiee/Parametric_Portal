#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["httpx"]
# ///
"""PostToolUse hook: Emit tool events to n8n webhook."""

# --- [IMPORTS] ----------------------------------------------------------------
from __future__ import annotations

import json
import os
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Final

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
def _debug(msg):
    return DEBUG and print(f"[webhook-emit] {msg}", file=sys.stderr)


def _parse_input():
    return json.loads(sys.stdin.read() or "{}")


def _extract_success(resp):
    return resp.get("success", True) if isinstance(resp, dict) else True


def _build_headers():
    return (
        {"Content-Type": "application/json", "X-Auth-Token": B.auth_token}
        if B.auth_token
        else {"Content-Type": "application/json"}
    )


def _build_event(data: HookData) -> ToolEvent:
    """Transform hook input to structured event."""
    tool_input = data.get("tool_input")
    return ToolEvent(
        timestamp=datetime.now(timezone.utc).isoformat(),
        session_id=str(data.get("session_id", "unknown")),
        tool_name=str(data.get("tool_name", "unknown")),
        tool_input=tool_input if isinstance(tool_input, dict) else {},
        success=_extract_success(data.get("tool_response", {})),
        project=B.project,
    )


def _emit(event: ToolEvent, url: str) -> None:
    """Fire-and-forget POST to n8n webhook."""
    _ = _debug(f"Emitting to {url}: {event.tool_name}")
    _ = httpx.post(url, json=asdict(event), headers=_build_headers(), timeout=B.timeout)


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> None:
    match (B.webhook_url, _parse_input()):
        case (None, _):
            _ = _debug("Webhook URL not configured, exiting")
        case (_, {}):
            _ = _debug("No input data")
        case (url, data) if url:
            _ = _emit(_build_event(data), url)
    sys.exit(0)


if __name__ == "__main__":
    main()
