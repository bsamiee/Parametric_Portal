---
name: bash-script-generator
description: Generate production-ready bash 5.2+/5.3 scripts with robust error handling, logging, argument parsing, and validation. Use when creating bash scripts, CLI tools, automation, cron jobs, deployment scripts, or text processing workflows.
---

# Bash Script Generator

Generate production-ready bash 5.2+/5.3 scripts with typed traps, parallel processing, structured logging, and functional patterns (pure functions, immutable locals, dispatch tables over conditionals).

## When to Use

User asks to "create", "generate", "build", or "write" a bash script, CLI tool, automation, cron job, deployment script, or text processing workflow.

## Pre-Generation: Clarify Requirements

**Use AskUserQuestion** if unclear:

| Ambiguity      | Question                                            |
| -------------- | --------------------------------------------------- |
| Data format    | "Input format? (nginx combined, JSON, CSV, custom)" |
| Large files    | "Files >100MB? Optimize for memory/performance?"    |
| Error handling | "Fail fast, continue with warnings, or retry?"      |
| Portability    | "POSIX sh portability or bash 5.2+/5.3 OK?"         |
| Output format  | "Human-readable, JSON, or CSV?"                     |

Before writing code: explain architecture, tool selection (per `docs/text-processing-guide.md`), key tradeoffs.

## Generation Workflow

| Stage             | Action                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| 1. Requirements   | Purpose, inputs/outputs, shell type, args, error handling, performance                          |
| 2. Structure      | Shebang + strict mode block + readonly constants + trap + main                                  |
| 3. Core Functions | Logging, error handling, argument parsing, usage -- see `assets/templates/standard-template.sh` |
| 4. Business Logic | Implement using tools per `docs/text-processing-guide.md`                                       |
| 5. Main           | `parse_args "$@"` + validate prerequisites + validate inputs + execute + log completion         |
| 6. Validate       | Run `bash -n script.sh`, fix issues, re-validate until clean                                    |

## Strict Mode Block (always use)

```bash
#!/usr/bin/env bash
set -Eeuo pipefail          # -E = errtrace (ERR trap inherits into functions/subshells)
shopt -s inherit_errexit    # Command substitutions inherit errexit
IFS=$'\n\t'
```

## Functional Style Rules

| Rule                           | Pattern                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| Immutable locals               | `local -r` for all non-mutating variables inside functions                                        |
| Immutable globals              | `readonly` for all module-level constants                                                         |
| Pure functions                 | Input via args, output via stdout or nameref (`local -n`), no global mutation                     |
| Dispatch tables                | `case` or associative arrays over `if/elif/else` chains                                           |
| Higher-order funcs             | Pass function names as args; `local -n` nameref for arrays                                        |
| Inline trivials                | If a function is called once and < 3 lines, inline at call site                                   |
| Brace grouping                 | `{ cmd1; cmd2; } > file` over `( cmd1; cmd2 ) > file` (no subshell)                               |
| Unified checkers               | Merge `_check_file`/`_check_content` into single `_check(source, pattern, msg, level)`            |
| No mutable counters            | Use `wc -l`, `grep -c`, or `awk` pipelines for counting                                           |
| `mapfile`/`readarray`          | Over `while read` loops for array population                                                      |
| `printf` everywhere            | Over `echo` (handles escapes, format strings, no ambiguity)                                       |
| `$(<file)`                     | Over `$(cat file)` (no fork)                                                                      |
| `printf -v var '%(%F %T)T' -1` | Over `$(date ...)` (no subshell)                                                                  |
| Here-strings `<<<`             | Over `echo x \| cmd` pipelines                                                                    |
| BASH_REMATCH parsing           | `[[ str =~ regex ]]` + `${BASH_REMATCH[N]}` over `grep -oP` / `sed` / `awk`                       |
| Assoc array as set             | `declare -Ar SET=([k1]=1 [k2]=1)` + `[[ -v SET[key] ]]` for O(1) membership                       |
| IFS field splitting            | `IFS=, read -ra parts <<< "$csv"` over `cut` / `awk -F,` for simple splits                        |
| Structured checks              | `declare -Ar CHECKS=([name]="pattern\|msg\|level")` + `IFS=\| read -r` for data-driven validation |

## Quality Checklist

- `#!/usr/bin/env bash` + `set -Eeuo pipefail` + `shopt -s inherit_errexit` + `IFS=$'\n\t'`
- All variables quoted: `"${var}"`
- Constants: `readonly UPPER_SNAKE`; locals: `local -r` (immutable) or `local`; functions: `lower_snake()`
- `printf -v var '%(%F %T)T' -1` for timestamps (no `$(date)` subshell)
- `[[ ]]` over `[ ]` everywhere; `<<<` over `echo |`; `<()` over temp files
- Error handling: `die()` / `check_command()` / `validate_file()`
- Usage/help with examples
- Cleanup on exit: `trap cleanup EXIT` (single trap, EXIT covers normal + signal exits)
- No ShellCheck warnings (v0.11.0+); no `eval` with user input; `$()` over backticks
- No mutable state where pure pipelines suffice

## Post-Generation Summary

```
**File:** path/to/script.sh
**Tool Selection:** grep: [why] | awk: [why] | sed: [why or "not needed"]
**Customization Points:** `VARIABLE`: [what] | `function()`: [when]
**Usage:** ./script.sh --help | ./script.sh -v input.log
**Validation Status:** Passed / Issues found
```

## Documentation

| Resource                                | Contents                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `docs/bash-scripting-guide.md`          | Strict mode, variables, parameter expansion, arrays, conditionals, bash 5.2/5.3 features |
| `docs/script-patterns.md`               | Argument parsing, config, logging, parallel processing, locks, signals, retry            |
| `docs/text-processing-guide.md`         | grep/awk/sed selection, pipeline patterns, performance                                   |
| `assets/templates/standard-template.sh` | Production-ready template with all boilerplate                                           |
| `examples/log-analyzer.sh`              | grep + awk + sed log analysis example                                                    |
