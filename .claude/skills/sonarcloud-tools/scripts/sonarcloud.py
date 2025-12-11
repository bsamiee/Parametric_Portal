#!/usr/bin/env -S uv run --quiet --script
# /// script
# dependencies = ["httpx"]
# ///
"""SonarCloud API — polymorphic HTTP client, zero-arg defaults."""

# --- [IMPORTS] ----------------------------------------------------------------
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

SCRIPT_PATH: Final[str] = "uv run .claude/skills/sonarcloud-tools/scripts/sonarcloud.py"

COMMANDS: Final[dict[str, dict[str, str]]] = {
    "quality-gate": {
        "desc": "Quality gate pass/fail status",
        "opts": "[--branch NAME] [--pull-request NUM]",
    },
    "issues": {
        "desc": "Search code issues (bugs, smells, vulnerabilities)",
        "opts": "[--severities BLOCKER,CRITICAL,MAJOR,MINOR,INFO] [--types BUG,VULNERABILITY,CODE_SMELL] [--statuses OPEN,CONFIRMED,REOPENED]",
    },
    "measures": {
        "desc": "Project metrics (coverage, bugs, etc.)",
        "opts": "[--metrics coverage,bugs,vulnerabilities]",
    },
    "analyses": {
        "desc": "Analysis history",
        "opts": "[--page NUM] [--page-size NUM]",
    },
    "projects": {
        "desc": "List organization projects",
        "opts": "[--page NUM] [--page-size NUM]",
    },
    "hotspots": {
        "desc": "Security hotspots",
        "opts": "[--status TO_REVIEW|ACKNOWLEDGED|FIXED|SAFE]",
    },
}

_COERCE: Final[dict[str, type]] = {"page": int, "page_size": int}


