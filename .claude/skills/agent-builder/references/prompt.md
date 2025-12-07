# [H1][PROMPT]
>**Dictum:** *Structured prompts constrain agent execution.*

<br>

Body after frontmatter forms system prompt; structure determines effectiveness.

---
## [1][STRUCTURE]
>**Dictum:** *Section hierarchy enables progressive loading.*

<br>

| [INDEX] | [ELEMENT]   | [PURPOSE]                   | [LOCATION]               |
| :-----: | ----------- | --------------------------- | ------------------------ |
|   [1]   | Role line   | Defines agent identity      | First line after `---`   |
|   [2]   | H2 sections | Numbered instruction blocks | Sequential after role    |
|   [3]   | Constraints | `[CRITICAL]`/`[IMPORTANT]`  | Within relevant sections |
|   [4]   | Output spec | Defines response format     | Dedicated section        |

<br>

### [1.1][ROLE_LINE]

Open with concise role definition; set behavioral framing.

```markdown
Extract and consolidate style guidance from documentation. Return severity-ranked summaries.
```

[IMPORTANT]:
- [NEVER] Verbose introductions or explanations.
- [ALWAYS] Imperative voice and single sentence.
- [ALWAYS] State concrete deliverable.

---
### [1.2][SECTIONS]

Use H2 headers with numbered sigils for main sections.

```markdown
## [1][INPUT]
Invoked by main agent when context is needed.

## [2][PROCESS]
1. **Map structure**: Glob files, identify scope.
2. **Read files**: Extract content.
3. **Synthesize**: Deduplicate, structure findings.

## [3][OUTPUT]
Return structured summary with severity ranking.

## [4][CONSTRAINTS]
- Read-only.
- Concise output.
```

---
## [2][CONSTRAINTS]
>**Dictum:** *Constraint markers enforce behavioral boundaries.*

<br>

| [INDEX] | [MARKER]      | [MEANING]             | [ENFORCEMENT] |
| :-----: | ------------- | --------------------- | ------------- |
|   [1]   | `[CRITICAL]`  | Non-negotiable rule   | Blocks action |
|   [2]   | `[IMPORTANT]` | Strongly advised      | Guides action |
|   [3]   | `[ALWAYS]`    | Universal application | Every context |
|   [4]   | `[NEVER]`     | Absolute prohibition  | No exceptions |
|   [5]   | `[VERIFY]`    | Gate checklist        | Pre-condition |

Placement pattern:

```markdown
[CRITICAL]:
- [NEVER] Modify files without validation gate.
- [ALWAYS] Load skill context before spawning subagents.

[IMPORTANT]:
- [ALWAYS] Use structured output format.
```

---
## [3][OUTPUT_SPEC]
>**Dictum:** *Response format enables integration.*

<br>

Define explicit output structure.

```markdown
## [3][OUTPUT]

[IMPORTANT] Concise output—max 2000 tokens.

Return structured summary:

## [1][DOMAIN_A]
- [findings]

## [2][DOMAIN_B]
- [findings]
```

---
## [4][AGENT_TYPES]
>**Dictum:** *Role determines tool scope and model selection.*

<br>

| [INDEX] | [TYPE]        | [TOOLS]                       | [MODEL] | [PURPOSE]        |
| :-----: | ------------- | ----------------------------- | :-----: | ---------------- |
|   [1]   | Read-only     | `Read, Glob, Grep`            | sonnet  | Analysis, review |
|   [2]   | Write-capable | `Read, Edit, Write, Bash`     | sonnet  | Implementation   |
|   [3]   | Orchestrator  | `Task, Read, Glob, TodoWrite` |  opus   | Agent dispatch   |
|   [4]   | Full access   | *(omit tools field)*          | session | General-purpose  |

[REFERENCE] Template scaffold: [→agent.template.md](../templates/agent.template.md)

[REFERENCE] Validation checklist: [→validation.md§4](./validation.md#4prompt_gate)
