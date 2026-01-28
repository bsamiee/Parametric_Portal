#!/usr/bin/env -S uv run --quiet --script
# /// script
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
from __future__ import annotations

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

# --- [DISPATCH] ---------------------------------------------------------------
CMDS: Final[dict[str, tuple[Callable[..., dict], int]]] = {}


def cmd(argc: int) -> Callable[[Callable[..., dict]], Callable[..., dict]]:
    """Register command with required argument count."""
    def register(fn: Callable[..., dict]) -> Callable[..., dict]:
        CMDS[fn.__name__] = (fn, argc)
        return fn
    return register


# --- [SUBPROCESS] -------------------------------------------------------------
def _run(*args: str) -> tuple[bool, str]:
    """Run pnpm exec nx command, return (success, output)."""
    env = {**os.environ, "NX_DAEMON": "false"}
    r = subprocess.run(("pnpm", "exec", "nx", *args), capture_output=True, text=True, env=env)
    return r.returncode == 0, (r.stdout or r.stderr).strip()


def _run_tsx(*args: str) -> tuple[bool, str]:
    """Run pnpm exec tsx command, return (success, output)."""
    r = subprocess.run(("pnpm", "exec", "tsx", *args), capture_output=True, text=True)
    return r.returncode == 0, (r.stdout or r.stderr).strip()


# --- [COMMANDS] ---------------------------------------------------------------
@cmd(0)
def workspace() -> dict:
    """List all projects in workspace."""
    ok, out = _run("show", "projects", "--json")
    return {"status": "success", "projects": json.loads(out)} if ok else {"status": "error", "message": out}


@cmd(0)
def path() -> dict:
    """Get workspace root path."""
    p = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
    return {"status": "success", "path": p}


@cmd(0)
def generators() -> dict:
    """List available generators."""
    ok, out = _run("list")
    return {"status": "success", "generators": out} if ok else {"status": "error", "message": out}


@cmd(1)
def project(name: str) -> dict:
    """View project configuration."""
    ok, out = _run("show", "project", name, "--json")
    return {"status": "success", "name": name, "project": json.loads(out)} if ok else {"status": "error", "message": out}


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
    b = base or BASE_BRANCH
    ok, out = _run("show", "projects", "--affected", f"--base={b}", "--json")
    return {"status": "success", "base": b, "affected": json.loads(out)} if ok else {"status": "error", "message": out}


@cmd(0)
def graph(output: str = "") -> dict:
    """Generate dependency graph."""
    o = output or GRAPH_OUTPUT
    ok, out = _run("graph", f"--file={o}")
    return {"status": "success", "file": o} if ok else {"status": "error", "message": out}


@cmd(0)
def tokens(path_: str = "") -> dict:
    """Count tokens in file/directory."""
    p = path_ or "."
    ok, out = _run_tsx(TOKEN_SCRIPT, p)
    return {"status": "success", "path": p, "output": out} if ok else {"status": "error", "message": out}


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
            if len(cmd_args) < argc:
                print(f"Usage: nx.py {cmd_name} {' '.join(f'<arg{i+1}>' for i in range(argc))}")
                return 1
            try:
                result = fn(*cmd_args[:argc + 1])  # required + up to 1 optional
                print(json.dumps(result, indent=2))
                return 0 if result["status"] == "success" else 1
            except json.JSONDecodeError as e:
                print(json.dumps({"status": "error", "message": f"Invalid JSON: {e}"}))
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
