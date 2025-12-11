#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["httpx"]
# ///
"""SonarCloud API — polymorphic HTTP client via decorator registration."""

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
    base_url: str = "https://sonarcloud.io/api"
    key_env: str = "SONAR_TOKEN"
    timeout: int = 30
    page_size: int = 100
    max_results: int = 500
    organization: str = "bsamiee"
    project: str = "bsamiee_Parametric_Portal"
    default_page_size_analyses: int = 10
    max_page_size_analyses: int = 100
    error_truncate_len: int = 500
    default_metrics: str = "ncloc,coverage,bugs,vulnerabilities,code_smells,duplicated_lines_density,security_hotspots,reliability_rating,security_rating,sqale_rating"
    default_statuses: str = "OPEN,CONFIRMED,REOPENED"


B: Final[_B] = _B()


# --- [PURE_FUNCTIONS] ---------------------------------------------------------
def _parse_conditions(conditions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Parse quality gate conditions into readable format."""
    return [
        {
            "metric": c.get("metricKey", ""),
            "status": c.get("status", ""),
            "actual": c.get("actualValue", ""),
            "threshold": c.get("errorThreshold", c.get("warningThreshold", "")),
            "comparator": c.get("comparator", ""),
        }
        for c in conditions
    ]


def _summarize_issues(issues: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    """Summarize issues by severity and type."""
    by_severity: dict[str, int] = {}
    by_type: dict[str, int] = {}
    for issue in issues:
        sev = issue.get("severity", "UNKNOWN")
        typ = issue.get("type", "UNKNOWN")
        by_severity[sev] = by_severity.get(sev, 0) + 1
        by_type[typ] = by_type.get(typ, 0) + 1
    return {"by_severity": by_severity, "by_type": by_type}


def _build_params(base: dict[str, Any], conditionals: dict[str, Any]) -> dict[str, Any]:
    """Build params dict by merging base with non-empty conditionals."""
    return base | {k: v for k, v in conditionals.items() if v}


def _pagination(
    page: int | None, page_size: int | None, default_size: int, max_size: int
) -> dict[str, int]:
    """Build pagination params with defaults and limits."""
    return {
        "ps": min(page_size or default_size, max_size),
        "p": page or 1,
    }


# --- [REGISTRY] ---------------------------------------------------------------
_tools: dict[str, tuple[ToolFn, ToolConfig]] = {}


def tool(**cfg: Any) -> Callable[[ToolFn], ToolFn]:
    """Register tool with HTTP config — method, path, transform."""

    def register(fn: ToolFn) -> ToolFn:
        _tools[fn.__name__.replace("_", "-")] = (fn, {"method": "GET", **cfg})
        return fn

    return register


# --- [TOOLS] ------------------------------------------------------------------
@tool(
    path="/qualitygates/project_status",
    transform=lambda r, a: {
        "project": a["project"],
        "status": r["projectStatus"]["status"],
        "passed": r["projectStatus"]["status"] == "OK",
        "conditions": _parse_conditions(r["projectStatus"].get("conditions", [])),
        "ignored_conditions": r["projectStatus"].get("ignoredConditions", False),
    },
)
def quality_gate(
    project: str, organization: str, branch: str, pull_request: str
) -> dict:
    """Get quality gate status for project."""
    base = {
        "projectKey": project or B.project,
        "organization": organization or B.organization,
    }
    conditionals = {
        "branch": branch,
        "pullRequest": pull_request,
    }
    return _build_params(base, conditionals)


@tool(
    path="/issues/search",
    transform=lambda r, a: {
        "project": a["project"],
        "total": r["paging"]["total"],
        "page": r["paging"]["pageIndex"],
        "issues": [
            {
                "key": i["key"],
                "rule": i["rule"],
                "severity": i["severity"],
                "type": i["type"],
                "status": i["status"],
                "message": i["message"],
                "component": i["component"].split(":")[-1],
                "line": i.get("line"),
                "effort": i.get("effort", ""),
            }
            for i in r["issues"]
        ],
        "summary": _summarize_issues(r["issues"]),
    },
)
def issues(
    project: str,
    organization: str,
    severities: str,
    types: str,
    statuses: str,
    page: int,
    page_size: int,
) -> dict:
    """Search issues by severity, type, and status."""
    base = {
        "componentKeys": project or B.project,
        "organization": organization or B.organization,
        **_pagination(page, page_size, B.page_size, B.max_results),
    }
    conditionals = {
        "severities": severities,
        "types": types,
        "statuses": statuses or B.default_statuses,
    }
    return _build_params(base, conditionals)


@tool(
    path="/measures/component",
    transform=lambda r, a: {
        "project": r["component"]["key"],
        "name": r["component"]["name"],
        "metrics": {
            m["metric"]: m.get("value", m.get("period", {}).get("value", "N/A"))
            for m in r["component"]["measures"]
        },
    },
)
def measures(project: str, organization: str, metrics: str) -> dict:
    """Get project metrics (coverage, ncloc, bugs, etc.)."""
    return {
        "component": project or B.project,
        "organization": organization or B.organization,
        "metricKeys": metrics or B.default_metrics,
    }


@tool(
    path="/project_analyses/search",
    transform=lambda r, a: {
        "project": a["project"],
        "total": r["paging"]["total"],
        "analyses": [
            {
                "key": an["key"],
                "date": an["date"],
                "events": [
                    {"category": e["category"], "name": e.get("name", "")}
                    for e in an.get("events", [])
                ],
            }
            for an in r["analyses"]
        ],
    },
)
def analyses(project: str, organization: str, page: int, page_size: int) -> dict:
    """Get analysis history for project."""
    return {
        "project": project or B.project,
        "organization": organization or B.organization,
        **_pagination(
            page, page_size, B.default_page_size_analyses, B.max_page_size_analyses
        ),
    }


@tool(
    path="/projects/search",
    transform=lambda r, a: {
        "organization": a["organization"],
        "total": r["paging"]["total"],
        "projects": [
            {"key": p["key"], "name": p["name"], "qualifier": p.get("qualifier", "")}
            for p in r["components"]
        ],
    },
)
def projects(organization: str, page: int, page_size: int) -> dict:
    """List projects in organization."""
    return {
        "organization": organization or B.organization,
        **_pagination(page, page_size, B.page_size, B.max_results),
    }


@tool(
    path="/hotspots/search",
    transform=lambda r, a: {
        "project": a["project"],
        "total": r["paging"]["total"],
        "hotspots": [
            {
                "key": h["key"],
                "message": h["message"],
                "status": h["status"],
                "vulnerability_probability": h["vulnerabilityProbability"],
                "component": h["component"].split(":")[-1],
                "line": h.get("line"),
            }
            for h in r["hotspots"]
        ],
    },
)
def hotspots(
    project: str, organization: str, status: str, page: int, page_size: int
) -> dict:
    """Search security hotspots."""
    base = {
        "projectKey": project or B.project,
        "organization": organization or B.organization,
        **_pagination(page, page_size, B.page_size, B.max_results),
    }
    conditionals = {"status": status}
    return _build_params(base, conditionals)


# --- [PURE_FUNCTIONS] ---------------------------------------------------------
def _http_error_response(e: httpx.HTTPStatusError) -> dict[str, Any]:
    """Format HTTP status error response."""
    return {
        "status": "error",
        "message": str(e),
        "code": e.response.status_code,
        "details": e.response.text[: B.error_truncate_len] if e.response.text else "",
    }


def _request_error_response(e: httpx.RequestError) -> dict[str, Any]:
    """Format request error response."""
    return {"status": "error", "message": str(e)}


def _handle_error(e: Exception) -> dict[str, Any]:
    """Dispatch error to type-specific handler."""
    match e:
        case httpx.HTTPStatusError():
            return _http_error_response(e)
        case httpx.RequestError():
            return _request_error_response(e)
        case _:
            return {"status": "error", "message": str(e)}


# --- [DISPATCH] ---------------------------------------------------------------
def dispatch(cmd: str, args: dict[str, Any]) -> dict[str, Any]:
    """Execute registered tool via HTTP — pure dispatch, no branching."""
    fn, cfg = _tools[cmd]
    sig = fn.__code__.co_varnames[: fn.__code__.co_argcount]
    params = fn(**{k: args[k] for k in sig if k in args})
    headers = {"Authorization": f"Bearer {os.environ.get(B.key_env, '')}"}

    try:
        with httpx.Client(timeout=B.timeout) as c:
            r = c.request(
                cfg["method"],
                f"{B.base_url}{cfg['path']}",
                headers=headers,
                params=params,
            )
            r.raise_for_status()
            return {"status": "success", **cfg["transform"](r.json(), args)}
    except Exception as e:
        return _handle_error(e)


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """CLI entry point — parse args and dispatch to tool."""
    p = argparse.ArgumentParser(description=__doc__)
    [
        p.add_argument(a, **o)
        for a, o in [
            ("command", {"choices": _tools.keys()}),
            ("--project", {"default": B.project}),
            ("--organization", {"default": B.organization}),
            ("--branch", {"default": ""}),
            ("--pull-request", {"default": ""}),
            (
                "--severities",
                {"default": "", "help": "BLOCKER,CRITICAL,MAJOR,MINOR,INFO"},
            ),
            ("--types", {"default": "", "help": "BUG,VULNERABILITY,CODE_SMELL"}),
            (
                "--statuses",
                {"default": "", "help": "OPEN,CONFIRMED,REOPENED,RESOLVED,CLOSED"},
            ),
            ("--metrics", {"default": ""}),
            ("--status", {"default": "", "help": "TO_REVIEW,ACKNOWLEDGED,FIXED,SAFE"}),
            ("--page", {"type": int, "default": 1}),
            ("--page-size", {"type": int, "default": B.page_size}),
        ]
    ]
    args = vars(p.parse_args())
    result = dispatch(args.pop("command"), args)
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "success" else 1


if __name__ == "__main__":
    sys.exit(main())
