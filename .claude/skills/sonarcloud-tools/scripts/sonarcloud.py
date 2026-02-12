#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.14"
# dependencies = ["httpx"]
# ///
"""SonarCloud API CLI -- code quality metrics via REST API.

Commands:
    quality-gate [branch]           Quality gate status (or: quality-gate pr <num>)
    issues [severities] [types]     Search issues (e.g., BLOCKER,CRITICAL BUG)
    measures [metrics]              Project metrics (e.g., coverage,bugs)
    analyses [page_size]            Analysis history (default: 10)
    projects [page_size]            List organization projects (default: 100)
    hotspots [status]               Security hotspots (e.g., TO_REVIEW)
"""

import json
import os
import sys
from collections import Counter
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
    """Register command with required argument count.

    Args:
        argc: Minimum number of required positional arguments.

    Returns:
        Decorator that registers the function into CMDS.
    """
    def register(fn: Callable[..., dict]) -> Callable[..., dict]:
        """Store function in registry under its hyphenated name."""
        CMDS[fn.__name__.replace("_", "-")] = (fn, argc)
        return fn
    return register


# --- [FUNCTIONS] --------------------------------------------------------------
def _get(path: str, params: dict[str, Any]) -> tuple[bool, dict]:
    """GET request with bearer auth.

    Args:
        path: API endpoint path.
        params: Query parameters.

    Returns:
        Tuple of (success, response_data).
    """
    match os.environ.get(KEY_ENV, ""):
        case "":
            return False, {"error": f"Missing {KEY_ENV} environment variable"}
        case token:
            pass
    headers = {"Authorization": f"Bearer {token}"}
    with httpx.Client(timeout=TIMEOUT) as client:
        response = client.get(f"{BASE_URL}{path}", headers=headers, params=params)
        response.raise_for_status()
        return True, response.json()


def _parse_conditions(conditions: list[dict]) -> list[dict]:
    """Transform quality gate conditions into normalized format.

    Args:
        conditions: Raw condition dicts from API.

    Returns:
        List of normalized condition dicts.
    """
    return [
        {
            "metric": condition.get("metricKey", ""),
            "status": condition.get("status", ""),
            "actual": condition.get("actualValue", ""),
            "threshold": condition.get("errorThreshold", condition.get("warningThreshold", "")),
        }
        for condition in conditions
    ]


def _summarize_issues(issues: list[dict]) -> dict[str, dict[str, int]]:
    """Group issues by severity and type via Counter (no mutable accumulators).

    Args:
        issues: List of issue dicts from API.

    Returns:
        Summary with by_severity and by_type counts.
    """
    return {
        "by_severity": dict(Counter(issue.get("severity", "UNKNOWN") for issue in issues)),
        "by_type": dict(Counter(issue.get("type", "UNKNOWN") for issue in issues)),
    }


# --- [COMMANDS] ---------------------------------------------------------------
@cmd(0)
def quality_gate(arg1: str = "", arg2: str = "") -> dict:
    """Quality gate status.

    Args:
        arg1: Branch name or 'pr' for pull request mode.
        arg2: Pull request number when arg1 is 'pr'.

    Returns:
        Quality gate result dict.
    """
    params: dict[str, Any] = {"projectKey": PROJECT, "organization": ORG}
    match (arg1, arg2):
        case ("pr", number) if number:
            params["pullRequest"] = number
        case (branch, _) if branch:
            params["branch"] = branch
        case _:
            pass
    ok, data = _get("/qualitygates/project_status", params)
    if not ok:
        return {"status": "error", "message": data.get("error", str(data))}
    project_status = data["projectStatus"]
    return {
        "status": "success",
        "project": PROJECT,
        "gate_status": project_status["status"],
        "passed": project_status["status"] == "OK",
        "conditions": _parse_conditions(project_status.get("conditions", [])),
    }


@cmd(0)
def issues(severities: str = "", types: str = "") -> dict:
    """Search issues by severity and type.

    Args:
        severities: Comma-separated severity filter.
        types: Comma-separated type filter.

    Returns:
        Issues result dict with summary.
    """
    params: dict[str, Any] = {
        "componentKeys": PROJECT,
        "organization": ORG,
        "statuses": DEFAULT_STATUSES,
        "ps": 100,
        **({"severities": severities} if severities else {}),
        **({"types": types} if types else {}),
    }
    ok, data = _get("/issues/search", params)
    if not ok:
        return {"status": "error", "message": data.get("error", str(data))}
    issues_list = [
        {
            "key": issue["key"],
            "rule": issue["rule"],
            "severity": issue["severity"],
            "type": issue["type"],
            "message": issue["message"],
            "component": issue["component"].split(":")[-1],
            "line": issue.get("line"),
        }
        for issue in data["issues"]
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
    """Project metrics.

    Args:
        metrics: Comma-separated metric keys (default: all).

    Returns:
        Metrics result dict.
    """
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
            measure["metric"]: measure.get("value", measure.get("period", {}).get("value", "N/A"))
            for measure in data["component"]["measures"]
        },
    }


