---
description: [Verb-first description for /help menu]
argument-hint: [target] [focus: domain1|domain2|domain3?]
# allowed-tools: Read, Glob, Task [Uncomment and scope when command needs specific tools]
---

# [H1][COMMAND-NAME]
>**Dictum:** *[Core principle explaining why this command exists.]*

<br>

---
## [1][TARGET]
>**Dictum:** *Explicit targets prevent ambiguity.*

<br>

@$1

---
## [2][ARGUMENTS]
>**Dictum:** *Defaults prevent empty substitution.*

<br>

**Target:** `${1:-default-value}`<br>
**Focus:** `${2:-all}`

---
## [3][CONTEXT]
>**Dictum:** *Runtime context captures dynamic state.*

<br>

<!-- Optional: Add shell context for dynamic values -->
<!-- Branch: !`git branch --show-current` -->
<!-- Root: !`git rev-parse --show-toplevel` -->

---
## [4][TASK]
>**Dictum:** *Clear instructions ensure consistent execution.*

<br>

1. Read target file via `@$1`.
2. Analyze content against criteria.
3. Apply transformations and validations.

<!-- ─────────────────────────────────────────────────────────────────────────
VARIABLE REFERENCE:

Arguments:
  $ARGUMENTS       → All args as string (free-form input)
  $1, $2...        → Positional parameters (structured args)
  ${N:-default}    → Fallback value if arg missing
  [CRITICAL] Select $ARGUMENTS OR $1-$N — never mix.

Files:
  @path            → Include file contents
  @$1              → Dynamic path via argument
  [CRITICAL] Declare Read in allowed-tools for every @path.

Shell:
  !`command`       → Execute and inject stdout
  !`git ...`       → Repository context injection
  [CRITICAL] Declare Bash in allowed-tools for every !command.

Skill Loading:
  @.claude/skills/[name]/SKILL.md           → Core skill context
  @.claude/skills/[name]/references/*.md    → Domain knowledge
  Orchestrator loads context. Subagents execute analysis. Orchestrator validates findings.

───────────────────────────────────────────────────────────────────────────── -->
