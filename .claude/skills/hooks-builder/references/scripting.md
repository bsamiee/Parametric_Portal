# [H1][SCRIPTING]
>**Dictum:** *Python 3.14 functional pipelines produce reliable hooks.*

<br>

---
## [1][SHEBANG]
>**Dictum:** *PEP 723 inline metadata enables zero-setup execution.*

<br>

```python
#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.14"
# dependencies = ["httpx"]
# ///
```

---
## [2][TYPES]
>**Dictum:** *PEP 695 type aliases replace TypeAlias annotations.*

<br>

```python
from collections.abc import Callable
from typing import Any, Final, NamedTuple

type Frontmatter = dict[str, str]
type ParseState = tuple[Frontmatter, str | None, list[str]]
type Handler = tuple[Callable[[dict], tuple[str, ...]], Callable[[str, dict], dict]]

class SkillEntry(NamedTuple):
    name: str
    trigger: str
```

---
## [3][CONSTANTS]
>**Dictum:** *Frozen dataclass with field factories enables immutable config.*

<br>

```python
from dataclasses import dataclass, field
import re

@dataclass(frozen=True, slots=True)
class _B:
    timeout: int = 60
    blocked: frozenset[str] = frozenset(("rm -rf", "sudo"))
    field_re: re.Pattern[str] = field(default_factory=lambda: re.compile(r"^([^:]+):(.*)$"))

B: Final[_B] = _B()
DEBUG: Final[bool] = os.environ.get("CLAUDE_HOOK_DEBUG", "").lower() in ("1", "true")
_debug = lambda msg: DEBUG and print(f"[hook] {msg}", file=sys.stderr)
```

---
## [4][DISPATCH]
>**Dictum:** *Handler tables route all behavior — zero conditionals.*

<br>

```python
handlers: dict[str, Handler] = {
    "workspace": (lambda _: ("npx", "nx", "show", "projects", "--json"), lambda o, _: {"projects": json.loads(o)}),
    "project": (lambda a: ("npx", "nx", "show", "project", a["name"], "--json"), lambda o, a: {"name": a["name"], "project": json.loads(o)}),
}

# Decorator registration
_tools: dict[str, tuple[Callable, dict]] = {}
def tool(**cfg: Any) -> Callable[[Callable], Callable]:
    return lambda fn: (_tools.__setitem__(fn.__name__, (fn, {"method": "POST", **cfg})), fn)[1]
```

---
## [5][PATTERN_MATCHING]
>**Dictum:** *Structural pattern matching replaces if/else chains.*

<br>

```python
def _fold_line(state: ParseState, line: str) -> ParseState:
    result, field, parts = state
    match_ = B.field_re.match(line)
    match (match_, line.startswith(" "), field):
        case (m, False, _) if m and m.group(2).strip() in (">-", ">"):
            return ({**result, field: " ".join(parts)} if field else result, m.group(1).strip(), [])
        case (m, False, _) if m:
            return ({**result, m.group(1).strip(): m.group(2).strip().strip("'\"")}, None, [])
        case (_, True, f) if f:
            return (result, field, [*parts, line.strip()])
        case _:
            return state

# Exhaustive matching with assert_never
type Action = Literal["allow", "block", "ask"]
def handle(action: Action) -> int:
    match action:
        case "allow" | "ask": return 0
        case "block": return 2
        case _ as unreachable: assert_never(unreachable)
```

---
## [6][EXPRESSIONS]
>**Dictum:** *Walrus operator and comprehensions eliminate statements.*

<br>

```python
# Walrus in comprehension
lines = [line for n, g in B.groups if (line := f'<group name="{n}">{" ".join(g)}</group>')]

# Ternary chain
result = {"status": "success", **fmt(o, a)} if o else {"status": "error", "msg": f"{cmd} failed"}
```

---
## [7][OUTPUT]
>**Dictum:** *XML tags optimize Claude context injection per Anthropic guidance.*

<br>

```python
def _format_xml(skills: list[SkillEntry], targets: frozenset[str]) -> str:
    return "\n".join([
        "<session_context>",
        f'  <skills count="{len(skills)}">',
        *[f'    <skill name="{s.name}">{s.trigger}</skill>' for s in skills],
        "  </skills>",
        "</session_context>",
    ])
```

---
## [8][SECURITY]
>**Dictum:** *Defense patterns prevent exploitation.*

<br>

| [FORBIDDEN]                | [REQUIRED]                               |
| -------------------------- | ---------------------------------------- |
| `os.system(f"...{input}")` | `subprocess.run([...], shell=False)`     |
| `eval()` / `exec()`        | `json.load(sys.stdin)`                   |
| `path.startswith(prefix)`  | `Path(p).resolve().is_relative_to(root)` |

---
## [9][TOOLING]
>**Dictum:** *Quality gates enforce standards.*

<br>

```toml
[tool.pyright]
typeCheckingMode = "all"
pythonVersion = "3.14"

[tool.ruff]
target-version = "py314"
select = ["E", "F", "W", "B", "I", "UP", "ANN", "S", "C90"]
```

| [GATE] | [COMMAND]                             |
| ------ | ------------------------------------- |
| Type   | `pyright .`                           |
| Lint   | `ruff check --fix . && ruff format .` |
