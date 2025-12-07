# [H1][SCRIPTING]
>**Dictum:** *Reliable hook scripts require functional pipelines.*

<br>

Python 3.14+ with strict typing. Zero imperative patterns. Security-first design.

---
## [1][TOOLING_GATE]
>**Dictum:** *Sequential tool execution enforces quality gates.*

<br>

| [INDEX] | [TOOL]       | [COMMAND]            | [PURPOSE]          |
| :-----: | ------------ | -------------------- | ------------------ |
|   [1]   | basedpyright | `basedpyright .`     | Type checking      |
|   [2]   | ruff check   | `ruff check --fix .` | Linting + auto-fix |
|   [3]   | ruff format  | `ruff format .`      | Formatting         |

[CRITICAL] All three must pass. No suppressions.

---
## [2][PHILOSOPHY]
>**Dictum:** *Four governance pillars ensure hook implementation quality.*

<br>

| [INDEX] | [PILLAR]           | [RULE]                                        |
| :-----: | ------------------ | --------------------------------------------- |
|   [1]   | Algorithmic        | Zero literals; trace all values to `B: Final` |
|   [2]   | Polymorphic        | Zero `if/else`; use `handlers[key](data)`     |
|   [3]   | Functional         | Zero mutation; `Final`, frozen `@dataclass`   |
|   [4]   | Expression-Centric | Ternary over blocks; lambda over single-def   |

---
## [3][SECURITY]
>**Dictum:** *Defense patterns prevent exploitation.*

<br>

| [INDEX] | [FORBIDDEN]                       | [REQUIRED]                            |
| :-----: | --------------------------------- | ------------------------------------- |
|   [1]   | `os.system(f"...{input}...")`     | `json.load(sys.stdin)`                |
|   [2]   | `eval()` / `exec()`               | `os.path.realpath()` comparison       |
|   [3]   | `subprocess.run(..., shell=True)` | `subprocess.run([...], shell=False)`  |
|   [4]   | `path.startswith(prefix)`         | `@dataclass(frozen=True, slots=True)` |
|   [5]   | `print(tool_input)` (credentials) | `handlers[key](data)` dispatch        |

---
## [4][STRUCTURE]
>**Dictum:** *Section dividers enable navigation.*

<br>

| [INDEX] | [SECTION]               | [CONTENT]                               |
| :-----: | ----------------------- | --------------------------------------- |
|   [1]   | `# --- TYPES`           | `TypedDict`, `@dataclass`, type aliases |
|   [2]   | `# --- CONSTANTS`       | `B: Final`, `frozenset` collections     |
|   [3]   | `# --- PURE_FUNCTIONS`  | Lambdas, validators, transformers       |
|   [4]   | `# --- DISPATCH_TABLES` | `handlers: dict[str, Callable]`         |
|   [5]   | `# --- ENTRY_POINT`     | `def main() -> int:`                    |
|   [6]   | `# --- EXPORT`          | `if __name__ == "__main__":`            |

---
## [5][PATTERNS]
>**Dictum:** *Reusable patterns accelerate development.*

<br>

### [5.1][UV_SHEBANG]
PEP 723 inline dependencies—zero environment setup.

```python
#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.12"
# dependencies = ["python-dotenv"]
# ///
from typing import Callable, Final
import json, sys
type Handler = Callable[[dict], tuple[str, str]]
B: Final = {"blocked": frozenset(("rm -rf", "sudo"))}
handlers: dict[str, Handler] = {
    "Bash": lambda d: ("block", "Dangerous") if any(c in str(d) for c in B["blocked"]) else ("allow", ""),
}
def main() -> int:
    data = json.load(sys.stdin)
    action, reason = handlers.get(data.get("tool_name", ""), lambda _: ("allow", ""))(data.get("tool_input", {}))
    reason and print(reason, file=sys.stderr)
    return 0 if action == "allow" else 2
if __name__ == "__main__": sys.exit(main())
```

### [5.2][IDIOMS]
```python
# Type aliases (Python 3.12+)
type Frontmatter = dict[str, str]
type ParseState = tuple[Frontmatter, str | None, list[str]]

# Immutable collections
BLOCKED: Final[frozenset[str]] = frozenset(("rm -rf", "sudo", "chmod 777"))

# Exhaustive dispatch
from typing import Literal, assert_never
Action = Literal["allow", "block", "ask"]
def handle(action: Action) -> int:
    match action:
        case "allow": return 0
        case "block": return 2
        case "ask": return 0
        case _ as unreachable: assert_never(unreachable)

# Path validation
from pathlib import Path
import os
project = os.environ.get("CLAUDE_PROJECT_DIR", "")
safe = lambda p: Path(p).resolve().is_relative_to(Path(project).resolve())

# Debug pattern
DEBUG: Final[bool] = os.environ.get("CLAUDE_HOOK_DEBUG", "").lower() in ("1", "true")
_debug = lambda msg: DEBUG and print(f"[hook] {msg}", file=sys.stderr)

# Pipe composition
from functools import reduce
pipe = lambda x, *fns: reduce(lambda acc, f: f(acc), fns, x)
```

---
## [6][CONFIG]
>**Dictum:** *Tooling configuration enforces standards.*

<br>

```toml
# pyproject.toml
[tool.basedpyright]
typeCheckingMode = "all"
pythonVersion = "3.14"

[tool.ruff]
target-version = "py314"
line-length = 120

[tool.ruff.lint]
select = ["E", "F", "W", "B", "I", "UP", "ANN", "S", "C90"]
```

[REFERENCE] Validation checklist: [→validation.md§4](./validation.md#4scripting_gate)
