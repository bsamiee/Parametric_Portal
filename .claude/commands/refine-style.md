---
description: Refine folder files for style compliance (project)
argument-hint: [folder-path] [focus: formatting|voice|taxonomy|dictum|keywords|density?]
---

# [H1][REFINE-STYLE]
>**Dictum:** *Parallel wave dispatch maximizes throughput while preserving validation integrity.*

<br>

Target: `$1`
Focus: `${2:-none}`

---
## [1][FOCUS_DOMAINS]
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
## [2][WORKFLOW]
>**Dictum:** *Two-wave parallel dispatch separates analysis from correction.*

<br>

1. **Glob** `$1` for `**/*.md`, `**/*.ts`, `**/*.tsx`.
2. **Execute** `/learn-skill style-standards`—load style context once.
3. **Create** TaskCreate list—all files pending.
4. **Partition** files into batches of 10.
5. **Loop** batches:
   - **Wave 1:** Dispatch `style-analyzer` agents (parallel, 1 per file).
   - Collect wave 1 results.
   - **Wave 2:** Dispatch `style-corrector` agents (parallel, fed wave 1 analysis).
   - Collect wave 2 results.
   - Mark batch complete.
6. **Report** summary: files processed, issues found, corrections applied.

---
## [3][CONSTRAINTS]
>**Dictum:** *Constraints enforce parallel execution integrity.*

<br>

[IMPORTANT]:
- [ALWAYS] Load style context ONCE via `/learn-skill` before waves.
- [ALWAYS] Dispatch ALL wave agents in ONE message—prevents sequential bottleneck.
- [ALWAYS] Wait for wave 1 completion before dispatching wave 2.
- [ALWAYS] Pass wave 1 analysis to corresponding wave 2 agent.

[CRITICAL]:
- [NEVER] Dispatch wave 2 without wave 1 results.
- [NEVER] Exceed batch size of 10—agent overhead limit.
- [NEVER] Mix analysis and correction in same agent—wave separation mandatory.
- [NEVER] Modify YAML frontmatter—agents enforce protection.
