# [H1][CONSOLIDATION]
>**Dictum:** *One polymorphic module beats ten scattered helpers.*

<br>

Consolidate APIs around stable capability surfaces and snippet-backed composition patterns.

---
## [1][COMMAND_FIRST]
>**Dictum:** *Command algebras replace sibling method clusters.*

<br>

Use [SNIP-01](./snippets.md#snip-01command_algebra) for closed operation families.

[IMPORTANT]:
- [ALWAYS] Model operations as discriminated variants.
- [ALWAYS] Dispatch with `Match.type(...).pipe(..., Match.exhaustive)`.
- [ALWAYS] Keep the public method count small; widen the command type, not the exported API.

[CRITICAL]:
- [NEVER] Add one method per action when action shape is variant-compatible.
- [NEVER] Use fallback dispatch for closed command unions.

---
## [2][AUTO_INTEGRATION]
>**Dictum:** *Internal logic is integrated through registries and layers, not public methods.*

<br>

Use [SNIP-02](./snippets.md#snip-02auto_integration_registry).

[IMPORTANT]:
- [ALWAYS] Register handlers by iterating an internal readonly registry.
- [ALWAYS] Keep registration in one layer-producing location.
- [ALWAYS] Treat new registry entries as automatic feature activation.

[CRITICAL]:
- [NEVER] Require composition-root edits for each new internal handler.
- [NEVER] Export handler internals to force integration.

---
## [3][CAPABILITY_FACADES]
>**Dictum:** *Capability groups reduce cognitive load and accidental API growth.*

<br>

Use [SNIP-03](./snippets.md#snip-03capability_groups).

[IMPORTANT]:
- [ALWAYS] Group methods by capability (`read`, `write`, `admin`).
- [ALWAYS] Keep grouped surface stable, evolve internals behind it.
- [ALWAYS] Prefer nested capability objects over flat method sprawl.

[CRITICAL]:
- [NEVER] Return giant flat service objects with unrelated concerns mixed.

---
## [4][SCHEMA_AND_TYPE_CONSOLIDATION]
>**Dictum:** *One canonical schema per entity, variants derived at call site.*

<br>

```typescript
const UserSchema = S.Struct({
    id: S.String.pipe(S.brand('UserId')),
    email: S.String,
    role: S.Literal('admin', 'member', 'viewer'),
});

const decodeCreate = S.decodeUnknown(UserSchema.pipe(S.pick('email', 'role')));
const decodePatch = S.decodeUnknown(UserSchema.pipe(S.pick('email', 'role'), S.partial));
```

[CRITICAL]:
- [NEVER] Maintain parallel `Create/Update/Patch` schemas when `pick/omit/partial` derives variants.
- [NEVER] Duplicate type aliases separate from schema definitions.

---
## [5][NO_HAND_ROLLING_MAP]
>**Dictum:** *Use existing Effect modules before authoring custom helpers.*

<br>

| [INDEX] | [HAND_ROLLED]        | [EFFECT_REPLACEMENT]      |
| :-----: | -------------------- | ------------------------- |
|   [1]   | variant branching    | `Match.type` / `Match.tag` |
|   [2]   | null checks          | `Option.fromNullable`     |
|   [3]   | retry loops          | `Schedule` composition    |
|   [4]   | lock + Map           | `STM` + `TMap`            |
|   [5]   | fiber registry       | `FiberMap`                |
|   [6]   | ad hoc stream buffer | `Stream.buffer/groupedWithin` |

[REFERENCE] Compose with [composition.md](./composition.md) and snippets catalog [snippets.md](./snippets.md).
