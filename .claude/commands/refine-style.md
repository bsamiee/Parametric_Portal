---
description: Refine folder files for style compliance (project)
argument-hint: [folder-path] [focus: formatting|voice|taxonomy|dictum|keywords|density?]
---

# [H1][REFINE-STYLE]
>**Dictum:** *Multi-agent coordination verifies style refinement across file sets.*

<br>

[CRITICAL] Process files sequentially: analyze → verify → execute → repeat.

---
## [1][CONTEXT]
>**Dictum:** *Context parameters scope refinement target.*

<br>

**Target Folder:** `$1`<br>
**Focus Domain:** ${2:-none}

[IMPORTANT] Glob `$1` for files matching `**/*.md`, `**/*.ts`, `**/*.tsx`.

---
## [2][FOCUS_DOMAINS]
>**Dictum:** *Focus domains elevate specific compliance areas.*

<br>

For specified `$2`, apply standard optimization PLUS elevated focus area priority.

| [INDEX] | [FOCUS]      | [WEIGHT]           | [TARGET_ELEMENTS]                              |
| :-----: | ------------ | ------------------ | ---------------------------------------------- |
|   [1]   | `formatting` | Structure priority | Headers, separators, spacing, tables, lists    |
|   [2]   | `voice`      | Tone priority      | Active voice, stopwords, imperatives, FANBOYS  |
|   [3]   | `taxonomy`   | Marker priority    | Sigils, stati glyphs, cross-references, counts |
|   [4]   | `dictum`     | Anchor priority    | Dictum placement, phrasing, WHY statements     |
|   [5]   | `keywords`   | Directive priority | `[CRITICAL]`, `[ALWAYS]`, `[NEVER]` ordering   |
|   [6]   | `density`    | Compression        | LOC reduction, redundancy elimination          |
|   [7]   | (custom)     | Specific element   | Any specific term or pattern                   |

[IMPORTANT] Focus is additive—apply full optimization, elevate focus area scrutiny.

---
## [3][STYLE_STANDARDS]
>**Dictum:** *Style standards provide validation authority.*

<br>

Load style-standards skill for validation authority:

### [3.1][CORE]

@.claude/skills/style-standards/SKILL.md
@.claude/skills/style-standards/references/keywords.md

---
### [3.2][TAXONOMY]

@.claude/skills/style-standards/references/taxonomy/lexicon.md
@.claude/skills/style-standards/references/taxonomy/references.md
@.claude/skills/style-standards/references/taxonomy/stati.md

---
### [3.3][VOICE]

@.claude/skills/style-standards/references/voice/grammar.md
@.claude/skills/style-standards/references/voice/ordering.md
@.claude/skills/style-standards/references/voice/comments.md
@.claude/skills/style-standards/references/voice/constraints.md
@.claude/skills/style-standards/references/voice/naming.md
@.claude/skills/style-standards/references/voice/density.md
@.claude/skills/style-standards/references/voice/validation.md

---
### [3.4][FORMATTING]

@.claude/skills/style-standards/references/formatting/structure.md
@.claude/skills/style-standards/references/formatting/typeset.md
@.claude/skills/style-standards/references/formatting/example.md

---
## [4][WORKFLOW]
>**Dictum:** *Phase execution ensures systematic refinement.*

<br>

Execute for EACH file in `$1`:

### [4.1][PHASE_1_ANALYZE]

1. **Spawn analysis agent** via Task tool, `subagent_type: general-purpose`.
2. **Agent prompt structure:**
   - Read target file path.
   - Apply style-standards from [§3] (pass relevant domain references in prompt).
   - For specified focus: elevate `$2` issues to higher severity.
   - Produce infraction/suggestion report, include line numbers.
   - Return severity-ranked findings.

---
### [4.2][PHASE_2_VERIFY]

1. **Read target file**.
2. **Compare** agent findings vs actual content using loaded style-standards.
3. **Confirm** valid issues, reject false positives.
4. **Identify** refinements agent missed.
5. **For specified focus:** ensure `$2` domain thoroughly addressed.

---
### [4.3][PHASE_3_EXECUTE]

1. **Apply corrections** via Edit tool.
2. **Preserve** semantic meaning and capabilities.
3. **Track progress** via TodoWrite.

---
### [4.4][PHASE_4_ITERATE]

1. **Mark file complete** in todo list.
2. **Advance** to next file.
3. **Repeat** phases 1-3.

---
## [5][AGENT_PROMPT_TEMPLATE]
>**Dictum:** *Template structures agent dispatch.*

<br>

@.claude/styles/report.md

Template for spawning analysis agent:

```
Read `[FILE_PATH]`, analyze against style-standards below.

## [STYLE_STANDARDS]
[Include relevant sections from §3 based on file type and focus domain]

## [FOCUS_DOMAIN]
[When `$2` specified]: Elevated priority for [FOCUS] domain.
- Apply full standard optimization.
- Weight [FOCUS]-related issues as higher severity.

[Otherwise]: Standard balanced optimization.

## [OUTPUT]
Use report.md format with domain variables:
- domain-1: CRITICAL (99% compliance violations)
- domain-2: HIGH (95% compliance violations)
- domain-3: MEDIUM (85% compliance violations)
- domain-4: FOCUS (when $2 specified)

Include line numbers: `Line X: [issue] → [fix]`
```

---
## [6][EXECUTION_CONSTRAINTS]
>**Dictum:** *Constraints enforce execution integrity.*

<br>

[IMPORTANT]:
- [ALWAYS] Create TodoWrite list before processing first file.
- [ALWAYS] Mark one file `in_progress` at a time.
- [ALWAYS] Read file prior to executing corrections.
- [ALWAYS] Verify agent findings against loaded style-standards—reject false positives.
- [ALWAYS] For specified focus, ensure focus domain addressed per file.

[CRITICAL]:
- [NEVER] Execute corrections without verification phase.
- [NEVER] Skip files — process entire folder.
- [NEVER] Batch completions — mark done immediately after each file.
- [NEVER] Trust agent blindly — you hold style-standards context, you are validation authority.
- [NEVER] Ignore non-focus issues — focus is additive, not exclusive.

---
## [7][BEGIN]
>**Dictum:** *Execution sequence initiates refinement.*

<br>

1. **Glob** `$1`, enumerate all files.
2. **Create** TodoWrite list, all files pending.
3. **Note** focus domain `$2` when specified.
4. **Start** at first file—mark `in_progress`.
5. **Execute** phases 1-4 sequentially.
6. **Report** summary at folder completion (include focus metrics when applicable).
