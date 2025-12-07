---
name: hooks-builder
type: standard
depth: base
description: >-
  Creates and configures Claude Code hooks for lifecycle automation. Use when
  implementing PreToolUse validation, PostToolUse formatting, PermissionRequest
  auto-approve, custom notifications, session management, or deterministic agent control.
---

# [H1][HOOKS-BUILDER]
>**Dictum:** *Hooks encode deterministic behavior; prompts cannot guarantee execution.*

<br>

Build Claude Code hooks—shell commands executing at agent lifecycle events.

**Scope:**<br>
- *Event Selection:* Choose hook type by automation goal (blocking vs observing).
- *Configuration:* Author settings.json entries with matchers and timeouts.
- *Response Handling:* Control agent via exit codes, JSON responses, or prompt evaluation.

**Domain Navigation:**<br>
- *[SCHEMA]* — Configuration structure, matchers, JSON response formats. Load for authoring hooks.
- *[LIFECYCLE]* — Event flow, input schemas, exit codes. Load for understanding behavior.
- *[INTEGRATION]* — Environment variables, context injection, precedence. Load for advanced automation.
- *[SCRIPTING]* — Python 3.14 standards, security patterns, functional style. Load for writing scripts.

[REFERENCE]: [→index.md](./index.md) — Complete reference file listing.

---
## [2][INSTRUCTIONS]
>**Dictum:** *Progressive disclosure optimizes context loading.*

<br>

**Universal Tasks:**<br>
1. Read [→index.md](./index.md): Reference file listing for navigation.

---
## [3][EVENTS]
>**Dictum:** *Ten events span agent lifecycle; six can block.*

<br>

| [INDEX] | [EVENT]           | [TRIGGER]                  | [BLOCKS] | [PRIMARY_USE]              |
| :-----: | ----------------- | -------------------------- | :------: | -------------------------- |
|   [1]   | PreToolUse        | Before tool execution      |   Yes    | Validate, block, modify    |
|   [2]   | PermissionRequest | Permission dialog shown    |   Yes    | Auto-approve/deny, modify  |
|   [3]   | PostToolUse       | After tool completion      |   Yes    | Format code, add context   |
|   [4]   | UserPromptSubmit  | User submits prompt        |   Yes    | Inject context, validate   |
|   [5]   | Stop              | Agent finishes responding  |   Yes    | Force continuation         |
|   [6]   | SubagentStop      | Subagent task completes    |   Yes    | Evaluate completion        |
|   [7]   | Notification      | Agent sends notification   |    No    | Custom desktop alerts      |
|   [8]   | PreCompact        | Before context compaction  |    No    | Backup transcripts         |
|   [9]   | SessionStart      | Session init or resume     |    No    | Load context, set env vars |
|  [10]   | SessionEnd        | Session terminates         |    No    | Cleanup, persist state     |

**Required Task:**<br>
1. Read [→lifecycle.md](./references/lifecycle.md): Input schemas, exit codes, execution model.

---
## [4][CONFIGURATION]
>**Dictum:** *Settings.json is the sole registration mechanism.*

<br>

| [INDEX] | [SCOPE] | [PATH]                        | [USE]               | [GIT]  |
| :-----: | ------- | ----------------------------- | ------------------- | :----: |
|   [1]   | User    | `~/.claude/settings.json`     | Global, all projects|  N/A   |
|   [2]   | Project | `.claude/settings.json`       | Shared, committed   | Commit |
|   [3]   | Local   | `.claude/settings.local.json` | Personal, testing   | Ignore |

**Precedence:** Local > Project > User.

**Required Task:**<br>
1. Read [→schema.md](./references/schema.md): Configuration schema, matchers, JSON responses.

---
## [5][IMPLEMENTATION]
>**Dictum:** *Two hook types serve different complexity levels.*

<br>

| [INDEX] | [TYPE]   | [USE_CASE]                       | [TIMEOUT] | [CHARACTERISTICS]       |
| :-----: | -------- | -------------------------------- | :-------: | ----------------------- |
|   [1]   | command  | Validation, formatting, rules    |    60s    | Deterministic, fast     |
|   [2]   | prompt   | Complex evaluation, LLM judgment |    30s    | Context-aware, flexible |

**Eligible for prompt type:** Stop, SubagentStop, UserPromptSubmit, PreToolUse, PermissionRequest.

**Required Task:**<br>
1. Read [→integration.md](./references/integration.md): Environment variables, context injection.

---
## [6][SCRIPTING]
>**Dictum:** *Functional pipelines produce reliable hook scripts.*

<br>

Python 3.14+ with strict typing. Zero imperative patterns.

**Required Task:**<br>
1. Read [→scripting.md](./references/scripting.md): Tooling gates, philosophy pillars, security patterns.

---
## [7][VALIDATION]
>**Dictum:** *Gate checklist prevents registration failures.*

<br>

[VERIFY] Pre-deployment:
- [ ] JSON syntax valid—no trailing commas.
- [ ] `type` field is `"command"` or `"prompt"`.
- [ ] `command` path exists and is executable.
- [ ] Matcher regex valid—test with `/hooks` command.
- [ ] Timeout appropriate: ≤60s for command, ≤30s for prompt.
- [ ] Security patterns applied per scripting.md.
