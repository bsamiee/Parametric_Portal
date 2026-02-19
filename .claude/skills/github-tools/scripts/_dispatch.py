# ruff: noqa: ARG005
"""Command dispatch table for GitHub CLI commands and output formatters."""

from collections.abc import Callable
import json
import os
from typing import Any, Final


type Handler = tuple[Callable[[dict], tuple[str, ...]], Callable[[str, dict], dict]]


# --- [FUNCTIONS] --------------------------------------------------------------
def _json(output: str) -> Any:
    """Parse JSON output, returning empty dict for empty strings."""
    return json.loads(output) if output else {}


def project_env() -> dict | None:
    """Get env with GH_PROJECTS_TOKEN if available."""
    token = os.environ.get("GH_PROJECTS_TOKEN")
    return {**os.environ, "GH_TOKEN": token} if token else None


def _edit_flags(args: dict) -> tuple[str, ...]:
    """Build edit flags for title/body/labels."""
    return tuple(
        f"--{key}={value}"
        for key, value in (("title", args.get("title")), ("body", args.get("body")), ("add-label", args.get("labels")))
        if value
    )


# --- [CONSTANTS] --------------------------------------------------------------
DEFAULT_STATE: Final = "open"
DEFAULT_LIMIT: Final = "30"
DEFAULT_BRANCH: Final = "main"
DEFAULT_OWNER: Final = "@me"
FORMAT_JSON: Final = "--format=json"

