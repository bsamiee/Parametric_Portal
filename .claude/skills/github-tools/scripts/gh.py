#!/usr/bin/env -S uv run --quiet --script
# /// script
# ///
"""GitHub CLI — unified polymorphic interface for zero-arg defaults."""

# --- [IMPORTS] ----------------------------------------------------------------
import json
import subprocess
import sys
from dataclasses import dataclass
from typing import Any, Final, Protocol


# --- [TYPES] ------------------------------------------------------------------
type Args = dict[str, Any]


class CmdBuilder(Protocol):
    def __call__(self, a: Args, /) -> tuple[str, ...]: ...


class OutputFormatter(Protocol):
    def __call__(self, o: str, a: Args, /) -> dict[str, Any]: ...


type Handler = tuple[CmdBuilder, OutputFormatter]


# --- [CONSTANTS] --------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class _B:
    state: str = "open"
    limit: int = 30
    fmt: str = "json"
    default_branch: str = "main"
    default_owner: str = "@me"
    api_method: str = "GET"
    empty_body: str = ""


B: Final[_B] = _B()

SCRIPT_PATH: Final[str] = "uv run .claude/skills/github-tools/scripts/gh.py"

COMMANDS: Final[dict[str, dict[str, str]]] = {
    # Issues
    "issue-list": {
        "desc": "List repository issues",
        "opts": "[--state open|closed|all] [--limit NUM]",
        "req": "",
    },
    "issue-view": {
        "desc": "View issue details",
        "opts": "--number NUM",
        "req": "--number",
    },
    "issue-create": {
        "desc": "Create new issue",
        "opts": "--title TEXT [--body TEXT]",
        "req": "--title",
    },
    "issue-comment": {
        "desc": "Comment on issue",
        "opts": "--number NUM --body TEXT",
        "req": "--number --body",
    },
    "issue-close": {"desc": "Close issue", "opts": "--number NUM", "req": "--number"},
    "issue-edit": {
        "desc": "Edit issue",
        "opts": "--number NUM [--title TEXT] [--body TEXT] [--labels TEXT]",
        "req": "--number",
    },
    "issue-reopen": {"desc": "Reopen issue", "opts": "--number NUM", "req": "--number"},
    "issue-pin": {"desc": "Pin issue", "opts": "--number NUM", "req": "--number"},
    # PRs
    "pr-list": {
        "desc": "List pull requests",
        "opts": "[--state open|closed|all] [--limit NUM]",
        "req": "",
    },
    "pr-view": {"desc": "View PR details", "opts": "--number NUM", "req": "--number"},
    "pr-create": {
        "desc": "Create pull request",
        "opts": "--title TEXT [--body TEXT] [--base BRANCH]",
        "req": "--title",
    },
    "pr-diff": {"desc": "Get PR diff", "opts": "--number NUM", "req": "--number"},
    "pr-files": {"desc": "List PR files", "opts": "--number NUM", "req": "--number"},
    "pr-checks": {"desc": "View PR checks", "opts": "--number NUM", "req": "--number"},
    "pr-edit": {
        "desc": "Edit PR",
        "opts": "--number NUM [--title TEXT] [--body TEXT] [--labels TEXT]",
        "req": "--number",
    },
    "pr-close": {"desc": "Close PR", "opts": "--number NUM", "req": "--number"},
    "pr-ready": {"desc": "Mark PR ready", "opts": "--number NUM", "req": "--number"},
    "pr-merge": {
        "desc": "Merge PR (squash)",
        "opts": "--number NUM",
        "req": "--number",
    },
    "pr-review": {
        "desc": "Review PR",
        "opts": "--number NUM --event APPROVE|REQUEST_CHANGES|COMMENT [--body TEXT]",
        "req": "--number --event",
    },
    # Workflows
    "workflow-list": {"desc": "List workflows", "opts": "", "req": ""},
    "workflow-view": {
        "desc": "View workflow YAML",
        "opts": "--workflow NAME",
        "req": "--workflow",
    },
    "workflow-run": {
        "desc": "Trigger workflow",
        "opts": "--workflow NAME [--ref BRANCH]",
        "req": "--workflow",
    },
    "run-list": {"desc": "List workflow runs", "opts": "[--limit NUM]", "req": ""},
    "run-view": {"desc": "View run details", "opts": "--run-id NUM", "req": "--run-id"},
    "run-logs": {
        "desc": "Get run logs",
        "opts": "--run-id NUM [--failed]",
        "req": "--run-id",
    },
    "run-rerun": {
        "desc": "Rerun failed jobs",
        "opts": "--run-id NUM",
        "req": "--run-id",
    },
    "run-cancel": {"desc": "Cancel run", "opts": "--run-id NUM", "req": "--run-id"},
    # Projects
    "project-list": {"desc": "List projects", "opts": "[--owner NAME]", "req": ""},
    "project-view": {
        "desc": "View project",
        "opts": "--project NUM [--owner NAME]",
        "req": "--project",
    },
    "project-item-list": {
        "desc": "List project items",
        "opts": "--project NUM [--owner NAME]",
        "req": "--project",
    },
    # Releases
    "release-list": {"desc": "List releases", "opts": "[--limit NUM]", "req": ""},
    "release-view": {"desc": "View release", "opts": "--tag NAME", "req": "--tag"},
    # Cache & Labels
    "cache-list": {"desc": "List caches", "opts": "[--limit NUM]", "req": ""},
    "cache-delete": {
        "desc": "Delete cache",
        "opts": "--cache-key KEY",
        "req": "--cache-key",
    },
    "label-list": {"desc": "List labels", "opts": "", "req": ""},
    # Search
    "search-repos": {
        "desc": "Search repositories",
        "opts": "--query TEXT [--limit NUM]",
        "req": "--query",
    },
    "search-code": {
        "desc": "Search code",
        "opts": "--query TEXT [--limit NUM]",
        "req": "--query",
    },
    "search-issues": {
        "desc": "Search issues",
        "opts": "--query TEXT [--limit NUM]",
        "req": "--query",
    },
    # Utility
    "repo-view": {"desc": "View repository", "opts": "[--repo NAME]", "req": ""},
    "api": {
        "desc": "Raw API call",
        "opts": "--endpoint PATH [--method GET|POST|PUT|DELETE]",
        "req": "--endpoint",
    },
}

