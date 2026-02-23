# [H1][CODE_DOCS]
>**Dictum:** *Code documentation generation encodes what type systems cannot express.*

<br>

Generation-specific instructions for code documentation across C#, Python, TypeScript. Canonical structure defined in `docs/standards/code-documentation-standards.md` — this reference covers operational workflow and content generation.

---
## [1][GENERATION_WORKFLOW]
>**Dictum:** *Exploration precedes generation.*

<br>

1. **Survey the module:** Read all exported symbols—functions, types, error types, constants—to identify public API surface.
2. **Identify effect types:** Map every function returning `Fin<T>`, `Result[T,E]`, `Effect<A,E>`, or equivalent; these require dual-channel documentation (success + failure).
3. **Check existing docs:** Preserve accurate existing documentation; update stale content. Never regenerate from scratch.
4. **Apply signal hierarchy:** For each symbol, determine what information the type signature already communicates. Document only additive layer.
5. **Validate coverage:** Cross-reference against §3[COVERAGE_MATRIX]; every required target documented, no prohibited target documented.

---
## [2][LANGUAGE_SPECIFICS]
>**Dictum:** *Each language has exactly one documentation format.*

<br>

### [2.1][CSHARP_XML]

Tag order: `<summary>` → `<param>` → `<returns>` → `<exception>` → `<example>` → `<remarks>`.

**`<summary>` generation:**
- State domain operation and guard conditions.
- Omit return type — `<returns>` handles that.

**`<param>` generation:**
- State constraint, origin, or semantic meaning.
- Include valid range when bounded: "Clamped to [1, 100] by service layer."

**`<returns>` generation on effect types:**

```csharp
/// <returns>
/// <see cref="Fin{OrderId}"/> — <c>Succ</c> when positivity and upper-bound
/// constraints hold; <c>Fail</c> with <see cref="Error"/> describing the
/// specific invariant violation.
/// </returns>
```

Pattern: Name the effect type → state success semantics → state failure semantics with error type.

**`<exception>` generation:**
- Only for exceptions that escape the effect type (defensive arms, sealed DU exhaustion).
- Total functions returning effect types: omit `<exception>`.

---
### [2.2][PYTHON_GOOGLE]

Section order: one-line summary → extended description → Args → Returns → Raises → Example → Note.

**One-line summary generation:**
- Imperative mood; no period; fits one line.
- State operation, not implementation.

**Args generation:**
- Each parameter: name, then constraint/semantic on indented continuation.

**Returns generation on effect types:**

```python
    Returns:
        Result containing ProcessedOrder on success,
        DomainError.InvalidAmount or DomainError.ExceedsLimit
        on constraint violation — caller pattern-matches variant.
```

Pattern: Name the container → state success payload → enumerate failure variants with caller action.

**Raises generation:**
- Total functions: explicitly state `Never raises — all failures encoded in Result.`
- Partial functions: list each exception with trigger condition.

---
### [2.3][TYPESCRIPT_TSDOC]

Tag order: description block → `@param` → `@returns` → `@throws` → `@example` → `@remarks`.

**Description block generation:**
- First paragraph: summary (imperative, one concept).
- Subsequent paragraphs: extended description (guard conditions, domain invariants).

**`@param` generation:**
- Hyphen separator after name; constraint or semantic meaning.

**`@returns` generation on effect types:**

```typescript
 * @returns Effect yielding OrderId on success, or OrderError
 *   describing the violated invariant on failure. Caller uses
 *   Effect.match or Effect.catchTag for variant-specific handling.
```

Pattern: Name the Effect → state success channel → state error channel → note caller handling pattern.

---
## [3][COVERAGE_MATRIX]
>**Dictum:** *Coverage rules are binary — no judgment calls.*

<br>

### [3.1][REQUIRED_TARGETS]

| [INDEX] | [TARGET]                    | [DOCUMENTATION_CONTENT]                                       |
| :-----: | --------------------------- | ------------------------------------------------------------- |
|   [1]   | **Exported function**       | Summary, all params, returns (dual-channel for effect types). |
|   [2]   | **Exported type/interface** | Domain concept, invariants maintained by smart constructor.   |
|   [3]   | **Error type variant**      | Trigger condition, caller recovery action.                    |
|   [4]   | **Smart constructor**       | Guard conditions, valid input ranges, failure modes.          |
|   [5]   | **Module file**             | One-line purpose at file top.                                 |
|   [6]   | **Pipeline/composition**    | Data flow direction, transformation stages.                   |

### [3.2][PROHIBITED_TARGETS]

| [INDEX] | [TARGET]                    | [RATIONALE]                                         |
| :-----: | --------------------------- | --------------------------------------------------- |
|   [1]   | **Private functions**       | Internal; co-located callers; names suffice.        |
|   [2]   | **Obvious accessors**       | Type + name is the complete contract.               |
|   [3]   | **Type-restating comments** | Negative value — occupies attention with no signal. |
|   [4]   | **Control flow narration**  | Code shows sequence; docs show intent.              |

---
## [4][EFFECT_TYPE_PATTERNS]
>**Dictum:** *Effect types require dual-channel documentation without exception.*

<br>

| [INDEX] | [LANGUAGE]     | [EFFECT_TYPE]            | [SUCCESS_DOCS]              | [FAILURE_DOCS]                      |
| :-----: | -------------- | ------------------------ | --------------------------- | ----------------------------------- |
|   [1]   | **C#**         | `Fin<T>`                 | `Succ` payload and meaning  | `Fail` with `Error` invariant       |
|   [2]   | **C#**         | `Validation<Error, T>`   | Valid state description     | Each `Error` variant trigger        |
|   [3]   | **Python**     | `Result[T, E]`           | `Success` payload semantics | `Failure` variant enumeration       |
|   [4]   | **TypeScript** | `Effect.Effect<A, E>`    | Success channel `A`         | Error channel `E` with tag matching |
|   [5]   | **TypeScript** | `Effect.Effect<A, E, R>` | Success channel `A`         | Error `E` + required service `R`    |

[IMPORTANT]:
1. [ALWAYS] **Dual-channel:** Both success and failure documented — omitting either is a validation failure.
2. [ALWAYS] **Caller action:** State what the caller does with each failure variant.
3. [ALWAYS] **Service requirements:** For `Effect<A, E, R>`, document the required service layer `R`.

[CRITICAL]:
- [NEVER] Document effect types as "returns T or error" — name the specific variants.
- [NEVER] Omit the failure channel because "it's obvious from the type."

---
## [5][UPDATE_WORKFLOW]
>**Dictum:** *Documentation updates are scoped, not regenerative.*

<br>

1. **Identify changed symbols:** Diff module against prior version; list added, modified, removed exports.
2. **Update changed docs:** Modify documentation for changed symbols only; preserve unchanged documentation verbatim.
3. **Verify coverage:** Run §3[COVERAGE_MATRIX] against updated module; flag new gaps.
4. **Check staleness:** Confirm all existing docs still describe current behavior; mark stale docs for update.
