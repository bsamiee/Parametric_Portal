---
name: ${kebab-case-name}
type: simple
depth: ${base|extended}
# context: fork
# user-invocable: false
# agent: Explore
description: ${action-verb-capability}. Use when ${scenario-1}, ${scenario-2}, or ${scenario-3}.
---

# [H1][${NAME}]
>**Dictum:** *${core-truth-one-sentence}.*

<br>

${one-sentence-purpose}

**Workflow:**
1. §${STEP_1} — ${step-1-action}
2. §${STEP_2} — ${step-2-action}
3. §${STEP_N} — ${step-n-action}

**Dependencies:** ${remove-if-none}
- `${skill-name}` — ${purpose}

**Input:** ${remove-if-none}
- `${param}`: ${description}

**Exclusions:** ${remove-if-none} ${comma-separated-exclusions}

---
## [1][${STEP_1}]
>**Dictum:** *${step-principle}.*

<br>

${step-context-and-purpose}

${content: tables, code blocks, bullet lists as needed}

[IMPORTANT]: ${remove-if-not-needed}
- [ALWAYS] ${positive-rule}.
- [NEVER] ${negative-rule}.

[VERIFY] ${gate-name}: ${inline-gate-for-decision-points-only}
- [ ] ${precondition-before-expensive-operation}

---
## [2][${STEP_2}]
>**Dictum:** *${step-principle}.*

<br>

${step-context-and-purpose}

${content: tables, code blocks, bullet lists as needed}

[CRITICAL]: ${remove-if-not-needed}
- [ALWAYS] ${critical-rule}.

---
## [N][${STEP_N}]
>**Dictum:** *${step-principle}.*

<br>

${step-context-and-purpose}

${content: subsections [N.1], [N.2] if needed for complex steps}

---
## [N+1][VALIDATION]
>**Dictum:** *Gates prevent incomplete execution.*

<br>

[VERIFY] Completion:
- [ ] ${step-1}: ${observable-outcome}
- [ ] ${step-2}: ${observable-outcome}
- [ ] ${step-n}: ${observable-outcome}
- [ ] Quality: ${domain-specific-quality-gate}
