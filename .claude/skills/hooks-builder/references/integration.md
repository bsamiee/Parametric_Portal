# [H1][INTEGRATION]
>**Dictum:** *Settings precedence governs hook resolution.*

<br>

Hooks integrate via settings files, environment variables, and context injection patterns.

---
## [1][ENVIRONMENT]
>**Dictum:** *Environment variables enable portable automation.*

<br>

### [1.1][HOOK_VARIABLES]
Variables injected by Claude Code into hook execution context:

| [INDEX] | [VARIABLE]            | [SCOPE]        | [VALUE]                            |
| :-----: | --------------------- | -------------- | ---------------------------------- |
|   [1]   | `CLAUDE_PROJECT_DIR`  | All hooks      | Absolute path to project root      |
|   [2]   | `CLAUDE_WORKING_DIR`  | All hooks      | Current working directory          |
|   [3]   | `CLAUDE_SESSION_ID`   | All hooks      | Current session identifier         |
|   [4]   | `CLAUDE_EVENT_TYPE`   | All hooks      | Event name (e.g., `PreToolUse`)    |
|   [5]   | `CLAUDE_TOOL_NAME`    | Tool hooks     | Tool being invoked (e.g., `Write`) |
|   [6]   | `CLAUDE_TOOL_INPUT`   | Tool hooks     | Raw tool parameters as JSON        |
|   [7]   | `CLAUDE_TOOL_OUTPUT`  | PostToolUse    | Tool execution output              |
|   [8]   | `CLAUDE_FILE_PATHS`   | Tool hooks     | Space-separated file paths         |
|   [9]   | `CLAUDE_NOTIFICATION` | Notification   | Message content                    |
|  [10]   | `CLAUDE_ENV_FILE`     | SessionStart   | Path to append `export` statements |
|  [11]   | `CLAUDE_PLUGIN_ROOT`  | Plugin hooks   | Absolute path to plugin directory  |
|  [12]   | `CLAUDE_CODE_REMOTE`  | Remote context | `"true"` when running remotely     |

### [1.2][CUSTOM_VARIABLES]

Define debug flags via environment for hook development:

```python
from typing import Final
import os
DEBUG: Final[bool] = os.environ.get("CLAUDE_HOOK_DEBUG", "").lower() in ("1", "true")
_debug = lambda msg: DEBUG and print(f"[hook] {msg}", file=sys.stderr)
```

### [1.3][PATH_PATTERNS]

```json
{ "command": "python3 \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/validate.py" }
```

[CRITICAL] Quote `$CLAUDE_PROJECT_DIR` to handle paths with spaces.

### [1.4][FOLDER_STRUCTURE]

```
.claude/
├── hooks/                    # Hook scripts
│   ├── validate-bash.py      # PreToolUse validator
│   └── load-context.py       # SessionStart context loader
├── settings.json             # Project hooks (committed)
└── settings.local.json       # Local hooks (gitignored)
```

---
## [2][CONTEXT_INJECTION]
>**Dictum:** *Stdout from specific events injects context for Claude.*

<br>

### [2.1][OUTPUT_ROUTING]

| [INDEX] | [EVENT]          | [STDOUT_HANDLING]            |
| :-----: | ---------------- | ---------------------------- |
|   [1]   | SessionStart     | Added as context for Claude  |
|   [2]   | UserPromptSubmit | Added as context for Claude  |
|   [3]   | PreToolUse       | Shown in transcript (Ctrl-R) |
|   [4]   | PostToolUse      | Shown in transcript (Ctrl-R) |
|   [5]   | Others           | Debug log only (`--debug`)   |

### [2.2][SESSIONSTART_PATTERN]

```python
import json
from typing import Final

WRAPPER: Final = "context"
def build_response(content: str) -> dict[str, object]:
    return {"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": f"<{WRAPPER}>\n{content}\n</{WRAPPER}>"}}
print(json.dumps(build_response("Project uses Effect. Follow REQUIREMENTS.md.")))
```

### [2.3][ENV_FILE_PERSISTENCE]

SessionStart hooks can persist variables for entire session via `CLAUDE_ENV_FILE`:

```python
from pathlib import Path
import os
from typing import Final

def cache_to_env(key: str, value: str) -> None:
    env_file = os.environ.get("CLAUDE_ENV_FILE")
    _ = env_file and Path(env_file).open("a").write(f"export {key}={value}\n")

# Usage: cache computed values for session duration
cache_to_env("SKILL_COUNT", str(len(skills)))
```

---
## [3][ATTENTION_WEIGHTING]
>**Dictum:** *XML-like tags increase agent attention.*

<br>

| [INDEX] | [TAG]         | [WEIGHT] | [USE]                     |
| :-----: | ------------- | :------: | ------------------------- |
|   [1]   | `<CRITICAL>`  | Highest  | Must-follow constraints   |
|   [2]   | `<IMPORTANT>` |   High   | Key guidance              |
|   [3]   | `<context>`   | Standard | General context injection |

```python
context = "<IMPORTANT>All files must pass basedpyright.</IMPORTANT>"
```

---
## [4][MERGE_BEHAVIOR]
>**Dictum:** *Hooks from all scopes merge at session start.*

<br>

| [INDEX] | [SCOPE] | [PATH]                        | [PRECEDENCE] |
| :-----: | ------- | ----------------------------- | :----------: |
|   [1]   | User    | `~/.claude/settings.json`     |    Lowest    |
|   [2]   | Project | `.claude/settings.json`       |    Medium    |
|   [3]   | Local   | `.claude/settings.local.json` |   Highest    |

- Same event hooks from all scopes run in parallel
- Hook snapshots captured at startup; changes require `/hooks` review
- Identical hook commands auto-deduplicated

---
## [5][VALIDATION]
>**Dictum:** *Gate checklist ensures correct integration.*

<br>

[VERIFY] Pre-deployment:
- [ ] `$CLAUDE_PROJECT_DIR` quoted in command strings.
- [ ] Context injection uses SessionStart or UserPromptSubmit.
- [ ] `CLAUDE_ENV_FILE` used only in SessionStart hooks.
- [ ] Plugin hooks use `${CLAUDE_PLUGIN_ROOT}` for portability.
- [ ] Attention tags applied to critical context.
