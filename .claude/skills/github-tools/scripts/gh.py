#!/usr/bin/env -S uv run --quiet --script
# /// script
# ///
"""GitHub CLI — unified polymorphic interface for zero-arg defaults."""

# --- [IMPORTS] ----------------------------------------------------------------
import json
import os
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
    "project-create": {
        "desc": "Create new project",
        "opts": "--title TEXT [--owner NAME]",
        "req": "--title",
    },
    "project-close": {
        "desc": "Close project",
        "opts": "--project NUM [--owner NAME]",
        "req": "--project",
    },
    "project-delete": {
        "desc": "Delete project",
        "opts": "--project NUM [--owner NAME]",
        "req": "--project",
    },
    "project-item-add": {
        "desc": "Add issue/PR to project",
        "opts": "--project NUM --url URL [--owner NAME]",
        "req": "--project --url",
    },
    "project-item-edit": {
        "desc": "Edit project item field",
        "opts": "--id ITEM_ID --project-id PROJECT_NODE_ID --field-id FIELD_ID [--text TEXT] [--number NUM] [--date DATE] [--single-select-option-id ID] [--iteration-id ID]",
        "req": "--id --project-id --field-id",
    },
    "project-item-delete": {
        "desc": "Remove item from project",
        "opts": "--project NUM --id ITEM_ID [--owner NAME]",
        "req": "--project --id",
    },
    "project-item-archive": {
        "desc": "Archive project item",
        "opts": "--project NUM --id ITEM_ID [--owner NAME]",
        "req": "--project --id",
    },
    "project-field-list": {
        "desc": "List project fields",
        "opts": "--project NUM [--owner NAME]",
        "req": "--project",
    },
    "project-field-create": {
        "desc": "Create custom field",
        "opts": "--project NUM --name TEXT --data-type TYPE [--single-select-options CSV] [--owner NAME]",
        "req": "--project --name --data-type",
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
    # Discussions
    "discussion-list": {
        "desc": "List discussions",
        "opts": "[--category NAME] [--limit NUM] [--answered]",
        "req": "",
    },
    "discussion-view": {
        "desc": "View discussion",
        "opts": "--number NUM",
        "req": "--number",
    },
    "discussion-comment": {
        "desc": "Comment on discussion",
        "opts": "--discussion-id ID --body TEXT [--reply-to ID]",
        "req": "--discussion-id --body",
    },
    "discussion-category-list": {
        "desc": "List discussion categories",
        "opts": "",
        "req": "",
    },
    "discussion-pinned": {
        "desc": "List pinned discussions",
        "opts": "",
        "req": "",
    },
    "discussion-create": {
        "desc": "Create discussion",
        "opts": "--category-id ID --title TEXT --body TEXT",
        "req": "--category-id --title --body",
    },
    "discussion-update": {
        "desc": "Update discussion",
        "opts": "--discussion-id ID [--title TEXT] [--body TEXT] [--category-id ID]",
        "req": "--discussion-id",
    },
    "discussion-delete": {
        "desc": "Delete discussion",
        "opts": "--discussion-id ID",
        "req": "--discussion-id",
    },
    "discussion-close": {
        "desc": "Close discussion",
        "opts": "--discussion-id ID [--reason RESOLVED|OUTDATED|DUPLICATE]",
        "req": "--discussion-id",
    },
    "discussion-reopen": {
        "desc": "Reopen discussion",
        "opts": "--discussion-id ID",
        "req": "--discussion-id",
    },
    "discussion-lock": {
        "desc": "Lock discussion",
        "opts": "--discussion-id ID [--reason OFF_TOPIC|TOO_HEATED|RESOLVED|SPAM]",
        "req": "--discussion-id",
    },
    "discussion-unlock": {
        "desc": "Unlock discussion",
        "opts": "--discussion-id ID",
        "req": "--discussion-id",
    },
    "discussion-comment-update": {
        "desc": "Update discussion comment",
        "opts": "--comment-id ID --body TEXT",
        "req": "--comment-id --body",
    },
    "discussion-comment-delete": {
        "desc": "Delete discussion comment",
        "opts": "--comment-id ID",
        "req": "--comment-id",
    },
    "discussion-mark-answer": {
        "desc": "Mark comment as answer",
        "opts": "--comment-id ID",
        "req": "--comment-id",
    },
    "discussion-unmark-answer": {
        "desc": "Unmark comment as answer",
        "opts": "--comment-id ID",
        "req": "--comment-id",
    },
    "discussion-add-label": {
        "desc": "Add labels to discussion",
        "opts": "--discussion-id ID --label-ids IDS",
        "req": "--discussion-id --label-ids",
    },
    "discussion-remove-label": {
        "desc": "Remove labels from discussion",
        "opts": "--discussion-id ID --label-ids IDS",
        "req": "--discussion-id --label-ids",
    },
    "discussion-react": {
        "desc": "React to discussion/comment",
        "opts": "--subject-id ID --reaction THUMBS_UP|THUMBS_DOWN|LAUGH|HOORAY|CONFUSED|HEART|ROCKET|EYES",
        "req": "--subject-id --reaction",
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
    "project-create": ("title",),
    "project-close": ("project",),
    "project-delete": ("project",),
    "project-item-add": ("project", "url"),
    "project-item-edit": ("id", "project_id", "field_id"),
    "project-item-delete": ("project", "id"),
    "project-item-archive": ("project", "id"),
    "project-field-list": ("project",),
    "project-field-create": ("project", "name", "data_type"),
    "release-view": ("tag",),
    "search-repos": ("query",),
    "search-code": ("query",),
    "search-issues": ("query",),
    "discussion-view": ("number",),
    "discussion-comment": ("discussion_id", "body"),
    "discussion-create": ("category_id", "title", "body"),
    "discussion-update": ("discussion_id",),
    "discussion-delete": ("discussion_id",),
    "discussion-close": ("discussion_id",),
    "discussion-reopen": ("discussion_id",),
    "discussion-lock": ("discussion_id",),
    "discussion-unlock": ("discussion_id",),
    "discussion-comment-update": ("comment_id", "body"),
    "discussion-comment-delete": ("comment_id",),
    "discussion-mark-answer": ("comment_id",),
    "discussion-unmark-answer": ("comment_id",),
    "discussion-add-label": ("discussion_id", "label_ids"),
    "discussion-remove-label": ("discussion_id", "label_ids"),
    "discussion-react": ("subject_id", "reaction"),
    "api": ("endpoint",),
}


# --- [PURE_FUNCTIONS] ---------------------------------------------------------
def _repo_vars() -> tuple[str, ...]:
    """Returns GraphQL owner/repo variable args for current repository."""
    r = subprocess.run(("gh", "repo", "view", "--json=owner,name"), capture_output=True, text=True)
    d = json.loads(r.stdout) if r.returncode == 0 else {}
    owner, repo = d.get("owner", {}).get("login", ""), d.get("name", "")
    return ("-f", f"owner={owner}", "-f", f"repo={repo}")


def _get_repo_id() -> str:
    """Returns repository node ID for GraphQL mutations."""
    r = subprocess.run(("gh", "repo", "view", "--json=id"), capture_output=True, text=True)
    return json.loads(r.stdout).get("id", "") if r.returncode == 0 else ""


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


def _mk_project_value_flags(args: Args) -> tuple[str, ...]:
    """Generates conditional field value flags for project-item-edit."""
    return (
        *(f"--text={args['text']}" for _ in [1] if args.get("text")),
        *(f"--number={args['number']}" for _ in [1] if args.get("number")),
        *(f"--date={args['date']}" for _ in [1] if args.get("date")),
        *(f"--single-select-option-id={args['single_select_option_id']}" for _ in [1] if args.get("single_select_option_id")),
        *(f"--iteration-id={args['iteration_id']}" for _ in [1] if args.get("iteration_id")),
    )


def _action_fmt(action: str) -> OutputFormatter:
    """Creates boolean action formatters (merged, closed, ready, etc)."""
    return lambda o, a: {"number": a["number"], action: True}


def _get_env(cmd: str) -> dict[str, str] | None:
    """Returns env with GH_PROJECTS_TOKEN for project commands, None otherwise."""
    return (
        {**os.environ, "GH_TOKEN": os.environ["GH_PROJECTS_TOKEN"]}
        if cmd.startswith("project-") and os.environ.get("GH_PROJECTS_TOKEN")
        else None
    )


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
    # --- [PROJECTS_V2] --------------------------------------------------------
    "project-list": (
        lambda a: (
            "gh", "project", "list",
            f"--owner={a.get('owner', B.default_owner)}",
            "--format=json",
        ),
        lambda o, a: {"owner": a.get("owner", B.default_owner), "projects": json.loads(o)},
    ),
    "project-view": (
        lambda a: (
            "gh", "project", "view",
            str(a["project"]),
            f"--owner={a.get('owner', B.default_owner)}",
            "--format=json",
        ),
        lambda o, a: {"project": a["project"], "details": json.loads(o)},
    ),
    "project-item-list": (
        lambda a: (
            "gh", "project", "item-list",
            str(a["project"]),
            f"--owner={a.get('owner', B.default_owner)}",
            "--format=json",
        ),
        lambda o, a: {"project": a["project"], "items": json.loads(o)},
    ),
    "project-create": (
        lambda a: (
            "gh", "project", "create",
            f"--owner={a.get('owner', B.default_owner)}",
            f"--title={a['title']}",
            "--format=json",
        ),
        lambda o, a: {"created": json.loads(o)},
    ),
    "project-close": (
        lambda a: (
            "gh", "project", "close",
            str(a["project"]),
            f"--owner={a.get('owner', B.default_owner)}",
        ),
        lambda o, a: {"project": a["project"], "closed": True},
    ),
    "project-delete": (
        lambda a: (
            "gh", "project", "delete",
            str(a["project"]),
            f"--owner={a.get('owner', B.default_owner)}",
        ),
        lambda o, a: {"project": a["project"], "deleted": True},
    ),
    "project-item-add": (
        lambda a: (
            "gh", "project", "item-add",
            str(a["project"]),
            f"--owner={a.get('owner', B.default_owner)}",
            f"--url={a['url']}",
            "--format=json",
        ),
        lambda o, a: {"project": a["project"], "item": json.loads(o)},
    ),
    "project-item-edit": (
        lambda a: (
            "gh", "project", "item-edit",
            "--id", a["id"],
            "--project-id", a["project_id"],
            "--field-id", a["field_id"],
            *_mk_project_value_flags(a),
            "--format=json",
        ),
        lambda o, a: {"id": a["id"], "updated": True},
    ),
    "project-item-delete": (
        lambda a: (
            "gh", "project", "item-delete",
            str(a["project"]),
            f"--owner={a.get('owner', B.default_owner)}",
            "--id", a["id"],
        ),
        lambda o, a: {"id": a["id"], "deleted": True},
    ),
    "project-item-archive": (
        lambda a: (
            "gh", "project", "item-archive",
            str(a["project"]),
            f"--owner={a.get('owner', B.default_owner)}",
            "--id", a["id"],
        ),
        lambda o, a: {"id": a["id"], "archived": True},
    ),
    "project-field-list": (
        lambda a: (
            "gh", "project", "field-list",
            str(a["project"]),
            f"--owner={a.get('owner', B.default_owner)}",
            "--format=json",
        ),
        lambda o, a: {"project": a["project"], "fields": json.loads(o)},
    ),
    "project-field-create": (
        lambda a: (
            "gh", "project", "field-create",
            str(a["project"]),
            f"--owner={a.get('owner', B.default_owner)}",
            f"--name={a['name']}",
            f"--data-type={a['data_type']}",
            *(f"--single-select-options={a['single_select_options']}" for _ in [1] if a.get("single_select_options")),
            "--format=json",
        ),
        lambda o, a: {"project": a["project"], "field": json.loads(o)},
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
    # --- [DISCUSSIONS] --------------------------------------------------------
    "discussion-list": (
        lambda a: (
            "gh", "api", "graphql",
            "-f", f"query=query($owner:String!,$repo:String!,$limit:Int!{',_$cat:ID' if a.get('category') else ''}{',_$ans:Boolean' if a.get('answered') else ''}){{repository(owner:$owner,name:$repo){{discussions(first:$limit{',categoryId:$cat' if a.get('category') else ''}{',answered:$ans' if a.get('answered') else ''}){{nodes{{number title body author{{login}}category{{name id}}createdAt updatedAt isAnswered locked labels(first:10){{nodes{{name}}}}}}pageInfo{{hasNextPage endCursor}}}}}}}}",
            *_repo_vars(),
            "-F", f"limit={a.get('limit', B.limit)}",
            *(("-f", f"cat={a['category']}") if a.get("category") else ()),
            *(("-F", "ans=true") if a.get("answered") else ()),
        ),
        lambda o, a: {"discussions": json.loads(o).get("data", {}).get("repository", {}).get("discussions", {}).get("nodes", [])},
    ),
    "discussion-view": (
        lambda a: (
            "gh", "api", "graphql",
            "-f", "query=query($owner:String!,$repo:String!,$num:Int!){repository(owner:$owner,name:$repo){discussion(number:$num){id number title body author{login}category{name id}createdAt labels(first:10){nodes{name}}answer{author{login}body createdAt}reactionGroups{content users{totalCount}}comments(first:100){nodes{id body author{login}createdAt reactionGroups{content users{totalCount}}replies(first:50){nodes{id body author{login}createdAt}}}}}}}",
            *_repo_vars(),
            "-F", f"num={a['number']}",
        ),
        lambda o, a: {"number": a["number"], "discussion": json.loads(o).get("data", {}).get("repository", {}).get("discussion", {})},
    ),
    "discussion-comment": (
        lambda a: (
            "gh", "api", "graphql",
            "-f", f"query=mutation($id:ID!,$body:String!{',_$reply:ID' if a.get('reply_to') else ''}){{addDiscussionComment(input:{{discussionId:$id,body:$body{',replyToId:$reply' if a.get('reply_to') else ''}}}){{comment{{id}}}}}}",
            "-f", f"id={a['discussion_id']}",
            "-f", f"body={a['body']}",
            *(("-f", f"reply={a['reply_to']}") if a.get("reply_to") else ()),
        ),
        lambda o, a: {"discussion_id": a["discussion_id"], "commented": True, "response": json.loads(o)},
    ),
    "discussion-category-list": (
        lambda a: (
            "gh", "api", "graphql",
            "-f", "query=query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){discussionCategories(first:25){nodes{id name emoji description isAnswerable}}}}",
            *_repo_vars(),
        ),
        lambda o, a: {"categories": json.loads(o).get("data", {}).get("repository", {}).get("discussionCategories", {}).get("nodes", [])},
    ),
    "discussion-pinned": (
        lambda a: (
            "gh", "api", "graphql",
            "-f", "query=query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){pinnedDiscussions(first:10){nodes{discussion{number title}pinnedBy{login}}}}}",
            *_repo_vars(),
        ),
        lambda o, a: {"pinned": json.loads(o).get("data", {}).get("repository", {}).get("pinnedDiscussions", {}).get("nodes", [])},
    ),
    "discussion-create": (
        lambda a: (
            "gh", "api", "graphql",
            "-f", "query=mutation($repoId:ID!,$catId:ID!,$title:String!,$body:String!){createDiscussion(input:{repositoryId:$repoId,categoryId:$catId,title:$title,body:$body}){discussion{id number url}}}",
            "-f", f"repoId={_get_repo_id()}",
            "-f", f"catId={a['category_id']}",
            "-f", f"title={a['title']}",
            "-f", f"body={a['body']}",
        ),
        lambda o, a: {"created": json.loads(o).get("data", {}).get("createDiscussion", {}).get("discussion", {})},
    ),
    "discussion-update": (
        lambda a: (
            "gh", "api", "graphql",
            "-f", f"query=mutation($id:ID!{',_$title:String' if a.get('title') else ''}{',_$body:String' if a.get('body') else ''}{',_$catId:ID' if a.get('category_id') else ''}){{updateDiscussion(input:{{discussionId:$id{',title:$title' if a.get('title') else ''}{',body:$body' if a.get('body') else ''}{',categoryId:$catId' if a.get('category_id') else ''}}}){{discussion{{id}}}}}}",
            "-f", f"id={a['discussion_id']}",
            *(("-f", f"title={a['title']}") if a.get("title") else ()),
            *(("-f", f"body={a['body']}") if a.get("body") else ()),
            *(("-f", f"catId={a['category_id']}") if a.get("category_id") else ()),
        ),
        lambda o, a: {"discussion_id": a["discussion_id"], "updated": True},
    ),
    "discussion-delete": (
        lambda a: (
            "gh", "api", "graphql",
            "-f", "query=mutation($id:ID!){deleteDiscussion(input:{id:$id}){discussion{id}}}",
            "-f", f"id={a['discussion_id']}",
        ),
        lambda o, a: {"discussion_id": a["discussion_id"], "deleted": True},
    ),
    "discussion-close": (
        lambda a: (
            "gh", "api", "graphql",
            "-f", f"query=mutation($id:ID!{',_$reason:DiscussionCloseReason' if a.get('reason') else ''}){{closeDiscussion(input:{{discussionId:$id{',reason:$reason' if a.get('reason') else ''}}}){{discussion{{id}}}}}}",
            "-f", f"id={a['discussion_id']}",
            *(("-f", f"reason={a['reason']}") if a.get("reason") else ()),
        ),
        lambda o, a: {"discussion_id": a["discussion_id"], "closed": True},
    ),
    "discussion-reopen": (
        lambda a: (
            "gh", "api", "graphql",
            "-f", "query=mutation($id:ID!){reopenDiscussion(input:{discussionId:$id}){discussion{id}}}",
            "-f", f"id={a['discussion_id']}",
        ),
        lambda o, a: {"discussion_id": a["discussion_id"], "reopened": True},
    ),
    "discussion-lock": (
        lambda a: (
            "gh", "api", "graphql",
            "-f", f"query=mutation($id:ID!{',_$reason:LockReason' if a.get('reason') else ''}){{lockLockable(input:{{lockableId:$id{',lockReason:$reason' if a.get('reason') else ''}}}){{lockedRecord{{...on Discussion{{id}}}}}}}}",
            "-f", f"id={a['discussion_id']}",
            *(("-f", f"reason={a['reason']}") if a.get("reason") else ()),
        ),
        lambda o, a: {"discussion_id": a["discussion_id"], "locked": True},
    ),
    "discussion-unlock": (
        lambda a: (
            "gh", "api", "graphql",
            "-f", "query=mutation($id:ID!){unlockLockable(input:{lockableId:$id}){unlockedRecord{...on Discussion{id}}}}",
            "-f", f"id={a['discussion_id']}",
        ),
        lambda o, a: {"discussion_id": a["discussion_id"], "unlocked": True},
    ),
    "discussion-comment-update": (
        lambda a: (
            "gh", "api", "graphql",
            "-f", "query=mutation($id:ID!,$body:String!){updateDiscussionComment(input:{commentId:$id,body:$body}){comment{id}}}",
            "-f", f"id={a['comment_id']}",
            "-f", f"body={a['body']}",
        ),
        lambda o, a: {"comment_id": a["comment_id"], "updated": True},
    ),
    "discussion-comment-delete": (
        lambda a: (
            "gh", "api", "graphql",
            "-f", "query=mutation($id:ID!){deleteDiscussionComment(input:{id:$id}){comment{id}}}",
            "-f", f"id={a['comment_id']}",
        ),
        lambda o, a: {"comment_id": a["comment_id"], "deleted": True},
    ),
    "discussion-mark-answer": (
        lambda a: (
            "gh", "api", "graphql",
            "-f", "query=mutation($id:ID!){markDiscussionCommentAsAnswer(input:{id:$id}){discussion{id}}}",
            "-f", f"id={a['comment_id']}",
        ),
        lambda o, a: {"comment_id": a["comment_id"], "marked_answer": True},
    ),
    "discussion-unmark-answer": (
        lambda a: (
            "gh", "api", "graphql",
            "-f", "query=mutation($id:ID!){unmarkDiscussionCommentAsAnswer(input:{id:$id}){discussion{id}}}",
            "-f", f"id={a['comment_id']}",
        ),
        lambda o, a: {"comment_id": a["comment_id"], "unmarked_answer": True},
    ),
    "discussion-add-label": (
        lambda a: (
            "gh", "api", "graphql",
            "-f", "query=mutation($id:ID!,$labelIds:[ID!]!){addLabelsToLabelable(input:{labelableId:$id,labelIds:$labelIds}){labelable{...on Discussion{id}}}}",
            "-f", f"id={a['discussion_id']}",
            "-f", f"labelIds={a['label_ids']}",
        ),
        lambda o, a: {"discussion_id": a["discussion_id"], "labels_added": True},
    ),
    "discussion-remove-label": (
        lambda a: (
            "gh", "api", "graphql",
            "-f", "query=mutation($id:ID!,$labelIds:[ID!]!){removeLabelsFromLabelable(input:{labelableId:$id,labelIds:$labelIds}){labelable{...on Discussion{id}}}}",
            "-f", f"id={a['discussion_id']}",
            "-f", f"labelIds={a['label_ids']}",
        ),
        lambda o, a: {"discussion_id": a["discussion_id"], "labels_removed": True},
    ),
    "discussion-react": (
        lambda a: (
            "gh", "api", "graphql",
            "-f", "query=mutation($id:ID!,$content:ReactionContent!){addReaction(input:{subjectId:$id,content:$content}){reaction{id}}}",
            "-f", f"id={a['subject_id']}",
            "-f", f"content={a['reaction']}",
        ),
        lambda o, a: {"subject_id": a["subject_id"], "reaction": a["reaction"], "reacted": True},
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
    r = subprocess.run(builder(opts), capture_output=True, text=True, env=_get_env(cmd))
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
