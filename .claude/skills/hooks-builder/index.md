# [H1][INDEX]
>**Dictum:** *Reference navigation requires centralized discovery.*

<br>

Navigate hook configuration, lifecycle, integration patterns.

| [INDEX] | [DOMAIN]        | [PATH]                                                | [DICTUM]                                                 |
| :-----: | --------------- | ----------------------------------------------------- | -------------------------------------------------------- |
|   [1]   | Schema          | [->schema.md](references/schema.md)                   | Schema compliance ensures valid configuration.           |
|   [2]   | Lifecycle       | [->lifecycle.md](references/lifecycle.md)             | Lifecycle understanding enables correct event selection. |
|   [3]   | Integration     | [->integration.md](references/integration.md)         | Integration knowledge enables precedence control.        |
|   [4]   | Scripting       | [->scripting.md](references/scripting.md)             | Functional pipeline patterns ensure reliable hooks.      |
|   [5]   | Recipes         | [->recipes.md](references/recipes.md)                 | Proven patterns accelerate development.                  |
|   [6]   | Troubleshooting | [->troubleshooting.md](references/troubleshooting.md) | Known issues enable defensive implementation.            |
|   [7]   | Validation      | [->validation.md](references/validation.md)           | Operational criteria verify hook quality.                |

**Summary:**
- *Hook types:* `command` (600s timeout), `prompt` (30s, 8 eligible events), `agent` (60s, 8 eligible events, up to 50 turns).
- *Events:* 14 lifecycle events — 7 blocking (exit 2 blocks action), 7 non-blocking (exit 2 shows stderr only).
- *Blocking events:* PreToolUse, PermissionRequest, UserPromptSubmit, Stop, SubagentStop, TeammateIdle, TaskCompleted.
- *Non-blocking events:* PostToolUse, PostToolUseFailure, SessionStart, SessionEnd, Notification, SubagentStart, PreCompact.
- *Prompt/agent response:* `{"ok": true}` allows; `{"ok": false, "reason": "..."}` blocks.
- *Fields:* `async` (background execution), `statusMessage` (custom spinner text), `once` (skills only).
- *Context injection:* SessionStart, UserPromptSubmit stdout → Claude context.
- *Security:* `shell=False`, `realpath()`, no `eval()`.
- *Environment:* `$CLAUDE_PROJECT_DIR`, `$CLAUDE_CODE_REMOTE`, `$CLAUDE_ENV_FILE` (SessionStart only).
- *Testing:* `/hooks` interactive manager, `claude --debug`, `Ctrl+O` verbose mode.
