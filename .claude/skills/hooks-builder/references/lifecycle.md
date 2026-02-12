# [H1][LIFECYCLE]
>**Dictum:** *Hook effectiveness requires matching event to intervention goal.*

<br>

Fourteen lifecycle events span agent execution. Each fires at distinct point with event-specific input.

---
## [1][EVENTS]
>**Dictum:** *Blocking capability determines whether hooks enforce or observe.*

<br>

| [INDEX] | [EVENT]             | [TRIGGER]                      | [CAN_BLOCK] | [OUTPUT_VISIBILITY]  |
| :-----: | ------------------- | ------------------------------ | :----------: | -------------------- |
|   [1]   | SessionStart        | Session begins or resumes      |      No      | Context for Claude   |
|   [2]   | UserPromptSubmit    | User submits prompt            |     Yes      | Context for Claude   |
|   [3]   | PreToolUse          | Before tool execution          |     Yes      | Verbose mode (Ctrl+O)|
|   [4]   | PermissionRequest   | Permission dialog about to show|     Yes      | Verbose mode (Ctrl+O)|
|   [5]   | PostToolUse         | After tool succeeds            |      No      | Verbose mode (Ctrl+O)|
|   [6]   | PostToolUseFailure  | After tool fails               |      No      | Verbose mode (Ctrl+O)|
|   [7]   | Notification        | Agent sends notification       |      No      | User only            |
|   [8]   | SubagentStart       | Subagent spawned               |      No      | User only            |
|   [9]   | SubagentStop        | Subagent finishes              |     Yes      | Verbose mode (Ctrl+O)|
|  [10]   | Stop                | Agent finishes responding      |     Yes      | Verbose mode (Ctrl+O)|
|  [11]   | TeammateIdle        | Teammate about to go idle      |     Yes      | Feedback to teammate |
|  [12]   | TaskCompleted       | Task marked as completed       |     Yes      | Feedback to model    |
|  [13]   | PreCompact          | Before context compaction      |      No      | User only            |
|  [14]   | SessionEnd          | Session terminates             |      No      | User only            |

[CRITICAL] Exit code 2 blocks action for events marked `Yes` in CAN_BLOCK column. PostToolUse/PostToolUseFailure exit 2 shows stderr to Claude but cannot undo the tool call.

---
## [2][INPUT_SCHEMAS]
>**Dictum:** *Event-specific fields enable targeted automation.*

<br>

### [2.1][COMMON_FIELDS]
All events receive via stdin JSON:

| [INDEX] | [FIELD]           | [TYPE] | [DESCRIPTION]                                      |
| :-----: | ----------------- | ------ | -------------------------------------------------- |
|   [1]   | `session_id`      | string | Current session identifier                         |
|   [2]   | `transcript_path` | string | Path to session transcript JSONL                   |
|   [3]   | `hook_event_name` | string | Event name (e.g., "PreToolUse")                    |
|   [4]   | `cwd`             | string | Current working directory                          |
|   [5]   | `permission_mode` | string | `default`, `plan`, `acceptEdits`, `dontAsk`, `bypassPermissions` |

### [2.2][TOOL_EVENTS]
PreToolUse, PermissionRequest, PostToolUse, PostToolUseFailure add:

| [INDEX] | [FIELD]         | [TYPE] | [DESCRIPTION]                         |
| :-----: | --------------- | ------ | ------------------------------------- |
|   [1]   | `tool_name`     | string | Tool being invoked (matcher target)   |
|   [2]   | `tool_input`    | object | Tool parameters (tool-specific shape) |
|   [3]   | `tool_use_id`   | string | Unique tool invocation ID             |

PostToolUse adds `tool_response` (object). PostToolUseFailure adds `error` (string) and optional `is_interrupt` (boolean).

### [2.3][STOP_EVENTS]
Stop and SubagentStop add:

| [INDEX] | [FIELD]                  | [TYPE]  | [DESCRIPTION]                                     |
| :-----: | ------------------------ | ------- | ------------------------------------------------- |
|   [1]   | `stop_hook_active`       | boolean | True if a previous Stop hook kept Claude running   |

SubagentStop additionally provides `agent_id` (string), `agent_type` (string), and `agent_transcript_path` (string).

### [2.4][SESSION_EVENTS]

| [INDEX] | [EVENT]      | [FIELD]  | [VALUES]                                                     |
| :-----: | ------------ | -------- | ------------------------------------------------------------ |
|   [1]   | SessionStart | `source` | `startup`, `resume`, `clear`, `compact`                      |
|   [2]   | SessionStart | `model`  | Model identifier string                                      |
|   [3]   | SessionEnd   | `reason` | `clear`, `logout`, `prompt_input_exit`, `bypass_permissions_disabled`, `other` |

