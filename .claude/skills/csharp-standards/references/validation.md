# [H1][VALIDATION]
>**Dictum:** *Operational criteria verify C# 14 / .NET 10 standards compliance.*

<br>

Structural quality checklist for auditing `.cs` modules against csharp-standards contracts. Use after scaffolding, editing, or reviewing any module. Items below are NOT enforced by the compiler or editorconfig -- they require human/agent judgment.

---
## [1][TYPE_INTEGRITY]

- [ ] One canonical type per entity -- no duplicate record definitions across files
- [ ] Domain primitives use `readonly record struct` + `private` constructor + `Fin<T>` factory -- raw `string`/`int`/`Guid` absent from public signatures
- [ ] DU hierarchies are `sealed` with `private protected` constructors; entities use smart constructors + `with`-expressions -- no `{ get; set; }` bags, no open inheritance *(canonical location -- see [CONTRACTS] for cross-references)*
- [ ] `field` keyword used for inline property validation where value normalization applies (rounding, clamping, trimming)
- [ ] Phantom type markers are empty `readonly struct` -- no fields, no methods

---
## [2][ERROR_SYMPTOMS]

Diagnostic table for structural issues. Consult FIRST when triaging code review findings.

| [INDEX] | [SYMPTOM]                                   | [CAUSE]                       | [FIX]                                              |
| :-----: | :------------------------------------------ | :---------------------------- | :------------------------------------------------- |
|   [1]   | **`var x = ...` in domain code**            | Type inference hiding intent  | Replace with explicit `Fin<T>` / `Option<T>` type  |
|   [2]   | **`if (x != null)` guard blocks**           | Null-based architecture       | Use `Option<T>` + `Match` at boundary              |
|   [3]   | **`try { } catch (Exception e) { }`**       | Exception-driven control flow | Use `Fin<T>` / `Eff<RT,T>` error channel           |
|   [4]   | **`foreach` + mutable accumulator**         | Imperative iteration          | Tail-recursive fold over `ReadOnlySpan<T>`         |
|   [5]   | **Multiple overloads for same concept**     | Arity bloat                   | `params ReadOnlySpan<T>` + algebraic constraint    |
|   [6]   | **`Match` called mid-pipeline**             | Premature context collapse    | Use `Map`/`Bind`/`BiMap` instead                   |
|   [7]   | **Lambda captures method parameter**        | Hidden closure allocation     | `static` lambda + tuple threading                  |
|   [8]   | **`IService` with single implementation**   | Interface pollution           | Remove interface; inject `Func<>` or use directly  |
|   [9]   | **Entity with only `{ get; set; }`**        | Anemic domain model           | Smart constructors + `with`-expression transitions |
|  [10]   | **`.Where().Sum()` on hot path**            | LINQ heap allocation          | `TensorPrimitives` / span-based processing         |
|  [11]   | **`null` used for 2+ semantic meanings**    | Collapsed absence semantics   | `Option<T>` for absence, `Fin<T>` for failure      |
|  [12]   | **3+ sibling methods (`Get`/`TryGet`/...)** | API surface inflation         | One `Execute<R>(Query)` entry point                |
|  [13]   | **`private` method with single caller**     | Helper spam                   | Inline at call site or promote to domain type      |
|  [14]   | **Repetitive switch arms, near-identical**  | Brute-force inlining          | Fold algebra or `K<F,A>` generic pipeline          |

---
## [3][EFFECT_INTEGRITY]

- [ ] `Fin<T>` for synchronous fallible operations -- `Bind`/`Map` chain; `Match` appears ONLY at program/API boundaries
- [ ] `Validation<Error,T>` for multi-field validation -- applicative `.Apply()` tuple; no sequential short-circuiting
- [ ] `Eff<RT,T>` for effectful pipelines -- `Has<RT,Trait>` environmental DI; no constructor injection
- [ ] No `try`/`catch`/`throw` in domain transforms under `Domain.*`; boundary adapters are limited to protocol-required `try/finally`/guarded flow only
- [ ] No `Match` mid-pipeline -- if `.Match(Succ: ..., Fail: ...)` appears before the final return/boundary, it is premature; use `Map`/`Bind`/`BiMap` instead

---
## [4][CONTROL_FLOW]

