# [H1][VALIDATION]
>**Dictum:** *Operational criteria verify output quality.*

<br>

Consolidated checklist for output-style-builder. SKILL.md §VALIDATION contains high-level gates; this file contains operational verification procedures.

---
## [1][FORMATS_GATE]
>**Dictum:** *Format deployment requires 80-point minimum.*

<br>

[VERIFY] Format compliance:
- [ ] Format selected matches use case strength (accuracy vs token tradeoff).
- [ ] Sections weighted and ordered by severity (10 → 1 descending).
- [ ] Embedding pattern matches reuse requirements (inline vs reference).
- [ ] Delimiter consistency verified throughout output.
- [ ] Required variables resolved; optionals have defaults.
- [ ] Validation score >= 80.

---
## [2][CONFIGURATION_GATE]
>**Dictum:** *Scope hierarchy prevents configuration conflicts.*

<br>

[VERIFY] Configuration compliance:
- [ ] Scope level matches use case (global → command hierarchy).
- [ ] CLAUDE.md output section <= 100 LOC.
- [ ] Override sections document divergence reason.
- [ ] Reference pattern uses `@` syntax with valid path.
- [ ] Reference files exist in `.claude/styles/` or `.claude/output-styles/`.
- [ ] Voice/formatting rules delegate to `style-standards`—zero duplication.
- [ ] Inheritance hierarchy respected (higher precedence wins).

---
## [3][SCORING]
>**Dictum:** *Quality gates prevent formats below 80% compliance.*

<br>

| [INDEX] | [DIMENSION]       | [POINTS] | [VALIDATOR]                          |
| :-----: | ----------------- | :------: | ------------------------------------ |
|   [1]   | Format valid      |    30    | Parser accepts (JSON/YAML/XML/MD-KV) |
|   [2]   | Required sections |    25    | All `required: true` present         |
|   [3]   | Delimiters        |    20    | Fence + separator consistency        |
|   [4]   | Variables         |    15    | All required vars resolved           |
|   [5]   | Anti-bloat        |    10    | No prohibited patterns               |
|         | **TOTAL**         | **100**  | Score >= 80 = pass                   |

---
## [4][ANTI_BLOAT]
>**Dictum:** *Prohibited patterns degrade output quality.*

<br>

**Prohibited Patterns:**
```regex
/Sourced from|Confirmed with|Based on/i  → meta-commentary
/This file|We do|You should/i            → self-reference
/might|could|probably|perhaps/i          → hedging
/\b(please|kindly|just|really)\b/i       → filler stopwords
```

[IMPORTANT] Prohibited patterns deduct 2 points per violation (maximum deduction: 10 points).

---
## [5][ERROR_SYMPTOMS]
>**Dictum:** *Symptom diagnosis accelerates fix identification.*

<br>

| [SYMPTOM]                | [CAUSE]                      | [FIX]                                   |
| ------------------------ | ---------------------------- | --------------------------------------- |
| Format not parsed        | Invalid JSON/YAML/XML syntax | Validate with parser before deployment  |
| Score below 80           | Missing required sections    | Add all `required: true` sections       |
| Delimiter inconsistency  | Mixed fence/separator styles | Standardize throughout output           |
| Variable unresolved      | Missing default for optional | Add `${var:-default}` syntax            |
| Style duplication        | Voice rules not delegated    | Reference `style-standards` skill       |
| Scope conflict           | Precedence not respected     | Higher scope (command > global) wins    |
| Reference file not found | Invalid `@` path             | Verify file exists in `.claude/styles/` |

---
## [6][OPERATIONAL_COMMANDS]
>**Dictum:** *Verification requires observable outcomes.*

<br>

```bash
# Format validation
jq . output.json                      # JSON syntax check
yq . output.yaml                      # YAML syntax check

# LOC verification
wc -l SKILL.md                        # Must be < 400 (full depth)
wc -l references/*.md                 # Each must be < 200

# Reference path verification
eza .claude/styles/                    # Verify format files exist
eza .claude/output-styles/             # Verify style files exist

# Anti-bloat check
rg -iE "Sourced from|Confirmed with|might|could" output.md
# Should return no matches
```
