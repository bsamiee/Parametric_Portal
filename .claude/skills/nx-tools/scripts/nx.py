#!/usr/bin/env -S uv run --quiet --script
# /// script
# ///
"""Nx workspace CLI — unified polymorphic interface."""

# --- [IMPORTS] ----------------------------------------------------------------
import argparse
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
    # CLI
    npx: str = "npx"
    nx: str = "nx"
    tsx: str = "tsx"

    # Commands
    show: str = "show"
    run_many: str = "run-many"
    list_cmd: str = "list"
    generate: str = "g"
    graph: str = "graph"

    # Subcommands
    projects: str = "projects"
    project: str = "project"

    # Flags
    json_flag: str = "--json"
    affected_flag: str = "--affected"
    base_prefix: str = "--base="
    file_prefix: str = "--file="
    target_flag: str = "-t"
    help_flag: str = "--help"

    # Defaults
    base: str = "main"
    output: str = ".nx/graph.json"
    target: str = "build"
    general: str = "general"

    # Paths
    token_script: str = "tools/scripts/count-tokens.ts"
    cwd_env: str = "CLAUDE_PROJECT_DIR"

    # JSON keys
    key_projects: str = "projects"
    key_name: str = "name"
    key_project: str = "project"
    key_base: str = "base"
    key_affected: str = "affected"
    key_target: str = "target"
    key_output: str = "output"
    key_path: str = "path"
    key_generators: str = "generators"
    key_generator: str = "generator"
    key_schema: str = "schema"
    key_file: str = "file"
    key_topic: str = "topic"
    key_docs: str = "docs"
    key_status: str = "status"
    key_message: str = "message"

    # Status
    success: str = "success"
    error: str = "error"
    failed_suffix: str = " failed"


B: Final[_B] = _B()


# --- [PURE_FUNCTIONS] ---------------------------------------------------------
def nx_cmd(*parts: str) -> tuple[str, ...]:
    """Build Nx command tuple."""
    return (B.npx, B.nx, *parts)


def parse_json(output: str) -> Any:
    """Parse JSON output."""
    return json.loads(output)


def strip_output(output: str) -> str:
    """Strip whitespace from output."""
    return output.strip()


def get_or_default(args: Args, key: str, default: str) -> str:
    """Get argument value or default."""
    return args[key] or default


def base_flag(base: str) -> str:
    """Build base flag."""
    return f"{B.base_prefix}{base}"


def file_flag(file: str) -> str:
    """Build file flag."""
    return f"{B.file_prefix}{file}"


# --- [DISPATCH_TABLES] --------------------------------------------------------
handlers: dict[str, Handler] = {
    "workspace": (
        lambda _: nx_cmd(B.show, B.projects, B.json_flag),
        lambda o, _: {B.key_projects: parse_json(o)},
    ),
    "project": (
        lambda a: nx_cmd(
            B.show, B.project, get_or_default(a, B.key_name, ""), B.json_flag
        ),
        lambda o, a: {B.key_name: a[B.key_name], B.key_project: parse_json(o)},
    ),
    "affected": (
        lambda a: nx_cmd(
            B.show,
            B.projects,
            B.affected_flag,
            base_flag(a[B.key_base]),
            B.json_flag,
        ),
        lambda o, a: {B.key_base: a[B.key_base], B.key_affected: parse_json(o)},
    ),
    "run": (
        lambda a: nx_cmd(
            B.run_many, B.target_flag, get_or_default(a, B.key_target, B.target)
        ),
        lambda o, a: {B.key_target: a[B.key_target], B.key_output: strip_output(o)},
    ),
    "tokens": (
        lambda a: (B.npx, B.tsx, B.token_script, get_or_default(a, B.key_path, ".")),
        lambda o, a: {B.key_path: a[B.key_path], B.key_output: strip_output(o)},
    ),
    "path": (
        lambda _: os.environ.get(B.cwd_env, os.getcwd()),
        lambda o, _: {B.key_path: o},
    ),
    "generators": (
        lambda _: nx_cmd(B.list_cmd),
        lambda o, _: {B.key_generators: strip_output(o)},
    ),
    "schema": (
        lambda a: nx_cmd(
            B.generate, get_or_default(a, B.key_generator, ""), B.help_flag
        ),
        lambda o, a: {
            B.key_generator: a[B.key_generator],
            B.key_schema: strip_output(o),
        },
    ),
    "graph": (
        lambda a: nx_cmd(B.graph, file_flag(a[B.key_output])),
        lambda o, a: {B.key_file: a[B.key_output]},
    ),
    "docs": (
        lambda a: (
            nx_cmd(a[B.key_topic], B.help_flag)
            if a[B.key_topic]
            else nx_cmd(B.help_flag)
        ),
        lambda o, a: {
            B.key_topic: a[B.key_topic] or B.general,
            B.key_docs: strip_output(o),
        },
    ),
}


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    [
        p.add_argument(a, **o)
        for a, o in [
            ("command", {"choices": handlers.keys()}),
            (f"--{B.key_name}", {}),
            (f"--{B.key_base}", {"default": B.base}),
            (f"--{B.key_target}", {}),
            (f"--{B.key_path}", {}),
            (f"--{B.key_generator}", {}),
            (f"--{B.key_output}", {"default": B.output}),
            (f"--{B.key_topic}", {}),
        ]
    ]

    args = vars(p.parse_args())
    builder, formatter = handlers[args["command"]]
    cmd = builder(args)

    match cmd:
        case str():
            output = cmd
        case tuple() if (
            r := subprocess.run(cmd, capture_output=True, text=True)
        ).returncode == 0:
            output = r.stdout or r.stderr
        case _:
            output = None

    result = (
        {B.key_status: B.success, **formatter(output, args)}
        if output
        else {
            B.key_status: B.error,
            B.key_message: f"{args['command']}{B.failed_suffix}",
        }
    )
    print(json.dumps(result))
    return 0 if output else 1


if __name__ == "__main__":
    sys.exit(main())
