# [H1][SCHEMA]
>**Dictum:** *Declarative automation requires structured configuration.*

<br>

Matchers filter events; commands execute automation.

---
## [1][STRUCTURE]
>**Dictum:** *Layered validation benefits from multiple hooks per event.*

<br>

```json
{
  "hooks": {
    "EventName": [{
      "matcher": "ToolPattern",
      "hooks": [{ "type": "command", "command": "script-path", "timeout": 60000 }]
    }]
  }
}
```

| [INDEX] | [FIELD]   | [TYPE] | [REQ] | [DEFAULT] | [CONSTRAINT]                         |
| :-----: | --------- | ------ | :---: | :-------: | ------------------------------------ |
|   [1]   | `matcher` | string |  No   |   `""`    | Regex or exact tool name             |
|   [2]   | `type`    | string |  Yes  |     —     | `"command"` or `"prompt"`            |
|   [3]   | `command` | string |  Yes  |     —     | Shell command or script path         |
|   [4]   | `timeout` | number |  No   |  `60000`  | ms, max 600000; prompt default 30000 |

---
## [2][MATCHERS]
>**Dictum:** *Matchers filter invocations; precision reduces unnecessary execution.*

<br>

### [2.1][TOOL_MATCHERS]
Tool events (PreToolUse, PermissionRequest, PostToolUse):

| [INDEX] | [PATTERN]  | [EXAMPLE]       | [MATCHES]                  |
| :-----: | ---------- | --------------- | -------------------------- |
|   [1]   | Exact      | `"Bash"`        | Bash tool only             |
|   [2]   | Regex OR   | `"Edit\|Write"` | Edit or Write tools        |
|   [3]   | Regex wild | `"Notebook.*"`  | NotebookRead, NotebookEdit |
|   [4]   | Empty/`*`  | `""`            | All tools (catch-all)      |
|   [5]   | MCP prefix | `"mcp__.*"`     | All MCP tool calls         |

### [2.2][SESSION_MATCHERS]
Session events (SessionStart, SessionEnd):

| [INDEX] | [EVENT]      | [MATCHER]             | [TRIGGERS_ON]           |
| :-----: | ------------ | --------------------- | ----------------------- |
|   [1]   | SessionStart | `"startup"`           | Fresh session start     |
|   [2]   | SessionStart | `"resume"`            | Session resumed         |
|   [3]   | SessionStart | `"clear"`             | After `/clear` command  |
|   [4]   | SessionStart | `"compact"`           | After context compacted |
|   [5]   | SessionStart | `"startup\|resume"`   | Common: init or resume  |
|   [6]   | SessionEnd   | `"logout"`            | User logout             |
|   [7]   | SessionEnd   | `"prompt_input_exit"` | User exits at prompt    |

### [2.3][NOTIFICATION_MATCHERS]
Notification events:

| [INDEX] | [MATCHER]            | [TRIGGERS_ON]              |
| :-----: | -------------------- | -------------------------- |
|   [1]   | `permission_prompt`  | Permission dialog shown    |
|   [2]   | `idle_prompt`        | Idle timeout notification  |
|   [3]   | `auth_success`       | Authentication completed   |
|   [4]   | `elicitation_dialog` | Information request dialog |

---
## [3][JSON_RESPONSES]
>**Dictum:** *Structured responses enable fine-grained agent control.*

<br>

### [3.1][COMMON_OUTPUT]
Common response fields:

| [INDEX] | [FIELD]          | [TYPE]  | [EFFECT]                                   |
| :-----: | ---------------- | ------- | ------------------------------------------ |
|   [1]   | `continue`       | boolean | `false` halts Claude entirely (overrides)  |
|   [2]   | `stopReason`     | string  | Message shown when `continue: false`       |
|   [3]   | `suppressOutput` | boolean | Hides hook stdout from transcript (Ctrl-R) |
|   [4]   | `systemMessage`  | string  | Injects system-level message to Claude     |

### [3.2][PRETOOLUSE_OUTPUT]

| [INDEX] | [FIELD]                    | [VALUES]  | [EFFECT]                      |
| :-----: | -------------------------- | --------- | ----------------------------- |
|   [1]   | `permissionDecision`       | `"allow"` | Bypasses permission system    |
|   [2]   | `permissionDecision`       | `"deny"`  | Blocks tool, reason to Claude |
|   [3]   | `permissionDecision`       | `"ask"`   | Shows permission dialog       |
|   [4]   | `permissionDecisionReason` | string    | Explanation shown to Claude   |
|   [5]   | `updatedInput`             | object    | Modifies tool parameters      |

```json
{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow"}}
```

### [3.3][PERMISSIONREQUEST_OUTPUT]

| [INDEX] | [FIELD]        | [VALUES]  | [EFFECT]                      |
| :-----: | -------------- | --------- | ----------------------------- |
|   [1]   | `behavior`     | `"allow"` | Grants permission silently    |
|   [2]   | `behavior`     | `"deny"`  | Denies with optional reason   |
|   [3]   | `updatedInput` | object    | Modifies tool parameters      |
|   [4]   | `message`      | string    | Denial reason shown to Claude |
|   [5]   | `interrupt`    | boolean   | Interrupts current operation  |

```json
{"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "allow", "updatedInput": {}}}}
```

### [3.4][POSTTOOLUSE_OUTPUT]

| [INDEX] | [FIELD]             | [VALUES]  | [EFFECT]                   |
| :-----: | ------------------- | --------- | -------------------------- |
|   [1]   | `decision`          | `"block"` | Prompts Claude with reason |
|   [2]   | `additionalContext` | string    | Adds context for Claude    |

### [3.5][SESSION_OUTPUT]
Session context injection (SessionStart, UserPromptSubmit):

| [INDEX] | [FIELD]             | [EFFECT]                    |
| :-----: | ------------------- | --------------------------- |
|   [1]   | `additionalContext` | Injected as context         |
|   [2]   | Plain stdout        | Also injected (exit code 0) |

---
## [4][PROMPT_HOOKS]
>**Dictum:** *LLM evaluation handles context-dependent decisions beyond static rules.*

<br>

| [INDEX] | [FIELD]   | [TYPE]     | [DEFAULT] | [CONSTRAINT]                                    |
| :-----: | --------- | ---------- | :-------: | ----------------------------------------------- |
|   [1]   | `type`    | `"prompt"` |     —     | Required for LLM evaluation                     |
|   [2]   | `prompt`  | string     |     —     | Custom instructions; use `$ARGUMENTS` for input |
|   [3]   | `timeout` | number     |  `30000`  | ms, shorter than command                        |

**Eligible events:** Stop, SubagentStop.<br>
**Response schema:** `{"decision": "approve"|"block", "reason": "..."}`<br>
**Deprecated:** `"decision": "approve"|"block"` maps to `"allow"|"deny"` in command hooks.

---
## [5][TESTING]
>**Dictum:** *Independent testing validates hook logic before deployment.*

<br>

| [INDEX] | [METHOD]    | [COMMAND]                                       |
| :-----: | ----------- | ----------------------------------------------- |
|   [1]   | List hooks  | `/hooks`                                        |
|   [2]   | Debug mode  | `claude --debug`                                |
|   [3]   | Direct test | `echo '{"tool_name":"Bash"}' \| python hook.py` |

[REFERENCE] Validation checklist: [→validation.md§1](./validation.md#1schema_gate)
