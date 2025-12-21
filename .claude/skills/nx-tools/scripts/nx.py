#!/usr/bin/env -S uv run --quiet --script
# /// script
# ///
"""Nx workspace CLI — polymorphic interface with zero-arg defaults."""

# --- [IMPORTS] ----------------------------------------------------------------
import json
import os
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Final


# --- [TYPES] ------------------------------------------------------------------
type Args = dict[str, Any]
type CmdBuilder = Callable[[Args], tuple[str, ...] | str]
type OutputFormatter = Callable[[str, Args], dict[str, Any]]
type Handler = tuple[CmdBuilder, OutputFormatter]


# --- [CONSTANTS] --------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class _B:
    pnpm: str = "pnpm"
    exec: str = "exec"
    nx: str = "nx"
    tsx: str = "tsx"
    show: str = "show"
    run_many: str = "run-many"
    base_prefix: str = "--base="
    file_prefix: str = "--file="
    base: str = "main"
    output: str = ".nx/graph.json"
    target: str = "build"
    token_script: str = "tools/scripts/count-tokens.ts"
    cwd_env: str = "CLAUDE_PROJECT_DIR"
    failed_suffix: str = " failed"
    daemon_env: str = "NX_DAEMON"


B: Final[_B] = _B()

SCRIPT_PATH: Final[str] = "uv run .claude/skills/nx-tools/scripts/nx.py"

COMMANDS: Final[dict[str, dict[str, str]]] = {
    "workspace": {
        "desc": "List all projects in workspace",
        "opts": "",
        "req": "",
    },
    "path": {
        "desc": "Get workspace root path",
        "opts": "",
        "req": "",
    },
    "generators": {
        "desc": "List available generators",
        "opts": "",
        "req": "",
    },
    "project": {
        "desc": "View project configuration",
        "opts": "--name PROJECT",
        "req": "--name",
    },
    "run": {
        "desc": "Run target across projects",
        "opts": "--target TARGET",
        "req": "--target",
    },
    "schema": {
        "desc": "View generator schema",
        "opts": "--generator NAME",
        "req": "--generator",
    },
    "affected": {
        "desc": "List affected projects",
        "opts": "[--base main]",
        "req": "",
    },
    "graph": {
        "desc": "Generate dependency graph",
        "opts": "[--output .nx/graph.json]",
        "req": "",
    },
    "tokens": {
        "desc": "Count tokens in file/directory",
        "opts": "[--path PATH]",
        "req": "",
    },
    "docs": {
        "desc": "View Nx command documentation",
        "opts": "[--topic COMMAND]",
        "req": "",
    },
}

REQUIRED: Final[dict[str, tuple[str, ...]]] = {
    "project": ("name",),
    "run": ("target",),
    "schema": ("generator",),
}


# --- [PURE_FUNCTIONS] ---------------------------------------------------------
def _usage_error(message: str, cmd: str | None = None) -> dict[str, Any]:
    """Generate usage error with correct syntax."""
    return {
        "status": "error",
        "message": "\n".join(
            [
                f"[ERROR] {message}",
                "",
                "[USAGE]",
                *(
                    [
                        f"  {SCRIPT_PATH} {cmd}{' ' + COMMANDS[cmd]['opts'] if COMMANDS[cmd]['opts'] else ''}",
                        *(
                            [f"  Required: {COMMANDS[cmd]['req']}"]
                            if COMMANDS[cmd]["req"]
                            else []
                        ),
                    ]
                    if cmd and cmd in COMMANDS
                    else [
                        f"  {SCRIPT_PATH} <command> [options]",
                        "",
                        "[ZERO_ARG_COMMANDS]",
                        *[
                            f"  {n:<12} {i['desc']}"
                            for n, i in COMMANDS.items()
                            if not i["req"]
                        ],
                        "",
                        "[REQUIRED_ARG_COMMANDS]",
                        *[
                            f"  {n:<12} {i['desc']} ({i['req']})"
                            for n, i in COMMANDS.items()
                            if i["req"]
                        ],
                        "",
                        "[EXAMPLES]",
                        f"  {SCRIPT_PATH} workspace",
                        f"  {SCRIPT_PATH} project --name parametric-portal",
                        f"  {SCRIPT_PATH} run --target build",
                    ]
                ),
            ]
        ),
    }


