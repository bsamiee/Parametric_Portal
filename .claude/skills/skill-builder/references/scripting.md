# [H1][SCRIPTING]
>**Dictum:** *Scripts enforce deterministic operations.*

<br>

Scripts extend skill capabilities with executable automation. Required for: CLI tooling, exact reproducibility, tool orchestration.

---
## [1][CRITERIA]
>**Dictum:** *Clear boundaries prevent unnecessary scripting overhead.*

<br>

| [INDEX] | [INCLUDE]                    | [EXCLUDE]               |
| :-----: | ---------------------------- | ----------------------- |
|   [1]   | External tool orchestration  | Simple transformations  |
|   [2]   | File generation/scaffolding  | Context-dependent logic |
|   [3]   | CLI tooling for skill users  | One-time operations     |
|   [4]   | Exact reproducibility needed | LLM-suitable tasks      |

---
## [2][STANDARDS]
>**Dictum:** *Scripts embody project philosophy in minimal surface area.*

<br>

**Purpose:**
- *Orchestration:* Wrap external tools (protoc, pandoc, prisma) for downstream skill workflows.
- *Generation:* Scaffold artifacts requiring exact structure (OpenAPI specs, database migrations).
- *Validation:* Enforce constraints beyond LLM generation (schema compliance, AST transforms).

**Tooling:**
- *Python:* 3.14+ with `slots=True`, `Final`, type hints. Standard library first.
- *TypeScript:* 6.0+ with Effect 3.19+, ESM imports, `satisfies` for exhaustiveness.

**Philosophy:**
- *Algorithmic:* Derive values from frozen `B` constant.
- *Polymorphic:* Route variants through dispatch tables.
- *Functional:* Compose via `pipe`, Effect pipelines, Option monads.
- *Expression-Centric:* Ternaries over conditionals, implicit returns.

**Density:**<br>
Maximum functionality in minimum LOC. Single script addresses single concern. No wrapper abstractions.

[REFERENCE] Script validation checklist: [→validation.md§5](./validation.md#5scripting)

---
## [3][PYTHON]
>**Dictum:** *Frozen config with dispatch tables maximizes portability.*

<br>

```python
#!/usr/bin/env python3
"""Transform input through format-specific handlers."""
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Callable
import argparse, json, sys

@dataclass(frozen=True, slots=True)
class B:
    indent: int = 2
    encoding: str = "utf-8"
    exit_ok: int = 0
    exit_err: int = 1

C: Final = B()

handlers: dict[str, Callable[[dict], dict]] = {
    "upper": lambda d: {k: (v.upper() if isinstance(v, str) else v) for k, v in d.items()},
    "lower": lambda d: {k: (v.lower() if isinstance(v, str) else v) for k, v in d.items()},
    "keys": lambda d: {"keys": list(d.keys())},
}

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("-i", "--input", type=Path, required=True)
    p.add_argument("-o", "--output", type=Path)
    p.add_argument("-m", "--mode", choices=handlers.keys(), default="upper")
    a = p.parse_args()

    result = json.dumps({"status": "success", "data": handlers[a.mode](json.loads(a.input.read_text(C.encoding)))}, indent=C.indent)
    (a.output.write_text(result, encoding=C.encoding) if a.output else print(result))
    return C.exit_ok

if __name__ == "__main__":
    sys.exit(main())
```

---
## [4][TYPESCRIPT]
>**Dictum:** *Effect pipelines with Schema validation ensure composability.*

<br>

```typescript
#!/usr/bin/env npx tsx
import { Effect, pipe, Option, Schema } from "effect";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const B = Object.freeze({ indent: 2, encoding: "utf-8" } as const);

const Mode = Schema.Literal("upper", "lower", "keys");
type Mode = typeof Mode.Type;

class FileError { readonly _tag = "FileError"; constructor(readonly path: string) {} }
class ParseError { readonly _tag = "ParseError"; constructor(readonly reason: string) {} }

const handlers = {
    upper: (d: Record<string, unknown>) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === "string" ? v.toUpperCase() : v])),
    lower: (d: Record<string, unknown>) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === "string" ? v.toLowerCase() : v])),
    keys: (d: Record<string, unknown>) => ({ keys: Object.keys(d) }),
} as const satisfies Record<Mode, (d: Record<string, unknown>) => unknown>;

const run = (input: string, output: Option.Option<string>, mode: Mode) =>
    pipe(
        Effect.tryPromise({ try: () => readFile(input, B.encoding), catch: () => new FileError(input) }),
        Effect.flatMap((c) => Effect.try({ try: () => JSON.parse(c), catch: () => new ParseError("Invalid JSON") })),
        Effect.flatMap((d) => Effect.try({ try: () => Schema.decodeUnknownSync(Schema.Record({ key: Schema.String, value: Schema.Unknown }))(d), catch: () => new ParseError("Invalid structure") })),
        Effect.map((data) => JSON.stringify({ status: "success", data: handlers[mode](data) }, null, B.indent)),
        Effect.flatMap((json) => Option.match(output, {
            onNone: () => Effect.sync(() => console.log(json)),
            onSome: (p) => Effect.tryPromise({ try: () => writeFile(p, json), catch: () => new FileError(p) }),
        }))
    );

const { values: v } = parseArgs({ options: { input: { type: "string", short: "i" }, output: { type: "string", short: "o" }, mode: { type: "string", short: "m", default: "upper" }, help: { type: "boolean", short: "h" } } });
v.help ? console.log("Usage: transform.ts -i <input> [-o <output>] [-m upper|lower|keys]") : Effect.runPromise(run(v.input!, Option.fromNullable(v.output), Schema.decodeSync(Mode)(v.mode)));
```

---
## [5][ORGANIZATION]
>**Dictum:** *Consistent naming enables rapid discovery.*

<br>

| [INDEX] | [PREFIX]     | [PURPOSE]             |
| :-----: | ------------ | --------------------- |
|   [1]   | `generate-`  | Creation, scaffolding |
|   [2]   | `validate-`  | Verification, checks  |
|   [3]   | `transform-` | Data conversion       |
|   [4]   | `run-`       | External tool wrapper |

[IMPORTANT]:
- [ALWAYS] Support `--help` for discoverability.
- [ALWAYS] JSON output for agent parsing.
- [ALWAYS] Document external tool dependencies in script header.
