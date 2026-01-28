#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["httpx"]
# ///
"""SonarCloud API CLI — code quality metrics via REST API.

Commands:
    quality-gate [branch]           Quality gate status (or: quality-gate pr <num>)
    issues [severities] [types]     Search issues (e.g., BLOCKER,CRITICAL BUG)
    measures [metrics]              Project metrics (e.g., coverage,bugs)
    analyses [page_size]            Analysis history (default: 10)
    projects [page_size]            List organization projects (default: 100)
    hotspots [status]               Security hotspots (e.g., TO_REVIEW)
"""
from __future__ import annotations

import json
import os
import sys
from collections.abc import Callable
from typing import Any, Final

import httpx

# --- [CONSTANTS] --------------------------------------------------------------
BASE_URL: Final = "https://sonarcloud.io/api"
KEY_ENV: Final = "SONAR_TOKEN"
TIMEOUT: Final = 30
ORG: Final = "bsamiee"
PROJECT: Final = "bsamiee_Parametric_Portal"
DEFAULT_METRICS: Final = "ncloc,coverage,bugs,vulnerabilities,code_smells,duplicated_lines_density,security_hotspots,reliability_rating,security_rating,sqale_rating"
DEFAULT_STATUSES: Final = "OPEN,CONFIRMED,REOPENED"

# --- [DISPATCH] ---------------------------------------------------------------
CMDS: Final[dict[str, tuple[Callable[..., dict], int]]] = {}


def cmd(argc: int) -> Callable[[Callable[..., dict]], Callable[..., dict]]:
    """Register command with required argument count."""
    def register(fn: Callable[..., dict]) -> Callable[..., dict]:
        CMDS[fn.__name__.replace("_", "-")] = (fn, argc)
        return fn
    return register


# --- [HTTP] -------------------------------------------------------------------
def _get(path: str, params: dict[str, Any]) -> tuple[bool, dict]:
    """GET request with auth, return (success, data)."""
    token = os.environ.get(KEY_ENV, "")
    if not token:
        return False, {"error": f"Missing {KEY_ENV} environment variable"}
    headers = {"Authorization": f"Bearer {token}"}
    with httpx.Client(timeout=TIMEOUT) as c:
        r = c.get(f"{BASE_URL}{path}", headers=headers, params=params)
        r.raise_for_status()
        return True, r.json()


# --- [HELPERS] ----------------------------------------------------------------
def _parse_conditions(conditions: list[dict]) -> list[dict]:
    """Transform quality gate conditions."""
    return [
        {
            "metric": c.get("metricKey", ""),
            "status": c.get("status", ""),
            "actual": c.get("actualValue", ""),
            "threshold": c.get("errorThreshold", c.get("warningThreshold", "")),
        }
        for c in conditions
    ]


def _summarize_issues(issues: list[dict]) -> dict[str, dict[str, int]]:
    """Group issues by severity and type."""
    by_severity: dict[str, int] = {}
    by_type: dict[str, int] = {}
    for issue in issues:
        sev = issue.get("severity", "UNKNOWN")
        typ = issue.get("type", "UNKNOWN")
        by_severity[sev] = by_severity.get(sev, 0) + 1
        by_type[typ] = by_type.get(typ, 0) + 1
    return {"by_severity": by_severity, "by_type": by_type}


# --- [COMMANDS] ---------------------------------------------------------------
@cmd(0)
def quality_gate(arg1: str = "", arg2: str = "") -> dict:
    """Quality gate status. Args: [branch] or pr <num>."""
    params: dict[str, Any] = {"projectKey": PROJECT, "organization": ORG}
    if arg1 == "pr" and arg2:
        params["pullRequest"] = arg2
    elif arg1:
        params["branch"] = arg1
    ok, data = _get("/qualitygates/project_status", params)
    if not ok:
        return {"status": "error", "message": data.get("error", str(data))}
    ps = data["projectStatus"]
    return {
        "status": "success",
        "project": PROJECT,
        "gate_status": ps["status"],
        "passed": ps["status"] == "OK",
        "conditions": _parse_conditions(ps.get("conditions", [])),
    }


