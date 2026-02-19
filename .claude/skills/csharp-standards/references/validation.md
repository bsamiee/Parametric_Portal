# [H1][VALIDATION]
>**Dictum:** *Operational criteria verify C# 14 / .NET 10 standards compliance.*

<br>

Structural quality checklist for auditing `.cs` modules against csharp-standards contracts. Use after scaffolding, editing, or reviewing any module. Items below are NOT enforced by the compiler or editorconfig -- they require human/agent judgment.

---
## [1][TYPE_INTEGRITY]

- [ ] One canonical type per entity -- no duplicate record definitions across files
- [ ] Domain primitives use `readonly record struct` + `private` constructor + `Fin<T>` factory -- raw `string`/`int`/`Guid` absent from public signatures
- [ ] DU hierarchies are sealed with `private protected` constructors -- no open inheritance
- [ ] Entities own state transitions via smart constructors and `with`-expressions -- no `{ get; set; }` bags with external mutation logic
- [ ] `field` keyword used for inline property validation where value normalization applies (rounding, clamping, trimming)
- [ ] Phantom type markers are empty `readonly struct` -- no fields, no methods

---
## [2][EFFECT_INTEGRITY]

- [ ] `Fin<T>` for synchronous fallible operations -- `Bind`/`Map` chain; `Match` appears ONLY at program/API boundaries
- [ ] `Validation<Error,T>` for multi-field validation -- applicative `.Apply()` tuple; no sequential short-circuiting
- [ ] `Eff<RT,T>` for effectful pipelines -- `Has<RT,Trait>` environmental DI; no constructor injection
- [ ] No `try`/`catch`/`throw` in any namespace under `Domain.*` -- search for `catch` and `throw` keywords as detection heuristic
- [ ] No `Match` mid-pipeline -- if `.Match(Succ: ..., Fail: ...)` appears before the final return/boundary, it is premature; use `Map`/`Bind`/`BiMap` instead

---
## [3][CONTROL_FLOW]

- [ ] Zero `if`/`else`/`while`/`for`/`foreach` in domain code -- switch expressions and monadic `Bind` only
- [ ] Exhaustive switch on DU hierarchies -- compiler-enforced; no silent `_` discard arm that swallows future variants -- `_ => throw new UnreachableException()` is the permitted defensive pattern until C# ships first-class DU exhaustiveness
- [ ] Binary conditions use switch expression -- not ternary with complex sub-expressions or method calls
- [ ] No early-return guard sequences (`if (!valid) return Error;`) -- unify via `Validation<Error,T>` applicative pipeline

---
## [4][SURFACE_QUALITY]

- [ ] **No helper spam**: every private function is called from 2+ sites within the module. Single-call private functions should be inlined at the call site. Multi-call private functions shared across modules indicate the module boundary is wrong -- the function belongs in the consuming domain.
- [ ] **No arity spam**: if 3+ methods share a name prefix or structural pattern (e.g., `ProcessSingle`/`ProcessBatch`/`ProcessAll`), collapse to one polymorphic function via `params ReadOnlySpan<T>` or a typed query algebra.
- [ ] **No surface inflation**: `Get`/`GetMany`/`TryGet`/`GetOrDefault` sibling families indicate a missing query algebra. One `Execute<R>(Query<K,V,R>)` method owns all variation.
- [ ] **No interface pollution**: `IFoo` with exactly one `Foo` implementation adds indirection without value. Remove the interface; inject `Func<>` delegates for testability if needed.
- [ ] **No null architecture**: if `null` represents more than one semantic state (not-found, error, uninitialized, default), replace with `Option<T>` for absence and `Fin<T>` for failure.

---
## [5][DENSITY]

- [ ] **~400 LOC refactoring signal**: a module approaching 400 lines is a signal to evaluate whether it contains multiple domain concerns. This is NOT a hard cap -- a single complex DU hierarchy with 450 lines of exhaustive pattern matching may be correct. The question is: "does this module own exactly one concept?"
- [ ] **Dense logic, not brute-force inlining**: review whether the module achieves its functionality through algebraic composition (Bind/Map/Pipe chains, DU folds, applicative validation) or through verbose mechanical repetition. Repetitive `switch` arms with near-identical bodies indicate a missing abstraction.
- [ ] **No wrapper/indirection spam**: single-use `private` methods that wrap a library call with no additional logic should be inlined. Wrappers are justified only when they add validation, error translation, or span-based optimization.

---
## [6][PERFORMANCE_SENSITIVITY]

These checks apply ONLY to code annotated as hot-path or residing in performance-critical namespaces. They are NOT universal.

- [ ] Lambdas use `static` keyword -- zero closure capture; data threaded via tuple parameters
- [ ] `ReadOnlySpan<T>` for input; `Span<T>` for output workspace -- no `T[]` allocation on hot path
- [ ] `TensorPrimitives` or `Vector512` for numeric aggregation -- not IEnumerable LINQ
- [ ] `stackalloc` for small fixed-size buffers; `ArrayPool` for dynamic-size buffers
- [ ] `ValueTask<T>` for operations that complete synchronously in the common case (cache hits)

---
## [7][DETECTION_HEURISTICS]

Concrete search patterns an agent can apply to any `.cs` file:

