# [H1][SCHEMA]
>**Dictum:** *Declarative automation requires structured configuration.*

<br>

Three nesting levels: event -> matcher group -> hook handler.

---
## [1][STRUCTURE]
>**Dictum:** *Layered configuration enables multiple hooks per event.*

<br>

```json
{
  "hooks": {
    "EventName": [{
      "matcher": "ToolPattern",
      "hooks": [{ "type": "command", "command": "script-path", "timeout": 600 }]
    }]
  }
}
```

### [1.1][COMMON_FIELDS]
All hook handler types share:

| [INDEX] | [FIELD]         | [TYPE]  | [REQ] | [DEFAULT]     | [CONSTRAINT]                                        |
| :-----: | --------------- | ------- | :---: | :-----------: | --------------------------------------------------- |
|   [1]   | `type`          | string  |  Yes  |       —       | `"command"`, `"prompt"`, or `"agent"`               |
|   [2]   | `timeout`       | number  |  No   | type-specific | Seconds. command=600, prompt=30, agent=60           |
|   [3]   | `statusMessage` | string  |  No   |       —       | Custom spinner text during hook execution           |
|   [4]   | `once`          | boolean |  No   |    `false`    | Run once per session, then removed. Skills only     |

### [1.2][COMMAND_FIELDS]
Additional fields for `type: "command"`:

| [INDEX] | [FIELD]   | [TYPE]  | [REQ] | [DEFAULT] | [CONSTRAINT]                                       |
| :-----: | --------- | ------- | :---: | :-------: | -------------------------------------------------- |
|   [1]   | `command` | string  |  Yes  |     —     | Shell command or script path                       |
|   [2]   | `async`   | boolean |  No   |  `false`  | Run in background; non-blocking; no decision control |

### [1.3][PROMPT_AND_AGENT_FIELDS]
Additional fields for `type: "prompt"` and `type: "agent"`:

| [INDEX] | [FIELD]  | [TYPE] | [REQ] | [DEFAULT]  | [CONSTRAINT]                                           |
| :-----: | -------- | ------ | :---: | :--------: | ------------------------------------------------------ |
|   [1]   | `prompt` | string |  Yes  |     —      | Instructions for LLM; `$ARGUMENTS` = hook input JSON   |
|   [2]   | `model`  | string |  No   | fast model | Model to use for evaluation                            |

---
## [2][MATCHERS]
>**Dictum:** *Matchers filter invocations; precision reduces unnecessary execution.*

<br>

### [2.1][TOOL_MATCHERS]
PreToolUse, PermissionRequest, PostToolUse, PostToolUseFailure match on `tool_name`:

| [INDEX] | [PATTERN]  | [EXAMPLE]             | [MATCHES]                     |
| :-----: | ---------- | --------------------- | ----------------------------- |
|   [1]   | Exact      | `"Bash"`              | Bash tool only                |
|   [2]   | Regex OR   | `"Edit\|Write"`       | Edit or Write tools           |
|   [3]   | Regex wild | `"Notebook.*"`        | NotebookRead, NotebookEdit    |
|   [4]   | Empty/`*`  | `""`                  | All tools (catch-all)         |
|   [5]   | MCP exact  | `"mcp__memory__.*"`   | All tools from memory server  |
|   [6]   | MCP broad  | `"mcp__.*__write.*"`  | Any MCP tool containing write |

### [2.2][SESSION_MATCHERS]

| [INDEX] | [EVENT]      | [MATCHER]                    | [TRIGGERS_ON]                     |
| :-----: | ------------ | ---------------------------- | --------------------------------- |
|   [1]   | SessionStart | `"startup"`                  | New session                       |
|   [2]   | SessionStart | `"resume"`                   | `--resume`, `--continue`, `/resume` |
|   [3]   | SessionStart | `"clear"`                    | After `/clear` command            |
|   [4]   | SessionStart | `"compact"`                  | Auto or manual compaction         |
|   [5]   | SessionEnd   | `"clear"`                    | Session cleared                   |
|   [6]   | SessionEnd   | `"logout"`                   | User logout                       |
|   [7]   | SessionEnd   | `"prompt_input_exit"`        | User exits at prompt              |
|   [8]   | SessionEnd   | `"bypass_permissions_disabled"` | Bypass mode disabled           |
|   [9]   | SessionEnd   | `"other"`                    | Other exit reasons                |

### [2.3][OTHER_MATCHERS]

| [INDEX] | [EVENT]       | [MATCHER]                 | [TRIGGERS_ON]              |
| :-----: | ------------- | ------------------------- | -------------------------- |
|   [1]   | Notification  | `"permission_prompt"`     | Permission dialog shown    |
|   [2]   | Notification  | `"idle_prompt"`           | Idle timeout notification  |
|   [3]   | Notification  | `"auth_success"`          | Authentication completed   |
|   [4]   | Notification  | `"elicitation_dialog"`    | Information request dialog |
|   [5]   | SubagentStart | `"Explore"`, `"Plan"`, etc | Agent type name           |
|   [6]   | SubagentStop  | Same as SubagentStart      | Agent type name           |
|   [7]   | PreCompact    | `"manual"` or `"auto"`    | Compaction trigger type   |

**No matcher support:** UserPromptSubmit, Stop, TeammateIdle, TaskCompleted — always fire on every occurrence.