@cmd(0)
def analyses(page_size: str = "") -> dict:
    """Analysis history.

    Args:
        page_size: Number of results per page (default: 10).

    Returns:
        Analysis history dict.
    """
    size = int(page_size) if page_size else 10
    params = {"project": PROJECT, "organization": ORG, "ps": min(size, 100)}
    ok, data = _get("/project_analyses/search", params)
    if not ok:
        return {"status": "error", "message": data.get("error", str(data))}
    return {
        "status": "success",
        "project": PROJECT,
        "total": data["paging"]["total"],
        "analyses": [
            {
                "key": analysis["key"],
                "date": analysis["date"],
                "events": [{"category": event["category"], "name": event.get("name", "")} for event in analysis.get("events", [])],
            }
            for analysis in data["analyses"]
        ],
    }


@cmd(0)
def projects(page_size: str = "") -> dict:
    """List organization projects.

    Args:
        page_size: Number of results per page (default: 100).

    Returns:
        Projects result dict.
    """
    size = int(page_size) if page_size else 100
    params = {"organization": ORG, "ps": min(size, 500)}
    ok, data = _get("/projects/search", params)
    if not ok:
        return {"status": "error", "message": data.get("error", str(data))}
    return {
        "status": "success",
        "organization": ORG,
        "total": data["paging"]["total"],
        "projects": [{"key": project["key"], "name": project["name"]} for project in data["components"]],
    }


@cmd(0)
def hotspots(status: str = "") -> dict:
    """Security hotspots.

    Args:
        status: Filter by status (TO_REVIEW|ACKNOWLEDGED|FIXED|SAFE).

    Returns:
        Hotspots result dict.
    """
    params: dict[str, Any] = {
        "projectKey": PROJECT,
        "organization": ORG,
        "ps": 100,
        **({"status": status} if status else {}),
    }
    ok, data = _get("/hotspots/search", params)
    if not ok:
        return {"status": "error", "message": data.get("error", str(data))}
    return {
        "status": "success",
        "project": PROJECT,
        "total": data["paging"]["total"],
        "hotspots": [
            {
                "key": hotspot["key"],
                "message": hotspot["message"],
                "status": hotspot["status"],
                "probability": hotspot["vulnerabilityProbability"],
                "component": hotspot["component"].split(":")[-1],
                "line": hotspot.get("line"),
            }
            for hotspot in data["hotspots"]
        ],
    }


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """Dispatch command and print JSON output.

    Returns:
        Exit code: 0 for success, 1 for failure.
    """
    match sys.argv[1:]:
        case [cmd_name, *cmd_args] if (entry := CMDS.get(cmd_name)):
            fn, argc = entry
            if len(cmd_args) < argc:
                sys.stdout.write(f"Usage: sonarcloud.py {cmd_name} {' '.join(f'<arg{index + 1}>' for index in range(argc))}\n")
                return 1
            try:
                result = fn(*cmd_args[:argc + 2])
                sys.stdout.write(json.dumps(result, indent=2) + "\n")
                return 0 if result["status"] == "success" else 1
            except httpx.HTTPStatusError as error:
                sys.stdout.write(json.dumps({"status": "error", "code": error.response.status_code, "message": error.response.text[:200]}) + "\n")
                return 1
            except httpx.RequestError as error:
                sys.stdout.write(json.dumps({"status": "error", "message": str(error)}) + "\n")
                return 1
            except ValueError as error:
                sys.stdout.write(json.dumps({"status": "error", "message": f"Invalid argument: {error}"}) + "\n")
                return 1
        case [cmd_name, *_]:
            sys.stdout.write(f"[ERROR] Unknown command '{cmd_name}'\n\n")
            sys.stdout.write(__doc__ + "\n")
            return 1
        case _:
            sys.stdout.write(__doc__ + "\n")
            return 1


if __name__ == "__main__":
    sys.exit(main())