REQUIRED: Final[dict[str, tuple[str, ...]]] = {
    "issue-view": ("number",),
    "issue-create": ("title",),
    "issue-comment": ("number", "body"),
    "issue-close": ("number",),
    "issue-edit": ("number",),
    "issue-reopen": ("number",),
    "issue-pin": ("number",),
    "pr-view": ("number",),
    "pr-files": ("number",),
    "pr-checks": ("number",),
    "pr-merge": ("number",),
    "pr-review": ("number", "event"),
    "pr-create": ("title",),
    "pr-diff": ("number",),
    "pr-edit": ("number",),
    "pr-close": ("number",),
    "pr-ready": ("number",),
    "run-view": ("run_id",),
    "run-logs": ("run_id",),
    "run-rerun": ("run_id",),
    "run-cancel": ("run_id",),
    "cache-delete": ("cache_key",),
    "workflow-view": ("workflow",),
    "workflow-run": ("workflow",),
    "project-view": ("project",),
    "project-item-list": ("project",),
    "release-view": ("tag",),
    "search-repos": ("query",),
    "search-code": ("query",),
    "search-issues": ("query",),
    "api": ("endpoint",),
}


# --- [PURE_FUNCTIONS] ---------------------------------------------------------
def _usage_error(message: str, cmd: str | None = None) -> dict[str, Any]:
    """Generates usage error for correct syntax."""
    lines = [f"[ERROR] {message}", "", "[USAGE]"]

    if cmd and cmd in COMMANDS:
        info = COMMANDS[cmd]
        lines.append(f"  {SCRIPT_PATH} {cmd} {info['opts']}")
        if info["req"]:
            lines.append(f"  Required: {info['req']}")
    else:
        lines.append(f"  {SCRIPT_PATH} <command> [options]")
        lines.append("")
        lines.append("[COMMON_COMMANDS]")
        common = ["issue-list", "pr-list", "run-list", "workflow-list", "label-list"]
        for name in common:
            lines.append(f"  {name:<16} {COMMANDS[name]['desc']}")
        lines.append("")
        lines.append("[EXAMPLES]")
        lines.append(f"  {SCRIPT_PATH} issue-list")
        lines.append(f"  {SCRIPT_PATH} pr-list --state open")
        lines.append(f"  {SCRIPT_PATH} issue-view --number 42")
        lines.append(f"  {SCRIPT_PATH} run-list --limit 10")

    return {"status": "error", "message": "\n".join(lines)}