---
## [3][JSON_RESPONSES]
>**Dictum:** *Structured responses enable fine-grained agent control.*

<br>

### [3.1][UNIVERSAL_OUTPUT]
Fields available to all events on exit 0:

| [INDEX] | [FIELD]          | [TYPE]  | [DEFAULT] | [EFFECT]                                   |
| :-----: | ---------------- | ------- | :-------: | ------------------------------------------ |
|   [1]   | `continue`       | boolean |  `true`   | `false` halts Claude entirely (overrides all) |
|   [2]   | `stopReason`     | string  |     —     | Message shown to user when `continue: false` |
|   [3]   | `suppressOutput` | boolean |  `false`  | Hides hook stdout from verbose mode output |
|   [4]   | `systemMessage`  | string  |     —     | Warning message shown to user              |

### [3.2][PRETOOLUSE_OUTPUT]
Uses `hookSpecificOutput` for three-way decision:

| [INDEX] | [FIELD]                    | [VALUES]        | [EFFECT]                              |
| :-----: | -------------------------- | --------------- | ------------------------------------- |
|   [1]   | `permissionDecision`       | `"allow"`       | Bypasses permission system            |
|   [2]   | `permissionDecision`       | `"deny"`        | Blocks tool; reason shown to Claude   |
|   [3]   | `permissionDecision`       | `"ask"`         | Prompts user to confirm               |
|   [4]   | `permissionDecisionReason` | string          | Explanation (user for allow/ask; Claude for deny) |
|   [5]   | `updatedInput`             | object          | Modifies tool parameters before execution |
|   [6]   | `additionalContext`        | string          | Context added before tool executes    |

```json
{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow"}}
```

### [3.3][PERMISSIONREQUEST_OUTPUT]
Uses `hookSpecificOutput` with nested `decision`:

| [INDEX] | [FIELD]              | [VALUES]  | [EFFECT]                                  |
| :-----: | -------------------- | --------- | ----------------------------------------- |
|   [1]   | `decision.behavior`  | `"allow"` | Grants permission silently                |
|   [2]   | `decision.behavior`  | `"deny"`  | Denies with optional message              |
|   [3]   | `decision.updatedInput` | object | Modifies tool parameters (allow only)     |
|   [4]   | `decision.updatedPermissions` | object | Applies permission rule updates (allow only) |
|   [5]   | `decision.message`   | string    | Denial reason shown to Claude (deny only) |
|   [6]   | `decision.interrupt`  | boolean  | Stops Claude if denied (deny only)        |

```json
{"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "allow"}}}
```

### [3.4][TOP_LEVEL_DECISION]
Used by UserPromptSubmit, PostToolUse, PostToolUseFailure, Stop, SubagentStop:

| [INDEX] | [FIELD]             | [VALUES]  | [EFFECT]                                    |
| :-----: | ------------------- | --------- | ------------------------------------------- |
|   [1]   | `decision`          | `"block"` | Prevents action; Claude receives reason     |
|   [2]   | `reason`            | string    | Explanation shown to Claude                 |
|   [3]   | `additionalContext` | string    | Added to Claude's context                   |

### [3.5][CONTEXT_INJECTION]
SessionStart and UserPromptSubmit support context injection:

| [INDEX] | [METHOD]                   | [EFFECT]                             |
| :-----: | -------------------------- | ------------------------------------ |
|   [1]   | Plain stdout (non-JSON)    | Injected as context for Claude       |
|   [2]   | `additionalContext` in JSON | Injected as context (more discrete) |

SessionStart also supports `CLAUDE_ENV_FILE` for persisting environment variables.

---
## [4][HOOK_TYPES]
>**Dictum:** *Three hook types serve distinct evaluation patterns.*

<br>

### [4.1][COMMAND_HOOKS]
Deterministic shell scripts. Receive JSON stdin, return exit codes + optional JSON stdout.

### [4.2][PROMPT_HOOKS]
Single-turn LLM evaluation. Sends hook input + prompt to a fast Claude model.

**Eligible events:** PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, UserPromptSubmit, Stop, SubagentStop, TaskCompleted.

**Response schema:**
```json
{"ok": true}
{"ok": false, "reason": "Explanation shown to Claude"}
```

`ok: true` allows the action. `ok: false` blocks it with the provided reason.

### [4.3][AGENT_HOOKS]
Multi-turn subagent evaluation with tool access (Read, Grep, Glob). Up to 50 turns.

**Eligible events:** Same as prompt hooks.
**Response schema:** Same as prompt hooks: `{"ok": true/false, "reason": "..."}`.

[IMPORTANT] TeammateIdle does NOT support prompt or agent hooks — exit codes only.

---
## [5][TESTING]
>**Dictum:** *Independent testing validates hook logic before deployment.*

<br>

| [INDEX] | [METHOD]    | [COMMAND]                                         |
| :-----: | ----------- | ------------------------------------------------- |
|   [1]   | List hooks  | `/hooks` interactive manager                      |
|   [2]   | Debug mode  | `claude --debug` — shows hook match/execution     |
|   [3]   | Verbose     | `Ctrl+O` toggle — shows hook output in transcript |
|   [4]   | Direct test | `echo '{"tool_name":"Bash"}' \| python hook.py`  |
|   [5]   | Disable all | `"disableAllHooks": true` in settings             |

[REFERENCE] Validation checklist: [->validation.md§1](./validation.md#1schema_gate)
