# [H1][SCRIPTING]
>**Dictum:** *Functional pipelines produce reliable hook scripts.*

<br>

Python 3.14+ with strict typing. Zero imperative patterns. Security-first design.

---
## [1][TOOLING_GATE]
>**Dictum:** *Three tools run in sequence before commit.*

<br>

| [INDEX] | [TOOL]       | [COMMAND]            | [PURPOSE]          |
| :-----: | ------------ | -------------------- | ------------------ |
|   [1]   | basedpyright | `basedpyright .`     | Type checking      |
|   [2]   | ruff check   | `ruff check --fix .` | Linting + auto-fix |
|   [3]   | ruff format  | `ruff format .`      | Formatting         |

[CRITICAL] All three must pass. No suppressions, no exceptions.

---
## [2][PHILOSOPHY]
>**Dictum:** *Four pillars govern hook implementation.*

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

### [3.1][FORBIDDEN_PATTERNS]

| [INDEX] | [PATTERN]                         | [RISK]              |
| :-----: | --------------------------------- | ------------------- |
|   [1]   | `os.system(f"...{input}...")`     | Command injection   |
|   [2]   | `eval()` / `exec()`               | Code execution      |
|   [3]   | `subprocess.run(..., shell=True)` | Shell injection     |
|   [4]   | `path.startswith(prefix)`         | Path traversal      |
|   [5]   | `print(tool_input)`               | Credential exposure |

### [3.2][REQUIRED_PATTERNS]

| [INDEX] | [PATTERN]                             | [PURPOSE]             |
| :-----: | ------------------------------------- | --------------------- |
|   [1]   | `json.load(sys.stdin)`                | Safe JSON parsing     |
|   [2]   | `os.path.realpath()` comparison       | Canonical path check  |
|   [3]   | `subprocess.run([...], shell=False)`  | Safe command exec     |
|   [4]   | `@dataclass(frozen=True, slots=True)` | Immutable state       |
|   [5]   | `handlers[key](data)` dispatch        | No conditional chains |

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

```python
#!/usr/bin/env python3
"""Hook: Validate tool calls."""
# --- TYPES --------------------------------------------------------------------
from dataclasses import dataclass
from typing import Callable, Final, TypedDict
@dataclass(frozen=True, slots=True)
class Result:
    decision: str
    reason: str
# --- CONSTANTS ----------------------------------------------------------------
B: Final = {"blocked": frozenset(("rm -rf", "sudo")), "timeout": 60000}
# --- DISPATCH_TABLES ----------------------------------------------------------
handlers: dict[str, Callable[[dict], Result]] = {
    "Bash": lambda d: Result("block", "Dangerous") if any(c in str(d) for c in B["blocked"]) else Result("allow", "OK"),
}
# --- ENTRY_POINT --------------------------------------------------------------
def main() -> int:
    import json, sys
    data = json.load(sys.stdin)
    result = handlers.get(data.get("tool_name", ""), lambda _: Result("allow", "Default"))(data)
    json.dump({"decision": result.decision, "reason": result.reason}, sys.stdout)
    return 0 if result.decision == "allow" else 2
if __name__ == "__main__":
    import sys; sys.exit(main())
```

---
## [5][PATTERNS]
>**Dictum:** *Common patterns accelerate development.*

<br>

### [5.1][EXHAUSTIVE_DISPATCH]

```python
from typing import Never, assert_never, Literal

Action = Literal["allow", "block", "ask"]
def handle(action: Action) -> int:
    match action:
        case "allow": return 0
        case "block": return 2
        case "ask": return 0
        case _ as unreachable: assert_never(unreachable)
```

### [5.2][PIPE_COMPOSITION]

```python
from functools import reduce
from typing import Callable, TypeVar
T = TypeVar('T')
pipe = lambda x, *fns: reduce(lambda acc, f: f(acc), fns, x)
result = pipe(data, parse, validate, transform)
```

### [5.3][PATH_VALIDATION]

```python
from pathlib import Path
import os
project = os.environ.get("CLAUDE_PROJECT_DIR", "")
safe = lambda p: Path(p).resolve().is_relative_to(Path(project).resolve())
```

### [5.4][ADVANCED_PATTERNS]

```python
# Type aliases (Python 3.12+)
type Frontmatter = dict[str, str]
type ParseState = tuple[Frontmatter, str | None, list[str]]

# Immutable collections
BLOCKED: Final[frozenset[str]] = frozenset(("rm -rf", "sudo", "chmod 777"))

# Fold pattern: stateful transformation via reduce
from functools import reduce
def fold_line(state: ParseState, line: str) -> ParseState:
    result, field, parts = state
    return (
        ({**result, field: " ".join(parts)}, None, []) if line.startswith("---")
        else (result, field, [*parts, line.strip()]) if field else state
    )
final = reduce(fold_line, lines, ({}, None, []))

# Debug pattern: expression-centric with short-circuit
DEBUG: Final[bool] = os.environ.get("CLAUDE_HOOK_DEBUG", "").lower() in ("1", "true")
_debug = lambda msg: DEBUG and print(f"[hook] {msg}", file=sys.stderr)
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
line-length = 88

[tool.ruff.lint]
select = ["E", "F", "W", "B", "I", "UP", "ANN", "S", "C90"]
ignore = ["ANN101"]

[tool.ruff.lint.mccabe]
max-complexity = 10
```

---
## [7][VALIDATION]
>**Dictum:** *Gate checklist enforces quality.*

<br>

[VERIFY] Pre-commit:
- [ ] `basedpyright` passes with zero errors.
- [ ] `ruff check` passes with zero violations.
- [ ] No `if/else` chains—use dispatch tables.
- [ ] No mutable state—use frozen dataclasses.
- [ ] Section dividers pad to column 80.
- [ ] No forbidden security patterns.
- [ ] Path validation uses `realpath()`.
