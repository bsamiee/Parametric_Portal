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

**Common fields (all types):** `type` (required: "command"|"prompt"|"agent"), `timeout` (command=600, prompt=30, agent=60), `statusMessage` (spinner text), `once` (boolean, skills only).
**Command fields:** `command` (shell command/path), `async` (background, no decision control).
**Prompt/Agent fields:** `prompt` (instructions, `$ARGUMENTS` = hook input JSON), `model` (fast model default).

---
## [2][MATCHERS]
>**Dictum:** *Matchers filter invocations; precision reduces unnecessary execution.*

<br>

**Tool matchers** (PreToolUse, PermissionRequest, PostToolUse, PostToolUseFailure):

| [INDEX] | [PATTERN]  | [EXAMPLE]           | [MATCHES]                    |
| :-----: | ---------- | ------------------- | ---------------------------- |
|   [1]   | Exact      | `"Bash"`            | Bash tool only               |
|   [2]   | Regex OR   | `"Edit\|Write"`     | Edit or Write                |
|   [3]   | Regex wild | `"Notebook.*"`      | NotebookRead, NotebookEdit   |
|   [4]   | Empty/`*`  | `""`                | All tools (catch-all)        |
|   [5]   | MCP        | `"mcp__memory__.*"` | All tools from memory server |

**Session matchers:** `"startup"`, `"resume"`, `"clear"`, `"compact"` (SessionStart); `"init"`, `"maintenance"` (Setup); `"clear"`, `"logout"`, `"prompt_input_exit"`, `"bypass_permissions_disabled"`, `"other"` (SessionEnd).
**Other matchers:** Notification: `"permission_prompt"`, `"idle_prompt"`, `"auth_success"`, `"elicitation_dialog"`. SubagentStart/Stop: agent type name. PreCompact: `"manual"|"auto"`.
**No matcher support:** UserPromptSubmit, Stop, TeammateIdle, TaskCompleted — always fire.

---
## [3][JSON_RESPONSES]
>**Dictum:** *Structured responses enable fine-grained agent control.*

<br>

**Universal output (exit 0):** `continue` (false halts Claude), `stopReason` (message on halt), `suppressOutput` (hide stdout), `systemMessage` (warning to user).

**PreToolUse:** `hookSpecificOutput.permissionDecision` ("allow"|"deny"|"ask"), `permissionDecisionReason`, `updatedInput` (modify tool params), `additionalContext`.

**PermissionRequest:** `hookSpecificOutput.decision.behavior` ("allow"|"deny"), `decision.updatedInput`, `decision.updatedPermissions`, `decision.message` (deny reason), `decision.interrupt` (stop Claude on deny).

**Top-level decision** (UserPromptSubmit, PostToolUse, PostToolUseFailure, Stop, SubagentStop): `decision` ("block"), `reason`, `additionalContext`.

**Context injection** (SessionStart, Setup, UserPromptSubmit): Plain stdout or `additionalContext` in JSON. SessionStart supports `CLAUDE_ENV_FILE`. Setup stdout becomes context visible to Claude.

---
## [4][HOOK_TYPES]
>**Dictum:** *Three hook types serve distinct evaluation patterns.*

<br>

**Command hooks:** Deterministic shell scripts. JSON stdin, exit codes + optional JSON stdout.
**Prompt hooks:** Single-turn LLM evaluation. Response: `{"ok": true}` or `{"ok": false, "reason": "..."}`.
**Agent hooks:** Multi-turn subagent with tool access (Read, Grep, Glob). Up to 50 turns. Same response schema as prompt.

**Eligible events (prompt/agent):** PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, UserPromptSubmit, Stop, SubagentStop, TaskCompleted.

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
|   [4]   | Direct test | `echo '{"tool_name":"Bash"}' \| python hook.py`   |
|   [5]   | Disable all | `"disableAllHooks": true` in settings             |

[REFERENCE] Validation checklist: [->validation.md§1](./validation.md#1schema_gate)
