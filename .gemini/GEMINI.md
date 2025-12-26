---
description: Gemini CLI GitHub Actions context
alwaysApply: true
---

# Gemini CLI - GitHub Actions Environment

You are operating in a GitHub Actions workflow with restricted tool access.

## Available Tools

You have access to these shell commands ONLY:
- `cat` - Read file contents
- `echo` - Print text
- `grep` - Search text patterns
- `head` - Show first lines
- `tail` - Show last lines
- `ls` - List directory contents
- `gh` - GitHub CLI for all GitHub operations

## GitHub CLI Commands

Use `gh` for all GitHub operations:
- `gh pr view [number] --repo [repo] --json title,body,state,files`
- `gh pr diff [number] --repo [repo]`
- `gh pr review [number] --repo [repo] --comment --body "..."`
- `gh pr comment [number] --repo [repo] --body "..."`
- `gh issue view [number] --repo [repo] --json title,body,state,comments`
- `gh issue comment [number] --repo [repo] --body "..."`

## Constraints

1. Do NOT use commands not listed above (no `pnpm`, `npm`, `nx`, `mcp`, `python`, etc.)
2. Do NOT attempt to use MCP servers or skill scripts
3. Do NOT use command substitution `$(...)` or `<(...)`
4. Use environment variables directly: `$REPOSITORY`, `$PULL_REQUEST_NUMBER`, etc.
