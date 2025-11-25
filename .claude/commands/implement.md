---
name: implement
description: Implement features using specialist agents and dogmatic patterns
---

Implement the requested feature using dogmatic TypeScript patterns.

## AGENT SELECTION

| Pattern | Agent |
|---------|-------|
| Effect/Option, branded types | typescript-advanced |
| React 19 components | react-specialist |
| Vite/Nx config changes | vite-nx-specialist |
| New package setup | library-planner |

## MANDATORY PATTERNS

```typescript
// Single B constant
const B = Object.freeze({
    config: { port: 3000 },
    modes: ['app', 'library'],
} as const);

// Dispatch table (NOT if/else)
const handlers = {
    app: (c) => buildApp(c),
    library: (c) => buildLib(c),
} as const;
const result = handlers[mode](config);

// Effect pipeline (NOT try/catch)
const fn = (url: string): Effect.Effect<Data, Error, never> =>
    pipe(
        Effect.tryPromise(() => fetch(url)),
        Effect.flatMap((r) => Effect.sync(() => r.json())),
    );

// Option (NOT null checks)
const value = pipe(
    Option.fromNullable(maybeNull),
    Option.match({ onNone: () => fallback, onSome: (v) => v }),
);
```

## VERIFICATION

```bash
pnpm typecheck  # TypeScript passes
pnpm check      # Biome passes
```
