#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.14"
# ///
"""Nx workspace CLI — query monorepo metadata via unified interface.

Commands:
    workspace                     List all projects
    path                          Get workspace root path
    generators                    List available generators
    project <name>                View project configuration
    run <target>                  Run target across projects
    schema <generator>            View generator schema
    affected [base]               List affected projects (default: main)
    graph [output]                Generate dependency graph (default: .nx/graph.json)
    tokens [path]                 Count tokens in file/directory (default: .)
    docs [topic]                  View Nx command documentation
"""

import json
import os
import subprocess
import sys
from collections.abc import Callable
from typing import Any, Final

# --- [CONSTANTS] --------------------------------------------------------------
BASE_BRANCH: Final = "main"
GRAPH_OUTPUT: Final = ".nx/graph.json"
TOKEN_SCRIPT: Final = "tools/scripts/count-tokens.ts"

# --- [TYPES] ------------------------------------------------------------------
type CommandEntry = tuple[Callable[..., dict], int]
type CommandRegistry = dict[str, CommandEntry]

# --- [DISPATCH] ---------------------------------------------------------------
CMDS: Final[CommandRegistry] = {}


def cmd(argc: int) -> Callable[[Callable[..., dict]], Callable[..., dict]]:
    """Register command with required argument count."""
    def register(fn: Callable[..., dict]) -> Callable[..., dict]:
        CMDS[fn.__name__] = (fn, argc)
        return fn
    return register


# --- [FUNCTIONS] --------------------------------------------------------------
def _run(*args: str) -> tuple[bool, str]:
    """Run pnpm exec nx command, return (success, output).

    Args:
        args: Nx CLI arguments to pass after 'pnpm exec nx'.

    Returns:
        Tuple of (success, output) where output is stdout or stderr.
    """
    env = {**os.environ, "NX_DAEMON": "false"}
    result = subprocess.run(("pnpm", "exec", "nx", *args), capture_output=True, text=True, env=env)
    return result.returncode == 0, (result.stdout or result.stderr).strip()


def _run_tsx(*args: str) -> tuple[bool, str]:
    """Run pnpm exec tsx command, return (success, output).

    Args:
        args: TSX CLI arguments to pass after 'pnpm exec tsx'.

    Returns:
        Tuple of (success, output) where output is stdout or stderr.
    """
    result = subprocess.run(("pnpm", "exec", "tsx", *args), capture_output=True, text=True)
    return result.returncode == 0, (result.stdout or result.stderr).strip()


def _parse_or_error(ok: bool, out: str, success_fn: Callable[[Any], dict]) -> dict:
    """Parse JSON output on success, return error dict on failure.

    Args:
        ok: Whether the command succeeded.
        out: Raw command output.
        success_fn: Function to build success dict from parsed JSON.

    Returns:
        Success dict via success_fn or error dict.
    """
    return success_fn(json.loads(out)) if ok else {"status": "error", "message": out}


# --- [COMMANDS] ---------------------------------------------------------------
@cmd(0)
def workspace() -> dict:
    """List all projects in workspace."""
    ok, out = _run("show", "projects", "--json")
    return _parse_or_error(ok, out, lambda data: {"status": "success", "projects": data})


@cmd(0)
def path() -> dict:
    """Get workspace root path."""
    workspace_path = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
    return {"status": "success", "path": workspace_path}


@cmd(0)
def generators() -> dict:
    """List available generators."""
    ok, out = _run("list")
    return {"status": "success", "generators": out} if ok else {"status": "error", "message": out}


@cmd(1)
def project(name: str) -> dict:
    """View project configuration."""
    ok, out = _run("show", "project", name, "--json")
    return _parse_or_error(ok, out, lambda data: {"status": "success", "name": name, "project": data})


@cmd(1)
def run(target: str) -> dict:
    """Run target across projects."""
    ok, out = _run("run-many", "-t", target)
    return {"status": "success", "target": target, "output": out} if ok else {"status": "error", "message": out}


@cmd(1)
def schema(generator: str) -> dict:
    """View generator schema."""
    ok, out = _run("g", generator, "--help")
    return {"status": "success", "generator": generator, "schema": out} if ok else {"status": "error", "message": out}


@cmd(0)
def affected(base: str = "") -> dict:
    """List affected projects."""
    branch = base or BASE_BRANCH
    ok, out = _run("show", "projects", "--affected", f"--base={branch}", "--json")
    return _parse_or_error(ok, out, lambda data: {"status": "success", "base": branch, "affected": data})


@cmd(0)
def graph(output: str = "") -> dict:
    """Generate dependency graph."""
    output_path = output or GRAPH_OUTPUT
    ok, out = _run("graph", f"--file={output_path}")
    return {"status": "success", "file": output_path} if ok else {"status": "error", "message": out}


@cmd(0)
def tokens(path_: str = "") -> dict:
    """Count tokens in file/directory."""
    target_path = path_ or "."
    ok, out = _run_tsx(TOKEN_SCRIPT, target_path)
    return {"status": "success", "path": target_path, "output": out} if ok else {"status": "error", "message": out}


@cmd(0)
def docs(topic: str = "") -> dict:
    """View Nx command documentation."""
    args = (topic, "--help") if topic else ("--help",)
    ok, out = _run(*args)
    return {"status": "success", "topic": topic or "general", "docs": out} if ok else {"status": "error", "message": out}


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """Dispatch command and print JSON output."""
    match sys.argv[1:]:
        case [cmd_name, *cmd_args] if (entry := CMDS.get(cmd_name)):
            fn, argc = entry
            match cmd_args:
                case _ if len(cmd_args) < argc:
                    sys.stdout.write(f"Usage: nx.py {cmd_name} {' '.join(f'<arg{index + 1}>' for index in range(argc))}\n")
                    return 1
                case _:
                    try:
                        result = fn(*cmd_args[:argc + 1])
                        sys.stdout.write(json.dumps(result, indent=2) + "\n")
                        return 0 if result["status"] == "success" else 1
                    except json.JSONDecodeError as error:
                        sys.stdout.write(json.dumps({"status": "error", "message": f"Invalid JSON: {error}"}) + "\n")
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
