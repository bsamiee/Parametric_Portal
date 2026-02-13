"""Command implementations for SonarCloud CLI."""
from collections import Counter
from typing import Any, Final

BASE_URL: Final = "https://sonarcloud.io/api"
ORG: Final = "bsamiee"
PROJECT: Final = "bsamiee_Parametric_Portal"
DEFAULT_METRICS: Final = "ncloc,coverage,bugs,vulnerabilities,code_smells,duplicated_lines_density,security_hotspots,reliability_rating,security_rating,sqale_rating"
DEFAULT_STATUSES: Final = "OPEN,CONFIRMED,REOPENED"

# --- [FUNCTIONS] --------------------------------------------------------------
def _parse_conditions(conditions: list[dict]) -> list[dict]:
    """Transform quality gate conditions into normalized format."""
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
    """Group issues by severity and type via Counter (no mutable accumulators)."""
    return {
        "by_severity": dict(Counter(issue.get("severity", "UNKNOWN") for issue in issues)),
        "by_type": dict(Counter(issue.get("type", "UNKNOWN") for issue in issues)),
    }


# --- [COMMANDS] ---------------------------------------------------------------
def quality_gate(arg1: str, arg2: str, get_fn) -> dict:
    """Quality gate status.

    Args:
        arg1: Branch name or 'pr' for pull request mode.
        arg2: Pull request number when arg1 is 'pr'.
        get_fn: HTTP GET function with signature (path, params) -> (ok, data).

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
    ok, data = get_fn("/qualitygates/project_status", params)
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


def issues(severities: str, types: str, get_fn) -> dict:
    """Search issues by severity and type.

    Args:
        severities: Comma-separated severity filter.
        types: Comma-separated type filter.
        get_fn: HTTP GET function.

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
    ok, data = get_fn("/issues/search", params)
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


def measures(metrics: str, get_fn) -> dict:
    """Project metrics.

    Args:
        metrics: Comma-separated metric keys (default: all).
        get_fn: HTTP GET function.

    Returns:
        Metrics result dict.
    """
    params = {
        "component": PROJECT,
        "organization": ORG,
        "metricKeys": metrics or DEFAULT_METRICS,
    }
    ok, data = get_fn("/measures/component", params)
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


def analyses(page_size: str, get_fn) -> dict:
    """Analysis history.

    Args:
        page_size: Number of results per page (default: 10).
        get_fn: HTTP GET function.

    Returns:
        Analysis history dict.
    """
    size = int(page_size) if page_size else 10
    params = {"project": PROJECT, "organization": ORG, "ps": min(size, 100)}
    ok, data = get_fn("/project_analyses/search", params)
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


def projects(page_size: str, get_fn) -> dict:
    """List organization projects.

    Args:
        page_size: Number of results per page (default: 100).
        get_fn: HTTP GET function.

    Returns:
        Projects result dict.
    """
    size = int(page_size) if page_size else 100
    params = {"organization": ORG, "ps": min(size, 500)}
    ok, data = get_fn("/projects/search", params)
    if not ok:
        return {"status": "error", "message": data.get("error", str(data))}
    return {
        "status": "success",
        "organization": ORG,
        "total": data["paging"]["total"],
        "projects": [{"key": project["key"], "name": project["name"]} for project in data["components"]],
    }


def hotspots(status: str, get_fn) -> dict:
    """Security hotspots.

    Args:
        status: Filter by status (TO_REVIEW|ACKNOWLEDGED|FIXED|SAFE).
        get_fn: HTTP GET function.

    Returns:
        Hotspots result dict.
    """
    params: dict[str, Any] = {
        "projectKey": PROJECT,
        "organization": ORG,
        "ps": 100,
        **({"status": status} if status else {}),
    }
    ok, data = get_fn("/hotspots/search", params)
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