def _validate_args(cmd: str, args: Args) -> list[str]:
    """Return list of missing required arguments for command."""
    return [
        f"--{k.replace('_', '-')}" for k in REQUIRED.get(cmd, ()) if not args.get(k)
    ]


# --- [DISPATCH_TABLES] --------------------------------------------------------
handlers: dict[str, Handler] = {
    "workspace": (
        lambda _: (B.pnpm, B.exec, B.nx, B.show, "projects", "--json"),
        lambda o, _: {"projects": json.loads(o)},
    ),
    "project": (
        lambda a: (B.pnpm, B.exec, B.nx, B.show, "project", a.get("name") or "", "--json"),
        lambda o, a: {"name": a.get("name", ""), "project": json.loads(o)},
    ),
    "affected": (
        lambda a: (
            B.pnpm,
            B.exec,
            B.nx,
            B.show,
            "projects",
            "--affected",
            f"{B.base_prefix}{a.get('base') or B.base}",
            "--json",
        ),
        lambda o, a: {
            "base": a.get("base") or B.base,
            "affected": json.loads(o),
        },
    ),
    "run": (
        lambda a: (B.pnpm, B.exec, B.nx, B.run_many, "-t", a.get("target") or B.target),
        lambda o, a: {
            "target": a.get("target") or B.target,
            "output": o.strip(),
        },
    ),
    "tokens": (
        lambda a: (B.pnpm, B.exec, B.tsx, B.token_script, a.get("path") or "."),
        lambda o, a: {
            "path": a.get("path") or ".",
            "output": o.strip(),
        },
    ),
    "path": (
        lambda _: os.environ.get(B.cwd_env, os.getcwd()),
        lambda o, _: {"path": o},
    ),
    "generators": (
        lambda _: (B.pnpm, B.exec, B.nx, "list"),
        lambda o, _: {"generators": o.strip()},
    ),
    "schema": (
        lambda a: (B.pnpm, B.exec, B.nx, "g", a.get("generator") or "", "--help"),
        lambda o, a: {
            "generator": a.get("generator", ""),
            "schema": o.strip(),
        },
    ),
    "graph": (
        lambda a: (
            B.pnpm,
            B.exec,
            B.nx,
            "graph",
            f"{B.file_prefix}{a.get('output') or B.output}",
        ),
        lambda o, a: {"file": a.get("output") or B.output},
    ),
    "docs": (
        lambda a: (
            (B.pnpm, B.exec, B.nx, a.get("topic", ""), "--help")
            if a.get("topic")
            else (B.pnpm, B.exec, B.nx, "--help")
        ),
        lambda o, a: {
            "topic": a.get("topic") or "general",
            "docs": o.strip(),
        },
    ),
}


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """CLI entry point — zero-arg defaults with optional args."""
    if not (args := sys.argv[1:]) or args[0] in ("-h", "--help"):
        print(json.dumps(_usage_error("No command specified"), indent=2))
        return 1

    if (cmd := args[0]) not in COMMANDS:
        print(json.dumps(_usage_error(f"Unknown command: {cmd}"), indent=2))
        return 1

    # Parse optional flags (--key value or --key=value)
    opts: Args = {}
    i = 1
    while i < len(args):
        arg = args[i]
        if arg.startswith("--"):
            if "=" in arg:
                key, val = arg[2:].split("=", 1)
                opts[key.replace("-", "_")] = val
            elif i + 1 < len(args) and not args[i + 1].startswith("--"):
                opts[arg[2:].replace("-", "_")] = args[i + 1]
                i += 1
            else:
                opts[arg[2:].replace("-", "_")] = True
        i += 1

    if missing := _validate_args(cmd, opts):
        print(
            json.dumps(
                _usage_error(f"Missing required: {', '.join(missing)}", cmd), indent=2
            )
        )
        return 1

    builder, formatter = handlers[cmd]
    cmd_tuple = builder(opts)
    env = {**os.environ, B.daemon_env: "false"}

    match cmd_tuple:
        case str():
            output = cmd_tuple
        case tuple() if (
            r := subprocess.run(cmd_tuple, capture_output=True, text=True, env=env)
        ).returncode == 0:
            output = r.stdout or r.stderr
        case _:
            output = None

    result = (
        {"status": "success", **formatter(output, opts)}
        if output
        else {"status": "error", "message": f"{cmd}{B.failed_suffix}"}
    )
    print(json.dumps(result, indent=2))
    return 0 if output else 1


if __name__ == "__main__":
    sys.exit(main())
