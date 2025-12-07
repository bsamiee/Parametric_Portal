# [H1][FORMATS]
>**Dictum:** *Format selection governs output reliability and token efficiency.*

<br>

[IMPORTANT] Format selection impacts accuracy by 16pp and token cost by 6.75x. Constrained decoding achieves 97-100% compliance.

---
## [1][SELECTION]
>**Dictum:** *Empirical metrics inform format selection.*

<br>

| [INDEX] | [FORMAT]    | [ACCURACY] | [TOKEN_COST] | [STRENGTH]        | [USE_CASE]             |
| :-----: | ----------- | :--------: | :----------: | ----------------- | ---------------------- |
|   [1]   | Markdown-KV |   60.7%    |     2.7x     | Highest accuracy  | Agent output, reports  |
|   [2]   | XML         |   56.0%    |     1.8x     | Schema validation | Compliance, strict     |
|   [3]   | YAML        |   54.7%    |     0.7x     | Human-readable    | Config files           |
|   [4]   | JSON        |   52.3%    |    0.85x     | Universal parsing | API output, structured |
|   [5]   | CSV         |   44.3%    |     1.0x     | Minimal overhead  | Tabular data           |

**Token Cost Baseline:** CSV = 1.0x.

<br>

### [1.1][DECISION_DISPATCH]

```
1. Count consumers: 1 use → inline; 3+ uses → reference pattern.
2. Identify structure: flat → CSV; nested → JSON/YAML; strict schema → XML.
3. Accuracy need: critical → Markdown-KV; balanced → JSON.
4. Token budget: constrained → YAML (0.7x); flexible → Markdown-KV (2.7x).
```

---
### [1.2][SCHEMA_ENFORCEMENT]

| [INDEX] | [PROVIDER] | [METHOD]               | [COMPLIANCE] |
| :-----: | ---------- | ---------------------- | :----------: |
|   [1]   | OpenAI     | Constrained decoding   |     100%     |
|   [2]   | Anthropic  | Tool-based constraints |     100%     |
|   [3]   | XGrammar   | PDA-based (5x speedup) |   97-100%    |
|   [4]   | Outlines   | FSM-based              |    95-97%    |

[CRITICAL] Structured outputs guarantee format compliance, NOT semantic correctness.

---
## [2][WEIGHTING]
>**Dictum:** *Attention distribution determines section ordering.*

<br>

| [INDEX] | [WEIGHT] | [SEVERITY] | [ATTENTION] |
| :-----: | :------: | ---------- | :---------: |
|   [1]   |    10    | CRITICAL   |    5.79x    |
|   [2]   |   7-9    | IMPORTANT  |    3.2x     |
|   [3]   |   4-6    | STANDARD   |    1.0x     |
|   [4]   |   1-3    | OPTIONAL   |    0.5x     |

[IMPORTANT] Position weight-10 sections first. Place critical constraints at sequence start.

---
## [3][EMBEDDING]
>**Dictum:** *Reference patterns enable format reuse.*

<br>

| [INDEX] | [PATTERN]   | [SYNTAX]                    | [USE_CASE]              |
| :-----: | ----------- | --------------------------- | ----------------------- |
|   [1]   | Inline      | Embed full spec in body     | Single-use formats      |
|   [2]   | Reference   | `@.claude/styles/{name}.md` | Shared across 3+ agents |
|   [3]   | Conditional | Dispatch table by type      | Multi-format output     |

<br>

### [3.1][AGENT_EMBEDDING]

**Location:** Body preamble (after frontmatter, before first H2).

```markdown
---
name: agent-name
tools: Read, ...
---

[Purpose statement]

**Output Format:** @.claude/styles/{format-name}.md

---
## [1][PROCESS]
```

[IMPORTANT]:
- Include `Read` in agent `tools:` frontmatter for reference pattern.
- Embed format reference in body preamble. Exclude from H2 sections.

[CRITICAL] Each `@` embeds entire file. Use inline embedding for single-use formats.

---
### [3.2][VARIABLES]

**Syntax:**<br>
- Required: `${variable-name}`
- Optional: `${variable-name:-default}`
- Conditional: `${variable-name?}`

**Resolution:** Resolve frontmatter variables at compile-time. Resolve context values at runtime.

---
## [4][VALIDATION]
>**Dictum:** *Compliance scoring enforces quality.*

<br>

| [INDEX] | [DIMENSION]       | [POINTS] | [VALIDATOR]                          |
| :-----: | ----------------- | :------: | ------------------------------------ |
|   [1]   | Format valid      |    30    | Parser accepts (JSON/YAML/XML/MD-KV) |
|   [2]   | Required sections |    25    | All `required: true` present         |
|   [3]   | Delimiters        |    20    | Fence + separator consistency        |
|   [4]   | Variables         |    15    | All required vars resolved           |
|   [5]   | Anti-bloat        |    10    | No prohibited patterns               |
|         | **TOTAL**         | **100**  | Score >= 80 = pass                   |

<br>

### [4.1][ANTI_BLOAT]

**Prohibited Patterns:**
```regex
/Sourced from|Confirmed with|Based on/i  → meta-commentary
/This file|We do|You should/i            → self-reference
/might|could|probably|perhaps/i          → hedging
/\b(please|kindly|just|really)\b/i       → filler stopwords
```

[IMPORTANT] Prohibited patterns deduct 2 points per violation (maximum deduction: 10 points).

---
## [5][GATE]
>**Dictum:** *Checklist enforces deployment readiness.*

<br>

[VERIFY]:
- [ ] Format selected matches use case strength.
- [ ] Sections weighted and ordered by severity.
- [ ] Embedding pattern matches reuse requirements.
- [ ] All required variables resolved.
- [ ] No anti-bloat violations detected.
- [ ] Validation score >= 80.
