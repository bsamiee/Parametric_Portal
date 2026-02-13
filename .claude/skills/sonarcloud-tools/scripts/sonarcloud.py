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
# LOC: 150

import json
import os
import sys
from typing import Any, Final

import httpx

from _commands import quality_gate, issues, measures, analyses, projects, hotspots

# --- [CONSTANTS] --------------------------------------------------------------
BASE_URL: Final = "https://sonarcloud.io/api"
KEY_ENV: Final = "SONAR_TOKEN"
TIMEOUT: Final = 30


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


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """Dispatch command and print JSON output."""
    match sys.argv[1:]:
        case ["quality-gate", *args]:
            arg1 = args[0] if len(args) >= 1 else ""
            arg2 = args[1] if len(args) >= 2 else ""
            try:
                result = quality_gate(arg1, arg2, _get)
                sys.stdout.write(json.dumps(result, indent=2) + "\n")
                return 0 if result["status"] == "success" else 1
            except httpx.HTTPStatusError as error:
                sys.stdout.write(json.dumps({"status": "error", "code": error.response.status_code, "message": error.response.text[:200]}) + "\n")
                return 1
            except httpx.RequestError as error:
                sys.stdout.write(json.dumps({"status": "error", "message": str(error)}) + "\n")
                return 1

        case ["issues", *args]:
            severities = args[0] if len(args) >= 1 else ""
            types = args[1] if len(args) >= 2 else ""
            try:
                result = issues(severities, types, _get)
                sys.stdout.write(json.dumps(result, indent=2) + "\n")
                return 0 if result["status"] == "success" else 1
            except httpx.HTTPStatusError as error:
                sys.stdout.write(json.dumps({"status": "error", "code": error.response.status_code, "message": error.response.text[:200]}) + "\n")
                return 1
            except httpx.RequestError as error:
                sys.stdout.write(json.dumps({"status": "error", "message": str(error)}) + "\n")
                return 1

        case ["measures", *args]:
            metrics = args[0] if len(args) >= 1 else ""
            try:
                result = measures(metrics, _get)
                sys.stdout.write(json.dumps(result, indent=2) + "\n")
                return 0 if result["status"] == "success" else 1
            except httpx.HTTPStatusError as error:
                sys.stdout.write(json.dumps({"status": "error", "code": error.response.status_code, "message": error.response.text[:200]}) + "\n")
                return 1
            except httpx.RequestError as error:
                sys.stdout.write(json.dumps({"status": "error", "message": str(error)}) + "\n")
                return 1

        case ["analyses", *args]:
            page_size = args[0] if len(args) >= 1 else ""
            try:
                result = analyses(page_size, _get)
                sys.stdout.write(json.dumps(result, indent=2) + "\n")
                return 0 if result["status"] == "success" else 1
            except httpx.HTTPStatusError as error:
                sys.stdout.write(json.dumps({"status": "error", "code": error.response.status_code, "message": error.response.text[:200]}) + "\n")
                return 1
            except httpx.RequestError as error:
                sys.stdout.write(json.dumps({"status": "error", "message": str(error)}) + "\n")
                return 1

        case ["projects", *args]:
            page_size = args[0] if len(args) >= 1 else ""
            try:
                result = projects(page_size, _get)
                sys.stdout.write(json.dumps(result, indent=2) + "\n")
                return 0 if result["status"] == "success" else 1
            except httpx.HTTPStatusError as error:
                sys.stdout.write(json.dumps({"status": "error", "code": error.response.status_code, "message": error.response.text[:200]}) + "\n")
                return 1
            except httpx.RequestError as error:
                sys.stdout.write(json.dumps({"status": "error", "message": str(error)}) + "\n")
                return 1

        case ["hotspots", *args]:
            status = args[0] if len(args) >= 1 else ""
            try:
                result = hotspots(status, _get)
                sys.stdout.write(json.dumps(result, indent=2) + "\n")
                return 0 if result["status"] == "success" else 1
            except httpx.HTTPStatusError as error:
                sys.stdout.write(json.dumps({"status": "error", "code": error.response.status_code, "message": error.response.text[:200]}) + "\n")
                return 1
            except httpx.RequestError as error:
                sys.stdout.write(json.dumps({"status": "error", "message": str(error)}) + "\n")
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