### [2.5][SUBAGENT_EVENTS]

| [INDEX] | [EVENT]       | [FIELD]       | [DESCRIPTION]                        |
| :-----: | ------------- | ------------- | ------------------------------------ |
|   [1]   | SubagentStart | `agent_id`    | Unique identifier for the subagent   |
|   [2]   | SubagentStart | `agent_type`  | Agent name (matcher target)          |

### [2.6][TEAM_EVENTS]

| [INDEX] | [EVENT]       | [FIELD]            | [DESCRIPTION]                            |
| :-----: | ------------- | ------------------ | ---------------------------------------- |
|   [1]   | TeammateIdle  | `teammate_name`    | Name of teammate about to go idle        |
|   [2]   | TeammateIdle  | `team_name`        | Name of the team                         |
|   [3]   | TaskCompleted | `task_id`          | Identifier of task being completed       |
|   [4]   | TaskCompleted | `task_subject`     | Title of the task                        |
|   [5]   | TaskCompleted | `task_description` | Detailed description (may be absent)     |
|   [6]   | TaskCompleted | `teammate_name`    | Teammate completing task (may be absent) |
|   [7]   | TaskCompleted | `team_name`        | Team name (may be absent)                |

### [2.7][OTHER_EVENTS]

| [INDEX] | [EVENT]          | [FIELD]               | [DESCRIPTION]                |
| :-----: | ---------------- | --------------------- | ---------------------------- |
|   [1]   | UserPromptSubmit | `prompt`              | User's input text            |
|   [2]   | PreCompact       | `trigger`             | `manual` or `auto`           |
|   [3]   | PreCompact       | `custom_instructions` | Compaction instructions      |
|   [4]   | Notification     | `message`             | Notification content         |
|   [5]   | Notification     | `title`               | Optional notification title  |
|   [6]   | Notification     | `notification_type`   | `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog` |

---
## [3][EXIT_CODES]
>**Dictum:** *Exit code 2 blocks; exit 0 with JSON controls fine-grained behavior.*

<br>

| [INDEX] | [CODE] | [BEHAVIOR]                                              |
| :-----: | :----: | ------------------------------------------------------- |
|   [1]   |   0    | Success — stdout parsed for JSON; action proceeds       |
|   [2]   |   2    | Blocking error — stderr fed to Claude; action prevented |
|   [3]   | Other  | Non-blocking error — stderr shown in verbose mode only  |

[CRITICAL] Choose one approach per hook: exit codes alone, OR exit 0 with JSON for structured control. JSON is only processed on exit 0.

### [3.1][EXIT_2_BEHAVIOR]

| [INDEX] | [EVENT]            | [EXIT_2_EFFECT]                                            |
| :-----: | ------------------ | ---------------------------------------------------------- |
|   [1]   | PreToolUse         | Blocks tool call; stderr shown to Claude                   |
|   [2]   | PermissionRequest  | Denies the permission                                      |
|   [3]   | UserPromptSubmit   | Blocks prompt processing; erases prompt from context       |
|   [4]   | Stop               | Prevents Claude from stopping; continues conversation      |
|   [5]   | SubagentStop       | Prevents subagent from stopping                            |
|   [6]   | TeammateIdle       | Prevents teammate from going idle; stderr = feedback       |
|   [7]   | TaskCompleted      | Prevents task completion; stderr = feedback to model       |
|   [8]   | PostToolUse        | Shows stderr to Claude (tool already ran, cannot undo)     |
|   [9]   | PostToolUseFailure | Shows stderr to Claude (tool already failed)               |
|  [10]   | Non-blocking events| Shows stderr to user only (no effect on execution)         |

---
## [4][EXECUTION]
>**Dictum:** *Timeouts and deduplication prevent runaway execution.*

<br>

| [INDEX] | [PROPERTY]      | [VALUE]                                          |
| :-----: | --------------- | ------------------------------------------------ |
|   [1]   | Default timeout | 600s (command), 30s (prompt), 60s (agent)        |
|   [2]   | Parallelization | All matching hooks run in parallel               |
|   [3]   | Deduplication   | Identical hook commands deduplicated             |
|   [4]   | Input           | JSON via stdin                                   |
|   [5]   | Output          | stdout for JSON responses; stderr for errors     |
|   [6]   | Environment     | `$CLAUDE_PROJECT_DIR`, `$CLAUDE_CODE_REMOTE`     |
|   [7]   | Snapshot        | Hooks captured at startup; mid-session edits require `/hooks` review |

[REFERENCE] Validation checklist: [->validation.md§2](./validation.md#2lifecycle_gate)