- [ ] Zero `if`/`else`/`while`/`for`/`foreach` in domain code; boundary adapters may use minimal protocol-required flow only *(try/catch/throw: see [3] EFFECT_INTEGRITY)*
- [ ] Exhaustive switch on DU hierarchies -- compiler-enforced; no silent `_` discard arm that swallows future variants -- `_ => throw new UnreachableException()` is the permitted defensive pattern *(C# does not yet support first-class DU exhaustiveness)*
- [ ] Binary conditions use switch expression -- not ternary with complex sub-expressions or method calls
- [ ] No early-return guard sequences (`if (!valid) return Error;`) -- unify via `Validation<Error,T>` applicative pipeline
- [ ] Sealed DU / no-setter invariants: see [1] TYPE_INTEGRITY [CONTRACTS]

---
## [5][SURFACE_QUALITY]

- [ ] **No helper spam**: every private function is called from 2+ sites within the module -- single-call private functions should be inlined; multi-call functions shared across modules indicate wrong module boundary
- [ ] **No arity spam**: 3+ methods sharing a name prefix or structural pattern collapse to one polymorphic function via `params ReadOnlySpan<T>` or a typed query algebra
- [ ] **No surface inflation**: `Get`/`GetMany`/`TryGet`/`GetOrDefault` sibling families indicate a missing query algebra -- one `Execute<R>(Query<K,V,R>)` method owns all variation
- [ ] **No interface pollution**: `IFoo` with exactly one `Foo` implementation adds indirection without value -- remove the interface; inject `Func<>` delegates for testability
- [ ] **No null architecture**: `null` representing 2+ semantic states (not-found, error, uninitialized, default) requires `Option<T>` for absence and `Fin<T>` for failure

---
## [6][DENSITY]

- [ ] **~400 LOC refactoring signal** (domain modules -- skill reference files use 175 LOC cap): a module approaching 400 lines signals multiple domain concerns; NOT a hard cap -- a single complex DU hierarchy with 450 lines of exhaustive pattern matching may be correct
- [ ] **Dense logic, not brute-force inlining**: algebraic composition (Bind/Map/Pipe chains, DU folds, applicative validation) over verbose mechanical repetition; repetitive switch arms with near-identical bodies indicate a missing abstraction
- [ ] **No wrapper/indirection spam**: single-use `private` methods wrapping a library call with no additional logic should be inlined -- wrappers justified only when adding validation, error translation, or span-based optimization

---
## [7][PERFORMANCE_SENSITIVITY]

These checks apply ONLY to code annotated as hot-path or residing in performance-critical namespaces.

- [ ] Lambdas use `static` keyword -- zero closure capture; data threaded via tuple parameters
- [ ] `ReadOnlySpan<T>` for input; `Span<T>` for output workspace -- no `T[]` allocation on hot path
- [ ] `TensorPrimitives` or `Vector512` for numeric aggregation -- not IEnumerable LINQ
- [ ] `stackalloc` for small fixed-size buffers; `ArrayPool` for dynamic-size buffers
- [ ] `ValueTask<T>` for operations that complete synchronously in the common case (cache hits)
- [ ] `[GeneratedRegex]` for regex-validated smart constructors -- compile-time source generation eliminates runtime `Regex` construction; pattern: `[GeneratedRegex(@"^\d{3}$")] private static partial Regex Pattern();` on partial class, then `Pattern().IsMatch(value)` in `Fin<T>` factory

---
## [8][TESTING_INTEGRITY]

- [ ] FsCheck property laws cover smart constructors and state transitions (identity/associativity/closure where applicable)
- [ ] Testcontainers.PostgreSql integration checks verify boundary invariants against real runtime dependencies

---
## [9][DETECTION_HEURISTICS]

Concrete search patterns an agent can apply to any `.cs` file:

| [INDEX] | [SEARCH_FOR]                                             | [INDICATES]                    | [SEVERITY] |  [COVERAGE]  |
| :-----: | :------------------------------------------------------- | :----------------------------- | :--------: | :----------: |
|   [1]   | **`var ` in domain namespace declarations**              | VAR_INFERENCE                  |    High    | editorconfig |
|   [2]   | **`catch` or `throw` in `Domain.*` namespace**           | EXCEPTION_CONTROL_FLOW         |    High    |   CSP0001    |
|   [3]   | **`if (` or `else` in method bodies (not attributes)**   | IMPERATIVE_BRANCH              |    High    |   CSP0001    |
|   [4]   | **`.Match(` not at final return position**               | PREMATURE_MATCH_COLLAPSE       |   Medium   |   CSP0002    |
|   [5]   | **`{ get; set; }` on entity without smart constructor**  | ANEMIC_DOMAIN                  |    High    |  [ROADMAP]   |
|   [6]   | **`interface I` + single implementing class in project** | INTERFACE_POLLUTION            |   Medium   |   CSP0005    |
|   [7]   | **`== null` or `!= null` in domain logic**               | NULL_ARCHITECTURE              |   Medium   |  [ROADMAP]   |
|   [8]   | **3+ methods with shared name prefix in same type**      | ARITY_SPAM / SURFACE_INFLATION |   Medium   |   CSP0005    |
|   [9]   | **`private` method with single call site**               | HELPER_SPAM                    |    Low     |   CSP0005    |
|  [10]   | **Non-`static` lambda in `*.Performance.*` namespace**   | CLOSURE_CAPTURE_HOT_PATH       |    High    |  [ROADMAP]   |
|  [11]   | **`foreach` or `for (` in domain namespace**             | MUTABLE_ACCUMULATOR            |    High    |   CSP0001    |
|  [12]   | **Positional arguments (no `:` before value) at call**   | POSITIONAL_ARGS                |   Medium   |  [ROADMAP]   |
|  [13]   | **`new Regex(` in smart constructor or domain code**     | RUNTIME_REGEX_COMPILATION      |    High    |  SYSLIB1040  |

---
## [10][QUICK_REFERENCE]

| [INDEX] | [CHECKLIST_AREA]            | [WHAT_IT_VALIDATES]                                             | [REFERENCE]                         |
| :-----: | :-------------------------- | :-------------------------------------------------------------- | :---------------------------------- |
|   [1]   | **TYPE_INTEGRITY**          | Canonical types, smart constructors, sealed DUs, phantoms       | `types.md` [1], [4], [5]            |
|   [2]   | **ERROR_SYMPTOMS**          | 14 symptom-cause-fix triples for structural diagnosis           | --                                  |
|   [3]   | **EFFECT_INTEGRITY**        | Fin/Validation/Eff layering, no try/catch, no mid-Match         | `effects.md` [1], [4], [2]          |
|   [4]   | **CONTROL_FLOW**            | Zero branching, exhaustive switch, no early-return guards       | `effects.md` [4], `patterns.md` [1] |
|   [5]   | **SURFACE_QUALITY**         | No helper/arity/surface spam, no interface/null pollution       | `composition.md` [2], [5]           |
|   [6]   | **DENSITY**                 | ~400 LOC signal, algebraic density, no wrapper spam             | `patterns.md` [1]                   |
|   [7]   | **PERFORMANCE_SENSITIVITY** | Static lambdas, span I/O, SIMD, stackalloc, ValueTask           | `performance.md` [1], [7], [4]      |
|   [8]   | **TESTING_INTEGRITY**       | FsCheck property laws, Testcontainers boundary invariants       | --                                  |
|   [9]   | **DETECTION_HEURISTICS**    | 13 grep-able patterns with severity and coverage classification | --                                  |
|  [10]   | **BOUNDARY_ADAPTER**        | FluentValidation async RuleSets bridged to typed channels       | `effects.md` [4], [2]               |

---
## [11][BOUNDARY_ADAPTER]

> [BOUNDARY ONLY] FluentValidation adapters belong at the HTTP/API layer. Never import FluentValidation into domain modules. Use the bridge ONLY in application service boundary code.

- [ ] FluentValidation async rules (`MustAsync`, `CustomAsync`) execute via `ValidateAsync` only -- never `Validate` when async rules exist
- [ ] RuleSets are boundary contracts (`IncludeRuleSets`) and map to `Validation<Error,T>` before entering domain pipelines
- [ ] Bridge converts `ValidationResult` to `Validation<Error,T>` at boundary -- see `adapter-module.template.md` for canonical implementation
