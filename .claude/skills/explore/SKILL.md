---
name: explore
type: simple
depth: base
description: >-
  Researches options and recommends approach for GitHub Discussions. Use when
  (1) Discussion has `idea` label needing approach selection, (2) raw idea
  requires research synthesis, or (3) brainstorm needs actionable recommendation.
---

# [H1][EXPLORE]
>**Dictum:** *Research-backed recommendations enable autonomous progression.*

<br>

Transform Discussion ideas into actionable recommendations via deep research synthesis.

**Workflow**
1. §READ — `uv run .claude/skills/github-tools/scripts/gh.py discussion-view --number {discussion}`.
2. §RESEARCH — Invoke `deep-research` skill — parallel exploration.
3. §SYNTHESIZE — Produce recommendation with rationale and next steps.
4. §POST — `uv run .claude/skills/github-tools/scripts/gh.py discussion-comment --discussion-id {id} --body {output}`.

**Dependencies**
- `github-tools` — `discussion-view` (input), `discussion-comment` (output).
- `deep-research` — Parallel agent research and synthesis.

**Input**
- `discussion` — Discussion number to explore.

**Output**
- Discussion comment with recommendation + `<!-- SKILL_COMPLETE: explore -->` marker.

**Exclusions**
Implementation planning (→ plan skill), code generation, issue decomposition (→ decompose skill).

---
## [1][READ]
>**Dictum:** *Scope boundaries prevent research drift.*

<br>

**Extract**
- `title` — Topic identifier.
- `body` — Raw idea content, constraints, goals.
- `id` — Node ID — §POST requirement.
- `category` — Verify `Planning` category.

[IMPORTANT]:
- [ALWAYS] Extract node ID (`id` field) — §POST requirement.
- [NEVER] Proceed if Discussion body empty.

---
## [2][RESEARCH]
>**Dictum:** *Parallel investigation surfaces competing approaches.*

<br>

Invoke `deep-research` skill — Discussion content as topic.

**Invoke**
```
Topic: {discussion.title}
Context: {discussion.body}
Constraints: Explore diverse implementation paths and architectural patterns. Retain competing approaches even if suboptimal—alternatives inform trade-off analysis.
Prioritize: Existing solutions, prior art, known pitfalls, resource requirements.
```

`deep-research` executes:
- ORIENT — Map landscape via `exa-tools` skill searches.
- ROUND_1 — 6-10 agents explore facets.
- CRITIQUE_1 — Build skeleton, identify gaps.
- ROUND_2 — Fill gaps, broaden context.
- CRITIQUE_2 — Final synthesis (retains alternatives).

[CRITICAL]:
- [ALWAYS] Pass Discussion body as context — scoping requirement.
- [ALWAYS] Retain 2-3 competing approaches for §SYNTHESIZE.
- [NEVER] Discard alternatives during research synthesis.

---
## [3][SYNTHESIZE]
>**Dictum:** *Actionable recommendations enable autonomous pipeline progression.*

<br>

Transform `deep-research` output into structured recommendation.

**Verify**
- Approaches relate to stated goal.
- Trade-offs enable decision-making.
- Recommendation is actionable (not open-ended).

**Format Output**
```markdown
## [1][EXPLORE]: {title}

### [1.1][CONTEXT]
{problem understanding — 2-3 sentences}

### [1.2][APPROACHES]

**[A] {name}**
{description — 1-2 sentences}
- Pros: {benefits}
- Cons: {drawbacks}

**[B] {name}**
{description — 1-2 sentences}
- Pros: {benefits}
- Cons: {drawbacks}

**[C] {name}** (if applicable)
{description — 1-2 sentences}
- Pros: {benefits}
- Cons: {drawbacks}

### [1.3][RECOMMENDATION]
**Selected:** {approach letter + name}
**Rationale:** {why this approach — 2-3 sentences}
**Trade-offs Accepted:** {what we're accepting by choosing this}

### [1.4][NEXT_STEPS]
- {concrete action 1 — what to do next}
- {concrete action 2 — what to do after}

<!-- SKILL_COMPLETE: explore -->
```

[IMPORTANT]:
- [ALWAYS] Include 2+ approaches with pros/cons.
- [ALWAYS] Select ONE recommended approach with rationale.
- [ALWAYS] End with concrete NEXT_STEPS (not questions).
- [ALWAYS] Append `<!-- SKILL_COMPLETE: explore -->` marker.

[CRITICAL]:
- [NEVER] End with open questions — pipeline continues autonomously.
- [NEVER] Omit completion marker — n8n orchestration depends on it.

---
## [4][POST]
>**Dictum:** *Completion markers enable autonomous orchestration.*

<br>

Post formatted output to Discussion as comment.

**Command**
```bash
uv run .claude/skills/github-tools/scripts/gh.py discussion-comment \
  --discussion-id {id} \
  --body "{formatted_output}"
```

[CRITICAL]:
- [ALWAYS] Use node ID from §READ — not discussion number.
- [ALWAYS] Verify `<!-- SKILL_COMPLETE: explore -->` marker present in body.
- [NEVER] Post if §SYNTHESIZE produced open-ended questions.

---
## [5][VALIDATION]
>**Dictum:** *Incomplete execution breaks autonomous pipeline.*

<br>

[VERIFY] Completion:
- [ ] §READ: Discussion content retrieved, node ID extracted
- [ ] §RESEARCH: `deep-research` completed — 2-3 approaches retained
- [ ] §SYNTHESIZE: Output has RECOMMENDATION (not questions), NEXT_STEPS concrete
- [ ] §POST: Comment posted with `<!-- SKILL_COMPLETE: explore -->` marker

**Governance Validation**
Post-execution, `governance` agent validates:
- §CONTEXT addresses Discussion topic.
- §APPROACHES consider Discussion constraints.
- §RECOMMENDATION addresses Discussion goals.
- §NEXT_STEPS are actionable.

Binary pass/fail—no confidence scoring.
