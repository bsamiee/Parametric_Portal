# [H1][LIFECYCLE]
>**Dictum:** *Hook effectiveness requires matching event to intervention goal.*

<br>

Ten lifecycle events span agent execution. Each fires at distinct point with event-specific input.

---
## [1][EVENTS]
>**Dictum:** *Blocking events enforce; non-blocking events observe.*

<br>

| [INDEX] | [EVENT]           | [TRIGGER]                 | [BLOCKS] | [OUTPUT_VISIBILITY] |
| :-----: | ----------------- | ------------------------- | :------: | ------------------- |
|   [1]   | PreToolUse        | Before tool execution     |   Yes    | Transcript (Ctrl-R) |
|   [2]   | PermissionRequest | Permission dialog shown   |   Yes    | Transcript (Ctrl-R) |
|   [3]   | PostToolUse       | After tool completion     |   Yes    | Transcript (Ctrl-R) |
|   [4]   | UserPromptSubmit  | User submits prompt       |   Yes    | Context for Claude  |
|   [5]   | Stop              | Agent finishes responding |   Yes    | Transcript (Ctrl-R) |
|   [6]   | SubagentStop      | Subagent task completes   |   Yes    | Transcript (Ctrl-R) |
|   [7]   | Notification      | Agent sends notification  |    No    | Debug only          |
|   [8]   | PreCompact        | Before context compaction |    No    | Debug only          |
|   [9]   | SessionStart      | Session init or resume    |    No    | Context for Claude  |
|  [10]   | SessionEnd        | Session terminates        |    No    | Debug only          |

---
## [2][INPUT_SCHEMAS]
>**Dictum:** *Event-specific fields enable targeted automation.*

<br>

### [2.1][BASE_FIELDS]
Events receive:

| [INDEX] | [FIELD]           | [TYPE] | [DESCRIPTION]                                   |
| :-----: | ----------------- | ------ | ----------------------------------------------- |
|   [1]   | `session_id`      | string | Current session identifier                      |
|   [2]   | `transcript_path` | string | Path to session.jsonl                           |
|   [3]   | `hook_event_name` | string | Event name (e.g., "PreToolUse")                 |
|   [4]   | `cwd`             | string | Current working directory                       |
|   [5]   | `permission_mode` | string | `default\|plan\|acceptEdits\|bypassPermissions` |

### [2.2][TOOL_EVENTS]
PreToolUse, PermissionRequest, PostToolUse add:

| [INDEX] | [FIELD]       | [TYPE] | [DESCRIPTION]             |
| :-----: | ------------- | ------ | ------------------------- |
|   [1]   | `tool_name`   | string | Tool being invoked        |
|   [2]   | `tool_input`  | object | Tool parameters           |
|   [3]   | `tool_use_id` | string | Unique tool invocation ID |

PostToolUse adds `tool_response` with tool output.

### [2.3][STOP_EVENTS]
Stop, SubagentStop add:

| [INDEX] | [FIELD]            | [TYPE]  | [DESCRIPTION]                                  |
| :-----: | ------------------ | ------- | ---------------------------------------------- |
|   [1]   | `stop_hook_active` | boolean | True if previous Stop hook kept Claude running |

### [2.4][SESSION_EVENTS]

| [INDEX] | [EVENT]      | [FIELD]  | [VALUES]                                        |
| :-----: | ------------ | -------- | ----------------------------------------------- |
|   [1]   | SessionStart | `source` | `startup`, `resume`, `clear`, `compact`         |
|   [2]   | SessionEnd   | `reason` | `clear`, `logout`, `prompt_input_exit`, `other` |

### [2.5][OTHER_EVENTS]

| [INDEX] | [EVENT]          | [FIELD]               | [DESCRIPTION]           |
| :-----: | ---------------- | --------------------- | ----------------------- |
|   [1]   | UserPromptSubmit | `prompt`              | User's input text       |
|   [2]   | PreCompact       | `trigger`             | `manual` or `auto`      |
|   [3]   | PreCompact       | `custom_instructions` | Compaction instructions |
|   [4]   | Notification     | `message`             | Notification content    |

---
## [3][EXECUTION]
>**Dictum:** *Timeouts and deduplication prevent runaway execution.*

<br>

| [INDEX] | [PROPERTY]      | [VALUE]                              |
| :-----: | --------------- | ------------------------------------ |
|   [1]   | Timeout         | 60s default (command), 30s (prompt)  |
|   [2]   | Parallelization | All matching hooks run in parallel   |
|   [3]   | Deduplication   | Identical hook commands deduplicated |
|   [4]   | Input           | JSON via stdin                       |
|   [5]   | Output          | stdout for JSON, stderr for errors   |

---
## [4][EXIT_CODES]
>**Dictum:** *Blocking requires exit code 2; exit code 1 blocks erroneously.*

<br>

| [INDEX] | [CODE] | [DOCUMENTED]       | [ACTUAL_BEHAVIOR]                    |
| :-----: | :----: | ------------------ | ------------------------------------ |
|   [1]   |   0    | Success            | Continue normally                    |
|   [2]   |   1    | Non-blocking error | Blocks execution                     |
|   [3]   |   2    | Block              | Block action, stderr shown to Claude |
|   [4]   | Other  | Non-blocking error | Log error, continue execution        |

[CRITICAL] Exit 0 signals warnings. Exit 2 blocks intentionally.

### [4.1][EXIT_2_BEHAVIOR]

| [INDEX] | [EVENT]           | [EXIT_2_EFFECT]                     |
| :-----: | ----------------- | ----------------------------------- |
|   [1]   | PreToolUse        | Blocks tool call, stderr to Claude  |
|   [2]   | PermissionRequest | Denies permission, stderr to Claude |
|   [3]   | PostToolUse       | Stderr to Claude (tool already ran) |
|   [4]   | UserPromptSubmit  | Blocks prompt, erases input         |
|   [5]   | Stop              | Blocks stoppage, stderr to Claude   |
|   [6]   | SubagentStop      | Blocks stoppage, stderr to subagent |
|   [7]   | Non-blocking      | Stderr to user only (no effect)     |

---
## [5][KNOWN_ISSUES]
>**Dictum:** *Bug awareness prevents deployment failures.*

<br>

| [INDEX] | [ISSUE]            | [DESCRIPTION]                                    |
| :-----: | ------------------ | ------------------------------------------------ |
|   [1]   | Exit code 1 blocks | Despite docs, exit 1 blocks execution (#4809)    |
|   [2]   | Race condition     | PermissionRequest hooks >1.5s may show dialog    |
|   [3]   | Env substitution   | `$CLAUDE_TOOL_NAME` may fail in some contexts    |
|   [4]   | Context bridging   | SubagentStop cannot pass context to parent agent |
|   [5]   | SessionEnd/clear   | `/clear` doesn't fire SessionEnd hook (#6428)    |

[REFERENCE] Validation checklist: [→validation.md§2](./validation.md#2lifecycle_gate)
