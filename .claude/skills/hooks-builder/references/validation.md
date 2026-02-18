# [H1][VALIDATION]
>**Dictum:** *Operational criteria verify hook quality.*

<br>

Consolidated checklist for hooks-builder. SKILL.md §VALIDATION contains high-level gates; this file contains operational verification procedures.

---
## [1][SCHEMA_GATE]
>**Dictum:** *Silent registration failures demand pre-validation.*

<br>

[VERIFY] Schema compliance:
- [ ] JSON syntax valid—no trailing commas.
- [ ] `type` is `"command"`, `"prompt"`, or `"agent"`.
- [ ] Script path exists and is executable (command type).
- [ ] `prompt` field present (prompt/agent types).
- [ ] Matcher regex valid for target tools.
- [ ] Timeout in SECONDS: command <=600, prompt <=30, agent <=60.
- [ ] `async` and `statusMessage` fields used appropriately.
- [ ] `once` field only used in skill-scoped hooks.

---
## [2][LIFECYCLE_GATE]
>**Dictum:** *Pre-implementation verification prevents runtime failures.*

<br>

[VERIFY] Lifecycle compliance:
- [ ] Match event to automation goal (blocking or observing).
- [ ] Blocking events (7): PreToolUse, PermissionRequest, UserPromptSubmit, Stop, SubagentStop, TeammateIdle, TaskCompleted.
- [ ] Non-blocking events (7): PostToolUse, PostToolUseFailure, SessionStart, SessionEnd, Notification, SubagentStart, PreCompact.
- [ ] Access input schema fields correctly per event type.
- [ ] Use exit code 0 for warnings, exit code 2 for intentional blocking.
- [ ] Set timeout appropriate for script complexity (in seconds).
- [ ] Consider race conditions for PermissionRequest hooks under 1.5s.

---
## [3][INTEGRATION_GATE]
>**Dictum:** *Gate checklist verification ensures correct integration.*

<br>

[VERIFY] Integration compliance:
- [ ] `$CLAUDE_PROJECT_DIR` quoted in command strings.
- [ ] Context injection uses SessionStart or UserPromptSubmit only.
- [ ] `CLAUDE_ENV_FILE` used only in SessionStart hooks.
- [ ] Plugin hooks use `${CLAUDE_PLUGIN_ROOT}` for portability.
- [ ] Windows: absolute paths used instead of env variables.
- [ ] PermissionRequest hooks complete in <1.5s.

---
## [4][SCRIPTING_GATE]
>**Dictum:** *Gate checklist enforces script quality.*

<br>

[VERIFY] Script quality:
- [ ] `ty check` passes with zero errors.
- [ ] `ruff check` passes with zero violations.
- [ ] No `if/else` chains—use dispatch tables.
- [ ] No mutable state—use frozen dataclasses.
- [ ] No forbidden security patterns.
- [ ] Path validation uses `realpath()`.

---
## [5][RECIPES_GATE]
>**Dictum:** *Gate checklist enforces recipe quality.*

<br>

[VERIFY] Recipe compliance:
- [ ] Dispatch tables replace if/else chains.
- [ ] `B: Final` consolidates configuration.
- [ ] Frozen dataclasses for structured data.
- [ ] Exit 0 for non-blocking hooks.
- [ ] Prompt/agent hooks use `{"ok": true/false}` response schema.

---
## [6][TROUBLESHOOTING_GATE]
>**Dictum:** *Gate checklist prevents common failures.*

<br>

[VERIFY] Deployment readiness:
- [ ] JSON syntax validated (no trailing commas).
- [ ] Script has executable permission (`chmod +x`).
- [ ] Shebang uses `#!/usr/bin/env python3`.
- [ ] Windows uses absolute paths.
- [ ] Exit code 0 for non-blocking feedback.
- [ ] PermissionRequest hooks complete in <1.5s.
- [ ] Prompt/agent hooks only on eligible events (8 events, NOT TeammateIdle).

---
## [7][ERROR_SYMPTOMS]
>**Dictum:** *Symptom-to-fix mapping accelerates diagnosis.*

<br>

| [SYMPTOM]                 | [CAUSE]                       | [FIX]                         |
| ------------------------- | ----------------------------- | ----------------------------- |
| Hook not registered       | Trailing commas in JSON       | Validate JSON syntax          |
| Permission denied         | Missing executable permission | `chmod +x script.py`          |
| Exit code 1 blocks        | Bug #4809                     | Use exit 0 for warnings       |
| PermissionRequest race    | Hook >1.5s                    | Optimize or use PreToolUse    |
| Env vars not expanded     | Windows platform              | Use absolute paths            |
| `/hooks` shows "No hooks" | Wrong settings.json location  | Check file path (#11544)      |
| Variables not expanded    | Template syntax `{{...}}`     | Use env vars instead          |
| SessionEnd not firing     | `/clear` command used         | Known issue (#6428)           |
| Prompt hook not firing    | Used on TeammateIdle          | TeammateIdle: exit codes only |
| Wrong timeout units       | Used milliseconds             | Timeouts are in SECONDS       |

---
## [8][OPERATIONAL_COMMANDS]
>**Dictum:** *Observable outcomes enable verification.*

<br>

```bash
# JSON validation
python3 -c "import json; json.load(open('.claude/settings.json'))"

# Hook listing
/hooks

# Direct script test
printf '%s' '{"tool_name":"Bash","tool_input":{"command":"ls"}}' | python3 .claude/hooks/validate.py
printf 'Exit: %d\n' "$?"

# Debug mode
claude --debug

# Verbose mode (see hook output)
# Press Ctrl+O in session

# Executable verification
eza -la .claude/hooks/*.py  # Check +x permission
head -1 .claude/hooks/*.py  # Check shebang
```