def _validate_args(cmd: str, args: Args) -> list[str]:
    """Returns missing required arguments for command."""
    return [
        f"--{k.replace('_', '-')}" for k in REQUIRED.get(cmd, ()) if args.get(k) is None
    ]


def _mk_edit_flags(args: Args) -> tuple[str, ...]:
    """Generates conditional edit flags for pr-edit and issue-edit."""
    return (
        *(f"--title={args['title']}" for _ in [1] if args.get("title")),
        *(f"--body={args['body']}" for _ in [1] if args.get("body")),
        *(f"--add-label={args['labels']}" for _ in [1] if args.get("labels")),
    )


def _action_fmt(action: str) -> OutputFormatter:
    """Creates boolean action formatters (merged, closed, ready, etc)."""
    return lambda o, a: {"number": a["number"], action: True}


def _list_handler(resource: str, fields: str, key: str) -> Handler:
    """Creates list handlers (issue-list, pr-list, run-list)."""
    return (
        lambda a: (
            "gh",
            resource,
            "list",
            f"--state={a.get('state', B.state)}",
            f"--limit={a.get('limit', B.limit)}",
            f"--json={fields}",
        ),
        lambda o, a: {"state": a.get("state", B.state), key: json.loads(o)},
    )


def _search_handler(resource: str, fields: str, key: str) -> Handler:
    """Creates search handlers (search-repos, search-code, search-issues)."""
    return (
        lambda a: (
            "gh",
            "search",
            resource,
            a["query"],
            f"--limit={a.get('limit', B.limit)}",
            f"--json={fields}",
        ),
        lambda o, a: {"query": a["query"], key: json.loads(o)},
    )


