---
description: Structural specification for code documentation across C#, Python, TypeScript
---

# [H1][CODE-DOCUMENTATION-STANDARDS]
>**Dictum:** *Documentation completes the type signature.*

<br>

[CRITICAL] Document what the type system cannot express. Types encode structure; documentation encodes intent, constraints, failure semantics, and domain invariants.

---
## [1][SIGNAL_HIERARCHY]
>**Dictum:** *Higher-fidelity signals obsolete lower-fidelity signals.*

<br>

| [INDEX] | [SIGNAL]           | [FIDELITY] | [IMPLICATION]                                          |
| :-----: | ------------------ | :--------: | ------------------------------------------------------ |
|   [1]   | **Type signature** |  Highest   | Compiler-verified. Never restate in documentation.     |
|   [2]   | **Name**           |    High    | Self-documenting. Poor names require doc compensation. |
|   [3]   | **Doc comment**    |   Medium   | Agent/human-readable. Covers intent and constraints.   |
|   [4]   | **Inline comment** |    Low     | Last resort. Explains WHY, never WHAT.                 |

[IMPORTANT]:
1. [ALWAYS] **Additive only:** Each documentation level adds information absent from levels above.
2. [ALWAYS] **Intent over mechanics:** Document the business invariant, not the implementation path.

[CRITICAL]:
- [NEVER] Restate return type: `/// <returns>Returns a Fin of OrderId</returns>` on `Fin<OrderId>`.
- [NEVER] Restate parameter type: `@param name the name string` on `name: str`.
- [NEVER] Describe control flow: "First validates, then processes..." — the code shows sequence.

---
## [2][FORMATS]
>**Dictum:** *One format per language; no negotiation.*

<br>

| [INDEX] | [LANGUAGE]     | [FORMAT]          | [GENERATOR] | [STANDARD]                  |
| :-----: | -------------- | ----------------- | ----------- | --------------------------- |
|   [1]   | **C#**         | XML Documentation | DocFX       | Microsoft XML Documentation |
|   [2]   | **Python**     | Google Style      | Sphinx      | google.github.io/styleguide |
|   [3]   | **TypeScript** | TSDoc             | TypeDoc     | tsdoc.org                   |

---
## [3][STRUCTURE]
>**Dictum:** *Concrete format per language eliminates ambiguity.*

<br>

### [3.1][CSHARP]

Tags in canonical order: `<summary>`, `<param>`, `<returns>`, `<exception>`, `<example>`, `<remarks>`.

```csharp
/// <summary>
/// Validates and constructs an <see cref="OrderId"/> from raw input.
/// Rejects negative values and values exceeding <paramref name="maxBound"/>.
/// </summary>
/// <param name="candidate">Raw identifier from external boundary.</param>
/// <param name="maxBound">Upper bound from configuration — domain-specific ceiling.</param>
/// <returns>
/// <see cref="Fin{OrderId}"/> — <c>Succ</c> when constraints hold;
/// <c>Fail</c> with <see cref="Error"/> describing the violated invariant.
/// </returns>
/// <exception cref="UnreachableException">Defensive arm — sealed DU hierarchy exhausted.</exception>
public static Fin<OrderId> Create(long candidate, long maxBound)
```

[IMPORTANT]:
1. [ALWAYS] **`<summary>`:** State the domain operation and its guard conditions.
2. [ALWAYS] **`<param>`:** State the constraint, origin, or semantic meaning — not the type.
3. [ALWAYS] **`<returns>`:** State both success and failure semantics of the effect type.

### [3.2][PYTHON]

Google Style sections in order: one-line summary, extended description (optional), Args, Returns, Raises, Example (optional), Note (optional).

```python
def create_order_id(
    candidate: int,
    max_bound: int,
) -> Result[OrderId, DomainError]:
    """Validate and construct OrderId from external boundary input.

    Rejects negative values and values exceeding the domain-specific
    ceiling defined by max_bound.

    Args:
        candidate: Raw identifier from external boundary.
            Must be non-negative.
        max_bound: Upper bound from configuration.
            Domain-specific ceiling; varies per tenant.

    Returns:
        Result containing OrderId on success, DomainError on
        constraint violation with the specific invariant that failed.

    Raises:
        Never raises — all failures encoded in Result.
    """
```

