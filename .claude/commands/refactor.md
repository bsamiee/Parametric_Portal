---
name: refactor
description: Refactor code to dogmatic FP/ROP patterns
---

Refactor the specified code using dogmatic patterns.

## TRANSFORMATION RULES

| From | To |
|------|-----|
| Multiple const exports | Single B constant |
| if/else chains | Dispatch table |
| switch statements | Dispatch table |
| try/catch | Effect pipeline |
| null/undefined checks | Option.match |
| for/while loops | .map/.filter/Effect |
| Promise chains | Effect.flatMap |

## SINGLE B CONSTANT PATTERN

```typescript
// BEFORE (scattered)
const PORT = 3000;
const HOST = 'localhost';
const MODES = ['app', 'lib'] as const;

// AFTER (unified)
const B = Object.freeze({
    port: 3000,
    host: 'localhost',
    modes: ['app', 'lib'],
} as const);
```

## DISPATCH TABLE PATTERN

```typescript
// BEFORE (if/else)
if (mode === 'app') return buildApp(c);
else if (mode === 'lib') return buildLib(c);

// AFTER (dispatch)
const handlers = {
    app: (c) => buildApp(c),
    lib: (c) => buildLib(c),
} as const;
return handlers[mode](c);
```

## VERIFICATION

- [ ] File count unchanged or reduced
- [ ] Single B constant per file
- [ ] Zero if/else, try/catch, loops
- [ ] `pnpm typecheck && pnpm check` passes
