---
name: skill-builder
type: standard
depth: full
description: >-
    Creates and refines Claude Code skills following Anthropic best practices
    with YAML frontmatter, progressive disclosure, and LOC-gated quality. Use
    when authoring new SKILL.md files, restructuring skill references/,
    upgrading skill depth or type, or validating existing skill compliance.
---

# [H1][SKILL-BUILDER]
>**Dictum:** *Structured authoring produces discoverable, maintainable skills.*

<br>

Create and refine Claude Code skills via structured workflows.

**Tasks:**
1. Collect parameters — Scope: `create | refine`, Type: `simple | standard | complex`, Depth: `base | extended | full`
2. Read [frontmatter.md](./references/frontmatter.md) — Discovery metadata, trigger patterns
3. Read [structure.md](./references/structure.md) — Folder layout gated by Type
4. Read [depth.md](./references/depth.md) — LOC limits, nesting gated by Depth
5. (complex) Read [scripting.md](./references/scripting.md) — Automation standards
6. Capture requirements — purpose, triggers, outputs
7. Invoke `skill-summarizer` with skill `style-standards` — Extract voice, formatting, taxonomy
8. Invoke `deep-research` — Domain research for skill topic
9. Plan with 3 agents — file inventory, section structure, content framework
10. Execute per Scope:
    - (create) Author new artifacts; select template:
      - [simple](./templates/simple.skill.template.md) - DEFAULT
      - [standard](./templates/standard.skill.template.md)
      - [complex](./templates/complex.skill.template.md)
    - (refine) Compare input to existing frontmatter; see [refine-workflow.md](./references/refine-workflow.md):
      - Input = existing — optimize (density, fixes, quality)
      - Input > existing — upgrade (expand structure or depth)
      - Input < existing — downsize (combine, refactor, remove low-relevance)
11. Validate — Quality gate, LOC compliance, structure match

**Dependencies:**
- `deep-research` — Domain research via parallel agents
- `skill-summarizer` — Voice and formatting extraction (with skill `style-standards`)
- `report.md` — Sub-agent output format

**References:**

| Domain      | File                                                      |
| ----------- | --------------------------------------------------------- |
| Frontmatter | [frontmatter.md](references/frontmatter.md)               |
| Structure   | [structure.md](references/structure.md)                    |
| Depth       | [depth.md](references/depth.md)                            |
| Scripting   | [scripting.md](references/scripting.md)                    |
| Validation  | [validation.md](references/validation.md)                  |
| Create      | [create-workflow.md](references/create-workflow.md)        |
| Refine      | [refine-workflow.md](references/refine-workflow.md)        |

---
## [1][DOMAIN_GUIDE]
>**Dictum:** *Metadata drives discovery, type gates structure, depth caps density.*

<br>

Frontmatter is indexed at session start (~100 tokens). Description quality determines invocation accuracy — LLM reasoning matches user intent, no embeddings. Type gates folder creation (simple/standard/complex). Depth enforces LOC limits and nesting rights per level (+50 SKILL.md, +25 reference cumulative).

| [INDEX] | [TYPE]   | [DEPTH RANGE] | [FOLDERS]                          |
| :-----: | -------- | :-----------: | ---------------------------------- |
|   [1]   | Simple   |   Base-Ext    | SKILL.md only                      |
|   [2]   | Standard |   Base-Full   | +references/, templates/           |
|   [3]   | Complex  |   Ext-Full    | +scripts/                          |

**Guidance:**
- `Discovery` — Description is ONLY field parsed for relevance. Include "Use when" clauses, file types, operations. Third person, active, present tense.
- `Structure` — Create only folders appropriate to type. Empty folders prohibited. Max 7 files in references/.
- `Depth` — Hard caps: Base <300/<150, Extended <350/<175, Full <400/<200. Exceeding requires refactoring, not justification.
- `Content Separation` — SKILL.md = WHY (tasks, guidance, best-practices). References = HOW (specs, tables, schemas). No verbatim duplication.

See [frontmatter.md](references/frontmatter.md) for schema. See [structure.md](references/structure.md) for layout. See [depth.md](references/depth.md) for limits.

---
## [2][AUTHORING]
>**Dictum:** *Templates enforce canonical structure, scripts extend deterministic capability.*

<br>

**Templates:** Select by type — simple (default), standard, complex. Follow template exactly; combine user input with skeleton for consistent artifacts.

**Scripts:** Complex type only. Justified when: external tool wrapping, exact reproducibility, schema enforcement. See [scripting.md](references/scripting.md) for standards (Python 3.14+/TypeScript 6.0+, frozen config, dispatch tables, JSON output).

**LOC Optimization:** Consolidate — restructure — densify — prune (in order). Brute-force trimming prohibited. See [depth.md > LOC_OPTIMIZATION](references/depth.md#3loc_optimization).

---
## [3][VALIDATION]
>**Dictum:** *Gates prevent incomplete artifacts.*

<br>

[VERIFY] Completion:
- [ ] Parameters: Scope, Type, Depth collected and applied.
- [ ] Research: `deep-research` completed fully before authoring.
- [ ] Style: `skill-summarizer` constraints applied to output.
- [ ] Workflow: Executed per Scope (create | refine).
- [ ] Quality: LOC within limits, content separation enforced.

See [validation.md](references/validation.md) for operational checklist.
