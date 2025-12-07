# [H1][VALIDATION]
>**Dictum:** *Operational criteria verify agent quality.*

<br>

Operational verification procedures for agent-builder. SKILL.md §VALIDATION contains high-level gates.

---
## [1][REQUIREMENTS_GATE]
>**Dictum:** *Requirements clarity prevents rework.*

<br>

[VERIFY] Requirements captured:
- [ ] Name follows naming conventions (kebab-case, descriptive).
- [ ] Type explicitly stated (readonly|write|orchestrator|full).
- [ ] 3+ trigger scenarios identified.
- [ ] Deliverable articulated.

---
## [2][PLAN_GATE]
>**Dictum:** *Synthesis ensures informed artifact creation.*

<br>

[VERIFY] Plan synthesis complete:
- [ ] Frontmatter fields defined.
- [ ] Prompt sections outlined.
- [ ] Trigger coverage confirmed.

[VERIFY] Plan compliance:
- [ ] Tools match Type gate.
- [ ] Model matches Type gate.
- [ ] Description includes "Use when" + 3+ triggers.

---
## [3][FRONTMATTER_GATE]
>**Dictum:** *Frontmatter structure determines discoverability.*

<br>

[VERIFY] Before deployment:
- [ ] Delimiters: `---` on line 1; closing `---` on own line.
- [ ] Syntax: spaces only—no tabs; quote special characters.
- [ ] `name`: lowercase + hyphens; max 64 chars; matches filename.
- [ ] `description`: third person, active voice, present tense.
- [ ] `description`: includes "Use when" + 3+ trigger scenarios.
- [ ] `description`: catch-all phrase for broader applicability.
- [ ] Multi-line: folded scalar `>-` only—never `|`.

---
## [4][PROMPT_GATE]
>**Dictum:** *Prompt structure ensures agent effectiveness.*

<br>

[VERIFY] Before deployment:
- [ ] Role line: concise, imperative, states deliverable.
- [ ] Sections: H2 with numbered sigils.
- [ ] Constraints: `[CRITICAL]`/`[IMPORTANT]` markers present.
- [ ] Output spec: explicit format defined.
- [ ] No verbose introductions or explanations.
- [ ] Stateless operation—no prior context assumptions.

---
## [5][ARTIFACT_GATE]
>**Dictum:** *Final validation ensures deployment readiness.*

<br>

[VERIFY] Quality gate:
- [ ] Filename: kebab-case, `.md` extension.
- [ ] `name`: matches filename (without extension).
- [ ] `description`: third person, active, "Use when" clause, catch-all.
- [ ] `tools`: matches Type gate (or omitted for full).
- [ ] YAML: `---` delimiters, spaces only, `>-` for multi-line.
- [ ] Role line: imperative, single sentence.
- [ ] Sections: H2 with numbered sigils.
- [ ] Constraints: [CRITICAL]/[IMPORTANT] markers present.
- [ ] Output spec: explicit format defined.

---
## [6][ERROR_SYMPTOMS]
>**Dictum:** *Symptom diagnosis accelerates fix identification.*

<br>

| [SYMPTOM]             | [CAUSE]                 | [FIX]                      |
| --------------------- | ----------------------- | -------------------------- |
| YAML parse failure    | Tab character           | Replace with spaces        |
| Frontmatter ignored   | Missing delimiter       | Add `---` before and after |
| Registration fails    | Name mismatch           | Match filename exactly     |
| Discovery fails       | Vague description       | Add "Use when" + triggers  |
| Agent not invoked     | No catch-all phrase     | Add "or related tasks"     |
| Wrong model selected  | Type gate mismatch      | Match model to type        |
| Tool permission error | Missing tool in list    | Add required tool          |
| Indexing error        | Wrong multi-line scalar | Use `>-` not `\|`          |

---
## [7][OPERATIONAL_COMMANDS]
>**Dictum:** *Observable outcomes enable verification.*

<br>

```bash
# YAML validation
head -20 .claude/agents/my-agent.md  # Check frontmatter

# Name matching
basename .claude/agents/my-agent.md .md  # Should match name field
grep "^name:" .claude/agents/my-agent.md

# Description check
grep -i "use when" .claude/agents/my-agent.md  # Must exist

# Tool declaration
grep "^tools:" .claude/agents/my-agent.md

# Filename convention
ls .claude/agents/ | grep -v "^[a-z-]*\.md$"  # Find violations
```
