---
name: ${kebab-case-name}
type: complex
depth: ${extended|full}
# context: fork
# user-invocable: false
# agent: Explore
description: ${action-verb-capability}. Use when ${scenario-1}, ${scenario-2}, or ${scenario-3}.
---

# [H1][${NAME}]
>**Dictum:** *${core-truth-one-sentence}.*

<br>

${one-sentence-purpose}

**Tasks:**
1. Collect parameters — ${param-1}: `${options}`, ${param-n}: `${options}`
2. Read [index.md](./index.md) — Reference file listing for navigation
3. Read [${domain-1}.md](./references/${domain-1}.md) — ${domain-1-description}
4. Read [${domain-n}.md](./references/${domain-n}.md) — ${domain-n-description}
5. (scripting) Read [scripting.md](./references/scripting.md) — Automation standards
6. (prose) Load `style-standards` skill — Voice, formatting, constraints
7. Execute per ${workflow}:
   - (${param-value-1}) ${action} — see [${workflow-1}.md](./references/workflows/${workflow-1}.md)
   - (${param-value-n}) ${action} — see [${workflow-n}.md](./references/workflows/${workflow-n}.md)
8. Validate — Quality gate; see §VALIDATION

**Dependencies:**
- `${skill-name}` — ${purpose}
- `${output-style}` — Sub-agent output format

[REFERENCE]: [index.md](./index.md) — Complete file listing

---
## [1][${DOMAIN_1}]
>**Dictum:** *${domain-truth}.*

<br>

${domain-context-sentence-explaining-why}

${tables, key concepts, decision gates as needed}

**Guidance:**
- `${Concept}` — ${why-it-matters}.
- `${Concept}` — ${why-it-matters}.

**Best-Practices:**
- **${Pattern}** — ${constraint-or-rule}.

---
## [2][${DOMAIN_N}]
>**Dictum:** *${domain-truth}.*

<br>

${domain-context-sentence-explaining-why}

**Guidance:**
- `${Concept}` — ${why-it-matters}.

**Best-Practices:**
- **${Pattern}** — ${constraint-or-rule}.

---
## [N][SCRIPTING]
>**Dictum:** *Deterministic automation extends LLM capabilities.*

<br>

scripts/ folder for external tool orchestration, artifact generation, validation.

**Guidance:**
- `Justification` — Script overhead demands explicit need: tool wrapping, reproducibility, schema enforcement.
- `Standards` — Python 3.14+/TypeScript 6.0+, frozen config, dispatch tables, JSON output.

**Best-Practices:**
- **Augmentation** — Scripts support workflows; core logic remains in SKILL.md and references.

---
## [N+1][VALIDATION]
>**Dictum:** *Gates prevent incomplete execution.*

<br>

[VERIFY] Completion:
- [ ] Parameters: ${param-list} collected and applied.
- [ ] References: All required domain files loaded per Tasks.
- [ ] Workflow: ${workflow} executed per parameter fork.
- [ ] Style: `style-standards` constraints applied.
- [ ] Quality: LOC within limits, content separation enforced.

[REFERENCE] Operational checklist: [→validation.md](./references/validation.md)
