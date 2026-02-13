# [H1][VARIABLE_INTERPOLATION]
>**Dictum:** *Variables enable command reuse across contexts.*

<br>

[CRITICAL] Variables substitute before prompt processing. Choose ONE argument pattern per command.

---
## [1][ARGUMENT_CAPTURE]
>**Dictum:** *Pattern choice determines resolution behavior.*

<br>

| [INDEX] | [SYNTAX]                   | [BEHAVIOR]                              | [USE_WHEN]           |
| :-----: | -------------------------- | --------------------------------------- | -------------------- |
|   [1]   | **`$ARGUMENTS`**           | All args as single string               | Free-form input      |
|   [2]   | **`$1`, `$2`...**          | Positional parameter (1-based)          | Structured multi-arg |
|   [3]   | **`$ARGUMENTS[N]`**        | Indexed parameter (0-based)             | Indexed access       |
|   [4]   | **`${N:-val}`**            | Default if argument missing             | Optional parameters  |
|   [5]   | **`${CLAUDE_SESSION_ID}`** | Current session identifier              | Session-specific     |

**Examples:**
```markdown
# $ARGUMENTS — free-form
Fix issue #$ARGUMENTS following project standards.
# /fix 123 high priority → "Fix issue #123 high priority..."

# Positional — structured (1-based)
Compare @$1 with @$2.
# /compare src/a.ts src/b.ts → includes both files

# Defaults — optional
Target: ${1:-src}  Format: ${2:-json}
# /analyze → "Target: src  Format: json"
```

---
## [2][FILE_REFERENCES]
>**Dictum:** *File references inject context at interpolation.*

<br>

| [INDEX] | [SYNTAX]     | [BEHAVIOR]              | [REQUIRED_TOOL] |
| :-----: | ------------ | ----------------------- | --------------- |
|   [1]   | **`@path`**  | Include file contents   | `Read`          |
|   [2]   | **`@$1`**    | Dynamic path via arg    | `Read`          |
|   [3]   | **`@./rel`** | Relative path inclusion | `Read`          |

[CRITICAL]:
- [ALWAYS] Declare `Read` in `allowed-tools` for every `@path`.
- [NEVER] Use shell commands for file reading — use `@path`.

---
## [3][SHELL_EXECUTION]
>**Dictum:** *Shell execution captures runtime state.*

<br>

**Syntax:** `` !`command` `` (execute, inject stdout), `!$(subcommand)` (subshell interpolation). Requires `Bash` in `allowed-tools`.

```markdown
## Repository Context
Root: !`git rev-parse --show-toplevel`
Branch: !`git branch --show-current`
```

[CRITICAL]:
- [ALWAYS] Declare `Bash` in `allowed-tools` for shell execution.
- [NEVER] Use shell for file content — use `@path`.
- [NEVER] Hardcode absolute paths in shell commands.

---
## [4][SKILL_LOADING]
>**Dictum:** *Skill context grants orchestrators validation authority.*

<br>

**Depth levels:** Core only (`@.claude/skills/[name]/SKILL.md`), domain subset (`+ references/[domain]/*.md`), full tree (`+ references/**/*.md`).

**Orchestrator pattern:** Load skill context BEFORE spawning subagents. Orchestrator holds validation authority; subagents return findings WITHOUT skill context. Verify agent findings against loaded context.

[CRITICAL]:
- [ALWAYS] Load skill context BEFORE spawning subagents.
- [NEVER] Assume subagent skill file access.

---
## [5][PATTERN_SELECTION]
>**Dictum:** *Scenario determines pattern selection.*

<br>

| [INDEX] | [SCENARIO]              | [PATTERN]              |
| :-----: | ----------------------- | ---------------------- |
|   [1]   | Single free-form input  | `$ARGUMENTS`           |
|   [2]   | Multiple structured     | `$1`, `$2`...          |
|   [3]   | Optional parameters     | `${N:-default}`        |
|   [4]   | Session identifier      | `${CLAUDE_SESSION_ID}` |
|   [5]   | File analysis           | `@path`                |
|   [6]   | Dynamic context         | `` !`cmd` ``           |
|   [7]   | Validation authority    | `@skill/...`           |

[CRITICAL]:
- [ALWAYS] Choose ONE argument pattern per command.
- [NEVER] Mix `$ARGUMENTS` with positional `$1-$N`.

---
## [6][ANTI_PATTERNS]
>**Dictum:** *Pattern mixing causes unpredictable substitution.*

<br>

| [INDEX] | [ANTI_PATTERN]                  | [SYMPTOM]                | [FIX]                |
| :-----: | ------------------------------- | ------------------------ | -------------------- |
|   [1]   | **`$ARGUMENTS` + `$1`**         | Double substitution      | Choose one pattern   |
|   [2]   | **`@path` without `Read`**      | Silent file load failure | Add `Read` to tools  |
|   [3]   | **No default for optional**     | Empty string substituted | Use `${N:-default}`  |
|   [4]   | **`` !`cmd` `` without `Bash`** | Shell command ignored    | Add `Bash` to tools  |
|   [5]   | **Skill load after subagents**  | Authority inversion      | Load context first   |
