# [H1][TROUBLESHOOTING]
>**Dictum:** *Known issue awareness enables defensive implementation.*

<br>

Platform-specific bugs, timing issues, and configuration gotchas.

---
## [1][PLATFORM_ISSUES]
>**Dictum:** *Platform differences require explicit handling.*

<br>

| [INDEX] | [PLATFORM] | [ISSUE]                       | [WORKAROUND]                        |
| :-----: | ---------- | ----------------------------- | ----------------------------------- |
|   [1]   | Windows    | `$CLAUDE_PROJECT_DIR` literal | Use absolute paths in command field |
|   [2]   | Windows    | PATH wiped on env append      | Use full executable paths           |
|   [3]   | Windows    | Shell expansion fails         | Write .bat wrapper scripts          |
|   [4]   | WSL        | Path translation issues       | Use `/mnt/c/` paths consistently    |
|   [5]   | Docker     | SSH key access required       | Mount SSH agent socket              |
|   [6]   | SSHFS      | Relative paths fail           | Use absolute paths only             |

### [1.1][WINDOWS_WORKAROUND]

```json
{
  "command": "C:\\Python314\\python.exe C:\\Projects\\myproject\\.claude\\hooks\\validate.py"
}
```

---
## [2][TIMING_ISSUES]
>**Dictum:** *Hook execution speed determines behavior.*

<br>

| [INDEX] | [ISSUE]                | [THRESHOLD] | [SOLUTION]                         |
| :-----: | ---------------------- | :---------: | ---------------------------------- |
|   [1]   | PermissionRequest race |    1.5s     | Keep hooks <1.5s or use PreToolUse |
|   [2]   | Duplicate execution    |      —      | Add file locking or deduplication  |
|   [3]   | SessionStart timeout   |     60s     | Cache expensive computations       |
|   [4]   | Slow network calls     |      —      | Use async or background processes  |

### [2.1][DEDUPLICATION_PATTERN]

```python
import fcntl, sys, contextlib
from pathlib import Path
from typing import Final

LOCK: Final = Path("/tmp/claude-hook.lock")

def _acquire_lock() -> bool:
    with contextlib.suppress(BlockingIOError):
        fcntl.flock(LOCK.open("w"), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    return False

_acquire_lock() or sys.exit(0)  # Another instance running
```

---
## [3][EXIT_CODE_GOTCHAS]
>**Dictum:** *Exit code verification compensates for documentation divergence.*

<br>

| [INDEX] | [CODE] | [DOCUMENTED]       | [ACTUAL]                         |
| :-----: | :----: | ------------------ | -------------------------------- |
|   [1]   |   0    | Success            | Success                          |
|   [2]   |   1    | Non-blocking error | **Blocks execution (bug #4809)** |
|   [3]   |   2    | Block              | Block action                     |
|   [4]   |   3+   | Non-blocking error | Non-blocking error               |

[CRITICAL] Use exit 0 for warnings. Exit 1 blocks despite documentation.

---
## [4][CONFIG_ISSUES]
>**Dictum:** *Configuration validation prevents silent failures.*

<br>

| [INDEX] | [ISSUE]                       | [SYMPTOM]                     | [FIX]                        |
| :-----: | ----------------------------- | ----------------------------- | ---------------------------- |
|   [1]   | Trailing commas in JSON       | Hook not registered           | Validate JSON syntax         |
|   [2]   | Template variables `{{...}}`  | Variables not expanded        | Use env vars instead         |
|   [3]   | Changes after startup         | Old hooks still running       | Run `/hooks` to reload       |
|   [4]   | Missing executable permission | `permission denied` error     | `chmod +x script.py`         |
|   [5]   | Wrong shebang                 | `/usr/bin/env: bad interp`    | Use `#!/usr/bin/env python3` |
|   [6]   | /hooks shows "No hooks"       | Valid config ignored (#11544) | Check settings.json location |

---
## [5][REMOTE_EXECUTION]
>**Dictum:** *Remote execution requires explicit configuration.*

<br>

| [INDEX] | [CONTEXT]         | [ISSUE]                    | [SOLUTION]                           |
| :-----: | ----------------- | -------------------------- | ------------------------------------ |
|   [1]   | SSH remote        | Hooks don't run            | Use `--dangerously-skip-permissions` |
|   [2]   | Docker            | `CLAUDE_PROJECT_DIR` wrong | Mount project as volume              |
|   [3]   | CI/CD             | No interactive approval    | Pre-approve in settings              |
|   [4]   | GitHub Codespaces | PATH issues                | Use absolute paths                   |

---
## [6][DEBUGGING]
>**Dictum:** *Debug mode reveals hook behavior.*

<br>

| [INDEX] | [METHOD]           | [COMMAND]                                       |
| :-----: | ------------------ | ----------------------------------------------- |
|   [1]   | Enable debug mode  | `claude --debug`                                |
|   [2]   | List active hooks  | `/hooks`                                        |
|   [3]   | Test hook directly | `echo '{"tool_name":"Bash"}' \| python hook.py` |
|   [4]   | Check exit code    | `echo $?` after hook execution                  |
|   [5]   | View hook output   | Press `Ctrl+O` for verbose mode                 |

[REFERENCE] Validation checklist: [→validation.md§6](./validation.md#6troubleshooting_gate)
