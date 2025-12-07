---
name: report
description: Universal severity-ranked report format for summarizer agents and analysis commands.
format: markdown-kv
---

# [H1][REPORT]
>**Dictum:** *Severity-ranked structure optimizes attention distribution.*

<br>

Universal output format for agents synthesizing multi-source information into actionable summaries.

---
## [1][FORMAT]
>**Dictum:** *Format specification anchors output structure.*

<br>

**Type:** `markdown-kv`<br>
**Fence:** None (structured markdown sections)<br>
**Token Budget:** `${token-limit:-2000}`

```markdown
## [1][${domain-1:-CRITICAL}]
- [99% compliance rules, non-negotiable constraints]

## [2][${domain-2:-ENFORCEMENT}]
- [95% compliance rules, binary-verifiable]

## [3][${domain-3:-CONVENTION}]
- [85% compliance rules, style consistency]

## [4][${domain-4:-EXCEPTIONS}]
- [domain-specific overrides, infrastructure exceptions]

## [5][SOURCES]
- [file paths for rule lookup]
```

---
## [2][SECTIONS]
>**Dictum:** *Section ordering determines attention distribution.*

<br>

| [INDEX] | [SECTION] | [REQUIRED] | [WEIGHT] | [PURPOSE]                          |
| :-----: | --------- | :--------: | :------: | ---------------------------------- |
|   [1]   | Domain 1  |    Yes     |    10    | Highest-priority findings (anchor) |
|   [2]   | Domain 2  |    Yes     |    8     | High-priority findings             |
|   [3]   | Domain 3  |    Yes     |    6     | Standard-priority findings         |
|   [4]   | Domain 4  |     No     |    4     | Exceptions and overrides           |
|   [5]   | SOURCES   |    Yes     |    2     | Traceability for rule lookup       |

[IMPORTANT] Domain names are variables. Default: CRITICAL → ENFORCEMENT → CONVENTION → EXCEPTIONS.

---
## [3][VARIABLES]
>**Dictum:** *Variables enable runtime customization.*

<br>

| [INDEX] | [VARIABLE]    | [REQUIRED] | [DEFAULT]   | [DESCRIPTION]                      |
| :-----: | ------------- | :--------: | ----------- | ---------------------------------- |
|   [1]   | domain-1      |     No     | CRITICAL    | First section label                |
|   [2]   | domain-2      |     No     | ENFORCEMENT | Second section label               |
|   [3]   | domain-3      |     No     | CONVENTION  | Third section label                |
|   [4]   | domain-4      |     No     | EXCEPTIONS  | Fourth section label               |
|   [5]   | token-limit   |     No     | 2000        | Maximum output tokens              |
|   [6]   | pass-sections |     No     | none        | Sections to pass verbatim `[PASS]` |

---
## [4][CONSTRAINTS]
>**Dictum:** *Constraints enforce output quality.*

<br>

[IMPORTANT]:
- [ALWAYS] Order sections by weight descending (CRITICAL first).
- [ALWAYS] Include SOURCES section for traceability.
- [ALWAYS] Mark pass-through sections with `[PASS]` qualifier.
- [NEVER] Include meta-commentary, hedging, or stopwords.
- [NEVER] Exceed token budget.

---
## [5][VALIDATION]
>**Dictum:** *Validation rules enforce compliance.*

<br>

[VERIFY]:
- [ ] All required sections present in correct order.
- [ ] Domain labels resolved (custom or defaults).
- [ ] Token budget respected.
- [ ] No anti-bloat violations.
- [ ] SOURCES section includes file paths.