[IMPORTANT]:
1. [ALWAYS] **One-line summary:** Imperative mood, no period, fits on one line.
2. [ALWAYS] **Args:** State constraint or semantic meaning per parameter. Indent continuation lines.
3. [ALWAYS] **Returns:** State both success and failure semantics.
4. [ALWAYS] **Raises:** Explicitly state `Never raises` when the function is total.

### [3.3][TYPESCRIPT]

TSDoc tags in order: description block, `@param`, `@returns`, `@throws`, `@example`, `@remarks`.

```typescript
/**
 * Validates and constructs an OrderId from external boundary input.
 *
 * Rejects negative values and values exceeding the domain-specific
 * ceiling. All failures are encoded in the Effect error channel.
 *
 * @param candidate - Raw identifier from external boundary. Must be non-negative.
 * @param maxBound - Upper bound from configuration. Domain-specific ceiling.
 * @returns Effect yielding OrderId on success, or OrderError describing
 *   the violated invariant on failure.
 */
export const createOrderId = (
  candidate: number,
  maxBound: number,
): Effect.Effect<OrderId, OrderError> =>
```

[IMPORTANT]:
1. [ALWAYS] **Description block:** First paragraph is the summary. Subsequent paragraphs are extended description.
2. [ALWAYS] **`@param`:** Hyphen separator after name. State constraint or semantic meaning.
3. [ALWAYS] **`@returns`:** State both success and error channel semantics.

---
## [4][COVERAGE]
>**Dictum:** *Coverage rules prevent documentation debt.*

<br>

### [4.1][REQUIRED]

| [INDEX] | [TARGET]                 | [DOCUMENTATION_REQUIRED]                                 |
| :-----: | ------------------------ | -------------------------------------------------------- |
|   [1]   | **Exported functions**   | Full doc comment with summary, params, returns.          |
|   [2]   | **Exported types**       | Summary stating domain concept and invariants.           |
|   [3]   | **Error types**          | Each variant: when it occurs, what the caller should do. |
|   [4]   | **Effect-returning fns** | Both success and failure channel semantics.              |
|   [5]   | **Smart constructors**   | Guard conditions, valid input ranges, failure modes.     |
|   [6]   | **Module-level**         | One-line module purpose at file top.                     |

### [4.2][PROHIBITED]

| [INDEX] | [TARGET]                    | [RATIONALE]                                            |
| :-----: | --------------------------- | ------------------------------------------------------ |
|   [1]   | **Private functions**       | Internal — callers are co-located; names suffice.      |
|   [2]   | **Obvious accessors**       | `Name` property on `User` — type + name is complete.   |
|   [3]   | **Type-restating comments** | Type signature already encodes this information.       |
|   [4]   | **Control flow narration**  | Code shows sequence; comments show intent.             |
|   [5]   | **Changelog in comments**   | Version control tracks history; comments track intent. |

---
## [5][INLINE_COMMENTS]
>**Dictum:** *Inline comments justify decisions, not describe operations.*

<br>

[IMPORTANT]:
1. [ALWAYS] **WHY comments:** Explain the business reason, constraint, or non-obvious invariant.
2. [ALWAYS] **Boundary annotations:** Mark where external contracts impose requirements.

[CRITICAL]:
- [NEVER] WHAT comments: `// increment counter` above `counter += 1`.
- [NEVER] TODO without ticket: `// TODO: fix this` — link to issue tracker or remove.
- [NEVER] Commented-out code: version control preserves history.

---
## [6][VALIDATION]
>**Dictum:** *Gates prevent documentation debt accumulation.*

<br>

[VERIFY] Completion:
- [ ] All exported functions have full doc comments (summary, params, returns).
- [ ] All exported types have summary with domain concept and invariants.
- [ ] All error types document each variant's trigger and caller action.
- [ ] Effect-returning functions document both success and failure channels.
- [ ] No doc comment restates type signature information.
- [ ] No inline comment describes WHAT — only WHY.
- [ ] No commented-out code remains in module.
- [ ] Language-specific format matches §3 exactly (XML/Google/TSDoc).
