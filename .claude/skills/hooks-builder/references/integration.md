# [H1][INTEGRATION]
>**Dictum:** *Settings precedence governs hook resolution.*

<br>

Hooks integrate via settings files, environment variables, and context injection patterns.

---
## [1][ENVIRONMENT]
>**Dictum:** *Environment variables enable portable automation.*

<br>

### [1.1][HOOK_VARIABLES]

| [INDEX] | [VARIABLE]            | [SCOPE]      | [VALUE]                            |
| :-----: | --------------------- | ------------ | ---------------------------------- |
|   [1]   | `CLAUDE_PROJECT_DIR`  | All hooks    | Absolute path to project root      |
|   [2]   | `CLAUDE_CODE_REMOTE`  | All hooks    | `"true"` for web, unset for CLI    |
|   [3]   | `CLAUDE_ENV_FILE`     | SessionStart | Path to append `export` statements |
|   [4]   | `CLAUDE_PLUGIN_ROOT`  | Plugin hooks | Absolute path to plugin directory  |

[IMPORTANT] All other event-specific data (session_id, tool_name, tool_input, cwd, etc.) is delivered via JSON stdin, NOT environment variables. Parse with `jq` (Bash) or `json.load(sys.stdin)` (Python).

### [1.2][CUSTOM_VARIABLES]

```python
DEBUG: Final[bool] = os.environ.get("CLAUDE_HOOK_DEBUG", "").lower() in ("1", "true")
_debug = lambda msg: DEBUG and print(f"[hook] {msg}", file=sys.stderr)
```

### [1.3][PATH_PATTERNS]

```json
{ "command": "python3 \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/validate.py" }
```

[CRITICAL] Quote `$CLAUDE_PROJECT_DIR` for paths with spaces.

### [1.4][PLATFORM_WARNINGS]

| [INDEX] | [PLATFORM] | [ISSUE]                              | [WORKAROUND]              |
| :-----: | ---------- | ------------------------------------ | ------------------------- |
|   [1]   | Windows    | `$CLAUDE_PROJECT_DIR` literal string | Use absolute paths        |
|   [2]   | Windows    | PATH wiped on env append             | Use full executable paths |
|   [3]   | Remote     | SSH key access required              | Configure SSH agent       |

---
## [2][CONTEXT_INJECTION]
>**Dictum:** *Stdout from specific events injects context to Claude.*

<br>

### [2.1][OUTPUT_ROUTING]

| [INDEX] | [EVENT]          | [STDOUT_HANDLING]            |
| :-----: | ---------------- | ---------------------------- |
|   [1]   | SessionStart     | Added as context for Claude  |
|   [2]   | UserPromptSubmit | Added as context for Claude  |
|   [3]   | PreToolUse       | Shown in verbose mode (Ctrl+O) |
|   [4]   | PostToolUse      | Shown in verbose mode (Ctrl+O) |
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

```python
from pathlib import Path
import os
def cache_to_env(key: str, value: str) -> None:
    env_file = os.environ.get("CLAUDE_ENV_FILE")
    _ = env_file and Path(env_file).open("a").write(f"export {key}={value}\n")
# Usage: cache computed values for session duration
cache_to_env("SKILL_COUNT", str(len(skills)))
```

---
## [3][ATTENTION_WEIGHTING]
>**Dictum:** *XML-like tags weight agent attention.*

<br>

| [INDEX] | [TAG]         | [WEIGHT] | [USE]                     |
| :-----: | ------------- | :------: | ------------------------- |
|   [1]   | `<CRITICAL>`  | Highest  | Must-follow constraints   |
|   [2]   | `<IMPORTANT>` |   High   | Key guidance              |
|   [3]   | `<context>`   | Standard | General context injection |

---
## [4][MERGE_BEHAVIOR]
>**Dictum:** *Scope merging at session start composes hooks.*

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
## [5][TIMING]
>**Dictum:** *Fast hook execution preserves user experience.*

<br>

| [INDEX] | [EVENT]           | [THRESHOLD] | [CONSEQUENCE]                |
| :-----: | ----------------- | :---------: | ---------------------------- |
|   [1]   | PermissionRequest |    <1.5s    | Race condition; dialog shown |
|   [2]   | SessionStart      |     <5s     | Delayed session start        |
|   [3]   | All hooks         |   <100ms    | Imperceptible latency        |

---
## [6][FOLDER_STRUCTURE]

```
.claude/
├── hooks/                    # Hook scripts
│   ├── validate-bash.py      # PreToolUse validator
│   └── load-context.py       # SessionStart context loader
├── settings.json             # Project hooks (committed)
└── settings.local.json       # Local hooks (gitignored)
```

[REFERENCE] Validation checklist: [→validation.md§3](./validation.md#3integration_gate)
