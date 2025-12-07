---
name: output-style-builder
type: standard
depth: extended
description: >-
  Creates structured output formats (JSON, YAML, Markdown-KV, XML) and response style
  configurations for Claude. Use when: (1) defining agent output schemas (.json, .yaml, .xml),
  (2) configuring response style scope hierarchy, (3) embedding formats in agents/commands,
  (4) building CLAUDE.md output sections, (5) creating format definitions in .claude/styles/,
  or (6) standardizing structured data serialization.
---

# [H1][OUTPUT-STYLE-BUILDER]
>**Dictum:** *Format selection and scope configuration determine response quality.*

<br>

Agent response formats and scope-based style configuration.

[DELEGATE] Voice, formatting, constraint rules → `style-standards` skill.

**Scope:**<br>
- *Formats:* Structured data serialization (JSON, YAML, Markdown-KV, XML) for agent output.
- *Configuration:* Response style scope hierarchy (global → project → skill → command).

**Domain Navigation:**<br>
- *[FORMATS]* — Structured data output. Load for: agent schemas, API responses, validation scoring.
- *[CONFIGURATION]* — Scope hierarchy. Load for: CLAUDE.md output sections, precedence rules.
- *[SCHEMA]* — Delimiters, examples. Load for: syntax reference, canonical patterns.
- *[STRUCTURE]* — Ordering, composition. Load for: section sequencing, chaining.

[REFERENCE]: [→index.md](./index.md) — Complete reference file listing.

---
## [1][INSTRUCTIONS]
>**Dictum:** *Progressive disclosure optimizes context loading.*

<br>

**Universal Tasks:**<br>
1. Read [→index.md](./index.md): File listing.
2. Select domain: FORMATS (structured data) or CONFIGURATION (response style scope).

**Conditional Tasks:**<br>
1. (Requires: FORMATS) Read [→formats.md](./references/formats.md): Selection, embedding, validation.
2. (Requires: CONFIGURATION) Read [→configuration.md](./references/configuration.md): Scope hierarchy, embedding patterns.
3. (Requires: prose rules) Load `style-standards` skill for voice, formatting, constraints.

---
## [2][FORMATS]
>**Dictum:** *Format selection governs output reliability.*

<br>

[IMPORTANT] Format choice impacts accuracy (16pp variance) and token cost (6.75x variance).

**Required Task:**<br>
1. Read [→formats.md](./references/formats.md): Selection metrics, embedding, validation scoring.

**Guidance:**<br>
- `Selection` — Markdown-KV: 60.7% accuracy, 2.7x tokens. JSON: 52.3% accuracy, 0.85x tokens.
- `Embedding` — Inline for single use. Reference (`@.claude/styles/`) for 3+ consumers.
- `Validation` — 100-point scoring. Deployment requires score >= 80.

**Best-Practices:**<br>
- Single format per output type.
- Max 5 variables per format; every optional has default.
- Constrained decoding guarantees 97-100% schema compliance.

**References:**<br>
- [→formats.md](./references/formats.md): Selection, embedding, validation.
- [→format.template.md](./templates/format.template.md): Format scaffold.

---
## [3][CONFIGURATION]
>**Dictum:** *Scope hierarchy determines style precedence.*

<br>

[IMPORTANT] Higher precedence overrides lower. Command (5) overrides global (1).

**Required Task:**<br>
1. Read [→configuration.md](./references/configuration.md): Scope levels, embedding patterns.

**Guidance:**<br>
- `Global` — CLAUDE.md `[OUTPUT]` section. 50-100 LOC optimal.
- `Project` — PROJECT.md overrides. Document divergence reason.
- `Skill/Agent` — Inline or reference pattern. Match reuse requirements.
- `Command` — Narrowest scope. Specialized output for single invocation.

**Best-Practices:**<br>
- Global rules in CLAUDE.md; overrides minimal (max 30 LOC).
- Reference `style-standards` for voice/formatting rules—no duplication.
- Weight-10 constraints position first in all scopes.

**References:**<br>
- [→configuration.md](./references/configuration.md): Scope hierarchy, embedding.
- [→style.template.md](./templates/style.template.md): Style scaffold.
- [DELEGATE] `style-standards` skill: Voice, formatting, constraints.

---
## [4][SCHEMA]
>**Dictum:** *Delimiter syntax anchors implementation.*

<br>

[IMPORTANT] Consistent delimiters prevent 18-29% performance variance.

**Required Task:**<br>
1. Read [→schema.md](./references/schema.md): Delimiter patterns, canonical examples.

**Guidance:**<br>
- `Delimiters` — Code fence (` ``` `), separator (`---`), soft break (`<br>`).
- `Consistency` — Single output prohibits mixed delimiter styles.

**References:**<br>
- [→schema.md](./references/schema.md): Syntax reference.

---
## [5][STRUCTURE]
>**Dictum:** *Section ordering prevents attention loss.*

<br>

[IMPORTANT] Primacy effect: early items receive 5.79x attention weight.

**Required Task:**<br>
1. Read [→structure.md](./references/structure.md): Ordering, hierarchy, composition.

**Guidance:**<br>
- `Ordering` — Action-first, Priority-first, or Context-first patterns.
- `Hierarchy` — Maximum 3 levels. 2-7 items per container.
- `Composition` — Base-override inheritance. Shallow or deep merge.

**References:**<br>
- [→structure.md](./references/structure.md): Sequencing, composability.

---
## [6][TEMPLATES]
>**Dictum:** *Templates enforce canonical structure.*

<br>

**FORMATS Domain:**<br>
- [→format.template.md](./templates/format.template.md): Structured data format scaffold.

**CONFIGURATION Domain:**<br>
- [→style.template.md](./templates/style.template.md): Response style scaffold.

---
## [7][VALIDATION]
>**Dictum:** *Gate checklist enforces compliance.*

<br>

**FORMATS Gate:**<br>
[VERIFY]:
- [ ] Format matches use case (accuracy vs token tradeoff).
- [ ] Sections weighted and ordered by severity.
- [ ] Embedding matches reuse requirements (inline vs reference).
- [ ] Delimiter consistency verified throughout output.
- [ ] Required variables resolved; optionals have defaults.
- [ ] Validation score >= 80.

**CONFIGURATION Gate:**<br>
[VERIFY]:
- [ ] Scope appropriate (global → command hierarchy).
- [ ] CLAUDE.md output section <= 100 LOC.
- [ ] Override sections document divergence reason.
- [ ] Voice/formatting rules reference `style-standards`—zero duplication.
- [ ] Weight-10 constraints positioned first.
