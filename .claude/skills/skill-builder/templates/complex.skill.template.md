---
name: ${kebab-case-name}
type: complex
depth: ${extended|full}
# context: fork
# agent: Explore
# user-invocable: false
# disable-model-invocation: true
# allowed-tools: Read, Glob, Grep, Bash
# argument-hint: [target] [focus?]
description: ${action-verb-capability}. Use when ${scenario-1}, ${scenario-2}, or ${scenario-3}.
---

# [H1][${NAME}]
>**Dictum:** *${core-truth-one-sentence}.*

<br>

${one-sentence-purpose}

**Tasks:**
1. Collect parameters — ${param-1}: `${options}`, ${param-n}: `${options}`
2. Read [${domain-1}.md](./references/${domain-1}.md) — ${domain-1-description}
3. Read [${domain-n}.md](./references/${domain-n}.md) — ${domain-n-description}
4. (scripting) Read [scripting.md](./references/scripting.md) — Automation standards
5. (prose) Load `style-standards` skill — Voice, formatting, constraints
6. Execute per ${workflow}:
   - (${param-value-1}) ${action} — see [${workflow-1}.md](./references/${workflow-1}.md)
   - (${param-value-n}) ${action} — see [${workflow-n}.md](./references/${workflow-n}.md)
7. Validate — Quality gate; see VALIDATION

**Dependencies:**
- `${skill-name}` — ${purpose}
- `${output-style}` — Sub-agent output format

**References:**

| Domain        | File                                                        |
| ------------- | ----------------------------------------------------------- |
| ${domain-1}   | [${domain-1}.md](references/${domain-1}.md)                  |
| ${domain-n}   | [${domain-n}.md](references/${domain-n}.md)                  |
| Scripting     | [scripting.md](references/scripting.md)                      |
| Validation    | [validation.md](references/validation.md)                    |

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

See [validation.md](./references/validation.md) for operational checklist.
