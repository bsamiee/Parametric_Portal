/**
 * Validate overlay color utilities and merge behavior.
 */
import { it } from '@fast-check/vitest';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import { getLevelColor, mergeColors, OVERLAY_TUNING } from '../src/overlay.tsx';
import type { LogLevelKey } from '../src/types.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    levels: ['Debug', 'Info', 'Warning', 'Error', 'Fatal'] as const,
} as const);

// --- [TESTS] -----------------------------------------------------------------

describe('overlay', () => {
    describe('getLevelColor', () => {
        it.each(B.levels)('%s returns oklch color', (level) => {
            expect(getLevelColor(level)).toMatch(/^oklch\(/);
        });

        it('all levels have distinct colors', () => {
            const colors = B.levels.map((level) => getLevelColor(level as LogLevelKey));
            expect(new Set(colors).size).toBe(B.levels.length);
        });

        it.prop([fc.constantFrom(...B.levels) as fc.Arbitrary<LogLevelKey>])('always returns valid oklch', (level) => {
            const color = getLevelColor(level);
            expect(color).toMatch(/^oklch\(\d+\.?\d*\s+\d+\.?\d*\s+\d+\.?\d*\)$/);
        });
    });

    describe('mergeColors', () => {
        it('returns defaults when called without override', () => {
            const result = mergeColors();
            expect([result.bg, result.errorColor]).toEqual([
                OVERLAY_TUNING.colors.bg,
                OVERLAY_TUNING.colors.errorColor,
            ]);
        });

        it.prop([fc.string()])('overrides bg while preserving other defaults', (customBg) => {
            const result = mergeColors({ ...OVERLAY_TUNING.colors, bg: customBg });
            expect([result.bg, result.errorColor]).toEqual([customBg, OVERLAY_TUNING.colors.errorColor]);
        });

        it.prop([fc.string(), fc.string()])('overrides multiple properties', (bg, errorColor) => {
            const result = mergeColors({ ...OVERLAY_TUNING.colors, bg, errorColor });
            expect([result.bg, result.errorColor]).toEqual([bg, errorColor]);
        });
    });
});
