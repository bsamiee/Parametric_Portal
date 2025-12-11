---
description: Refine folder files for style compliance (project)
argument-hint: [folder-path] [focus: formatting|voice|taxonomy|dictum|keywords|density?]
---

# [H1][REFINE-STYLE]
>**Dictum:** *Parallel wave dispatch maximizes throughput while preserving validation integrity.*

<br>

---
## [1][PARAMETERS]
>**Dictum:** *Parameters scope refinement target.*

<br>

Target: $1
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
>**Dictum:** *Parallel dispatch multiplies throughput via concurrent agent waves.*

<br>

### [4.1][INITIALIZATION]

1. **Glob** `$1` for `**/*.md`, `**/*.ts`, `**/*.tsx`.
2. **Load** style context via `style-summarizer` agent (single dispatch).
3. **Create** TodoWrite list—all files pending.
4. **Partition** files into batches of 10.

### [4.2][WAVE_LOOP]

For each batch (max 10 files):

**Wave 1 — Analysis (Parallel):**
- Dispatch N `style-analyzer` agents in ONE message (1 file = 1 agent).
- Each agent receives: `file_path`, `focus`, `style_context`.
- Collect all wave 1 results before proceeding.

**Wave 2 — Correction (Parallel):**
- Dispatch N `style-corrector` agents in ONE message (1 file = 1 agent).
- Each agent receives: `file_path`, `analysis` (from wave 1), `style_context`, `frontmatter_end`.
- Collect all wave 2 results.

**Batch Completion:**
- Mark batch files complete in TodoWrite.
- Advance to next batch.
- Repeat until all batches processed.

### [4.3][AGENTS]

| [WAVE] | [AGENT]           | [TOOLS]          | [SCOPE]                   |
| :----: | ----------------- | ---------------- | ------------------------- |
|   1    | `style-analyzer`  | Read, Glob, Grep | Analysis only (read-only) |
|   2    | `style-corrector` | Read, Edit       | Validation + correction   |

---
## [5][CONSTRAINTS]
>**Dictum:** *Constraints enforce parallel execution integrity.*

<br>

[IMPORTANT]:
- [ALWAYS] Create TodoWrite list before processing.
- [ALWAYS] Load style context ONCE via style-summarizer before waves.
- [ALWAYS] Dispatch ALL wave agents in ONE message—prevents sequential bottleneck.
- [ALWAYS] Wait for wave 1 completion before dispatching wave 2.
- [ALWAYS] Pass wave 1 analysis to corresponding wave 2 agent.

[CRITICAL]:
- [NEVER] Dispatch wave 2 without wave 1 results.
- [NEVER] Skip files—process entire folder.
- [NEVER] Exceed batch size of 10—agent overhead limit.
- [NEVER] Mix analysis and correction in same agent—wave separation is mandatory.
- [NEVER] Modify YAML frontmatter—agents enforce protection.

---
## [6][BEGIN]
>**Dictum:** *Execution sequence initiates parallel refinement.*

<br>

1. **Glob** `$1`—enumerate files.
2. **Dispatch** `style-summarizer` agent—load style context.
3. **Create** TodoWrite list, all pending.
4. **Note** focus `$2` when specified.
5. **Partition** files into batches of 10.
6. **Loop** batches:
   - Wave 1: Dispatch `style-analyzer` agents (parallel).
   - Collect wave 1 results.
   - Wave 2: Dispatch `style-corrector` agents (parallel, fed wave 1).
   - Collect wave 2 results.
   - Mark batch complete.
7. **Report** summary: files processed, issues found, corrections applied, rejections.