# --- [DISPATCH_TABLES] --------------------------------------------------------
handlers: dict[str, Handler] = {
    "issue-list": _list_handler(
        "issue", "number,title,state,labels,createdAt,author", "issues"
    ),
    "issue-view": (
        lambda a: (
            "gh",
            "issue",
            "view",
            str(a["number"]),
            "--json=number,title,body,state,labels,comments,author,createdAt",
        ),
        lambda o, a: {"number": a["number"], "issue": json.loads(o)},
    ),
    "issue-create": (
        lambda a: (
            "gh",
            "issue",
            "create",
            f"--title={a['title']}",
            f"--body={a.get('body', B.empty_body)}",
            "--json=number,url",
        ),
        lambda o, a: {"created": json.loads(o)},
    ),
    "issue-comment": (
        lambda a: ("gh", "issue", "comment", str(a["number"]), f"--body={a['body']}"),
        _action_fmt("commented"),
    ),
    "pr-list": _list_handler(
        "pr", "number,title,state,headRefName,author,createdAt", "pulls"
    ),
    "pr-view": (
        lambda a: (
            "gh",
            "pr",
            "view",
            str(a["number"]),
            "--json=number,title,body,state,headRefName,baseRefName,commits,files,reviews,comments",
        ),
        lambda o, a: {"number": a["number"], "pull": json.loads(o)},
    ),
    "pr-files": (
        lambda a: ("gh", "pr", "view", str(a["number"]), "--json=files"),
        lambda o, a: {"number": a["number"], "files": json.loads(o).get("files", [])},
    ),
    "pr-checks": (
        lambda a: (
            "gh",
            "pr",
            "checks",
            str(a["number"]),
            "--json=name,state,workflow,link",
        ),
        lambda o, a: {"number": a["number"], "checks": json.loads(o)},
    ),
    "pr-merge": (
        lambda a: (
            "gh",
            "pr",
            "merge",
            str(a["number"]),
            "--squash",
            "--delete-branch",
        ),
        _action_fmt("merged"),
    ),
    "pr-review": (
        lambda a: (
            "gh",
            "pr",
            "review",
            str(a["number"]),
            f"--{a['event'].lower()}",
            f"--body={a.get('body', B.empty_body)}",
        ),
        lambda o, a: {"number": a["number"], "event": a["event"], "reviewed": True},
    ),
    "search-repos": _search_handler(
        "repos", "fullName,description,stargazersCount,url", "repos"
    ),
    "search-code": _search_handler("code", "path,repository,textMatches", "matches"),
    "search-issues": _search_handler(
        "issues", "number,title,repository,state,url", "issues"
    ),
    "repo-view": (
        lambda a: (
            "gh",
            "repo",
            "view",
            a.get("repo", B.empty_body),
            "--json=name,description,defaultBranchRef,stargazerCount,url",
        ),
        lambda o, a: {"repo": json.loads(o)},
    ),
    "run-list": (
        lambda a: (
            "gh",
            "run",
            "list",
            f"--limit={a.get('limit', B.limit)}",
            "--json=databaseId,displayTitle,status,conclusion,workflowName,createdAt,headBranch",
        ),
        lambda o, a: {"runs": json.loads(o)},
    ),
    "run-view": (
        lambda a: (
            "gh",
            "run",
            "view",
            str(a["run_id"]),
            "--json=databaseId,displayTitle,status,conclusion,jobs,createdAt,updatedAt",
        ),
        lambda o, a: {"run_id": a["run_id"], "run": json.loads(o)},
    ),
    "run-logs": (
        lambda a: (
            "gh",
            "run",
            "view",
            str(a["run_id"]),
            "--log-failed" if a.get("failed") else "--log",
        ),
        lambda o, a: {"run_id": a["run_id"], "logs": o},
    ),
    "run-rerun": (
        lambda a: ("gh", "run", "rerun", str(a["run_id"]), "--failed"),
        lambda o, a: {"run_id": a["run_id"], "rerun": True},
    ),
    "cache-list": (
        lambda a: (
            "gh",
            "cache",
            "list",
            f"--limit={a.get('limit', B.limit)}",
            "--json=id,key,sizeInBytes,createdAt,lastAccessedAt",
        ),
        lambda o, a: {"caches": json.loads(o)},
    ),
    "cache-delete": (
        lambda a: ("gh", "cache", "delete", a["cache_key"], "--confirm"),
        lambda o, a: {"cache_key": a["cache_key"], "deleted": True},
    ),
    "label-list": (
        lambda a: ("gh", "label", "list", "--json=name,description,color"),
        lambda o, a: {"labels": json.loads(o)},
    ),
    # --- [WORKFLOWS] ----------------------------------------------------------
    "workflow-list": (
        lambda a: ("gh", "workflow", "list", "--json=id,name,path,state"),
        lambda o, a: {"workflows": json.loads(o)},
    ),
    "workflow-view": (
        lambda a: ("gh", "workflow", "view", a["workflow"], "--yaml"),
        lambda o, a: {"workflow": a["workflow"], "yaml": o.strip()},
    ),
    "workflow-run": (
        lambda a: (
            "gh",
            "workflow",
            "run",
            a["workflow"],
            f"--ref={a.get('ref', B.default_branch)}",
        ),
        lambda o, a: {
            "workflow": a["workflow"],
            "ref": a.get("ref", B.default_branch),
            "triggered": True,
        },
    ),
    "run-cancel": (
        lambda a: ("gh", "run", "cancel", str(a["run_id"])),
        lambda o, a: {"run_id": a["run_id"], "cancelled": True},
    ),
    # --- [PR_LIFECYCLE] -------------------------------------------------------
    "pr-create": (
        lambda a: (
            "gh",
            "pr",
            "create",
            f"--title={a['title']}",
            f"--body={a.get('body', B.empty_body)}",
            f"--base={a.get('base', B.default_branch)}",
            "--json=number,url",
        ),
        lambda o, a: {"created": json.loads(o)},
    ),
    "pr-diff": (
        lambda a: ("gh", "pr", "diff", str(a["number"]), "--patch"),
        lambda o, a: {"number": a["number"], "diff": o},
    ),
    "pr-edit": (
        lambda a: (
            "gh",
            "pr",
            "edit",
            str(a["number"]),
            *_mk_edit_flags(a),
        ),
        _action_fmt("edited"),
    ),
    "pr-close": (
        lambda a: ("gh", "pr", "close", str(a["number"])),
        _action_fmt("closed"),
    ),
    "pr-ready": (
        lambda a: ("gh", "pr", "ready", str(a["number"])),
        _action_fmt("ready"),
    ),
    # --- [ISSUE_LIFECYCLE] ----------------------------------------------------
    "issue-close": (
        lambda a: ("gh", "issue", "close", str(a["number"])),
        _action_fmt("closed"),
    ),
    "issue-edit": (
        lambda a: (
            "gh",
            "issue",
            "edit",
            str(a["number"]),
            *_mk_edit_flags(a),
        ),
        _action_fmt("edited"),
    ),
    "issue-reopen": (
        lambda a: ("gh", "issue", "reopen", str(a["number"])),
        _action_fmt("reopened"),
    ),
    "issue-pin": (
        lambda a: ("gh", "issue", "pin", str(a["number"])),
        _action_fmt("pinned"),
    ),
    # --- [PROJECTS] -----------------------------------------------------------
    "project-list": (
        lambda a: (
            "gh",
            "project",
            "list",
            f"--owner={a.get('owner', B.default_owner)}",
            "--format=json",
        ),
        lambda o, a: {
            "owner": a.get("owner", B.default_owner),
            "projects": json.loads(o),
        },
    ),
    "project-view": (
        lambda a: (
            "gh",
            "project",
            "view",
            str(a["project"]),
            f"--owner={a.get('owner', B.default_owner)}",
            "--format=json",
        ),
        lambda o, a: {"project": a["project"], "details": json.loads(o)},
    ),
    "project-item-list": (
        lambda a: (
            "gh",
            "project",
            "item-list",
            str(a["project"]),
            f"--owner={a.get('owner', B.default_owner)}",
            "--format=json",
        ),
        lambda o, a: {"project": a["project"], "items": json.loads(o)},
    ),
    # --- [RELEASES] -----------------------------------------------------------
    "release-list": (
        lambda a: (
            "gh",
            "release",
            "list",
            f"--limit={a.get('limit', B.limit)}",
            "--json=tagName,name,isDraft,isPrerelease,publishedAt",
        ),
        lambda o, a: {"releases": json.loads(o)},
    ),
    "release-view": (
        lambda a: (
            "gh",
            "release",
            "view",
            a["tag"],
            "--json=tagName,name,body,isDraft,isPrerelease,publishedAt,assets",
        ),
        lambda o, a: {"tag": a["tag"], "release": json.loads(o)},
    ),
    # --- [RAW_API] ------------------------------------------------------------
    "api": (
        lambda a: (
            "gh",
            "api",
            a["endpoint"],
            "--method",
            a.get("method", B.api_method),
        ),
        lambda o, a: {
            "endpoint": a["endpoint"],
            "response": json.loads(o)
            if o.strip().startswith(("{", "["))
            else o.strip(),
        },
    ),
}


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """CLI entry point — zero-arg defaults, optional filters."""
    if not (args := sys.argv[1:]) or args[0] in ("-h", "--help"):
        print(json.dumps(_usage_error("No command specified"), indent=2))
        return 1

    if (cmd := args[0]) not in COMMANDS:
        print(json.dumps(_usage_error(f"Unknown command: {cmd}"), indent=2))
        return 1

    opts: dict[str, Any] = {}
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
    r = subprocess.run(builder(opts), capture_output=True, text=True)
    result = (
        {"status": "success", **formatter(r.stdout or r.stderr, opts)}
        if r.returncode == 0
        else {
            "status": "error",
            "message": f"{cmd} failed",
            "stderr": r.stderr,
        }
    )
    print(json.dumps(result, indent=2))
    return 0 if r.returncode == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
