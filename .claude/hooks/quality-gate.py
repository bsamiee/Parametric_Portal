#!/usr/bin/env python3
"""Stop hook: Quality gate - typecheck + lint before completion."""

# --- [IMPORTS] ----------------------------------------------------------------
from __future__ import annotations

import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Final

# --- [TYPES] ------------------------------------------------------------------
type CheckResult = tuple[bool, str]
type CheckCmd = tuple[str, ...]


# --- [CONSTANTS] --------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class _B:
    """Immutable configuration constants."""

    checks: tuple[CheckCmd, ...] = (
        ("pnpm", "nx", "affected", "-t", "typecheck", "--parallel=3"),
        ("pnpm", "nx", "affected", "-t", "check", "--parallel=3"),
    )
    timeout: int = 180


B: Final[_B] = _B()
DEBUG: Final[bool] = os.environ.get("CLAUDE_HOOK_DEBUG", "").lower() in ("1", "true")


# --- [PURE_FUNCTIONS] ---------------------------------------------------------
def _debug(msg):
    return DEBUG and print(f"[quality-gate] {msg}", file=sys.stderr)


def _get_project_dir():
    return Path(os.environ.get("CLAUDE_PROJECT_DIR", ".")).resolve()


def _extract_check_name(cmd):
    return cmd[4] if len(cmd) > 4 and cmd[1] == "nx" else cmd[0]


def _has_changes(project_dir: Path) -> bool:
    """Detects uncommitted changes to gate unnecessary validation runs."""
    result = subprocess.run(
        ("git", "status", "--porcelain"),
        cwd=project_dir,
        capture_output=True,
        text=True,
    )
    return bool(result.stdout.strip())


def _run_check(cmd: CheckCmd, project_dir: Path) -> CheckResult:
    """Execute single check command, return (success, error_summary)."""
    _ = _debug(f"Running: {' '.join(cmd)}")
    result = subprocess.run(
        cmd,
        cwd=project_dir,
        capture_output=True,
        text=True,
        timeout=B.timeout,
    )
    return (result.returncode == 0, result.stderr[:500] if result.stderr else "")


def _format_failure(cmd: CheckCmd, err: str) -> str:
    """Format failure message from command and error."""
    name = _extract_check_name(cmd)
    return f"{name}: {err}" if err else name


def _run_all_checks(project_dir: Path) -> tuple[str, ...]:
    """Run all checks, return tuple of failure messages."""
    results = tuple(_run_check(cmd, project_dir) for cmd in B.checks)
    return tuple(
        _format_failure(cmd, err)
        for cmd, (success, err) in zip(B.checks, results, strict=True)
        if not success
    )


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> None:
    project_dir = _get_project_dir()
    _ = _debug(f"Project dir: {project_dir}")

    match _has_changes(project_dir):
        case False:
            _ = _debug("No uncommitted changes, skipping")
            sys.exit(0)
        case True:
            _ = _debug("Changes detected, running quality checks")

    match _run_all_checks(project_dir):
        case ():
            _ = _debug("All checks passed")
            sys.exit(0)
        case failures:
            print(
                "BLOCKED: Quality gate failed\n"
                + "\n".join(f"- {f}" for f in failures),
                file=sys.stderr,
            )
            sys.exit(2)


if __name__ == "__main__":
    main()
