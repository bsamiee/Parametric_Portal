---
description: Fetch library documentation from Context7
argument-hint: [library] [question]
allowed-tools: Bash(uv run .claude/skills/context7-tools/scripts/context7.py:*)
---
Run: `uv run .claude/skills/context7-tools/scripts/context7.py lookup $1 "$2"`

Present documentation to user. Extract relevant code examples.
