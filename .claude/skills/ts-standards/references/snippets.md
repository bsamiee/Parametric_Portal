# [H1][SNIPPETS]
>**Dictum:** *Canonical snippets are the source of truth for repeated patterns.*

<br>

Use these snippet IDs directly in implementations and reviews. Prefer references over copy-paste variants.

---
## [SNIP-01][COMMAND_ALGEBRA]
>**Use:** Replace multiple sibling methods with one polymorphic command entrypoint.

```typescript
import { Data, Effect, Match } from 'effect';

type Op = Data.TaggedEnum<{
    readonly Upsert: { readonly payload: unknown };
    readonly Purge: { readonly tenantId: string };
    readonly Replay: { readonly id: string };
}>;

const { Upsert, Purge, Replay } = Data.taggedEnum<Op>();

const run = Effect.fn('Service.run')((op: Op) =>
    Match.type<Op>().pipe(
        Match.tag('Upsert', ({ payload }) => doUpsert(payload)),
        Match.tag('Purge', ({ tenantId }) => doPurge(tenantId)),
        Match.tag('Replay', ({ id }) => doReplay(id)),
        Match.exhaustive,
    )(op),
);
```

---
## [SNIP-02][AUTO_INTEGRATION_REGISTRY]
>**Use:** Auto-integrate internal handlers without manual per-handler composition churn.

```typescript
import { Effect, Layer } from 'effect';

const _REGISTRY = {
    'purge-assets': purgeAssets,
    'purge-sessions': purgeSessions,
    'tenant-lifecycle': tenantLifecycle,
} as const;

const Handlers = Layer.effectDiscard(Effect.gen(function* () {
    const jobs = yield* JobService;
    yield* Effect.forEach(
        Object.entries(_REGISTRY),
        ([name, handler]) => jobs.registerHandler(name, handler),
        { discard: true },
    );
}));
```

---
## [SNIP-03][CAPABILITY_GROUPS]
>**Use:** Compress service surface into capability groups instead of flat method sprawl.

```typescript
return {
    read: { one, page, stream },
    write: { put, set, drop, lift },
    admin: { agg, purge, fn },
} as const;
```

---
## [SNIP-04][ADVANCED_POLYMORPHIC_TYPES]
>**Use:** Preserve literal precision and constrain inference direction in polymorphic APIs.

```typescript
const select = <
    const Ops extends Readonly<Record<string, unknown>>,
    K extends keyof Ops,
>(
    ops: Ops,
    key: NoInfer<K>,
): Ops[K] => ops[key];
```

---
## [SNIP-05][BOUNDARY_ERROR_COLLAPSE]
>**Use:** Collapse internal error unions into boundary-safe errors with exhaustive mapping.

```typescript
const toHttp = <A, R>(program: Effect.Effect<A, DomainError, R>) =>
    program.pipe(
        Effect.mapError(Match.type<DomainError>().pipe(
            Match.tag('NotFound', ({ id }) => HttpError.NotFound.of('resource', id)),
            Match.tag('Conflict', ({ reason }) => HttpError.Conflict.of('resource', reason)),
            Match.tag('Validation', ({ field, detail }) => HttpError.Validation.of(field, detail)),
            Match.exhaustive,
        )),
    );
```

---
## [SNIP-06][IF_FREE_BASH_DISPATCH]
>**Use:** Dual-mode validator architecture (`hook` + `check`) with strict-mode bash and no `if` keyword.

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

readonly _MODE_DEFAULT="check"
declare -Ar _DISPATCH=([check]="_run_check" [hook]="_run_hook")

_parse_args() {
    local mode="${_MODE_DEFAULT}"
    while (($# > 0)); do
        case "$1" in
            --mode=*) mode="${1#*=}"; shift ;;
            --mode) mode="${2:-${_MODE_DEFAULT}}"; shift 2 ;;
            *) shift ;;
        esac
    done
    printf '%s\n' "${mode}"
}

_main() {
    local -r mode="$(_parse_args "$@")"
    [[ -v _DISPATCH["${mode}"] ]] || _die "unsupported mode: ${mode}"
    "${_DISPATCH[${mode}]}"
}
```

---
## [USAGE]
>**Dictum:** *Reference snippet IDs in code reviews and commit notes.*

- `SNIP-01`: command algebra + exhaustive dispatch.
- `SNIP-02`: auto-integration registry.
- `SNIP-03`: grouped capability facade.
- `SNIP-04`: advanced generic constraints.
- `SNIP-05`: boundary error collapse.
- `SNIP-06`: validator shell architecture.
