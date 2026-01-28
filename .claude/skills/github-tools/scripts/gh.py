#!/usr/bin/env -S uv run --quiet --script
# /// script
# ///
"""GitHub CLI — unified interface for repository operations.

Commands:
    issue-list [state] [limit]              List issues (default: open, 30)
    issue-view <number>                     View issue details
    issue-create <title> [body]             Create issue
    issue-comment <number> <body>           Comment on issue
    issue-close <number>                    Close issue
    issue-edit <number> [title] [body]      Edit issue
    issue-reopen <number>                   Reopen issue

    pr-list [state] [limit]                 List PRs (default: open, 30)
    pr-view <number>                        View PR details
    pr-create <title> [body] [base]         Create PR
    pr-diff <number>                        Get PR diff
    pr-files <number>                       List PR files
    pr-checks <number>                      View PR checks
    pr-merge <number>                       Merge PR (squash)
    pr-review <number> <event> [body]       Review PR (APPROVE|REQUEST_CHANGES|COMMENT)
    pr-close <number>                       Close PR
    pr-ready <number>                       Mark PR ready

    run-list [limit]                        List workflow runs
    run-view <run_id>                       View run details
    run-logs <run_id> [failed]              Get run logs (pass 'failed' for failed only)
    run-rerun <run_id>                      Rerun failed jobs
    run-cancel <run_id>                     Cancel run
    workflow-list                           List workflows
    workflow-view <workflow>                View workflow YAML
    workflow-run <workflow> [ref]           Trigger workflow

    search-repos <query> [limit]            Search repositories
    search-code <query> [limit]             Search code
    search-issues <query> [limit]           Search issues

    project-list [owner]                    List projects
    project-view <project> [owner]          View project
    project-item-list <project> [owner]     List project items
    project-create <title> [owner]          Create project
    project-close <project> [owner]         Close project
    project-delete <project> [owner]        Delete project
    project-item-add <project> <url> [owner] Add item to project
    project-field-list <project> [owner]    List project fields

    release-list [limit]                    List releases
    release-view <tag>                      View release
    cache-list [limit]                      List caches
    cache-delete <cache_key>                Delete cache
    label-list                              List labels
    repo-view [repo]                        View repository
    api <endpoint> [method]                 Raw API call
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from typing import Any, Callable, Final

# --- [CONSTANTS] --------------------------------------------------------------
DEFAULT_STATE: Final = "open"
DEFAULT_LIMIT: Final = "30"
DEFAULT_BRANCH: Final = "main"
DEFAULT_OWNER: Final = "@me"

# --- [TYPES] ------------------------------------------------------------------
Handler = tuple[Callable[[dict], tuple[str, ...]], Callable[[str, dict], dict]]

# --- [HELPERS] ----------------------------------------------------------------
def _run(cmd: tuple[str, ...], env: dict | None = None) -> tuple[bool, str]:
    """Run gh command, return (success, output)."""
    r = subprocess.run(cmd, capture_output=True, text=True, env=env)
    return r.returncode == 0, (r.stdout or r.stderr).strip()


def _json(o: str) -> Any:
    """Parse JSON output."""
    return json.loads(o) if o else {}


def _repo_vars() -> tuple[str, ...]:
    """Get GraphQL owner/repo vars for current repo."""
    ok, out = _run(("gh", "repo", "view", "--json=owner,name"))
    d = _json(out) if ok else {}
    return ("-f", f"owner={d.get('owner', {}).get('login', '')}", "-f", f"repo={d.get('name', '')}")


def _repo_id() -> str:
    """Get repository node ID."""
    ok, out = _run(("gh", "repo", "view", "--json=id"))
    return _json(out).get("id", "") if ok else ""


def _project_env() -> dict | None:
    """Get env with GH_PROJECTS_TOKEN if available."""
    return {**os.environ, "GH_TOKEN": os.environ["GH_PROJECTS_TOKEN"]} if os.environ.get("GH_PROJECTS_TOKEN") else None


def _edit_flags(a: dict) -> tuple[str, ...]:
    """Build edit flags for title/body/labels."""
    return tuple(f"--{k}={v}" for k, v in [("title", a.get("title")), ("body", a.get("body")), ("add-label", a.get("labels"))] if v)


# --- [HANDLERS] ---------------------------------------------------------------
# Format: (required_args, optional_args, (cmd_builder, output_formatter))
CMDS: dict[str, tuple[tuple[str, ...], tuple[str, ...], Handler]] = {
    # --- Issues ---
    "issue-list": ((), ("state", "limit"), (
        lambda a: ("gh", "issue", "list", f"--state={a.get('state', DEFAULT_STATE)}", f"--limit={a.get('limit', DEFAULT_LIMIT)}", "--json=number,title,state,labels,createdAt,author"),
        lambda o, a: {"state": a.get("state", DEFAULT_STATE), "issues": _json(o)},
    )),
    "issue-view": (("number",), (), (
        lambda a: ("gh", "issue", "view", str(a["number"]), "--json=number,title,body,state,labels,comments,author,createdAt"),
        lambda o, a: {"number": a["number"], "issue": _json(o)},
    )),
    "issue-create": (("title",), ("body",), (
        lambda a: ("gh", "issue", "create", f"--title={a['title']}", f"--body={a.get('body', '')}", "--json=number,url"),
        lambda o, a: {"created": _json(o)},
    )),
    "issue-comment": (("number", "body"), (), (
        lambda a: ("gh", "issue", "comment", str(a["number"]), f"--body={a['body']}"),
        lambda o, a: {"number": a["number"], "commented": True},
    )),
    "issue-close": (("number",), (), (
        lambda a: ("gh", "issue", "close", str(a["number"])),
        lambda o, a: {"number": a["number"], "closed": True},
    )),
    "issue-edit": (("number",), ("title", "body", "labels"), (
        lambda a: ("gh", "issue", "edit", str(a["number"]), *_edit_flags(a)),
        lambda o, a: {"number": a["number"], "edited": True},
    )),
    "issue-reopen": (("number",), (), (
        lambda a: ("gh", "issue", "reopen", str(a["number"])),
        lambda o, a: {"number": a["number"], "reopened": True},
    )),
    "issue-pin": (("number",), (), (
        lambda a: ("gh", "issue", "pin", str(a["number"])),
        lambda o, a: {"number": a["number"], "pinned": True},
    )),

    # --- Pull Requests ---
    "pr-list": ((), ("state", "limit"), (
        lambda a: ("gh", "pr", "list", f"--state={a.get('state', DEFAULT_STATE)}", f"--limit={a.get('limit', DEFAULT_LIMIT)}", "--json=number,title,state,headRefName,author,createdAt"),
        lambda o, a: {"state": a.get("state", DEFAULT_STATE), "pulls": _json(o)},
    )),
    "pr-view": (("number",), (), (
        lambda a: ("gh", "pr", "view", str(a["number"]), "--json=number,title,body,state,headRefName,baseRefName,commits,files,reviews,comments"),
        lambda o, a: {"number": a["number"], "pull": _json(o)},
    )),
    "pr-create": (("title",), ("body", "base"), (
        lambda a: ("gh", "pr", "create", f"--title={a['title']}", f"--body={a.get('body', '')}", f"--base={a.get('base', DEFAULT_BRANCH)}", "--json=number,url"),
        lambda o, a: {"created": _json(o)},
    )),
    "pr-diff": (("number",), (), (
        lambda a: ("gh", "pr", "diff", str(a["number"]), "--patch"),
        lambda o, a: {"number": a["number"], "diff": o},
    )),
    "pr-files": (("number",), (), (
        lambda a: ("gh", "pr", "view", str(a["number"]), "--json=files"),
        lambda o, a: {"number": a["number"], "files": _json(o).get("files", [])},
    )),
    "pr-checks": (("number",), (), (
        lambda a: ("gh", "pr", "checks", str(a["number"]), "--json=name,state,workflow,link"),
        lambda o, a: {"number": a["number"], "checks": _json(o)},
    )),
    "pr-merge": (("number",), (), (
        lambda a: ("gh", "pr", "merge", str(a["number"]), "--squash", "--delete-branch"),
        lambda o, a: {"number": a["number"], "merged": True},
    )),
    "pr-review": (("number", "event"), ("body",), (
        lambda a: ("gh", "pr", "review", str(a["number"]), f"--{a['event'].lower()}", f"--body={a.get('body', '')}"),
        lambda o, a: {"number": a["number"], "event": a["event"], "reviewed": True},
    )),
    "pr-edit": (("number",), ("title", "body", "labels"), (
        lambda a: ("gh", "pr", "edit", str(a["number"]), *_edit_flags(a)),
        lambda o, a: {"number": a["number"], "edited": True},
    )),
    "pr-close": (("number",), (), (
        lambda a: ("gh", "pr", "close", str(a["number"])),
        lambda o, a: {"number": a["number"], "closed": True},
    )),
    "pr-ready": (("number",), (), (
        lambda a: ("gh", "pr", "ready", str(a["number"])),
        lambda o, a: {"number": a["number"], "ready": True},
    )),

    # --- Workflows ---
    "workflow-list": ((), (), (
        lambda a: ("gh", "workflow", "list", "--json=id,name,path,state"),
        lambda o, a: {"workflows": _json(o)},
    )),
    "workflow-view": (("workflow",), (), (
        lambda a: ("gh", "workflow", "view", a["workflow"], "--yaml"),
        lambda o, a: {"workflow": a["workflow"], "yaml": o},
    )),
    "workflow-run": (("workflow",), ("ref",), (
        lambda a: ("gh", "workflow", "run", a["workflow"], f"--ref={a.get('ref', DEFAULT_BRANCH)}"),
        lambda o, a: {"workflow": a["workflow"], "ref": a.get("ref", DEFAULT_BRANCH), "triggered": True},
    )),
    "run-list": ((), ("limit",), (
        lambda a: ("gh", "run", "list", f"--limit={a.get('limit', DEFAULT_LIMIT)}", "--json=databaseId,displayTitle,status,conclusion,workflowName,createdAt,headBranch"),
        lambda o, a: {"runs": _json(o)},
    )),
    "run-view": (("run_id",), (), (
        lambda a: ("gh", "run", "view", str(a["run_id"]), "--json=databaseId,displayTitle,status,conclusion,jobs,createdAt,updatedAt"),
        lambda o, a: {"run_id": a["run_id"], "run": _json(o)},
    )),
    "run-logs": (("run_id",), ("failed",), (
        lambda a: ("gh", "run", "view", str(a["run_id"]), "--log-failed" if a.get("failed") == "failed" else "--log"),
        lambda o, a: {"run_id": a["run_id"], "logs": o},
    )),
    "run-rerun": (("run_id",), (), (
        lambda a: ("gh", "run", "rerun", str(a["run_id"]), "--failed"),
        lambda o, a: {"run_id": a["run_id"], "rerun": True},
    )),
    "run-cancel": (("run_id",), (), (
        lambda a: ("gh", "run", "cancel", str(a["run_id"])),
        lambda o, a: {"run_id": a["run_id"], "cancelled": True},
    )),

    # --- Search ---
    "search-repos": (("query",), ("limit",), (
        lambda a: ("gh", "search", "repos", a["query"], f"--limit={a.get('limit', DEFAULT_LIMIT)}", "--json=fullName,description,stargazersCount,url"),
        lambda o, a: {"query": a["query"], "repos": _json(o)},
    )),
    "search-code": (("query",), ("limit",), (
        lambda a: ("gh", "search", "code", a["query"], f"--limit={a.get('limit', DEFAULT_LIMIT)}", "--json=path,repository,textMatches"),
        lambda o, a: {"query": a["query"], "matches": _json(o)},
    )),
    "search-issues": (("query",), ("limit",), (
        lambda a: ("gh", "search", "issues", a["query"], f"--limit={a.get('limit', DEFAULT_LIMIT)}", "--json=number,title,repository,state,url"),
        lambda o, a: {"query": a["query"], "issues": _json(o)},
    )),

    # --- Projects ---
    "project-list": ((), ("owner",), (
        lambda a: ("gh", "project", "list", f"--owner={a.get('owner', DEFAULT_OWNER)}", "--format=json"),
        lambda o, a: {"owner": a.get("owner", DEFAULT_OWNER), "projects": _json(o)},
    )),
    "project-view": (("project",), ("owner",), (
        lambda a: ("gh", "project", "view", str(a["project"]), f"--owner={a.get('owner', DEFAULT_OWNER)}", "--format=json"),
        lambda o, a: {"project": a["project"], "details": _json(o)},
    )),
    "project-item-list": (("project",), ("owner",), (
        lambda a: ("gh", "project", "item-list", str(a["project"]), f"--owner={a.get('owner', DEFAULT_OWNER)}", "--format=json"),
        lambda o, a: {"project": a["project"], "items": _json(o)},
    )),
    "project-create": (("title",), ("owner",), (
        lambda a: ("gh", "project", "create", f"--owner={a.get('owner', DEFAULT_OWNER)}", f"--title={a['title']}", "--format=json"),
        lambda o, a: {"created": _json(o)},
    )),
    "project-close": (("project",), ("owner",), (
        lambda a: ("gh", "project", "close", str(a["project"]), f"--owner={a.get('owner', DEFAULT_OWNER)}"),
        lambda o, a: {"project": a["project"], "closed": True},
    )),
    "project-delete": (("project",), ("owner",), (
        lambda a: ("gh", "project", "delete", str(a["project"]), f"--owner={a.get('owner', DEFAULT_OWNER)}"),
        lambda o, a: {"project": a["project"], "deleted": True},
    )),
    "project-item-add": (("project", "url"), ("owner",), (
        lambda a: ("gh", "project", "item-add", str(a["project"]), f"--owner={a.get('owner', DEFAULT_OWNER)}", f"--url={a['url']}", "--format=json"),
        lambda o, a: {"project": a["project"], "item": _json(o)},
    )),
    "project-field-list": (("project",), ("owner",), (
        lambda a: ("gh", "project", "field-list", str(a["project"]), f"--owner={a.get('owner', DEFAULT_OWNER)}", "--format=json"),
        lambda o, a: {"project": a["project"], "fields": _json(o)},
    )),

    # --- Releases ---
    "release-list": ((), ("limit",), (
        lambda a: ("gh", "release", "list", f"--limit={a.get('limit', DEFAULT_LIMIT)}", "--json=tagName,name,isDraft,isPrerelease,publishedAt"),
        lambda o, a: {"releases": _json(o)},
    )),
    "release-view": (("tag",), (), (
        lambda a: ("gh", "release", "view", a["tag"], "--json=tagName,name,body,isDraft,isPrerelease,publishedAt,assets"),
        lambda o, a: {"tag": a["tag"], "release": _json(o)},
    )),

    # --- Cache & Labels ---
    "cache-list": ((), ("limit",), (
        lambda a: ("gh", "cache", "list", f"--limit={a.get('limit', DEFAULT_LIMIT)}", "--json=id,key,sizeInBytes,createdAt,lastAccessedAt"),
        lambda o, a: {"caches": _json(o)},
    )),
    "cache-delete": (("cache_key",), (), (
        lambda a: ("gh", "cache", "delete", a["cache_key"], "--confirm"),
        lambda o, a: {"cache_key": a["cache_key"], "deleted": True},
    )),
    "label-list": ((), (), (
        lambda a: ("gh", "label", "list", "--json=name,description,color"),
        lambda o, a: {"labels": _json(o)},
    )),

    # --- Utility ---
    "repo-view": ((), ("repo",), (
        lambda a: ("gh", "repo", "view", a.get("repo", ""), "--json=name,description,defaultBranchRef,stargazerCount,url"),
        lambda o, a: {"repo": _json(o)},
    )),
    "api": (("endpoint",), ("method",), (
        lambda a: ("gh", "api", a["endpoint"], "--method", a.get("method", "GET")),
        lambda o, a: {"endpoint": a["endpoint"], "response": _json(o) if o.strip().startswith(("{", "[")) else o},
    )),

    # --- Discussions (GraphQL) ---
    "discussion-list": ((), ("category", "limit"), (
        lambda a: ("gh", "api", "graphql", "-f", f"query=query($owner:String!,$repo:String!,$limit:Int!){{repository(owner:$owner,name:$repo){{discussions(first:$limit){{nodes{{number title author{{login}}category{{name}}createdAt isAnswered}}}}}}}}", *_repo_vars(), "-F", f"limit={a.get('limit', DEFAULT_LIMIT)}"),
        lambda o, a: {"discussions": _json(o).get("data", {}).get("repository", {}).get("discussions", {}).get("nodes", [])},
    )),
    "discussion-view": (("number",), (), (
        lambda a: ("gh", "api", "graphql", "-f", "query=query($owner:String!,$repo:String!,$num:Int!){repository(owner:$owner,name:$repo){discussion(number:$num){id number title body author{login}category{name}createdAt answer{body author{login}}comments(first:50){nodes{id body author{login}}}}}}", *_repo_vars(), "-F", f"num={a['number']}"),
        lambda o, a: {"number": a["number"], "discussion": _json(o).get("data", {}).get("repository", {}).get("discussion", {})},
    )),
    "discussion-category-list": ((), (), (
        lambda a: ("gh", "api", "graphql", "-f", "query=query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){discussionCategories(first:25){nodes{id name emoji description isAnswerable}}}}", *_repo_vars()),
        lambda o, a: {"categories": _json(o).get("data", {}).get("repository", {}).get("discussionCategories", {}).get("nodes", [])},
    )),
    "discussion-create": (("category_id", "title", "body"), (), (
        lambda a: ("gh", "api", "graphql", "-f", "query=mutation($repoId:ID!,$catId:ID!,$title:String!,$body:String!){createDiscussion(input:{repositoryId:$repoId,categoryId:$catId,title:$title,body:$body}){discussion{id number url}}}", "-f", f"repoId={_repo_id()}", "-f", f"catId={a['category_id']}", "-f", f"title={a['title']}", "-f", f"body={a['body']}"),
        lambda o, a: {"created": _json(o).get("data", {}).get("createDiscussion", {}).get("discussion", {})},
    )),
    "discussion-comment": (("discussion_id", "body"), ("reply_to",), (
        lambda a: ("gh", "api", "graphql", "-f", f"query=mutation($id:ID!,$body:String!){{addDiscussionComment(input:{{discussionId:$id,body:$body}}){{comment{{id}}}}}}", "-f", f"id={a['discussion_id']}", "-f", f"body={a['body']}"),
        lambda o, a: {"discussion_id": a["discussion_id"], "commented": True},
    )),
    "discussion-close": (("discussion_id",), ("reason",), (
        lambda a: ("gh", "api", "graphql", "-f", "query=mutation($id:ID!){closeDiscussion(input:{discussionId:$id}){discussion{id}}}", "-f", f"id={a['discussion_id']}"),
        lambda o, a: {"discussion_id": a["discussion_id"], "closed": True},
    )),
    "discussion-delete": (("discussion_id",), (), (
        lambda a: ("gh", "api", "graphql", "-f", "query=mutation($id:ID!){deleteDiscussion(input:{id:$id}){discussion{id}}}", "-f", f"id={a['discussion_id']}"),
        lambda o, a: {"discussion_id": a["discussion_id"], "deleted": True},
    )),
}


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """Dispatch command and print JSON output."""
    match sys.argv[1:]:
        case [cmd_name, *args] if cmd_name in CMDS:
            req, opt, (builder, formatter) = CMDS[cmd_name]
            all_args = req + opt

            # Check required args
            if len(args) < len(req):
                print(f"Usage: gh.py {cmd_name} {' '.join(f'<{a}>' for a in req)} {' '.join(f'[{a}]' for a in opt)}")
                return 1

            # Map positional args to dict
            opts = dict(zip(all_args, args))

            # Execute command
            env = _project_env() if cmd_name.startswith("project-") else None
            ok, out = _run(builder(opts), env)

            result = {"status": "success", **formatter(out, opts)} if ok else {"status": "error", "message": f"{cmd_name} failed", "stderr": out}
            print(json.dumps(result, indent=2))
            return 0 if ok else 1

        case [cmd_name, *_]:
            print(f"[ERROR] Unknown command '{cmd_name}'\n")
            print(__doc__)
            return 1

        case _:
            print(__doc__)
            return 1


if __name__ == "__main__":
    sys.exit(main())
