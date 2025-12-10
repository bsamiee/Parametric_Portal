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
    base: str = "main"
    output: str = ".nx/graph.json"


B: Final[_B] = _B()


# --- [DISPATCH_TABLES] --------------------------------------------------------
handlers: dict[str, Handler] = {
    "workspace": (
        lambda _: ("npx", "nx", "show", "projects", "--json"),
        lambda o, _: {"projects": json.loads(o)},
    ),
    "project": (
        lambda a: ("npx", "nx", "show", "project", a["name"] or "", "--json"),
        lambda o, a: {"name": a["name"], "project": json.loads(o)},
    ),
    "affected": (
        lambda a: (
            "npx",
            "nx",
            "show",
            "projects",
            "--affected",
            f"--base={a['base']}",
            "--json",
        ),
        lambda o, a: {"base": a["base"], "affected": json.loads(o)},
    ),
    "run": (
        lambda a: ("npx", "nx", "run-many", "-t", a["target"] or "build"),
        lambda o, a: {"target": a["target"], "output": o.strip()},
    ),
    "tokens": (
        lambda a: ("npx", "tsx", "tools/scripts/count-tokens.ts", a["path"] or "."),
        lambda o, a: {"path": a["path"], "output": o.strip()},
    ),
    "path": (
        lambda _: os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd()),
        lambda o, _: {"path": o},
    ),
    "generators": (
        lambda _: ("npx", "nx", "list"),
        lambda o, _: {"generators": o.strip()},
    ),
    "schema": (
        lambda a: ("npx", "nx", "g", a["generator"] or "", "--help"),
        lambda o, a: {"generator": a["generator"], "schema": o.strip()},
    ),
    "graph": (
        lambda a: ("npx", "nx", "graph", f"--file={a['output']}"),
        lambda o, a: {"file": a["output"]},
    ),
    "docs": (
        lambda a: ("npx", "nx", a["topic"], "--help") if a["topic"] else ("npx", "nx", "--help"),
        lambda o, a: {"topic": a["topic"] or "general", "docs": o.strip()},
    ),
}


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    [
        p.add_argument(a, **o)
        for a, o in [
            ("command", {"choices": handlers.keys()}),
            ("--name", {}),
            ("--base", {"default": B.base}),
            ("--target", {}),
            ("--path", {}),
            ("--generator", {}),
            ("--output", {"default": B.output}),
            ("--topic", {}),
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
        {"status": "success", **formatter(output, args)}
        if output
        else {"status": "error", "message": f"{args['command']} failed"}
    )
    print(json.dumps(result))
    return 0 if output else 1


if __name__ == "__main__":
    sys.exit(main())
