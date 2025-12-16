#!/usr/bin/env -S uv run --quiet --script
"""Validate n8n workflow JSON against structural constraints."""

# --- [IMPORTS] ----------------------------------------------------------------
import json
import re
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

# --- [TYPES] ------------------------------------------------------------------
type Data = dict[str, Any]
type Check = Callable[[Data], list[str]]

# --- [CONSTANTS] --------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class _B:
    uuid_pat: str = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    ai_types: tuple[str, ...] = ("ai_tool", "ai_languageModel", "ai_memory", "ai_outputParser", "ai_embedding", "ai_vectorStore", "ai_retriever", "ai_textSplitter")
    on_error: tuple[str, ...] = ("stopWorkflow", "continueRegularOutput", "continueErrorOutput")
    caller_policy: tuple[str, ...] = ("any", "none", "workflowsFromSameOwner", "workflowsFromAList")

B: Final[_B] = _B()
UUID_RE: Final[re.Pattern[str]] = re.compile(B.uuid_pat, re.IGNORECASE)

# --- [PURE_FUNCTIONS] ---------------------------------------------------------
def _is_uuid(v):
    return isinstance(v, str) and bool(UUID_RE.match(v))

def _is_pos(v):
    return isinstance(v, list) and len(v) == 2 and all(isinstance(x, (int, float)) for x in v)

# --- [DISPATCH_TABLES] --------------------------------------------------------
checks: dict[str, Check] = {
    "root_required": lambda d: [
        f"missing root.{k}" for k in ("name", "nodes", "connections") if k not in d
    ],
    "root_types": lambda d: [
        *(["root.name must be string"] if "name" in d and not isinstance(d["name"], str) else []),
        *(["root.nodes must be array"] if "nodes" in d and not isinstance(d["nodes"], list) else []),
        *(["root.connections must be object"] if "connections" in d and not isinstance(d["connections"], dict) else []),
    ],
    "node_required": lambda d: [
        f"node[{i}] missing {k}"
        for i, n in enumerate(d.get("nodes", []))
        for k in ("id", "name", "type", "position")
        if k not in n
    ],
    "node_id_uuid": lambda d: [
        f"node[{i}].id invalid UUID: {n.get('id')}"
        for i, n in enumerate(d.get("nodes", []))
        if "id" in n and not _is_uuid(n["id"])
    ],
    "node_id_unique": lambda d: (
        lambda ids: [f"duplicate node.id: {x}" for x in ids if ids.count(x) > 1][:1]
    )([n.get("id") for n in d.get("nodes", []) if "id" in n]),
    "node_name_unique": lambda d: (
        lambda names: [f"duplicate node.name: {x}" for x in names if names.count(x) > 1][:1]
    )([n.get("name") for n in d.get("nodes", []) if "name" in n]),
    "node_position": lambda d: [
        f"node[{i}].position must be [x,y]: {n.get('position')}"
        for i, n in enumerate(d.get("nodes", []))
        if "position" in n and not _is_pos(n["position"])
    ],
    "node_on_error": lambda d: [
        f"node[{i}].onError invalid: {n.get('onError')} (allowed: {B.on_error})"
        for i, n in enumerate(d.get("nodes", []))
        if "onError" in n and n["onError"] not in B.on_error
    ],
    "conn_targets_exist": lambda d: (
        lambda names: [
            f"connection target not found: {c['node']}"
            for src in d.get("connections", {}).values()
            for key in src
            for arr in src[key]
            for c in arr
            if isinstance(c, dict) and c.get("node") not in names
        ]
    )({n.get("name") for n in d.get("nodes", [])}),
    "conn_ai_type_match": lambda d: [
        f"AI connection key={key} but type={c.get('type')} (must match)"
        for src in d.get("connections", {}).values()
        for key in src
        if key in B.ai_types
        for arr in src[key]
        for c in arr
        if isinstance(c, dict) and c.get("type") != key
    ],
    "settings_caller_policy": lambda d: (
        lambda s: [f"settings.callerPolicy invalid: {s.get('callerPolicy')} (allowed: {B.caller_policy})"]
        if "callerPolicy" in s and s["callerPolicy"] not in B.caller_policy else []
    )(d.get("settings", {})),
    "settings_exec_order_ai": lambda d: (
        lambda has_ai, s: [
            "AI workflow requires settings.executionOrder='v1'"
        ] if has_ai and s.get("executionOrder") != "v1" else []
    )(
        any(n.get("type", "").startswith("@n8n/n8n-nodes-langchain") for n in d.get("nodes", [])),
        d.get("settings", {}),
    ),
}

# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    args = sys.argv[1:]

    if not args or args[0] in ("-h", "--help"):
        print(json.dumps({
            "status": "error",
            "message": "\n".join([
                "[USAGE] validate-workflow.py <workflow.json> [--strict]",
                "",
                "[CHECKS]",
                *[f"  - {k}" for k in checks],
                "",
                "[OPTIONS]",
                "  --strict  Fail on warnings (UUID format, position array)",
            ]),
        }, indent=2))
        return 1

    path = Path(args[0])
    strict = "--strict" in args

    if not path.exists():
        print(json.dumps({"status": "error", "message": f"file not found: {path}"}))
        return 1

    try:
        data = json.loads(path.read_text("utf-8"))
    except json.JSONDecodeError as e:
        print(json.dumps({"status": "error", "message": f"invalid JSON: {e}"}))
        return 1

    errors = [e for check in checks.values() for e in check(data)]
    warnings = [e for e in errors if "UUID" in e or "position" in e]
    critical = [e for e in errors if e not in warnings]

    result = {
        "status": "error" if critical or (strict and warnings) else "success",
        "file": str(path),
        "checks": len(checks),
        "errors": critical,
        "warnings": warnings,
    }

    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "success" else 1


if __name__ == "__main__":
    sys.exit(main())
