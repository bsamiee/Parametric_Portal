#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.14"
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

import json
import subprocess
import sys

from _dispatch import CMDS, project_env
from _dispatch_graphql import GRAPHQL_CMDS


# --- [FUNCTIONS] --------------------------------------------------------------
def run_command(command: tuple[str, ...], env: dict | None = None, timeout_seconds: int = 30) -> tuple[bool, str]:
    """Run gh command, return (success, output)."""
    try:
        result = subprocess.run(command, capture_output=True, text=True, env=env, timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        return False, f'Command timed out after {timeout_seconds}s'
    return result.returncode == 0, (result.stdout or result.stderr).strip()


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """Dispatch command and print JSON output."""
    all_cmds = {**CMDS, **GRAPHQL_CMDS}
    match sys.argv[1:]:
        case [cmd_name, *cmd_args] if cmd_name in all_cmds:
            required, optional, (builder, formatter) = all_cmds[cmd_name]
            all_params = required + optional

            if len(cmd_args) < len(required):
                usage_args = (
                    f'{" ".join(f"<{param}>" for param in required)} {" ".join(f"[{param}]" for param in optional)}'
                )
                sys.stdout.write(f'Usage: gh.py {cmd_name} {usage_args}\n')
                return 1

            opts = dict(zip(all_params, cmd_args))
            env = project_env() if cmd_name.startswith('project-') else None
            ok, out = run_command(builder(opts), env)

            result = (
                {'status': 'success', **formatter(out, opts)}
                if ok
                else {'status': 'error', 'message': f'{cmd_name} failed', 'stderr': out}
            )
            sys.stdout.write(json.dumps(result, indent=2) + '\n')
            return 0 if ok else 1

        case [cmd_name, *_]:
            sys.stdout.write(f"[ERROR] Unknown command '{cmd_name}'\n\n")
            sys.stdout.write(__doc__ + '\n')
            return 1

        case _:
            sys.stdout.write(__doc__ + '\n')
            return 1


if __name__ == '__main__':
    sys.exit(main())
