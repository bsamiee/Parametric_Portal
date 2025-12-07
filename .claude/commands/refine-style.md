---
description: Refine folder files for style compliance (project)
argument-hint: [folder-path] [focus: formatting|voice|taxonomy|dictum|keywords|density?]
---

# [H1][REFINE-STYLE]
>**Dictum:** *Sequential verification ensures style compliance across file sets.*

<br>

---
## [1][PARAMETERS]
>**Dictum:** *Parameters scope refinement target.*

<br>

Target: $1<br>
Focus: ${2:-none}

---
## [2][CONTEXT]
>**Dictum:** *Context loading grants validation authority.*

<br>

@.claude/skills/style-standards/SKILL.md
@.claude/skills/style-standards/references/keywords.md
@.claude/skills/style-standards/references/taxonomy.md
@.claude/skills/style-standards/references/voice.md
@.claude/skills/style-standards/references/formatting.md
@.claude/skills/style-standards/references/validation.md
@.claude/styles/report.md

---
## [3][FOCUS_DOMAINS]
>**Dictum:** *Focus elevates specific compliance areas.*

<br>

| [INDEX] | [FOCUS]      | [TARGET_ELEMENTS]                              |
| :-----: | ------------ | ---------------------------------------------- |
|   [1]   | `formatting` | Headers, separators, spacing, tables, lists    |
|   [2]   | `voice`      | Active voice, stopwords, imperatives, FANBOYS  |
|   [3]   | `taxonomy`   | Sigils, stati glyphs, cross-references, counts |
|   [4]   | `dictum`     | Placement, phrasing, WHY statements            |
|   [5]   | `keywords`   | `[CRITICAL]`, `[ALWAYS]`, `[NEVER]` ordering   |
|   [6]   | `density`    | LOC reduction, redundancy elimination          |
|   [7]   | (custom)     | Any specific term or pattern                   |

[IMPORTANT] Focus is additive—apply full optimization, elevate focus area scrutiny.

---
## [4][WORKFLOW]
>**Dictum:** *Phase execution ensures systematic refinement.*

<br>

Glob `$1` for `**/*.md`, `**/*.ts`, `**/*.tsx`. Create TodoWrite list. Process each file:

1. **[ANALYZE]** — Spawn Task agent (`general-purpose`). Agent reads file, applies style-standards, returns severity-ranked findings with line numbers. Use `report.md` format.
2. **[VERIFY]** — Read target file. Compare findings vs loaded context (§2). Reject false positives; identify missed issues. Ensure focus domain addressed.
3. **[EXECUTE]** — Apply corrections via Edit. Preserve semantic meaning.
4. **[ITERATE]** — Mark file complete. Advance to next. Repeat phases 1-3.

---
## [5][CONSTRAINTS]
>**Dictum:** *Constraints enforce execution integrity.*

<br>

[IMPORTANT]:
- [ALWAYS] Create TodoWrite list before processing.
- [ALWAYS] Mark one file `in_progress` at time.
- [ALWAYS] Read file prior to corrections.
- [ALWAYS] Verify findings against loaded context—reject false positives.

[CRITICAL]:
- [NEVER] Execute corrections without verification.
- [NEVER] Skip files—process entire folder.
- [NEVER] Batch completions—mark done immediately.
- [NEVER] Trust agent blindly—orchestrator holds validation authority.
- [NEVER] Ignore non-focus issues—focus is additive, not exclusive.

---
## [6][BEGIN]
>**Dictum:** *Execution sequence initiates refinement.*

<br>

1. **Glob** `$1`—enumerate files.
2. **Create** TodoWrite list, all pending.
3. **Note** focus `$2` when specified.
4. **Start** first file—mark `in_progress`.
5. **Execute** phases 1-4 sequentially.
6. **Report** summary at completion.
