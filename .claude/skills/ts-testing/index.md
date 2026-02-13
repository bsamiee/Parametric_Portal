# [H1][INDEX]
>**Dictum:** *Reference navigation requires centralized discovery.*

<br>

Navigate testing laws, density techniques, categories, guardrails, and validation.

| [INDEX] | [DOMAIN]       | [PATH]                                     | [DICTUM]                                             |
| :-----: | -------------- | ------------------------------------------ | ---------------------------------------------------- |
|   [1]   | **Laws**       | [→laws.md](references/laws.md)             | Algebraic laws define WHAT to test.                  |
|   [2]   | **Density**    | [→density.md](references/density.md)       | Density techniques define HOW to test.               |
|   [3]   | **Categories** | [→categories.md](references/categories.md) | Category routing selects environment and tools.      |
|   [4]   | **Guardrails** | [→guardrails.md](references/guardrails.md) | Anti-patterns and enforcement prevent quality decay. |
|   [5]   | **Validation** | [→validation.md](references/validation.md) | Operational checklists verify spec quality.          |

**Templates:**
- `templates/unit-pbt.spec.template.md` -- Algebraic PBT scaffold for `packages/server/` modules.
- `templates/integration.spec.template.md` -- Testcontainers/MSW scaffold for boundary testing.

**Scope:** Three pillars (algebraic PBT, parametric generation, mutation defense) across four categories (unit, integration, system, E2E). Hard thresholds in SKILL.md section 2.
