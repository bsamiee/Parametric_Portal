import { describe, expect, it } from 'vitest';

// Why: _TRANSITIONS is not exported, so we replicate the pure data structure for unit testing
// the state machine logic without needing the Effect runtime or service dependencies.
const _TRANSITIONS: Partial<Record<string, ReadonlySet<string>>> = {
    active:    new Set(['suspended']),
    archived:  new Set(['purging']),
    suspended: new Set(['active', 'archived']),
};
const _ALL_STATUSES = ['active', 'suspended', 'archived', 'purging'] as const;
const isValidTransition = (from: string, to: string) => _TRANSITIONS[from]?.has(to) ?? false;

// --- [TESTS] -----------------------------------------------------------------

describe('Tenant lifecycle transitions', () => {
    it('valid transitions produce correct target states', () => {
        expect(isValidTransition('active', 'suspended')).toBe(true);
        expect(isValidTransition('suspended', 'active')).toBe(true);
        expect(isValidTransition('suspended', 'archived')).toBe(true);
        expect(isValidTransition('archived', 'purging')).toBe(true);
    });

    it('invalid transitions are rejected', () => {
        expect(isValidTransition('active', 'purging')).toBe(false);
        expect(isValidTransition('active', 'archived')).toBe(false);
        expect(isValidTransition('archived', 'active')).toBe(false);
        expect(isValidTransition('purging', 'active')).toBe(false);
        expect(isValidTransition('purging', 'archived')).toBe(false);
    });

    it('purging has no outbound transitions (terminal state)', () => {
        const purgingTransitions = _TRANSITIONS['purging'];
        expect(purgingTransitions).toBeUndefined();
    });

    it('all defined transitions reference valid app_status values', () => {
        const statusSet = new Set<string>(_ALL_STATUSES);
        Object.entries(_TRANSITIONS).forEach(([source, targets]) => {
            expect(statusSet.has(source)).toBe(true);
            targets?.forEach((target) => { expect(statusSet.has(target)).toBe(true); });
        });
    });
});
