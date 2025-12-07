---
description: Create new agent via agent-builder workflow (project)
argument-hint: [agent-name] [type: readonly|write|orchestrator|full] [purpose?]
---

# [H1][CREATE-AGENT]
>**Dictum:** *Research-informed agent creation maximizes discovery accuracy and behavioral precision.*

<br>

---
## [1][PARAMETERS]
>**Dictum:** *Parameters scope agent creation.*

<br>

Name: $1<br>
Type: $2<br>
Purpose: ${3:-unspecified}

---
## [2][CONSTRAINTS]
>**Dictum:** *Constraints enforce agent specification limits.*

<br>

| [INDEX] |   [LIMIT]   | [VALUE]     | [RATIONALE]                            |
| :-----: | :---------: | ----------- | -------------------------------------- |
|   [1]   |    Name     | kebab-case  | Filename = `name` field                |
|   [2]   | Description | <1024 chars | Third person, "Use when" clause        |
|   [3]   |    Tools    | Type-gated  | Scoped permissions                     |
|   [4]   |   Prompt    | Structured  | Role → Sections → Constraints → Output |

---
## [3][SKILL_CONTEXT]
>**Dictum:** *Skill context anchors agent infrastructure.*

<br>

@.claude/skills/agent-builder/SKILL.md
@.claude/skills/agent-builder/index.md
@.claude/skills/agent-builder/references/frontmatter.md
@.claude/skills/agent-builder/references/prompt.md
@.claude/skills/agent-builder/templates/agent.template.md

---
## [4][TYPE_GATES]
>**Dictum:** *Type gates scope tools and model selection.*

<br>

| [INDEX] | [TYPE]       | [TOOLS]                       | [MODEL] | [USE_CASE]                  |
| :-----: | ------------ | ----------------------------- | :-----: | --------------------------- |
|   [1]   | readonly     | Read, Glob, Grep              | sonnet  | Analysis, review, audit     |
|   [2]   | write        | Read, Edit, Write, Glob, Bash | sonnet  | Implementation, refactoring |
|   [3]   | orchestrator | Task, Read, Glob, TodoWrite   |  opus   | Agent dispatch, synthesis   |
|   [4]   | full         | *(omit field)*                | session | General-purpose             |

---
## [5][WORKFLOW]
>**Dictum:** *Phase execution ensures research-informed creation.*

<br>

Execute phases sequentially. Research before authoring.

### [5.1][UNDERSTAND]

Confirm before proceeding:
- `Name` — Kebab-case, descriptive, role/action-based. Reject: helper, processor, agent.
- `Type` — readonly|write|orchestrator|full. Gates tools + model.
- `Triggers` — What user intent activates? Capture 3+ scenarios.
- `Deliverable` — What concrete output does this agent produce?
- `Constraints` — What boundaries govern behavior?

---
### [5.2][ACQUIRE]

Invoke `style-summarizer` for voice constraints. Compile manifest:

```
Name: ${name} | Type: ${type}
Tools: ${tool_list} | Model: ${model}
Triggers: ${trigger_scenarios}
Deliverable: ${output_description}
```

---
### [5.3][RESEARCH]

Invoke `deep-research`:

| [PARAM] | [VALUE] |
| --- | --- |
| Topic | Agent design for ${type} type: ${purpose} |
| Constraints | Manifest §5.2, style from style-summarizer, AgentCount: 6/4 |

@.claude/skills/deep-research/SKILL.md

Post-dispatch: Extract validated findings, synthesize golden path.

---
### [5.4][AUTHOR]

Create `.claude/agents/$1.md`:

1. **Frontmatter:**
   - `name`: $1 (kebab-case, matches filename)
   - `description`: Capability + "Use when" + 3+ triggers + catch-all
   - `tools`: Per §TYPE_GATES (omit for full)
   - `model`: Per §TYPE_GATES (omit for session default)
   - `skills`: If agent needs skill context

2. **Role Line:** Imperative, single sentence, states concrete deliverable.

3. **Sections (H2 with sigils):**
   - `[1][INPUT]` — Invocation context
   - `[2][PROCESS]` — Numbered steps with **verb** bold
   - `[3][OUTPUT]` — Explicit format specification
   - `[4][CONSTRAINTS]` — [CRITICAL]/[IMPORTANT] markers

4. **Voice:** Third person description, imperative prompt body.

---
### [5.5][VALIDATE]

[VERIFY] Pre-deployment:
- [ ] Filename: kebab-case, `.md` extension.
- [ ] `name`: matches filename (without extension).
- [ ] `description`: third person, active, "Use when" clause, catch-all.
- [ ] `tools`: matches Type gate (or omitted for full).
- [ ] YAML: `---` delimiters, spaces only, `>-` for multi-line.
- [ ] Role line: imperative, single sentence.
- [ ] Sections: H2 with numbered sigils.
- [ ] Constraints: [CRITICAL]/[IMPORTANT] markers present.
- [ ] Output spec: explicit format defined.

[CRITICAL]:
- [ALWAYS] Research before authoring—Exa queries inform description triggers.
- [ALWAYS] Dispatch parallel agents for comprehensive coverage.
- [ALWAYS] Type gates tools AND model—both derived from $2.
- [NEVER] Vague descriptions—"Use when" + triggers required.
- [NEVER] Verbose prompt body—stateless, concise, structured.
