---
name: ${format-name}
description: ${format-purpose}
format: ${json|yaml|xml|markdown-kv}
base: ${base-format:-none}
---

# [H1][${FORMAT_NAME}]
>**Dictum:** *${format-truth}.*

<br>

${one-sentence-purpose}

---
## [1][FORMAT]
>**Dictum:** *Delimiter syntax anchors format implementation.*

<br>

**Type:** `${format-type}`<br>
**Fence:** ` ``` ` + `${language-hint}`<br>
**Base:** `${base-format:-none}`<br>
**Schema:** `${schema-enforcement:-none}`

```${format-type}
${format-template}
```

---
## [2][SECTIONS]
>**Dictum:** *Section ordering determines attention distribution.*

<br>

| [INDEX] | [SECTION]    | [REQUIRED] | [WEIGHT] | [PURPOSE]            |
| :-----: | ------------ | :--------: | :------: | -------------------- |
|   [1]   | ${section-1} |   ${y/n}   |    10    | ${section-1-purpose} |
|   [2]   | ${section-2} |   ${y/n}   |    8     | ${section-2-purpose} |
|   [3]   | ${section-3} |   ${y/n}   |    6     | ${section-3-purpose} |

[IMPORTANT]:
- [ALWAYS] Weight 10 = anchor position (58% attention).
- [ALWAYS] Sort descending by weight.
- [ALWAYS] Group equal-weight by logical flow.

---
## [3][VARIABLES]
>**Dictum:** *Variables enable runtime customization.*

<br>

[IMPORTANT] Resolve frontmatter variables at compile-time. Resolve context values at runtime.

| [INDEX] | [VARIABLE]    | [REQUIRED] | [DEFAULT]    | [DESCRIPTION]        |
| :-----: | ------------- | :--------: | ------------ | -------------------- |
|   [1]   | ${var-1-name} |     y      | none         | ${var-1-description} |
|   [2]   | ${var-2-name} |     n      | ${default-2} | ${var-2-description} |

**Syntax:**<br>
- Required: `${variable-name}`
- Optional: `${variable-name:-default}`
- Conditional: `${variable-name?}`

---
## [4][VALIDATION]
>**Dictum:** *Compliance scoring enforces quality.*

<br>

| [INDEX] | [DIMENSION]       | [POINTS] | [VALIDATOR]                          |
| :-----: | ----------------- | :------: | ------------------------------------ |
|   [1]   | Format valid      |    30    | Parser accepts (JSON/YAML/XML/MD-KV) |
|   [2]   | Delimiters        |    20    | Fence + separator consistency        |
|   [3]   | Required sections |    25    | All `required: y` sections present   |
|   [4]   | Variables         |    15    | All required variables resolved      |
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
### [4.2][GATE]

[VERIFY]:
- [ ] Format: Output matches `${format-type}` specification.
- [ ] Delimiters: Fence syntax and separators consistent.
- [ ] Sections: All required sections present in correct order.
- [ ] Variables: All required variables resolved.
- [ ] Weights: Sections ordered descending by weight (10 → 1).
- [ ] Anti-bloat: No prohibited patterns detected.
- [ ] Score: Validation total >= 80 points.