# --- [DISPATCH_TABLES] --------------------------------------------------------
CMDS: dict[str, tuple[tuple[str, ...], tuple[str, ...], Handler]] = {
    # --- Issues ---
    "issue-list": (
        (),
        ("state", "limit"),
        (
            lambda a: (
                "gh",
                "issue",
                "list",
                f"--state={a.get('state', DEFAULT_STATE)}",
                f"--limit={a.get('limit', DEFAULT_LIMIT)}",
                "--json=number,title,state,labels,createdAt,author",
            ),
            lambda o, a: {"state": a.get("state", DEFAULT_STATE), "issues": _json(o)},
        ),
    ),
    "issue-view": (
        ("number",),
        (),
        (
            lambda a: (
                "gh",
                "issue",
                "view",
                str(a["number"]),
                "--json=number,title,body,state,labels,comments,author,createdAt",
            ),
            lambda o, a: {"number": a["number"], "issue": _json(o)},
        ),
    ),
    "issue-create": (
        ("title",),
        ("body",),
        (
            lambda a: (
                "gh",
                "issue",
                "create",
                f"--title={a['title']}",
                f"--body={a.get('body', '')}",
                "--json=number,url",
            ),
            lambda o, a: {"created": _json(o)},
        ),
    ),
    "issue-comment": (
        ("number", "body"),
        (),
        (
            lambda a: ("gh", "issue", "comment", str(a["number"]), f"--body={a['body']}"),
            lambda o, a: {"number": a["number"], "commented": True},
        ),
    ),
    "issue-close": (
        ("number",),
        (),
        (
            lambda a: ("gh", "issue", "close", str(a["number"])),
            lambda o, a: {"number": a["number"], "closed": True},
        ),
    ),
    "issue-edit": (
        ("number",),
        ("title", "body", "labels"),
        (
            lambda a: ("gh", "issue", "edit", str(a["number"]), *_edit_flags(a)),
            lambda o, a: {"number": a["number"], "edited": True},
        ),
    ),
    "issue-reopen": (
        ("number",),
        (),
        (
            lambda a: ("gh", "issue", "reopen", str(a["number"])),
            lambda o, a: {"number": a["number"], "reopened": True},
        ),
    ),
    "issue-pin": (
        ("number",),
        (),
        (
            lambda a: ("gh", "issue", "pin", str(a["number"])),
            lambda o, a: {"number": a["number"], "pinned": True},
        ),
    ),  # --- Pull Requests ---
    "pr-list": (
        (),
        ("state", "limit"),
        (
            lambda a: (
                "gh",
                "pr",
                "list",
                f"--state={a.get('state', DEFAULT_STATE)}",
                f"--limit={a.get('limit', DEFAULT_LIMIT)}",
                "--json=number,title,state,headRefName,author,createdAt",
            ),
            lambda o, a: {"state": a.get("state", DEFAULT_STATE), "pulls": _json(o)},
        ),
    ),
    "pr-view": (
        ("number",),
        (),
        (
            lambda a: (
                "gh",
                "pr",
                "view",
                str(a["number"]),
                "--json=number,title,body,state,headRefName,baseRefName,commits,files,reviews,comments",
            ),
            lambda o, a: {"number": a["number"], "pull": _json(o)},
        ),
    ),
    "pr-create": (
        ("title",),
        ("body", "base"),
        (
            lambda a: (
                "gh",
                "pr",
                "create",
                f"--title={a['title']}",
                f"--body={a.get('body', '')}",
                f"--base={a.get('base', DEFAULT_BRANCH)}",
                "--json=number,url",
            ),
            lambda o, a: {"created": _json(o)},
        ),
    ),
    "pr-diff": (
        ("number",),
        (),
        (
            lambda a: ("gh", "pr", "diff", str(a["number"]), "--patch"),
            lambda o, a: {"number": a["number"], "diff": o},
        ),
    ),
    "pr-files": (
        ("number",),
        (),
        (
            lambda a: ("gh", "pr", "view", str(a["number"]), "--json=files"),
            lambda o, a: {"number": a["number"], "files": _json(o).get("files", [])},
        ),
    ),
    "pr-checks": (
        ("number",),
        (),
        (
            lambda a: ("gh", "pr", "checks", str(a["number"]), "--json=name,state,workflow,link"),
            lambda o, a: {"number": a["number"], "checks": _json(o)},
        ),
    ),
    "pr-merge": (
        ("number",),
        (),
        (
            lambda a: ("gh", "pr", "merge", str(a["number"]), "--squash", "--delete-branch"),
            lambda o, a: {"number": a["number"], "merged": True},
        ),
    ),
    "pr-review": (
        ("number", "event"),
        ("body",),
        (
            lambda a: (
                "gh",
                "pr",
                "review",
                str(a["number"]),
                f"--{a['event'].lower()}",
                f"--body={a.get('body', '')}",
            ),
            lambda o, a: {"number": a["number"], "event": a["event"], "reviewed": True},
        ),
    ),
    "pr-edit": (
        ("number",),
        ("title", "body", "labels"),
        (
            lambda a: ("gh", "pr", "edit", str(a["number"]), *_edit_flags(a)),
            lambda o, a: {"number": a["number"], "edited": True},
        ),
    ),
    "pr-close": (
        ("number",),
        (),
        (
            lambda a: ("gh", "pr", "close", str(a["number"])),
            lambda o, a: {"number": a["number"], "closed": True},
        ),
    ),
    "pr-ready": (
        ("number",),
        (),
        (
            lambda a: ("gh", "pr", "ready", str(a["number"])),
            lambda o, a: {"number": a["number"], "ready": True},
        ),
    ),
    # --- Workflows ---
    "workflow-list": (
        (),
        (),
        (
            lambda a: ("gh", "workflow", "list", "--json=id,name,path,state"),
            lambda o, a: {"workflows": _json(o)},
        ),
    ),
    "workflow-view": (
        ("workflow",),
        (),
        (
            lambda a: ("gh", "workflow", "view", a["workflow"], "--yaml"),
            lambda o, a: {"workflow": a["workflow"], "yaml": o},
        ),
    ),
    "workflow-run": (
        ("workflow",),
        ("ref",),
        (
            lambda a: ("gh", "workflow", "run", a["workflow"], f"--ref={a.get('ref', DEFAULT_BRANCH)}"),
            lambda o, a: {"workflow": a["workflow"], "ref": a.get("ref", DEFAULT_BRANCH), "triggered": True},
        ),
    ),
    "run-list": (
        (),
        ("limit",),
        (
            lambda a: (
                "gh",
                "run",
                "list",
                f"--limit={a.get('limit', DEFAULT_LIMIT)}",
                "--json=databaseId,displayTitle,status,conclusion,workflowName,createdAt,headBranch",
            ),
            lambda o, a: {"runs": _json(o)},
        ),
    ),
    "run-view": (
        ("run_id",),
        (),
        (
            lambda a: (
                "gh",
                "run",
                "view",
                str(a["run_id"]),
                "--json=databaseId,displayTitle,status,conclusion,jobs,createdAt,updatedAt",
            ),
            lambda o, a: {"run_id": a["run_id"], "run": _json(o)},
        ),
    ),
    "run-logs": (
        ("run_id",),
        ("failed",),
        (
            lambda a: (
                "gh",
                "run",
                "view",
                str(a["run_id"]),
                "--log-failed" if a.get("failed") == "failed" else "--log",
            ),
            lambda o, a: {"run_id": a["run_id"], "logs": o},
        ),
    ),
    "run-rerun": (
        ("run_id",),
        (),
        (
            lambda a: ("gh", "run", "rerun", str(a["run_id"]), "--failed"),
            lambda o, a: {"run_id": a["run_id"], "rerun": True},
        ),
    ),
    "run-cancel": (
        ("run_id",),
        (),
        (
            lambda a: ("gh", "run", "cancel", str(a["run_id"])),
            lambda o, a: {"run_id": a["run_id"], "cancelled": True},
        ),
    ),
    # --- Search ---
    "search-repos": (
        ("query",),
        ("limit",),
        (
            lambda a: (
                "gh",
                "search",
                "repos",
                a["query"],
                f"--limit={a.get('limit', DEFAULT_LIMIT)}",
                "--json=fullName,description,stargazersCount,url",
            ),
            lambda o, a: {"query": a["query"], "repos": _json(o)},
        ),
    ),
    "search-code": (
        ("query",),
        ("limit",),
        (
            lambda a: (
                "gh",
                "search",
                "code",
                a["query"],
                f"--limit={a.get('limit', DEFAULT_LIMIT)}",
                "--json=path,repository,textMatches",
            ),
            lambda o, a: {"query": a["query"], "matches": _json(o)},
        ),
    ),
    "search-issues": (
        ("query",),
        ("limit",),
        (
            lambda a: (
                "gh",
                "search",
                "issues",
                a["query"],
                f"--limit={a.get('limit', DEFAULT_LIMIT)}",
                "--json=number,title,repository,state,url",
            ),
            lambda o, a: {"query": a["query"], "issues": _json(o)},
        ),
    ),
    # --- Projects ---
    "project-list": (
        (),
        ("owner",),
        (
            lambda a: ("gh", "project", "list", f"--owner={a.get('owner', DEFAULT_OWNER)}", FORMAT_JSON),
            lambda o, a: {"owner": a.get("owner", DEFAULT_OWNER), "projects": _json(o)},
        ),
    ),
    "project-view": (
        ("project",),
        ("owner",),
        (
            lambda a: (
                "gh",
                "project",
                "view",
                str(a["project"]),
                f"--owner={a.get('owner', DEFAULT_OWNER)}",
                FORMAT_JSON,
            ),
            lambda o, a: {"project": a["project"], "details": _json(o)},
        ),
    ),
    "project-item-list": (
        ("project",),
        ("owner",),
        (
            lambda a: (
                "gh",
                "project",
                "item-list",
                str(a["project"]),
                f"--owner={a.get('owner', DEFAULT_OWNER)}",
                FORMAT_JSON,
            ),
            lambda o, a: {"project": a["project"], "items": _json(o)},
        ),
    ),
    "project-create": (
        ("title",),
        ("owner",),
        (
            lambda a: (
                "gh",
                "project",
                "create",
                f"--owner={a.get('owner', DEFAULT_OWNER)}",
                f"--title={a['title']}",
                FORMAT_JSON,
            ),
            lambda o, a: {"created": _json(o)},
        ),
    ),
    "project-close": (
        ("project",),
        ("owner",),
        (
            lambda a: ("gh", "project", "close", str(a["project"]), f"--owner={a.get('owner', DEFAULT_OWNER)}"),
            lambda o, a: {"project": a["project"], "closed": True},
        ),
    ),
    "project-delete": (
        ("project",),
        ("owner",),
        (
            lambda a: ("gh", "project", "delete", str(a["project"]), f"--owner={a.get('owner', DEFAULT_OWNER)}"),
            lambda o, a: {"project": a["project"], "deleted": True},
        ),
    ),
    "project-item-add": (
        ("project", "url"),
        ("owner",),
        (
            lambda a: (
                "gh",
                "project",
                "item-add",
                str(a["project"]),
                f"--owner={a.get('owner', DEFAULT_OWNER)}",
                f"--url={a['url']}",
                FORMAT_JSON,
            ),
            lambda o, a: {"project": a["project"], "item": _json(o)},
        ),
    ),
    "project-field-list": (
        ("project",),
        ("owner",),
        (
            lambda a: (
                "gh",
                "project",
                "field-list",
                str(a["project"]),
                f"--owner={a.get('owner', DEFAULT_OWNER)}",
                FORMAT_JSON,
            ),
            lambda o, a: {"project": a["project"], "fields": _json(o)},
        ),
    ),
    # --- Releases ---
    "release-list": (
        (),
        ("limit",),
        (
            lambda a: (
                "gh",
                "release",
                "list",
                f"--limit={a.get('limit', DEFAULT_LIMIT)}",
                "--json=tagName,name,isDraft,isPrerelease,publishedAt",
            ),
            lambda o, a: {"releases": _json(o)},
        ),
    ),
    "release-view": (
        ("tag",),
        (),
        (
            lambda a: (
                "gh",
                "release",
                "view",
                a["tag"],
                "--json=tagName,name,body,isDraft,isPrerelease,publishedAt,assets",
            ),
            lambda o, a: {"tag": a["tag"], "release": _json(o)},
        ),
    ),
    # --- Cache & Labels ---
    "cache-list": (
        (),
        ("limit",),
        (
            lambda a: (
                "gh",
                "cache",
                "list",
                f"--limit={a.get('limit', DEFAULT_LIMIT)}",
                "--json=id,key,sizeInBytes,createdAt,lastAccessedAt",
            ),
            lambda o, a: {"caches": _json(o)},
        ),
    ),
    "cache-delete": (
        ("cache_key",),
        (),
        (
            lambda a: ("gh", "cache", "delete", a["cache_key"], "--confirm"),
            lambda o, a: {"cache_key": a["cache_key"], "deleted": True},
        ),
    ),
    "label-list": (
        (),
        (),
        (
            lambda a: ("gh", "label", "list", "--json=name,description,color"),
            lambda o, a: {"labels": _json(o)},
        ),
    ),
    # --- Utility ---
    "repo-view": (
        (),
        ("repo",),
        (
            lambda a: (
                "gh",
                "repo",
                "view",
                a.get("repo", ""),
                "--json=name,description,defaultBranchRef,stargazerCount,url",
            ),
            lambda o, a: {"repo": _json(o)},
        ),
    ),
    "api": (
        ("endpoint",),
        ("method",),
        (
            lambda a: ("gh", "api", a["endpoint"], "--method", a.get("method", "GET")),
            lambda o, a: {"endpoint": a["endpoint"], "response": _json(o) if o.strip().startswith(("{", "[")) else o},
        ),
    ),
}