| [INDEX] | [SEARCH_FOR]                                         | [INDICATES]                    | [SEVERITY] |
| :-----: | ---------------------------------------------------- | ------------------------------ | ---------- |
|   [1]   | `var ` in domain namespace declarations              | VAR_INFERENCE                  | High       |
|   [2]   | `catch` or `throw` in `Domain.*` namespace           | EXCEPTION_CONTROL_FLOW         | High       |
|   [3]   | `if (` or `else` in method bodies (not attributes)   | IMPERATIVE_BRANCH              | High       |
|   [4]   | `.Match(` not at final return position               | PREMATURE_MATCH_COLLAPSE       | Medium     |
|   [5]   | `{ get; set; }` on entity without smart constructor  | ANEMIC_DOMAIN                  | High       |
|   [6]   | `interface I` + single implementing class in project | INTERFACE_POLLUTION            | Medium     |
|   [7]   | `== null` or `!= null` in domain logic               | NULL_ARCHITECTURE              | Medium     |
|   [8]   | 3+ methods with shared name prefix in same type      | ARITY_SPAM / SURFACE_INFLATION | Medium     |
|   [9]   | `private` method with single call site               | HELPER_SPAM                    | Low        |
|  [10]   | Non-`static` lambda in `*.Performance.*` namespace   | CLOSURE_CAPTURE_HOT_PATH       | High       |
|  [11]   | `foreach` or `for (` in domain namespace             | MUTABLE_ACCUMULATOR            | High       |
|  [12]   | Positional arguments (no `:` before value) at call   | POSITIONAL_ARGS                | Medium     |

---
## [8][ERROR_SYMPTOMS]

| [INDEX] | [SYMPTOM]                               | [CAUSE]                       | [FIX]                                              |
| :-----: | --------------------------------------- | ----------------------------- | -------------------------------------------------- |
|   [1]   | `var x = ...` in domain code            | Type inference hiding intent  | Replace with explicit `Fin<T>` / `Option<T>` type  |
|   [2]   | `if (x != null)` guard blocks           | Null-based architecture       | Use `Option<T>` + `Match` at boundary              |
|   [3]   | `try { } catch (Exception e) { }`       | Exception-driven control flow | Use `Fin<T>` / `Eff<RT,T>` error channel           |
|   [4]   | `foreach` + mutable accumulator         | Imperative iteration          | Tail-recursive fold over `ReadOnlySpan<T>`         |
|   [5]   | Multiple overloads for same concept     | Arity bloat                   | `params ReadOnlySpan<T>` + algebraic constraint    |
|   [6]   | `Match` called mid-pipeline             | Premature context collapse    | Use `Map`/`Bind`/`BiMap` instead                   |
|   [7]   | Lambda captures method parameter        | Hidden closure allocation     | `static` lambda + tuple threading                  |
|   [8]   | `IService` with single implementation   | Interface pollution           | Remove interface; inject `Func<>` or use directly  |
|   [9]   | Entity with only `{ get; set; }`        | Anemic domain model           | Smart constructors + `with`-expression transitions |
|  [10]   | `.Where().Sum()` on hot path            | LINQ heap allocation          | `TensorPrimitives` / span-based processing         |
|  [11]   | `null` used for 2+ semantic meanings    | Collapsed absence semantics   | `Option<T>` for absence, `Fin<T>` for failure      |
|  [12]   | 3+ sibling methods (`Get`/`TryGet`/...) | API surface inflation         | One `Execute<R>(Query)` entry point                |
|  [13]   | `private` method with single caller     | Helper spam                   | Inline at call site or promote to domain type      |
|  [14]   | Repetitive switch arms, near-identical  | Brute-force inlining          | Fold algebra or `K<F,A>` generic pipeline          |

---
## [9][QUICK_REFERENCE]

| [INDEX] | [CHECKLIST_AREA]        | [WHAT_IT_VALIDATES]                                       | [REFERENCE]                         |
| :-----: | ----------------------- | --------------------------------------------------------- | ----------------------------------- |
|   [1]   | TYPE_INTEGRITY          | Canonical types, smart constructors, sealed DUs, phantoms | `types.md` [1], [4], [5]            |
|   [2]   | EFFECT_INTEGRITY        | Fin/Validation/Eff layering, no try/catch, no mid-Match   | `effects.md` [1], [4], [2]          |
|   [3]   | CONTROL_FLOW            | Zero branching, exhaustive switch, no early-return guards | `effects.md` [4], `patterns.md` [1] |
|   [4]   | SURFACE_QUALITY         | No helper/arity/surface spam, no interface/null pollution | `composition.md` [2], [5]           |
|   [5]   | DENSITY                 | ~400 LOC signal, algebraic density, no wrapper spam       | `patterns.md` [1]                   |
|   [6]   | PERFORMANCE_SENSITIVITY | Static lambdas, span I/O, SIMD, stackalloc, ValueTask     | `performance.md` [1], [7], [4]      |
|   [7]   | DETECTION_HEURISTICS    | 12 grep-able patterns with severity classification        | --                                  |
|   [8]   | ERROR_SYMPTOMS          | 12 symptom-cause-fix triples for structural diagnosis     | --                                  |
