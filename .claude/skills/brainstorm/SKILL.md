---
name: brainstorm
type: simple
depth: base
description: >-
  Explores possibilities and generates options for GitHub Discussions via parallel
  research. Use when a Discussion needs idea exploration, when starting project
  planning in the Planning category, or when transforming raw ideas into structured
  approaches.
---

# [H1][BRAINSTORM]
>**Dictum:** *Options evaluated early reduce downstream rework.*

<br>

Transform Discussion ideas to structured approaches via deep research synthesis.

**Workflow:**
1. §READ — `uv run .claude/skills/github-tools/scripts/gh.py discussion-view --number {discussion}`
2. §RESEARCH — Invoke `deep-research` skill — parallel exploration
3. §ALIGN — Confirm synthesis addresses original topic
4. §POST — `uv run .claude/skills/github-tools/scripts/gh.py discussion-comment --discussion-id {id} --body {output}`

**Dependencies:**
- `github-tools` — `discussion-view` (input), `discussion-comment` (output)
- `deep-research` — Parallel agent research and synthesis

**Input:**
- `discussion`: Discussion number to brainstorm

**Exclusions:** Implementation planning, code generation, issue decomposition.

---
## [1][READ]
>**Dictum:** *Scope boundaries prevent research drift.*

<br>

**Extract:**
- `title` — Topic identifier
- `body` — Raw idea content, constraints, goals
- `id` — Node ID — §POST requirement
- `category` — Verify `Planning` category

[IMPORTANT]:
- [ALWAYS] Extract node ID (`id` field) — §POST requirement.
- [NEVER] Proceed if Discussion body empty.

---
## [2][RESEARCH]
>**Dictum:** *Retained alternatives enable informed trade-off analysis.*

<br>

Invoke `deep-research` skill — Discussion content as topic.

**Invoke:**
```
Topic: {discussion.title}
Context: {discussion.body}
Constraints: Explore diverse implementation paths and architectural patterns. Retain
competing approaches even if suboptimal—alternatives inform trade-off analysis.
Prioritize: existing solutions, prior art, known pitfalls, resource requirements.
```

`deep-research` executes:
- ORIENT — Map landscape via Exa searches
- ROUND_1 — 6-10 agents explore facets
- CRITIQUE_1 — Build skeleton, identify gaps
- ROUND_2 — Fill gaps, broaden context
- CRITIQUE_2 — Final synthesis (retains alternatives)

[CRITICAL]:
- [ALWAYS] Pass Discussion body as context — scoping requirement.
- [ALWAYS] Retain competing approaches — §ALIGN filters feasibility.
- [NEVER] Discard alternatives during research synthesis.

---
## [3][ALIGN]
>**Dictum:** *Misaligned synthesis wastes downstream effort.*

<br>

Verify `deep-research` output addresses Discussion topic.

**Check:**
- Approaches relate to stated goal
- Trade-offs enable decision-making
- Open questions invite human input

**Format Output:**
```markdown
## Brainstorm: {title}

### Context
{problem understanding from research}

### Approaches

**[A] {name}**
{description}
- Pros: {benefits}
- Cons: {drawbacks}

**[B] {name}**
{description}
- Pros: {benefits}
- Cons: {drawbacks}

**[C] {name}** (if applicable)
{description}
- Pros: {benefits}
- Cons: {drawbacks}

### Recommendation
{preferred approach with reasoning}

### Open Questions
- {question for human input}
```

[IMPORTANT]:
- [ALWAYS] Include 2+ approaches.
- [ALWAYS] End with open questions — human direction required.

---
## [4][POST]
>**Dictum:** *Centralized output enables threaded collaboration.*

<br>

[CRITICAL]:
- [ALWAYS] Use node ID from §READ — not discussion number.
- [NEVER] Post if §ALIGN check failed.

---
## [5][VALIDATION]
>**Dictum:** *Incomplete execution propagates errors downstream.*

<br>

[VERIFY] Completion:
- [ ] §READ: Discussion content retrieved, node ID extracted
- [ ] §RESEARCH: `deep-research` completed — 2-3 approaches retained
- [ ] §ALIGN: Output addresses original topic, includes open questions
- [ ] §POST: Comment posted to Discussion
