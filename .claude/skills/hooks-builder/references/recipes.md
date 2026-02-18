# [H1][RECIPES]
>**Dictum:** *Polymorphic patterns enable reliable automation.*

<br>

Six patterns use dispatch tables, frozen state, `B: Final` constants.

---
## [1][SECURITY_GATE]
>**Dictum:** *PreToolUse dispatch prevents dangerous operations.*

**Events:** PreToolUse (Bash|Write|Read matcher)

```python
#!/usr/bin/env python3
from typing import Callable, Final
import json, sys, os, re
from pathlib import Path
type Handler = Callable[[dict], tuple[str, str]]
B: Final = {
    "commands": frozenset((r"rm\s+.*-[rf]", r"sudo\s+rm", r"chmod\s+777")),
    "paths": frozenset((".env", ".pem", ".key", "credentials")),
    "secrets": frozenset((r"sk-ant-api\d+-[A-Za-z0-9_-]{90,}", r"ghp_[A-Za-z0-9]{36}", r"AKIA[A-Z0-9]{16}")),
    "project": Path(os.environ.get("CLAUDE_PROJECT_DIR", ".")).resolve(),
}
safe = lambda p: Path(p).resolve().is_relative_to(B["project"])
blocked_cmd = lambda cmd: any(re.search(p, cmd, re.I) for p in B["commands"])
blocked_path = lambda p: any(s in p for s in B["paths"])
has_secret = lambda txt: any(re.search(p, txt) for p in B["secrets"])
handlers: dict[str, Handler] = {
    "Bash": lambda d: ("deny", "Blocked") if blocked_cmd(d.get("command", "")) else ("deny", "Secret") if has_secret(d.get("command", "")) else ("allow", ""),
    "Write": lambda d: ("deny", "Protected") if blocked_path(d.get("file_path", "")) else ("allow", "") if safe(d.get("file_path", "")) else ("deny", "Outside"),
    "Read": lambda d: ("deny", "Protected") if blocked_path(d.get("file_path", "")) else ("allow", ""),
}
def main() -> int:
    data = json.load(sys.stdin)
    action, reason = handlers.get(data.get("tool_name", ""), lambda _: ("allow", ""))(data.get("tool_input", {}))
    reason and action == "deny" and print(reason, file=sys.stderr)
    return 0 if action == "allow" else 2
if __name__ == "__main__": sys.exit(main())
```

---
## [2][INPUT_TRANSFORMER]
>**Dictum:** *UpdatedInput field enables parameter modification.*

**Events:** PreToolUse (Bash|Write matcher)

```python
#!/usr/bin/env python3
from typing import Callable, Final
import json, sys, os
from pathlib import Path
B: Final = {"sandbox": Path(os.environ.get("CLAUDE_PROJECT_DIR", ".")) / ".sandbox"}
transformers: dict[str, Callable[[dict], dict]] = {
    "Bash": lambda d: {**d, "command": d.get("command", "").replace("rm ", "rm -i ")},
    "Write": lambda d: {**d, "file_path": str(B["sandbox"] / Path(d.get("file_path", "")).name)} if "/tmp" in d.get("file_path", "") else d,
}
def main() -> int:
    data = json.load(sys.stdin)
    tool, inp = data.get("tool_name", ""), data.get("tool_input", {})
    updated = transformers.get(tool, lambda d: d)(inp)
    updated != inp and print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow", "updatedInput": updated}}))
    return 0
if __name__ == "__main__": sys.exit(main())
```

---
## [3][QUALITY_PIPELINE]
>**Dictum:** *PostToolUse formatters enforce code quality.*

**Events:** PostToolUse (Write|Edit matcher)

```python
#!/usr/bin/env python3
from typing import Final
import json, sys, subprocess
from pathlib import Path
B: Final = {
    "fmt": {".py": ["ruff", "format"], ".ts": ["biome", "format", "--write"]},
    "chk": {".py": ["pyright", "--outputjson"]},
}
run = lambda cmd, p: subprocess.run([*cmd, str(p)], capture_output=True, text=True, timeout=30)
slim = lambda out: "\n".join(f"{e['range']['start']['line']}:{e['message']}" for e in json.loads(out).get("generalDiagnostics", [])[:5])
def main() -> int:
    path = Path(json.load(sys.stdin).get("tool_input", {}).get("file_path", ""))
    path.exists() and B["fmt"].get(path.suffix) and run(B["fmt"][path.suffix], path)
    chk = B["chk"].get(path.suffix)
    r = chk and path.exists() and run(chk, path)
    r and r.returncode and print(slim(r.stdout), file=sys.stderr)
    return 2 if r and r.returncode else 0
if __name__ == "__main__": sys.exit(main())
```

---
## [4][CONTEXT_BOOTSTRAP]
>**Dictum:** *SessionStart injects project context.*

**Events:** SessionStart (startup|resume|compact matcher)

```python
#!/usr/bin/env python3
from typing import Final
import json, sys, subprocess, os
from pathlib import Path
B: Final = {"files": ("REQUIREMENTS.md", "CLAUDE.md"), "tag": "context"}
git = lambda cmd: subprocess.run(["git", *cmd], capture_output=True, text=True, timeout=5).stdout.strip()
exists = lambda p: (Path(os.environ.get("CLAUDE_PROJECT_DIR", ".")) / p).exists()
def main() -> int:
    ctx = f"Branch: {git(['branch', '--show-current'])}\nStatus: {git(['status', '--short']) or 'Clean'}\nFiles: {', '.join(f for f in B['files'] if exists(f))}"
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": f"<{B['tag']}>\n{ctx}\n</{B['tag']}>"}}))
    return 0
if __name__ == "__main__": sys.exit(main())
```

---
## [5][OBSERVABILITY]
>**Dictum:** *Structured logging enables analysis.*

**Events:** All (catch-all matcher)

```python
#!/usr/bin/env python3
from dataclasses import dataclass, asdict
from typing import Final
import json, sys, os
from datetime import datetime, UTC
from pathlib import Path
@dataclass(frozen=True, slots=True)
class Entry:
    ts: str; event: str; tool: str | None; session: str
B: Final = {"log": Path(os.environ.get("CLAUDE_PROJECT_DIR", ".")) / ".claude" / "hooks.jsonl"}
def main() -> int:
    data = json.load(sys.stdin)
    entry = Entry(datetime.now(UTC).isoformat(), data.get("hook_event_name", ""), data.get("tool_name"), data.get("session_id", ""))
    B["log"].parent.mkdir(parents=True, exist_ok=True)
    B["log"].open("a").write(json.dumps(asdict(entry)) + "\n")
    return 0
if __name__ == "__main__": sys.exit(main())
```

---
## [6][STOP_EVALUATOR]
>**Dictum:** *Prompt hooks evaluate task completion.*

**Events:** Stop, SubagentStop (prompt type)

**Eligible Events:** Prompt hooks work with PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, UserPromptSubmit, Stop, SubagentStop, TaskCompleted. NOT TeammateIdle.

**Response Schema:** `{"ok": true}` allows action; `{"ok": false, "reason": "..."}` blocks.

```json
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "prompt",
        "prompt": "Evaluate whether the task is complete: tests pass, types check, all requirements met. Return {\"ok\": true} if complete. Return {\"ok\": false, \"reason\": \"what is missing\"} if incomplete.",
        "timeout": 30
      }]
    }]
  }
}
```

[REFERENCE] Validation checklist: [->validation.md§5](./validation.md#5recipes_gate)
