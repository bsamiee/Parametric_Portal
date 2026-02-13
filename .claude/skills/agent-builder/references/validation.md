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
- [ ] Frontmatter fields defined (all 11 fields considered).
- [ ] Prompt sections outlined.
- [ ] Trigger coverage confirmed.

[VERIFY] Plan compliance:
- [ ] Tools match Type gate (or use `disallowedTools` denylist).
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
- [ ] `tools`: allowlist matches agent type (or omit for full access).
- [ ] `disallowedTools`: denylist removes from inherited/allowed set.
- [ ] `model`: valid enum (`haiku`, `sonnet`, `opus`, `inherit`).
- [ ] `permissionMode`: valid enum if present (`default`, `acceptEdits`, `delegate`, `dontAsk`, `bypassPermissions`, `plan`).
- [ ] `maxTurns`: positive integer if present.
- [ ] `skills`: valid skill names if present.
- [ ] `memory`: valid enum if present (`user`, `project`, `local`).
- [ ] `mcpServers`: valid nested YAML with command/args if present.
- [ ] `hooks`: valid nested YAML with event/matcher/hook structure if present.

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

[IMPORTANT] Subagents receive ONLY their system prompt (markdown body) plus environment details. They do NOT receive full Claude Code system prompt.

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
- [ ] Location: `.claude/agents/` (project) or `~/.claude/agents/` (user).

---
## [6][ERROR_SYMPTOMS]
>**Dictum:** *Symptom diagnosis accelerates fix identification.*

<br>

| [INDEX] | [SYMPTOM]               | [CAUSE]                   | [FIX]                              |
| :-----: | ----------------------- | ------------------------- | ---------------------------------- |
|   [1]   | YAML parse failure      | Tab character             | Replace with spaces                |
|   [2]   | Frontmatter ignored     | Missing delimiter         | Add `---` before and after         |
|   [3]   | Registration fails      | Name mismatch             | Match filename exactly             |
|   [4]   | Discovery fails         | Vague description         | Add "Use when" + triggers          |
|   [5]   | Agent not invoked       | No catch-all phrase       | Add "or related tasks"             |
|   [6]   | Wrong model selected    | Type gate mismatch        | Match model to type                |
|   [7]   | Tool permission error   | Missing tool in list      | Add required tool                  |
|   [8]   | Indexing error          | Wrong multi-line scalar   | Use `>-` not `\|`                  |
|   [9]   | Subagent spawns blocked | Missing Task(type) syntax | Use `Task(worker, researcher)`     |
|  [10]   | Memory not persisting   | Missing memory field      | Add `memory: user\|project\|local` |
|  [11]   | Permission prompts      | Wrong permissionMode      | Set appropriate permission mode    |
|  [12]   | Tools appearing blocked | disallowedTools too broad | Narrow denylist scope              |

---
## [7][OPERATIONAL_COMMANDS]
>**Dictum:** *Observable outcomes enable verification.*

<br>

```bash
# YAML validation
head -30 .claude/agents/my-agent.md  # Check frontmatter (11 fields possible)

# Name matching
basename .claude/agents/my-agent.md .md  # Should match name field
rg "^name:" .claude/agents/my-agent.md

# Description check
rg -i "use when" .claude/agents/my-agent.md  # Must exist

# Tool declaration
rg "^tools:" .claude/agents/my-agent.md
rg "^disallowedTools:" .claude/agents/my-agent.md

# Optional fields
rg "^permissionMode:" .claude/agents/my-agent.md
rg "^memory:" .claude/agents/my-agent.md
rg "^maxTurns:" .claude/agents/my-agent.md

# Filename convention
eza .claude/agents/ | rg -v "^[a-z-]*\.md$"  # Find violations
```
