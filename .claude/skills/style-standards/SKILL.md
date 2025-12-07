---
name: style-standards
type: standard
depth: extended
description: Enforces style consistency for documentation and code with support for taxonomy, voice, and formatting domains. Use when creating or modifying files requiring: (1) markdown structure (headers, lists, tables, Dictums, separators), (2) code organization (comments, section dividers, naming conventions), (3) voice compliance (tone, grammar, imperative phrasing), or (4) formatting validation against project standards.
---

# [H1][STYLE-STANDARDS]
>**Dictum:** *Style consistency maximizes agent comprehension.*

<br>

Style standards governing all file creation and modification in this monorepo.

**Scope:**<br>
- *Documentation:* Markdown structure, headers, lists, tables, Dictums, separators.
- *Code:* Comments, headers, section dividers, naming conventions, file organization.

**Domain Navigation:**<br>
- *[TAXONOMY]* — Terms, markers, cross-references. Load for: sigils, stati, lexicon definitions.
- *[VOICE]* — Tone, grammar, comments, naming. Load for: imperative phrasing, headers, code naming.
- *[FORMATTING]* — Layout, separators, spacing. Load for: header structure, dividers, whitespace rules.

[REFERENCE]: [→index.md](./index.md) — Complete reference file listing.

# [H2][INSTRUCTIONS]
>**Dictum:** *Progressive disclosure optimizes context loading.*

<br>

[CRITICAL] Consistency over all else. Refactor inconsistent formatting to project standards.

**Instruction Structure:**<br>
- *Required Task* — Mandatory read before domain work. Numbered, sequential.
- *References* — Supplemental files for deeper context. Load as needed.
- *Guidance* — Core implementation rules. Imperative tone.
- *Best-Practices* — Usage patterns and limits. Declarative tone.

**Task Adherence:**<br>
1. Complete **Universal Tasks** first—applies to all domains.
2. Complete **Required Task** for target domain before implementation.

**Universal Tasks:**<br>
1. Read [→index.md](./index.md): Reference file listing for navigation.
2. Read [→keywords.md](references/keywords.md): Canonical keyword list; all `Markers` use official terms.

---
## [2.1][TAXONOMY]
>**Dictum:** *Vocabulary anchors structure; Markers encode state.*

<br>

Taxonomy signals intent for agent execution. Leverage terms for document traversal and desired behavior. Create all files with project taxonomy.

**Required Task:**<br>
1. Read [→lexicon.md](references/taxonomy/lexicon.md): Definitions for all monorepo-specific terms.

**References:**<br>
- [→references.md](references/taxonomy/references.md): Cross-reference notation and linking syntax.
- [→stati.md](references/taxonomy/stati.md): Canonical `Stati` glyphs and stasis markers.

**Guidance:**<br>
- `Dictum` - Read all `Dictum` + headers first for rapid file mapping.
- `Qualifier` - [ALWAYS] respect inline directives when encountered.
- `Preamble` - Signals **section-wide** imperative.
- `Terminus` - Signals **task-specific** imperative; **isolated** effect.
- `Corpus` - Read after `Preamble`/`Terminus` orientation.
- `Gate` - [CRITICAL] finalize all checklist items before proceeding; use `[VERIFY]` to denote `Gate` checklists.
- `Directive` - Lists require strict adherence; polarity set by `Modifier`.
- `Stati` - Replace emoji.

**Best-Practices:**<br>
- **Markers:** Hard limit of **10 per file**. Strategic placement maximizes compliance.
  - *Preamble/Terminus* - 0–4 markers per file maximum.

---
## [2.2][VOICE]
>**Dictum:** *Universal standards for LLM-optimized context, documentation, and agentic instructions.*

<br>

`Voice` applies to all documentation and comments. Scope: tone, list semantics, ordering primacy, grammar, syntax, modals, visuals, comment standards, keywords.

**Required Task:**<br>
1. Read [→grammar.md](references/voice/grammar.md): Tone, stopwords, punctuation, modals, syntax rules.

**References:**<br>
- [→ordering.md](references/voice/ordering.md): Primacy effects, attention weight distribution.
- [→comments.md](references/voice/comments.md): Comment rules, code header formats, accuracy tradeoffs.
- [→constraints.md](references/voice/constraints.md): Density limits, few-shot guidance.
- [→naming.md](references/voice/naming.md): Code and file naming patterns.
- [→density.md](references/voice/density.md): Tables, diagrams, format efficiency.
- [→validation.md](references/voice/validation.md): Voice compliance checklist.