# --- [PURE_FUNCTIONS] ---------------------------------------------------------
def _parse_conditions(conditions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Transforms quality gate conditions to structured format."""
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
    """Groups issues by severity and type."""
    by_severity: dict[str, int] = {}
    by_type: dict[str, int] = {}
    for issue in issues:
        sev = issue.get("severity", "UNKNOWN")
        typ = issue.get("type", "UNKNOWN")
        by_severity[sev] = by_severity.get(sev, 0) + 1
        by_type[typ] = by_type.get(typ, 0) + 1
    return {"by_severity": by_severity, "by_type": by_type}


def _build_params(base: dict[str, Any], conditionals: dict[str, Any]) -> dict[str, Any]:
    """Merges base params with non-empty conditionals."""
    return base | {k: v for k, v in conditionals.items() if v}


def _pagination(
    page: int | None, page_size: int | None, default_size: int, max_size: int
) -> dict[str, int]:
    """Builds pagination params from defaults, applies limits."""
    return {
        "ps": min(page_size or default_size, max_size),
        "p": page or 1,
    }


def _usage_error(message: str, cmd: str | None = None) -> dict[str, Any]:
    """Generates usage error for correct syntax."""
    lines = [f"[ERROR] {message}", "", "[USAGE]"]

    if cmd and cmd in COMMANDS:
        lines.append(f"  {SCRIPT_PATH} {cmd} {COMMANDS[cmd]['opts']}")
    else:
        lines.append(f"  {SCRIPT_PATH} <command> [options]")
        lines.append("")
        lines.append("[COMMANDS]")
        for name, info in COMMANDS.items():
            lines.append(f"  {name:<14} {info['desc']}")
        lines.append("")
        lines.append("[EXAMPLES]")
        lines.append(f"  {SCRIPT_PATH} issues")
        lines.append(f"  {SCRIPT_PATH} issues --severities BLOCKER,CRITICAL")
        lines.append(f"  {SCRIPT_PATH} hotspots")
        lines.append(f"  {SCRIPT_PATH} quality-gate")

    return {"status": "error", "message": "\n".join(lines)}


# --- [REGISTRY] ---------------------------------------------------------------
_tools: dict[str, tuple[ToolFn, ToolConfig]] = {}


def tool(**cfg: Any) -> Callable[[ToolFn], ToolFn]:
    """Registers tool—HTTP config: method, path, transform."""

    def register(fn: ToolFn) -> ToolFn:
        _tools[fn.__name__.replace("_", "-")] = (fn, {"method": "GET", **cfg})
        return fn

    return register


# --- [TOOLS] ------------------------------------------------------------------
@tool(
    path="/qualitygates/project_status",
    transform=lambda r, a: {
        "project": a.get("project", B.project),
        "status": r["projectStatus"]["status"],
        "passed": r["projectStatus"]["status"] == "OK",
        "conditions": _parse_conditions(r["projectStatus"].get("conditions", [])),
        "ignored_conditions": r["projectStatus"].get("ignoredConditions", False),
    },
)
def quality_gate(
    project: str = "", organization: str = "", branch: str = "", pull_request: str = ""
) -> dict:
    """Retrieves quality gate status for project."""
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
        "project": a.get("project", B.project),
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
    project: str = "",
    organization: str = "",
    severities: str = "",
    types: str = "",
    statuses: str = "",
    page: int = 1,
    page_size: int = 100,
) -> dict:
    """Searches issues by severity, type, status."""
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
def measures(project: str = "", organization: str = "", metrics: str = "") -> dict:
    """Retrieves project metrics (coverage, ncloc, bugs)."""
    return {
        "component": project or B.project,
        "organization": organization or B.organization,
        "metricKeys": metrics or B.default_metrics,
    }


@tool(
    path="/project_analyses/search",
    transform=lambda r, a: {
        "project": a.get("project", B.project),
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
def analyses(
    project: str = "", organization: str = "", page: int = 1, page_size: int = 10
) -> dict:
    """Retrieves analysis history for project."""
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
        "organization": a.get("organization", B.organization),
        "total": r["paging"]["total"],
        "projects": [
            {"key": p["key"], "name": p["name"], "qualifier": p.get("qualifier", "")}
            for p in r["components"]
        ],
    },
)
def projects(organization: str = "", page: int = 1, page_size: int = 100) -> dict:
    """Lists projects within organization."""
    return {
        "organization": organization or B.organization,
        **_pagination(page, page_size, B.page_size, B.max_results),
    }


@tool(
    path="/hotspots/search",
    transform=lambda r, a: {
        "project": a.get("project", B.project),
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
    project: str = "",
    organization: str = "",
    status: str = "",
    page: int = 1,
    page_size: int = 100,
) -> dict:
    """Searches security hotspots in project."""
    base = {
        "projectKey": project or B.project,
        "organization": organization or B.organization,
        **_pagination(page, page_size, B.page_size, B.max_results),
    }
    conditionals = {"status": status}
    return _build_params(base, conditionals)


# --- [DISPATCH] ---------------------------------------------------------------
def _http_error_response(e: httpx.HTTPStatusError) -> dict[str, Any]:
    """Formats HTTP status error response."""
    return {
        "status": "error",
        "message": str(e),
        "code": e.response.status_code,
        "details": e.response.text[: B.error_truncate_len] if e.response.text else "",
    }


def _request_error_response(e: httpx.RequestError) -> dict[str, Any]:
    """Formats request error response."""
    return {"status": "error", "message": str(e)}


def _handle_error(e: Exception) -> dict[str, Any]:
    """Dispatches error via type-specific handler."""
    match e:
        case httpx.HTTPStatusError():
            return _http_error_response(e)
        case httpx.RequestError():
            return _request_error_response(e)
        case _:
            return {"status": "error", "message": str(e)}


def dispatch(cmd: str, args: dict[str, Any]) -> dict[str, Any]:
    """Executes registered tool via HTTP dispatch."""
    if cmd not in _tools:
        return _usage_error(f"Unknown command: {cmd}")

    fn, cfg = _tools[cmd]
    sig = fn.__code__.co_varnames[: fn.__code__.co_argcount]
    params = fn(**{k: args.get(k, "") for k in sig})

    token = os.environ.get(B.key_env, "")
    if not token:
        return _usage_error(f"Missing {B.key_env} environment variable")

    headers = {"Authorization": f"Bearer {token}"}

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
    """CLI entry point — zero-arg defaults, optional filters."""
    if not (args := sys.argv[1:]) or args[0] in ("-h", "--help"):
        return print(json.dumps(_usage_error("No command specified"), indent=2)) or 1
    if (cmd := args[0]) not in COMMANDS:
        return print(json.dumps(_usage_error(f"Unknown command: {cmd}"), indent=2)) or 1

    # Parse optional flags (--key value or --key=value)
    opts: dict[str, Any] = {}
    i = 1
    while i < len(args):
        arg = args[i]
        if arg.startswith("--"):
            if "=" in arg:
                key, val = arg[2:].split("=", 1)
                opts[key.replace("-", "_")] = val
            elif i + 1 < len(args) and not args[i + 1].startswith("--"):
                key = arg[2:].replace("-", "_")
                val = args[i + 1]
                opts[key] = _COERCE.get(key, str)(val)
                i += 1
            else:
                opts[arg[2:].replace("-", "_")] = True
        i += 1

    result = dispatch(cmd, opts)
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "success" else 1


if __name__ == "__main__":
    sys.exit(main())
