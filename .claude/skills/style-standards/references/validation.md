# [H1][VALIDATION]
>**Dictum:** *Operational criteria verify style compliance.*

<br>

Operational verification procedures for style-standards. SKILL.md §VALIDATION contains high-level gates.

---
## [1][STRUCTURE]
>**Dictum:** *Visual topology defines semantic boundaries.*

<br>

[VERIFY] Structure compliance:
- [ ] Nesting: ≤H3 depth. H4+ requires new file.
- [ ] Visuals: Complex logic (>3 steps) diagrammed.
- [ ] Ordering: Critical constraints at sequence start (primacy effect).
- [ ] Headers: H1 → H2 → H3 strictly sequential. No level skipping.
- [ ] Separators: `---` between same-level siblings. `<br>` for soft transitions.

---
## [2][VOICE]
>**Dictum:** *Grammar maximizes signal density.*

<br>

[VERIFY] Voice compliance:
- [ ] Active: Content uses active voice—no passive constructions.
- [ ] Stopwords: `the`, `a`, `an`, `please`, `kindly` removed.
- [ ] Hedging: No `seems`, `might`, `probably`, `could`.
- [ ] Modals: No prose `must`, `should`, `ought`—use bracketed directives.
- [ ] Self-Reference: No "This file...", "We do...", "Sourced from...", "You should...".

---
## [3][TONE]
>**Dictum:** *Tone matches content type.*

<br>

[VERIFY] Tone compliance:
- [ ] Actions: Instructions use imperative—verb-first (e.g., "Validate input.").
- [ ] Context: Facts use declarative—state as truth (e.g., "Config source.").

---
## [4][SYNTAX]
>**Dictum:** *Syntax enforces clarity.*

<br>

[VERIFY] Syntax compliance:
- [ ] Periods: Complete instructions end with `.`
- [ ] Anchors: Variables/paths backticked.
- [ ] Constraints: `NEVER`/`MUST` binary verifiable.
- [ ] Clauses: Single subject-verb-object per sentence.

---
## [5][FORMATTING]
>**Dictum:** *Whitespace and separators encode hierarchy.*

<br>

[VERIFY] Formatting compliance:
- [ ] Dictum: Placed first after H1/H2. States WHY, not WHAT.
- [ ] Lists: Numbered for sequence, bullet for equivalence. No single-item lists.
- [ ] Spacing: 1 blank after header. None after `---`. None between list items.
- [ ] Tables: `[INDEX]` first column. `[HEADER]` sigil format.
- [ ] Thresholds: Lists 2-7 items. Items <100 chars. Nesting ≤2 levels.

---
## [6][TAXONOMY]
>**Dictum:** *Vocabulary anchors structure.*

<br>

[VERIFY] Taxonomy compliance:
- [ ] Keywords: All markers use canonical terms from keywords.md.
- [ ] Markers: ≤10 per file. Preamble/Terminus ≤4 per file.
- [ ] Sigils: UPPERCASE, max 3 words, underscores for compound.
- [ ] Stati: Glyphs replace emoji.

---
## [7][DENSITY]
>**Dictum:** *Constraints bound comprehension.*

<br>

[VERIFY] Density compliance:
- [ ] Limits: 3-5 constraints per instruction level.
- [ ] Simultaneous: <6 constraints (>6 = <25% satisfaction).
- [ ] Tables: Used for >2 entities with >2 dimensions.
- [ ] Diagrams: Used for >3 steps or >2 hierarchy levels.
