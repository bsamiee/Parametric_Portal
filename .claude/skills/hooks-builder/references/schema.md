# [H1][SCHEMA]
>**Dictum:** *Configuration structure determines hook registration.*

<br>

Hook configuration in settings.json. Matchers filter events; commands execute automation.

---
## [1][STRUCTURE]
>**Dictum:** *Nested arrays enable multiple hooks per event.*

<br>

```json
{
  "hooks": {
    "EventName": [
      {
        "matcher": "ToolPattern",
        "hooks": [
          { "type": "command", "command": "script-path", "timeout": 60000 }
        ]
      }
    ]
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
>**Dictum:** *Matchers filter which invocations trigger hooks.*

<br>

### [2.1][TOOL_MATCHERS]
Apply to PreToolUse, PermissionRequest, PostToolUse:

| [INDEX] | [PATTERN]  | [EXAMPLE]       | [MATCHES]                  |
| :-----: | ---------- | --------------- | -------------------------- |
|   [1]   | Exact      | `"Bash"`        | Bash tool only             |
|   [2]   | Regex OR   | `"Edit\|Write"` | Edit or Write tools        |
|   [3]   | Regex wild | `"Notebook.*"`  | NotebookRead, NotebookEdit |
|   [4]   | Empty/`*`  | `""` or `"*"`   | All tools (catch-all)      |
|   [5]   | MCP prefix | `"mcp__.*"`     | All MCP tool calls         |

### [2.2][SESSION_MATCHERS]
Apply to SessionStart, SessionEnd events:

| [INDEX] | [EVENT]      | [MATCHER]             | [TRIGGERS_ON]            |
| :-----: | ------------ | --------------------- | ------------------------ |
|   [1]   | SessionStart | `"startup"`           | Fresh session start      |
|   [2]   | SessionStart | `"resume"`            | Session resumed          |
|   [3]   | SessionStart | `"clear"`             | After `/clear` command   |
|   [4]   | SessionStart | `"compact"`           | After context compaction |
|   [5]   | SessionStart | `"startup\|resume"`   | Common: init or resume   |
|   [6]   | SessionEnd   | `"logout"`            | User logout              |
|   [7]   | SessionEnd   | `"prompt_input_exit"` | User exits at prompt     |

### [2.3][NOTIFICATION_MATCHERS]
Apply to Notification event only:

| [INDEX] | [MATCHER]            | [TRIGGERS_ON]              |
| :-----: | -------------------- | -------------------------- |
|   [1]   | `permission_prompt`  | Permission dialog shown    |
|   [2]   | `idle_prompt`        | Idle timeout notification  |
|   [3]   | `auth_success`       | Authentication completed   |
|   [4]   | `elicitation_dialog` | Information request dialog |

---
## [3][JSON_RESPONSES]
>**Dictum:** *Structured JSON responses enable fine-grained control.*

<br>

### [3.1][PRETOOLUSE_OUTPUT]

| [INDEX] | [FIELD]              | [VALUES]  | [EFFECT]                      |
| :-----: | -------------------- | --------- | ----------------------------- |
|   [1]   | `continue`           | `false`   | Stops Claude processing       |
|   [2]   | `permissionDecision` | `"allow"` | Bypasses permission system    |
|   [3]   | `permissionDecision` | `"deny"`  | Blocks tool, reason to Claude |
|   [4]   | `permissionDecision` | `"ask"`   | Shows permission dialog       |
|   [5]   | `updatedInput`       | `{...}`   | Modifies tool parameters      |

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "updatedInput": { "timeout": 30000 }
  }
}
```

### [3.2][PERMISSIONREQUEST_OUTPUT]

| [INDEX] | [FIELD]        | [VALUES]  | [EFFECT]                    |
| :-----: | -------------- | --------- | --------------------------- |
|   [1]   | `behavior`     | `"allow"` | Grants permission silently  |
|   [2]   | `behavior`     | `"deny"`  | Denies with optional reason |
|   [3]   | `updatedInput` | `{...}`   | Modifies tool parameters    |

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": { "behavior": "allow" },
    "updatedInput": { "file_path": "/sanitized/path" }
  }
}
```

### [3.3][POSTTOOLUSE_OUTPUT]

| [INDEX] | [FIELD]             | [VALUES]  | [EFFECT]                   |
| :-----: | ------------------- | --------- | -------------------------- |
|   [1]   | `decision`          | `"block"` | Prompts Claude with reason |
|   [2]   | `additionalContext` | `"..."`   | Adds context for Claude    |

### [3.4][SESSION_OUTPUT]

| [INDEX] | [FIELD]             | [EVENTS]                       | [EFFECT]           |
| :-----: | ------------------- | ------------------------------ | ------------------ |
|   [1]   | `additionalContext` | SessionStart, UserPromptSubmit | Context for Claude |

---
## [4][PROMPT_HOOKS]
>**Dictum:** *Prompt hooks enable LLM-evaluated decisions.*

<br>

| [INDEX] | [FIELD]   | [TYPE]     | [DEFAULT] | [CONSTRAINT]                   |
| :-----: | --------- | ---------- | :-------: | ------------------------------ |
|   [1]   | `type`    | `"prompt"` |     —     | Required for LLM evaluation    |
|   [2]   | `prompt`  | string     |     —     | Custom instructions for Claude |
|   [3]   | `timeout` | number     |  `30000`  | ms, shorter than command hooks |

**Eligible events:** Stop, SubagentStop, UserPromptSubmit, PreToolUse, PermissionRequest.

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Evaluate if task is complete. Return decision: approve or block.",
            "timeout": 30000
          }
        ]
      }
    ]
  }
}
```

---
## [5][TESTING]
>**Dictum:** *Test hooks independently before integration.*

<br>

| [INDEX] | [METHOD]    | [COMMAND]                                       |
| :-----: | ----------- | ----------------------------------------------- |
|   [1]   | List hooks  | `/hooks`                                        |
|   [2]   | Debug mode  | `claude --debug`                                |
|   [3]   | Direct test | `echo '{"tool_name":"Bash"}' \| python hook.py` |

---
## [6][VALIDATION]
>**Dictum:** *Gate checklist prevents registration failures.*

<br>

[VERIFY] Pre-deployment:
- [ ] JSON syntax valid—no trailing commas.
- [ ] `type` is `"command"` or `"prompt"`.
- [ ] Script path exists and is executable.
- [ ] Matcher regex valid for target tools.
- [ ] Timeout ≤600000ms (command) or ≤30000ms (prompt).
