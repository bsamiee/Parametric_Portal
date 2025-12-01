/**
 * Validate theme plugin virtual module resolution, color generation, and error handling.
 */
import { it } from '@fast-check/vitest';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import { B, defineThemes } from '../src/theme.ts';

// --- Pure Functions ----------------------------------------------------------

const loadVirtualModule = (input: Parameters<typeof defineThemes>[0]) => {
    const plugin = defineThemes(input);
    const resolveIdHook = plugin.resolveId;
    const loadHook = plugin.load;
    const resolved =
        typeof resolveIdHook === 'function'
            ? resolveIdHook.call({} as never, 'virtual:parametric-theme', undefined, {
                  attributes: {},
                  isEntry: false,
              })
            : undefined;
    const loadResult =
        typeof loadHook === 'function' ? loadHook.call({} as never, (resolved as string) ?? '') : undefined;
    const css = typeof loadResult === 'string' ? loadResult : undefined;
    return { css, resolved };
};

// --- Constants ---------------------------------------------------------------

const VALID_SCALES = [2, 5, 10, 15, 20] as const;

const VALID_MODIFIERS = ['hover', 'focus', 'active', 'disabled', 'pressed', 'selected', 'dragged'] as const;

// --- Entry Point -------------------------------------------------------------

describe('theme plugin', () => {
    describe('virtual module', () => {
        it('resolves virtual module id correctly', () => {
            const { resolved } = loadVirtualModule({ chroma: 0.1, hue: 0, lightness: 0.5, name: 'test', scale: 5 });
            expect(resolved).toBe('\0virtual:parametric-theme');
        });

        it('generates css with tailwind import', () => {
            const { css } = loadVirtualModule({ chroma: 0.1, hue: 0, lightness: 0.5, name: 'test', scale: 5 });
            expect(css).toBeDefined();
            expect(css ?? '').toContain('@import "tailwindcss";');
            expect(css ?? '').toContain('@theme {');
        });
    });

    describe.each(VALID_SCALES)('scale=%i generates correct tokens', (scale) => {
        it(`produces ${scale} color steps`, () => {
            const { css } = loadVirtualModule({ chroma: 0.1, hue: 180, lightness: 0.5, name: 'primary', scale });
            const steps = (css ?? '').match(/--color-primary-\d+:/g);
            expect(steps?.length).toBe(scale);
        });

        it('uses correct step increments (50)', () => {
            const { css } = loadVirtualModule({ chroma: 0.1, hue: 180, lightness: 0.5, name: 'primary', scale });
            const expectedSteps = Array.from({ length: scale }, (_, i) => (i + 1) * 50);
            for (const step of expectedSteps) {
                expect(css ?? '').toContain(`--color-primary-${step}:`);
            }
        });
    });

    describe('modifiers', () => {
        it.each(VALID_MODIFIERS)('modifier %s generates correct css variable', (modifier) => {
            const input = {
                chroma: 0.1,
                hue: 180,
                lightness: 0.5,
                modifiers: { [modifier]: true } as Record<string, true>,
                name: 'test',
                scale: 5,
            };
            const { css } = loadVirtualModule(input);
            expect(css ?? '').toContain(`--color-test-${modifier}:`);
        });

        it('applies custom modifiers', () => {
            const { css } = loadVirtualModule({
                chroma: 0.1,
                customModifiers: [{ alphaShift: 0, chromaShift: 0.5, lightnessShift: 0.1, name: 'accent' }],
                hue: 180,
                lightness: 0.5,
                name: 'test',
                scale: 5,
            });
            expect(css ?? '').toContain('--color-test-accent:');
        });
    });

    describe('spacing', () => {
        it.each([1, 5, 10])('spacing=%i generates correct variables', (spacing) => {
            const { css } = loadVirtualModule({
                chroma: 0.1,
                hue: 180,
                lightness: 0.5,
                name: 'test',
                scale: 5,
                spacing,
            });
            for (const i of Array.from({ length: spacing }, (_, idx) => idx + 1)) {
                expect(css ?? '').toContain(`--spacing-${i}:`);
            }
        });

        it('uses correct spacing increment (0.25rem)', () => {
            const { css } = loadVirtualModule({
                chroma: 0.1,
                hue: 180,
                lightness: 0.5,
                name: 'test',
                scale: 5,
                spacing: 4,
            });
            expect(css ?? '').toContain('--spacing-1: 0.25rem;');
            expect(css ?? '').toContain('--spacing-2: 0.5rem;');
            expect(css ?? '').toContain('--spacing-4: 1rem;');
        });
    });

    describe('color generation', () => {
        it.prop([
            fc.integer({ max: 359, min: 0 }),
            fc.float({ max: Math.fround(0.38), min: Math.fround(0.02), noNaN: true }),
            fc.float({ max: Math.fround(0.88), min: Math.fround(0.12), noNaN: true }),
        ])('generates valid oklch colors for hue=%d chroma=%f lightness=%f', (hue, chroma, lightness) => {
            const { css } = loadVirtualModule({ chroma, hue, lightness, name: 'prop', scale: 3 });
            expect(css ?? '').not.toContain('Failed:');
            expect(css ?? '').toMatch(/oklch\(\d+\.\d+%\s+\d+\.\d+\s+\d+\.\d+\)/);
        });
    });

    describe('error handling', () => {
        it('returns failure marker for invalid scale', () => {
            const { css } = loadVirtualModule({
                chroma: 0.1,
                hue: 0,
                lightness: 0.5,
                name: 'broken',
                scale: 25 as never,
            });
            expect(css ?? '').toContain('/* Failed: broken');
        });

        it('returns failure marker for invalid chroma', () => {
            const { css } = loadVirtualModule({ chroma: 0.5, hue: 0, lightness: 0.5, name: 'broken', scale: 5 });
            expect(css ?? '').toContain('/* Failed: broken');
        });
    });

    describe('theme config constants', () => {
        it('exports frozen config', () => {
            expect(Object.isFrozen(B)).toBe(true);
        });

        it('has all baseline modifiers', () => {
            for (const mod of VALID_MODIFIERS) {
                expect(B.baseline[mod]).toBeDefined();
            }
        });

        it('has multipliers for shifts', () => {
            expect(B.multipliers.alpha).toBeGreaterThan(0);
            expect(B.multipliers.chroma).toBeGreaterThan(0);
            expect(B.multipliers.lightness).toBeGreaterThan(0);
        });
    });
});
