#!/usr/bin/env -S uv run --quiet --script
# /// script
# ///
"""GitHub CLI — unified polymorphic interface."""

# --- [IMPORTS] ----------------------------------------------------------------
import argparse
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


B: Final[_B] = _B()


# --- [DISPATCH_TABLES] --------------------------------------------------------
handlers: dict[str, Handler] = {
    "issue-list": (
        lambda a: (
            "gh",
            "issue",
            "list",
            f"--state={a['state']}",
            f"--limit={a['limit']}",
            "--json=number,title,state,labels,createdAt,author",
        ),
        lambda o, a: {"state": a["state"], "issues": json.loads(o)},
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
            f"--body={a['body'] or ''}",
            "--json=number,url",
        ),
        lambda o, a: {"created": json.loads(o)},
    ),
    "issue-comment": (
        lambda a: ("gh", "issue", "comment", str(a["number"]), f"--body={a['body']}"),
        lambda o, a: {"number": a["number"], "commented": True},
    ),
    "pr-list": (
        lambda a: (
            "gh",
            "pr",
            "list",
            f"--state={a['state']}",
            f"--limit={a['limit']}",
            "--json=number,title,state,headRefName,author,createdAt",
        ),
        lambda o, a: {"state": a["state"], "pulls": json.loads(o)},
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
        lambda o, a: {"number": a["number"], "merged": True},
    ),
    "pr-review": (
        lambda a: (
            "gh",
            "pr",
            "review",
            str(a["number"]),
            f"--{a['event'].lower()}",
            f"--body={a['body'] or ''}",
        ),
        lambda o, a: {"number": a["number"], "event": a["event"], "reviewed": True},
    ),
    "search-repos": (
        lambda a: (
            "gh",
            "search",
            "repos",
            a["query"],
            f"--limit={a['limit']}",
            "--json=fullName,description,stargazersCount,url",
        ),
        lambda o, a: {"query": a["query"], "repos": json.loads(o)},
    ),
    "search-code": (
        lambda a: (
            "gh",
            "search",
            "code",
            a["query"],
            f"--limit={a['limit']}",
            "--json=path,repository,textMatches",
        ),
        lambda o, a: {"query": a["query"], "matches": json.loads(o)},
    ),
    "search-issues": (
        lambda a: (
            "gh",
            "search",
            "issues",
            a["query"],
            f"--limit={a['limit']}",
            "--json=number,title,repository,state,url",
        ),
        lambda o, a: {"query": a["query"], "issues": json.loads(o)},
    ),
    "repo-view": (
        lambda a: (
            "gh",
            "repo",
            "view",
            a["repo"] or "",
            "--json=name,description,defaultBranchRef,stargazerCount,url",
        ),
        lambda o, a: {"repo": json.loads(o)},
    ),
    "run-list": (
        lambda a: (
            "gh",
            "run",
            "list",
            f"--limit={a['limit']}",
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
    "run-rerun": (
        lambda a: ("gh", "run", "rerun", str(a["run_id"]), "--failed"),
        lambda o, a: {"run_id": a["run_id"], "rerun": True},
    ),
    "cache-list": (
        lambda a: (
            "gh",
            "cache",
            "list",
            f"--limit={a['limit']}",
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
            f"--ref={a['ref'] or 'main'}",
        ),
        lambda o, a: {
            "workflow": a["workflow"],
            "ref": a["ref"] or "main",
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
            f"--body={a['body'] or ''}",
            f"--base={a['base'] or 'main'}",
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
            *(f"--title={a['title']}" for _ in [1] if a["title"]),
            *(f"--body={a['body']}" for _ in [1] if a["body"]),
            *(f"--add-label={a['labels']}" for _ in [1] if a["labels"]),
        ),
        lambda o, a: {"number": a["number"], "edited": True},
    ),
    "pr-close": (
        lambda a: ("gh", "pr", "close", str(a["number"])),
        lambda o, a: {"number": a["number"], "closed": True},
    ),
    "pr-ready": (
        lambda a: ("gh", "pr", "ready", str(a["number"])),
        lambda o, a: {"number": a["number"], "ready": True},
    ),
    # --- [ISSUE_LIFECYCLE] ----------------------------------------------------
    "issue-close": (
        lambda a: ("gh", "issue", "close", str(a["number"])),
        lambda o, a: {"number": a["number"], "closed": True},
    ),
    "issue-edit": (
        lambda a: (
            "gh",
            "issue",
            "edit",
            str(a["number"]),
            *(f"--title={a['title']}" for _ in [1] if a["title"]),
            *(f"--body={a['body']}" for _ in [1] if a["body"]),
            *(f"--add-label={a['labels']}" for _ in [1] if a["labels"]),
        ),
        lambda o, a: {"number": a["number"], "edited": True},
    ),
    "issue-reopen": (
        lambda a: ("gh", "issue", "reopen", str(a["number"])),
        lambda o, a: {"number": a["number"], "reopened": True},
    ),
    "issue-pin": (
        lambda a: ("gh", "issue", "pin", str(a["number"])),
        lambda o, a: {"number": a["number"], "pinned": True},
    ),
    # --- [PROJECTS] -----------------------------------------------------------
    "project-list": (
        lambda a: (
            "gh",
            "project",
            "list",
            f"--owner={a['owner'] or '@me'}",
            "--format=json",
        ),
        lambda o, a: {"owner": a["owner"] or "@me", "projects": json.loads(o)},
    ),
    "project-view": (
        lambda a: (
            "gh",
            "project",
            "view",
            str(a["project"]),
            f"--owner={a['owner'] or '@me'}",
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
            f"--owner={a['owner'] or '@me'}",
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
            f"--limit={a['limit']}",
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
        lambda a: ("gh", "api", a["endpoint"], "--method", a["method"]),
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
    p = argparse.ArgumentParser(description=__doc__)
    [
        p.add_argument(a, **o)
        for a, o in [
            ("command", {"choices": handlers.keys()}),
            ("--number", {"type": int}),
            ("--title", {}),
            ("--body", {}),
            ("--state", {"default": B.state}),
            ("--limit", {"type": int, "default": B.limit}),
            ("--query", {}),
            ("--repo", {}),
            ("--endpoint", {}),
            ("--method", {"default": "GET"}),
            ("--event", {"choices": ["APPROVE", "REQUEST_CHANGES", "COMMENT"]}),
            ("--run-id", {"type": int}),
            ("--cache-key", {}),
            ("--workflow", {}),
            ("--ref", {}),
            ("--base", {}),
            ("--labels", {}),
            ("--owner", {}),
            ("--project", {"type": int}),
            ("--tag", {}),
        ]
    ]
    args = vars(p.parse_args())
    builder, formatter = handlers[args["command"]]
    r = subprocess.run(builder(args), capture_output=True, text=True)
    result = (
        {"status": "success", **formatter(r.stdout or r.stderr, args)}
        if r.returncode == 0
        else {
            "status": "error",
            "message": f"{args['command']} failed",
            "stderr": r.stderr,
        }
    )
    print(json.dumps(result))
    return 0 if r.returncode == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