**Guidance:**<br>
- `Voice` - Active voice: 56% token reduction.
- `Tone` - Mechanical, domain-specific. No hedging, no self-reference.
- `Syntax` - Simple sentences: 93.7% accuracy vs 46.8% nested.
- `Punctuation` - Attention sinks—absorb 20-40% weight despite minimal semantic content.
- `Ordering` - [CRITICAL] Primacy effects peak at 150-200 instructions; 5.79× attention for early items.
  - **Critical-First** - Highest-priority constraints at sequence start.
  - **Middle Burial** - Middle positions suffer U-shaped attention loss.
- `Comments` - Front-load architectural decisions where attention peaks.
- `Density` - Tables: >2 entities, >2 dimensions. Diagrams: >3 steps or >2 hierarchy levels.

**Best-Practices:**<br>
- **Comments** - Incorrect: 78% accuracy loss—omit if uncertain. *Why > What*: intent = signal, logic = noise.
- **Constraints** - 6+ simultaneous: <25% satisfaction. Max 3-5 per level.
- **Delimiters** - Consistency over choice. 18-29% variance per change.
- **Stopwords** - Remove `the`, `a`, `an`, `please`, `kindly`.
- **Tone** - Actions: imperative. Context/facts: declarative.
- **Naming** - Prohibited: `utils`, `helpers`, `misc`, `config`, `cfg`, `opts`, `params`, `Data`, `Info`, `Manager`, `Service`.

---
## [2.3][FORMATTING]
>**Dictum:** *Whitespace and separator rules for document structure.*

<br>

Separators encode hierarchy. Whitespace is semantic, not cosmetic. Patterns enable rapid reference.

**Required Task:**<br>
1. Read [→structure.md](references/formatting/structure.md): Depth, lists, separators, headers, spacing rules.

**References:**<br>
- [→typeset.md](references/formatting/typeset.md): Case conventions, punctuation, table formatting.
- [→example.md](references/formatting/example.md): Canonical formatting implementation.

**Guidance:**<br>
- `Dictum` - Place first after H1/H2. State WHY, not WHAT. Format: `>**Dictum:** *statement*`
- `Depth` - H1: File Truth. H2: Smallest agent read unit. H3: Nesting limit. [CRITICAL] H4+ requires new file.
- `Lists` - Use numbered `1.` for sequence/priority. Use bullet `-` for equivalence/sets.
- `Labels` - Format parent: `**Bold:**` with colon. Format child: `*Italic:*` for contrast.
- `Separators` - Use `---` for hard boundaries (H2 → H2, H3 → H3). Use `<br>` for soft transitions (H2 → H3).
- `Spacing` - Place 1 blank after header. Place none after `---`. Place none between list items.
- `Dividers` - Pad code separators `// --- [LABEL] ---` to column 80.
- `Tables` - Include `[INDEX]` first column. Format headers as `[HEADER]` sigil. Align: center index, right numeric, left prose.

**Best-Practices:**<br>
- **Separator Prohibitions** - `---` between H2 and first H3 prohibited. `<br>` between sibling H3s prohibited.
- **List Prohibitions** - Single-item lists prohibited—use prose. Bullet `-` only; `*`/`+` prohibited. Parallel grammar required.
- **Header Integrity** - Level skipping prohibited. H1 → H2 → H3 strictly sequential.
- **Thresholds** - Lists: 2-7 items. Items: <100 chars. Nesting: 2 levels max.
- **Sigils** - UPPERCASE, max 3 words, underscores for compound. Exception: `.claude/` infrastructure (skills, commands, agents) use hyphens matching file/folder name.
- **Soft Breaks** - `<br>` required after Dictum and Preamble. Groups 2-3 related definitions inline.
- **Case Taxonomy** - UPPERCASE: sigils, rubrics, keywords, section labels. Title Case: table cells. kebab-case: files.
- **Directive Ordering** - `[IMPORTANT]:` precedes `[CRITICAL]:`. Within list: `[ALWAYS]` precedes `[NEVER]`.
- **Table Styling** - First column bold for category anchoring.

