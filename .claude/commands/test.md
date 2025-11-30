---
name: test
description: Create tests using Vitest with Effect/Option patterns
---

Create tests using testing-specialist patterns.

## VITEST + EFFECT PATTERNS

```typescript
import { Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

describe('Feature', () => {
    it('should handle success case', () => {
        const result = Effect.runSync(myEffect);
        expect(result).toBe(expected);
    });

    it('should handle failure case', () => {
        const exit = Effect.runSyncExit(failingEffect);
        expect(exit._tag).toBe('Failure');
    });

    it('should handle Option', () => {
        const opt = Option.fromNullable(value);
        expect(Option.isSome(opt)).toBe(true);
        expect(Option.getOrNull(opt)).toBe(expected);
    });
});
```

## MANDATORY PATTERNS

- `Effect.runSync` for synchronous effects
- `Effect.runSyncExit` for checking failure cases
- `Option.isSome`/`Option.isNone` for Option assertions
- NO mocking unless absolutely necessary
- Property-based tests for complex logic (fast-check)

## COVERAGE REQUIREMENTS

```bash
pnpm test -- --coverage  # Must be ≥80%
```
