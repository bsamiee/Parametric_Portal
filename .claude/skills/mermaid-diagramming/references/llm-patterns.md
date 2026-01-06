# [H1][LLM_PATTERNS]
>**Dictum:** *Agent-optimized prompting yields valid diagram output.*

<br>

Best practices for LLM/agent consumption of Mermaid diagrams; covers terminology, prompt engineering, validation loops, and complexity thresholds.

[REFERENCE] Validation anti-patterns: [→validation.md](./validation.md)<br>
[REFERENCE] Accessibility directives: [→styling.md§6](./styling.md#6accessibility)

---
## [1][TERMINOLOGY]
>**Dictum:** *Domain-specific vocabulary improves generation accuracy.*

<br>

Use Mermaid-native terms in prompts to reduce ambiguity.

| [INDEX] | [USE] | [AVOID] | [RATIONALE] |
| :-----: | ----- | ------- | ----------- |
| [1] | node | shape, box, element | Mermaid uses "node" in syntax and docs |
| [2] | edge | line, arrow, connection | Edges are typed (solid, dotted, thick) |
| [3] | subgraph | group, container, section | Subgraph is keyword in flowchart syntax |
| [4] | participant | actor (unless UML stick figure) | Sequence diagrams distinguish these |
| [5] | direction TB/LR/BT/RL | top-to-bottom, left-to-right | Use exact direction keywords |
| [6] | classDef | style, CSS class | classDef is Mermaid keyword |
| [7] | linkStyle | edge style, arrow style | linkStyle targets edges by index |

---
## [2][PROMPT_ENGINEERING]
>**Dictum:** *Structured prompts produce syntactically valid diagrams.*

<br>

### [2.1][EFFECTIVE_PATTERNS]

| [INDEX] | [PATTERN] | [EXAMPLE] |
| :-----: | --------- | --------- |
| [1] | Specify diagram type first | "Create a flowchart showing..." |
| [2] | Define node count bounds | "Use 5-10 nodes maximum" |
| [3] | Request explicit direction | "Use TB (top-to-bottom) layout" |
| [4] | Enumerate relationships | "A connects to B, B connects to C and D" |
| [5] | Specify edge semantics | "Use dotted arrows for optional flows" |
| [6] | Request accessibility | "Include accTitle and accDescr" |

### [2.2][ANTI_PATTERNS]

| [INDEX] | [ANTI-PATTERN] | [SEVERITY] | [FIX] |
| :-----: | -------------- | ---------- | ----- |
| [1] | Vague complexity | High | Specify node/edge count limits |
| [2] | Missing diagram type | Critical | Always state flowchart/sequence/class/etc |
| [3] | Ambiguous relationships | High | Use "A to B" not "A and B connected" |
| [4] | Requesting layout control | Medium | Mermaid auto-layouts; accept results |
| [5] | Mixing diagram types | Critical | One diagram type per code block |
| [6] | Secrets in prompts | Critical | Never include credentials or keys |

### [2.3][PROMPT_TEMPLATE]

```text
Create a [DIAGRAM_TYPE] diagram with the following requirements:

Structure:
- Direction: [TB|LR|BT|RL]
- Node count: [MIN]-[MAX] nodes
- Subgraphs: [YES|NO]

Nodes:
- [NODE_A]: [DESCRIPTION]
- [NODE_B]: [DESCRIPTION]
...

Relationships:
- [NODE_A] --> [NODE_B]: [LABEL]
- [NODE_B] -.-> [NODE_C]: [LABEL]
...

Styling:
- Use classDef for [CATEGORY] nodes
- Edge semantics: solid=required, dotted=optional

Accessibility:
- accTitle: [TITLE]
- accDescr: [DESCRIPTION]
```

---
## [3][VALIDATION_LOOPS]
>**Dictum:** *Automated validation prevents silent failures.*

<br>

LLMs produce syntactically invalid Mermaid; always validate before rendering.

### [3.1][VALIDATION_PIPELINE]

```text
LLM Output
    |
    v
Extract code block (```mermaid ... ```)
    |
    v
Run: npx @mermaid-js/mermaid-cli -i input.mmd -o output.svg
    |
    +-- Success --> Use diagram
    |
    +-- Failure --> Feed error back to LLM --> Retry (max 3)
```

### [3.2][CLI_COMMANDS]

| [INDEX] | [COMMAND] | [PURPOSE] |
| :-----: | --------- | --------- |
| [1] | `npx mmdc -i diagram.mmd -o diagram.svg` | Render to SVG |
| [2] | `npx mmdc -i diagram.mmd -o diagram.png` | Render to PNG |
| [3] | `npx mmdc -i diagram.mmd -o diagram.pdf` | Render to PDF |
| [4] | `npx mmdc -c config.json -i diagram.mmd` | Apply config |

### [3.3][ERROR_FEEDBACK]

When validation fails, provide LLM with:
1. **Original prompt** — context for regeneration
2. **Generated diagram** — failed syntax
3. **Error message** — parser output
4. **Correction request** — "Fix the syntax error and regenerate"

---
## [4][COMPLEXITY_THRESHOLDS]
>**Dictum:** *Bounded complexity prevents degraded output quality.*

<br>

LLM accuracy degrades with diagram complexity; enforce limits.

### [4.1][RECOMMENDED_LIMITS]

| [INDEX] | [DIAGRAM_TYPE] | [MAX_NODES] | [MAX_EDGES] | [RATIONALE] |
| :-----: | -------------- | :---------: | :---------: | ----------- |
| [1] | flowchart | 15 | 25 | Layout becomes chaotic beyond this |
| [2] | sequence | 8 participants | 20 messages | Readability degrades |
| [3] | class | 10 classes | 15 relationships | UML complexity limit |
| [4] | state | 12 states | 18 transitions | Nested states compound |
| [5] | ER | 8 entities | 12 relationships | Crow's foot density |
| [6] | gantt | 20 tasks | N/A | Horizontal scrolling |
| [7] | mindmap | 4 levels deep | 30 nodes | Hierarchy readability |

### [4.2][DECOMPOSITION_STRATEGY]

When complexity exceeds limits:

1. **Split by subsystem** — Create separate diagrams per domain
2. **Use C4 levels** — Context → Container → Component → Code
3. **Reference diagrams** — "See [diagram-name] for details"
4. **Aggregate views** — High-level overview + detailed breakdowns

### [4.3][HYBRID_WORKFLOW]

For complex diagrams beyond LLM capability:

```text
1. LLM generates skeleton (nodes + primary edges)
2. Human refines in Mermaid Live Editor
3. Human adds styling, subgraphs, advanced syntax
4. Validate via mermaid-cli
5. Store in version control
```

---
## [5][CONTEXT_MANAGEMENT]
>**Dictum:** *Token efficiency preserves generation quality.*

<br>

Mermaid processing consumes LLM context; optimize input.

### [5.1][CONTEXT_ANTI_PATTERNS]

| [INDEX] | [ANTI-PATTERN] | [SEVERITY] | [FIX] |
| :-----: | -------------- | ---------- | ----- |
| [1] | Entire codebase as context | Critical | Extract relevant modules only |
| [2] | Verbose node descriptions | High | Use concise labels, expand in accDescr |
| [3] | Multiple diagram requests | Medium | One diagram per prompt |
| [4] | Iterative refinement loops | Medium | Batch corrections in single prompt |

### [5.2][EFFICIENT_PATTERNS]

| [INDEX] | [PATTERN] | [BENEFIT] |
| :-----: | --------- | --------- |
| [1] | Pre-extract entities | Reduces parsing overhead |
| [2] | Provide example syntax | Improves output accuracy |
| [3] | Specify version constraints | Avoids deprecated syntax |
| [4] | Request raw code block only | Reduces explanatory tokens |

---
## [6][SECURITY]
>**Dictum:** *Prompt isolation prevents data exfiltration.*

<br>

### [6.1][SECURITY_CHECKLIST]

[VERIFY] LLM Security:
- [ ] Never include credentials, API keys, or secrets in prompts.
- [ ] Use local/self-hosted LLMs for confidential architectures.
- [ ] Sanitize diagram output before embedding in applications.
- [ ] Review generated URLs for malicious targets.
- [ ] Avoid `javascript:` or `data:` URLs in click handlers.

### [6.2][SENSITIVE_DIAGRAM_WORKFLOW]

```text
1. Abstract sensitive details (use generic names)
2. Generate diagram with placeholder labels
3. Post-process: replace placeholders with real values
4. Store in secured repository with access controls
```

---
## [7][VERIFY]
>**Dictum:** *Gates prevent non-compliant agent output.*

<br>

[VERIFY] LLM Patterns:
- [ ] Used Mermaid-native terminology in prompt.
- [ ] Specified diagram type and direction.
- [ ] Enforced complexity limits (nodes/edges).
- [ ] Validated output via mermaid-cli.
- [ ] Included accessibility attributes.
- [ ] No secrets or sensitive data in prompt.
