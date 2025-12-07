---
name: hooks-builder
type: standard
depth: base
description: >-
  Creates and configures Claude Code hooks for lifecycle automation. Use when
  implementing PreToolUse validation, PostToolUse formatting, custom notifications,
  session management, or any deterministic agent behavior control.
---

# [H1][HOOKS-BUILDER]
>**Dictum:** *Hooks encode deterministic behavior; prompts cannot guarantee execution.*

<br>

Build Claude Code hooks—shell commands executing at agent lifecycle events.

**Scope:**<br>
- *Event Selection:* Choose appropriate hook type for automation goal.
- *Configuration:* Author settings.json hook entries with matchers.
- *Response Handling:* Control agent behavior via exit codes and JSON responses.

**Domain Navigation:**<br>
- *[SCHEMA]* — Configuration structure, matchers, response formats. Load for authoring hook JSON.
- *[LIFECYCLE]* — Execution flow, environment, exit codes. Load for understanding hook behavior.
- *[INTEGRATION]* — Plugin hooks, context injection, modular patterns. Load for advanced automation.
- *[SCRIPTING]* — Python 3.14 standards, functional patterns, tooling gates. Load for writing hook scripts.

[REFERENCE]: [→index.md](./index.md) — Complete reference file listing.

---
## [2][INSTRUCTIONS]
>**Dictum:** *Progressive disclosure optimizes context loading.*

<br>

**Universal Tasks:**<br>
1. Read [→index.md](./index.md): Reference file listing for navigation.

---
## [3][EVENTS]
>**Dictum:** *Ten events span agent lifecycle.*

<br>

[IMPORTANT] Select event by automation goal—each fires at distinct lifecycle point.

| [INDEX] | [EVENT]           | [TRIGGER]                      | [CAN BLOCK] | [USE CASE]                      |
| :-----: | ----------------- | ------------------------------ | :---------: | ------------------------------- |
|   [1]   | PreToolUse        | Before tool execution          |     Yes     | Validate, block, modify inputs  |
|   [2]   | PermissionRequest | Permission dialog shown        |     Yes     | Auto-approve/deny permissions   |
|   [3]   | PostToolUse       | After tool completion          |     Yes     | Format code, validate results   |
|   [4]   | UserPromptSubmit  | User submits prompt            |     Yes     | Add context, validate input     |
|   [5]   | Notification      | Agent sends notification       |     No      | Custom desktop alerts           |
|   [6]   | Stop              | Main agent finishes responding |     Yes     | Force continuation, cleanup     |
|   [7]   | SubagentStop      | Subagent task completes        |     Yes     | Evaluate subagent completion    |
|   [8]   | PreCompact        | Before context compaction      |     No      | Backup transcripts              |
|   [9]   | SessionStart      | Session init or resume         |     No      | Load context, setup environment |
|  [10]   | SessionEnd        | Session terminates             |     No      | Cleanup, state persistence      |

**Required Task:**<br>
1. Read [→lifecycle.md](./references/lifecycle.md): Execution flow, exit codes, environment variables.

**Guidance:**<br>
- *Blocking* — Exit code 2 blocks action. PreToolUse/PermissionRequest block before execution; PostToolUse blocks with feedback.
- *Non-blocking* — Notification, PreCompact, SessionStart, SessionEnd observe only.

**Best-Practices:**<br>
- **Event Selection** — PreToolUse for prevention; PostToolUse for reaction; Stop for continuation control.
- **Matcher Scope** — Narrow matchers reduce false triggers; `*` matches all tools.

---
## [4][CONFIGURATION]
>**Dictum:** *Settings.json is the sole registration mechanism.*

<br>

Hooks register in settings files—user, project, or local scope.

| [INDEX] | [SCOPE] | [PATH]                        | [USE]                     |
| :-----: | ------- | ----------------------------- | ------------------------- |
|   [1]   | User    | `~/.claude/settings.json`     | Global, all projects      |
|   [2]   | Project | `.claude/settings.json`       | Shared, committed to repo |
|   [3]   | Local   | `.claude/settings.local.json` | Personal, not committed   |

**Required Task:**<br>
1. Read [→schema.md](./references/schema.md): Configuration schema, matchers, response formats.

**Guidance:**<br>
- *Scope Selection* — Project scope for team conventions; user scope for personal preferences; local for testing.
- *Precedence* — Local overrides project; project overrides user.

**Best-Practices:**<br>
- **Path Variables** — Use `$CLAUDE_PROJECT_DIR` for project-relative script paths.
- **Timeout Tuning** — Default 60s; reduce for fast validations; increase for formatters.

---
## [5][IMPLEMENTATION]
>**Dictum:** *Scripts receive JSON stdin, return exit codes.*

<br>

[IMPORTANT] Hooks execute as shell commands with JSON piped to stdin.

**Guidance:**<br>
- *Input* — JSON object: session_id, transcript_path, tool_name, tool_input (event-specific).
- *Output* — Exit 0 for success; exit 2 to block; other codes for non-blocking errors.
- *Response* — Structured JSON to stdout enables fine-grained control (see schema.md).

**Best-Practices:**<br>
- **Script Location** — Store in `.claude/hooks/` with executable permissions.
- **Error Handling** — Print errors to stderr; stdout reserved for JSON responses.
- **Security** — Hooks run with your credentials. Validate inputs; block path traversal.

---
## [6][INTEGRATION]
>**Dictum:** *Modular architecture enables plugin extensibility.*

<br>

Hooks support plugin architecture and context injection for complex automation.

**Required Task:**<br>
1. Read [→integration.md](./references/integration.md): Plugin hooks.json, environment variables, context injection.

**Guidance:**<br>
- *Plugin Hooks* — Plugins define hooks in `hooks/hooks.json`. System merges with user hooks at session start.
- *Context Injection* — Use `additionalContext` in SessionStart/UserPromptSubmit for startup context loading.
- *Attention Weighting* — Wrap critical content in XML-like tags (`<IMPORTANT>`, `<CRITICAL>`) for increased agent attention.

**Best-Practices:**<br>
- **Environment Variables** — Use `$CLAUDE_PROJECT_DIR` for project hooks; `${CLAUDE_PLUGIN_ROOT}` for plugin hooks.
- **Modular Scripts** — Organize hooks in `.claude/hooks/` directory with clear naming.

---
## [7][SCRIPTING]
>**Dictum:** *Functional pipelines produce reliable hook scripts.*

<br>

Python 3.14+ with strict typing. Zero imperative patterns.

**Required Task:**<br>
1. Read [→scripting.md](./references/scripting.md): Tooling gates, philosophy pillars, code patterns.

**Guidance:**<br>
- *Tooling* — Run `basedpyright` then `ruff check` then `ruff format` before commit.
- *Philosophy* — Algorithmic constants, polymorphic dispatch, functional composition, expression-centric branching.
- *Structure* — Section dividers to column 80, frozen dataclasses, `Final` type annotations.

**Best-Practices:**<br>
- **Fold over Loop** — Use `reduce()` with immutable state tuples instead of `for` with mutation.
- **Ternary over Block** — Use `x if cond else y` instead of `if/else` statements.
- **Dispatch over Switch** — Use `handlers[key](data)` instead of conditional chains.
