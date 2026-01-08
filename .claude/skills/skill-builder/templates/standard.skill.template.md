---
name: ${kebab-case-name}
type: standard
depth: ${base|extended|full}
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
1. Read [index.md](./index.md) — Reference file listing for navigation
2. Read [${domain-1}.md](./references/${domain-1}.md) — ${domain-1-description}
3. Read [${domain-n}.md](./references/${domain-n}.md) — ${domain-n-description}
4. (${condition}) Read [${conditional}.md](./references/${conditional}.md) — ${conditional-description}
5. (prose) Load `style-standards` skill — Voice, formatting, constraints
6. Execute per ${workflow} — ${workflow-phases}
7. Validate — Quality gate; see §VALIDATION

**Scope:** ${remove-if-not-needed}
- *${Scope-1}:* ${what-this-covers}.
- *${Scope-N}:* ${what-this-covers}.

**Domain Navigation:** ${remove-if-not-needed}
- *[${DOMAIN_1}]* — ${domain-summary}. Load when ${trigger}.
- *[${DOMAIN_N}]* — ${domain-summary}. Load when ${trigger}.

**Templates:** ${remove-if-not-needed} [→${template}.md](./templates/${template}.md) — ${template-purpose}.

**Dependencies:** ${remove-if-none}
- `${skill-name}` — ${purpose}

[REFERENCE]: [index.md](./index.md) — Complete reference file listing

---
## [1][${DOMAIN_1}]
>**Dictum:** *${domain-truth}.*

<br>

${domain-context-sentence-explaining-why}

${optional: decision gate, tables, or key concepts}

**Guidance:**
- `${Concept}` — ${why-it-matters}.

**Best-Practices:** ${remove-if-not-needed}
- **${Pattern}** — ${constraint-or-rule}.

---
## [N][${DOMAIN_N}]
>**Dictum:** *${domain-truth}.*

<br>

${domain-context-sentence-explaining-why}

**Guidance:**
- `${Concept}` — ${why-it-matters}.

**Best-Practices:** ${remove-if-not-needed}
- **${Pattern}** — ${constraint-or-rule}.

---
## [N+1][VALIDATION]
>**Dictum:** *Gates prevent incomplete execution.*

<br>

[VERIFY] Completion:
- [ ] References: All required domain files loaded per Tasks.
- [ ] Workflow: ${workflow} phases executed.
- [ ] Style: `style-standards` constraints applied.
- [ ] Quality: LOC within limits, content separation enforced.

[REFERENCE] Operational checklist: [→validation.md](./references/validation.md)