@cmd(0)
def issues(severities: str = "", types: str = "") -> dict:
    """Search issues. Args: [severities] [types] (comma-separated)."""
    params: dict[str, Any] = {
        "componentKeys": PROJECT,
        "organization": ORG,
        "statuses": DEFAULT_STATUSES,
        "ps": 100,
    }
    if severities:
        params["severities"] = severities
    if types:
        params["types"] = types
    ok, data = _get("/issues/search", params)
    if not ok:
        return {"status": "error", "message": data.get("error", str(data))}
    issues_list = [
        {
            "key": i["key"],
            "rule": i["rule"],
            "severity": i["severity"],
            "type": i["type"],
            "message": i["message"],
            "component": i["component"].split(":")[-1],
            "line": i.get("line"),
        }
        for i in data["issues"]
    ]
    return {
        "status": "success",
        "project": PROJECT,
        "total": data["paging"]["total"],
        "issues": issues_list,
        "summary": _summarize_issues(data["issues"]),
    }


@cmd(0)
def measures(metrics: str = "") -> dict:
    """Project metrics. Args: [metrics] (comma-separated, default: all)."""
    params = {
        "component": PROJECT,
        "organization": ORG,
        "metricKeys": metrics or DEFAULT_METRICS,
    }
    ok, data = _get("/measures/component", params)
    if not ok:
        return {"status": "error", "message": data.get("error", str(data))}
    return {
        "status": "success",
        "project": data["component"]["key"],
        "name": data["component"]["name"],
        "metrics": {
            m["metric"]: m.get("value", m.get("period", {}).get("value", "N/A"))
            for m in data["component"]["measures"]
        },
    }


@cmd(0)
def analyses(page_size: str = "") -> dict:
    """Analysis history. Args: [page_size] (default: 10)."""
    ps = int(page_size) if page_size else 10
    params = {"project": PROJECT, "organization": ORG, "ps": min(ps, 100)}
    ok, data = _get("/project_analyses/search", params)
    if not ok:
        return {"status": "error", "message": data.get("error", str(data))}
    return {
        "status": "success",
        "project": PROJECT,
        "total": data["paging"]["total"],
        "analyses": [
            {
                "key": a["key"],
                "date": a["date"],
                "events": [{"category": e["category"], "name": e.get("name", "")} for e in a.get("events", [])],
            }
            for a in data["analyses"]
        ],
    }


@cmd(0)
def projects(page_size: str = "") -> dict:
    """List organization projects. Args: [page_size] (default: 100)."""
    ps = int(page_size) if page_size else 100
    params = {"organization": ORG, "ps": min(ps, 500)}
    ok, data = _get("/projects/search", params)
    if not ok:
        return {"status": "error", "message": data.get("error", str(data))}
    return {
        "status": "success",
        "organization": ORG,
        "total": data["paging"]["total"],
        "projects": [{"key": p["key"], "name": p["name"]} for p in data["components"]],
    }


@cmd(0)
def hotspots(status: str = "") -> dict:
    """Security hotspots. Args: [status] (TO_REVIEW|ACKNOWLEDGED|FIXED|SAFE)."""
    params: dict[str, Any] = {"projectKey": PROJECT, "organization": ORG, "ps": 100}
    if status:
        params["status"] = status
    ok, data = _get("/hotspots/search", params)
    if not ok:
        return {"status": "error", "message": data.get("error", str(data))}
    return {
        "status": "success",
        "project": PROJECT,
        "total": data["paging"]["total"],
        "hotspots": [
            {
                "key": h["key"],
                "message": h["message"],
                "status": h["status"],
                "probability": h["vulnerabilityProbability"],
                "component": h["component"].split(":")[-1],
                "line": h.get("line"),
            }
            for h in data["hotspots"]
        ],
    }


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """Dispatch command and print JSON output."""
    match sys.argv[1:]:
        case [cmd_name, *cmd_args] if (entry := CMDS.get(cmd_name)):
            fn, argc = entry
            if len(cmd_args) < argc:
                print(f"Usage: sonarcloud.py {cmd_name} {' '.join(f'<arg{i+1}>' for i in range(argc))}")
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
            except ValueError as e:
                print(json.dumps({"status": "error", "message": f"Invalid argument: {e}"}))
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
