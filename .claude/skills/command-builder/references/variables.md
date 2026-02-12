# [H1][VARIABLE_INTERPOLATION]
>**Dictum:** *Variables enable command reuse across contexts.*

<br>

[CRITICAL] Variables substitute before prompt processing. Choose ONE argument pattern per command.

---
## [1][ARGUMENT_CAPTURE]
>**Dictum:** *Pattern choice determines resolution behavior.*

<br>

| [INDEX] | [SYNTAX]                   | [BEHAVIOR]                          | [USE_WHEN]           |
| :-----: | -------------------------- | ----------------------------------- | -------------------- |
|   [1]   | **`$ARGUMENTS`**           | All args as single string           | Free-form input      |
|   [2]   | **`$1`, `$2`...**          | Positional parameter (1-based)      | Structured multi-arg |
|   [3]   | **`$ARGUMENTS[N]`**        | Indexed parameter (0-based)         | Indexed access       |
|   [4]   | **`$N`**                   | Shorthand for `$ARGUMENTS[N]` (0-based) | Indexed shorthand |
|   [5]   | **`${N:-val}`**            | Default if argument missing         | Optional parameters  |
|   [6]   | **`${CLAUDE_SESSION_ID}`** | Current session identifier          | Session-specific     |

**Examples:**
```markdown
# $ARGUMENTS — free-form
Fix issue #$ARGUMENTS following project standards.
# /fix 123 high priority → "Fix issue #123 high priority..."

# Positional — structured (1-based)
Compare @$1 with @$2.
# /compare src/a.ts src/b.ts → includes both files

# Indexed — structured (0-based)
Compare @$ARGUMENTS[0] with @$ARGUMENTS[1].
# /compare src/a.ts src/b.ts → includes both files

# Defaults — optional
Target: ${1:-src}  Format: ${2:-json}
# /analyze → "Target: src  Format: json"
# /analyze lib → "Target: lib  Format: json"
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

**Examples:**
```markdown
# Static path
Review @src/utils/helpers.ts for issues.

# Dynamic path (with frontmatter)
---
argument-hint: [file-path]
allowed-tools: Read
---
Analyze @$1 for security vulnerabilities.

# Multiple files
Compare @src/v1/api.ts with @src/v2/api.ts. Summarize breaking changes.
```

[CRITICAL]:
- [ALWAYS] Declare `Read` in `allowed-tools` for every `@path`.
- [NEVER] Use shell commands for file reading—use `@path`.

---
## [3][SHELL_EXECUTION]
>**Dictum:** *Shell execution captures runtime state.*

<br>

| [INDEX] | [SYNTAX]             | [BEHAVIOR]             | [REQUIRED_TOOL] |
| :-----: | -------------------- | ---------------------- | --------------- |
|   [1]   | **`` !`command` ``** | Execute, inject stdout | `Bash`          |
|   [2]   | **`!$(subcommand)`** | Subshell interpolation | `Bash`          |

**Example:**
```markdown
---
allowed-tools: Bash, Read
---
## Repository Context
Root: !`git rev-parse --show-toplevel`
Branch: !`git branch --show-current`
Commit: !`git rev-parse HEAD`

## Environment
Package Manager: !`command -v npm >/dev/null && echo "npm" || echo "yarn"`
Node: !`node --version`

## Task
Analyze changes since last release.
```

[CRITICAL]:
- [ALWAYS] Declare `Bash` in `allowed-tools` for shell execution.
- [NEVER] Use shell for file content—use `@path` instead.
- [NEVER] Hardcode absolute paths in shell commands.

---
## [4][SKILL_LOADING]
>**Dictum:** *Skill context grants orchestrators validation authority.*

<br>

| [INDEX] | [DEPTH]           | [PATTERN]                         | [USE_WHEN]           |
| :-----: | ----------------- | --------------------------------- | -------------------- |
|   [1]   | **Core only**     | `@.claude/skills/[name]/SKILL.md` | Quick validation     |
|   [2]   | **Domain subset** | `+ references/[domain]/*.md`      | Focused verification |
|   [3]   | **Full tree**     | `+ references/**/*.md`            | Comprehensive audit  |

**Orchestrator Pattern:**
```markdown
---
description: Validate target against skill standards
allowed-tools: Read, Task, TaskCreate
---
## Skill Context
@.claude/skills/style-standards/SKILL.md
@.claude/skills/style-standards/references/voice/*.md

## Task
1. Load skill context (above)—orchestrator holds validation authority
2. Spawn Task agents to analyze target files
3. Agents return findings WITHOUT skill context
4. Verify agent findings against loaded context
5. Apply corrections where agents deviate from standards
```

| [INDEX] | [ROLE]           | [CONTEXT]                 | [RESPONSIBILITY]           |
| :-----: | ---------------- | ------------------------- | -------------------------- |
|   [1]   | **Orchestrator** | Full skill context loaded | Final validation authority |
|   [2]   | **Subagent**     | Task prompt only          | Analysis and findings      |

[CRITICAL]:
- [ALWAYS] Load skill context BEFORE spawning subagents.
- [ALWAYS] Verify subagent work against loaded context.
- [NEVER] Assume subagent skill file access.

---
## [5][PATTERN_SELECTION]
>**Dictum:** *Scenario determines pattern selection.*

<br>

| [INDEX] | [SCENARIO]                   | [PATTERN]              | [EXAMPLE]             |
| :-----: | ---------------------------- | ---------------------- | --------------------- |
|   [1]   | **Single free-form input**   | `$ARGUMENTS`           | Issue description     |
|   [2]   | **Multiple structured args** | `$1`, `$2`...          | File paths, options   |
|   [3]   | **Indexed access (0-based)** | `$ARGUMENTS[N]`        | Indexed parameters    |
|   [4]   | **Indexed shorthand**        | `$0`, `$1`...          | Shorthand for `$ARGUMENTS[N]` |
|   [5]   | **Optional parameters**      | `${N:-default}`        | Fallback values       |
|   [6]   | **Session identifier**       | `${CLAUDE_SESSION_ID}` | Session-specific logs |
|   [7]   | **File analysis**            | `@path`                | Code review           |
|   [8]   | **Dynamic context**          | `` !`cmd` ``           | Git info, environment |
|   [9]   | **Validation authority**     | `@skill/...`           | Standards enforcement |

[CRITICAL]:
- [ALWAYS] Choose ONE argument pattern per command.
- [NEVER] Mix `$ARGUMENTS` with positional `$1-$N`—causes unpredictable substitution.

---
## [6][ANTI_PATTERNS]
>**Dictum:** *Pattern mixing causes unpredictable substitution.*

<br>

| [INDEX] | [ANTI_PATTERN]                  | [SYMPTOM]                | [FIX]                |
| :-----: | ------------------------------- | ------------------------ | -------------------- |
|   [1]   | **`$ARGUMENTS` + `$1`**         | Double substitution      | Choose one pattern.  |
|   [2]   | **`@path` without `Read`**      | Silent file load failure | Add `Read` to tools. |
|   [3]   | **No default for optional**     | Empty string substituted | Use `${N:-default}`. |
|   [4]   | **`` !`cmd` `` without `Bash`** | Shell command ignored    | Add `Bash` to tools. |
|   [5]   | **Hardcoded shell paths**       | Breaks portability       | Use relative paths.  |
|   [6]   | **Skill load after subagents**  | Authority inversion      | Load context first.  |
