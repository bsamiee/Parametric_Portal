/** Test theme plugin virtual module resolution and color generation. */
import { it } from '@fast-check/vitest';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import { defineThemes, B as THEME_TUNING } from '../src/theme.ts';

// --- [TYPES] -----------------------------------------------------------------

type ThemeInput = Parameters<typeof defineThemes>[0];

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    modifiers: ['hover', 'focus', 'active', 'disabled', 'pressed', 'selected', 'dragged'] as const,
    resolvedId: '\0virtual:parametric-theme' as const,
    scales: [2, 5, 10, 15, 20] as const,
    spacings: [1, 5, 10] as const,
    virtualId: 'virtual:parametric-theme' as const,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const validInput = (overrides: Partial<ThemeInput & object> = {}): ThemeInput =>
    ({ chroma: 0.1, hue: 180, lightness: 0.5, name: 'test', scale: 5, ...overrides }) as ThemeInput;

/** Simulate Vite plugin lifecycle for virtual module testing. Grounding: Manual invocation bypasses Vite runtime for isolated unit tests. */
const loadVirtualModule = (input: ThemeInput): { css: string | undefined; resolved: string | undefined } => {
    const plugin = defineThemes(input);
    const resolved =
        typeof plugin.resolveId === 'function'
            ? (plugin.resolveId.call({} as never, B.virtualId, undefined, {
                  attributes: {},
                  isEntry: false,
              }) as string | undefined)
            : undefined;
    const css =
        typeof plugin.load === 'function'
            ? (plugin.load.call({} as never, resolved ?? '') as string | undefined)
            : undefined;
    return { css, resolved };
};

describe('theme', () => {
    describe('virtual module', () => {
        it('resolves virtual module id', () => {
            const { resolved } = loadVirtualModule(validInput());
            expect(resolved).toBe(B.resolvedId);
        });

        it('generates css with tailwind import', () => {
            const { css } = loadVirtualModule(validInput());
            expect(css).toBeDefined();
            expect(css).toContain('@import "tailwindcss";');
            expect(css).toContain('@theme {');
        });
    });

    describe('scale generation', () => {
        it.each(B.scales)('scale=%i produces correct step count', (scale) => {
            const { css } = loadVirtualModule(validInput({ name: 'primary', scale }));
            const steps = css?.match(/--color-primary-\d+:/g);
            expect(steps?.length).toBe(scale);
        });

        it.each(B.scales)('scale=%i uses 50-increment steps', (scale) => {
            const { css } = loadVirtualModule(validInput({ name: 'primary', scale }));
            const expectedSteps = Array.from({ length: scale }, (_, i) => (i + 1) * THEME_TUNING.scale.increment);
            for (const step of expectedSteps) {
                expect(css).toContain(`--color-primary-${step}:`);
            }
        });
    });

    describe('modifiers', () => {
        it.each(B.modifiers)('modifier %s generates css variable', (modifier) => {
            const { css } = loadVirtualModule(
                validInput({ modifiers: { [modifier]: true } as Record<string, true>, name: 'mod' }),
            );
            expect(css).toContain(`--color-mod-${modifier}:`);
        });

        it('applies custom modifiers', () => {
            const { css } = loadVirtualModule(
                validInput({
                    customModifiers: [{ alphaShift: 0, chromaShift: 0.5, lightnessShift: 0.1, name: 'accent' }],
                    name: 'custom',
                }),
            );
            expect(css).toContain('--color-custom-accent:');
        });
    });

    describe('spacing', () => {
        it.each(B.spacings)('spacing=%i generates correct variables', (spacing) => {
            const { css } = loadVirtualModule(validInput({ spacing }));
            for (const i of Array.from({ length: spacing }, (_, idx) => idx + 1)) {
                expect(css).toContain(`--spacing-${i}:`);
            }
        });

        it('uses correct spacing increment', () => {
            const { css } = loadVirtualModule(validInput({ spacing: 4 }));
            const increment = THEME_TUNING.spacing.increment;
            expect(css).toContain(`--spacing-1: ${increment}rem;`);
            expect(css).toContain(`--spacing-2: ${increment * 2}rem;`);
            expect(css).toContain(`--spacing-4: ${increment * 4}rem;`);
        });
    });

    describe('color generation', () => {
        // OKLCH valid ranges: chroma [0.02, 0.38], lightness [0.12, 0.88]
        it.prop([
            fc.integer({ max: 359, min: 0 }),
            fc.float({ max: Math.fround(0.38), min: Math.fround(0.02), noNaN: true }),
            fc.float({ max: Math.fround(0.88), min: Math.fround(0.12), noNaN: true }),
        ])('generates valid oklch for hue=%d chroma=%f lightness=%f', (hue, chroma, lightness) => {
            const { css } = loadVirtualModule(validInput({ chroma, hue, lightness, name: 'prop', scale: 3 }));
            expect(css).not.toContain('Failed:');
            expect(css).toMatch(/oklch\(\d+\.\d+%\s+\d+\.\d+\s+\d+\.\d+\)/);
        });
    });

    describe('error handling', () => {
        // Exceeds THEME_TUNING constraints: scale.max=20, chroma.max=0.38
        it('returns failure marker for invalid scale', () => {
            const { css } = loadVirtualModule(validInput({ name: 'broken', scale: 25 as never }));
            expect(css).toContain('/* Failed: broken');
        });

        it('returns failure marker for invalid chroma', () => {
            const { css } = loadVirtualModule(validInput({ chroma: 0.5, name: 'broken' }));
            expect(css).toContain('/* Failed: broken');
        });
    });

    describe('tuning constants', () => {
        it('exports frozen config', () => {
            expect(Object.isFrozen(THEME_TUNING)).toBe(true);
        });

        it.each(B.modifiers)('baseline includes %s modifier', (mod) => {
            expect(THEME_TUNING.baseline[mod]).toBeDefined();
        });

        it('has positive multipliers', () => {
            expect(THEME_TUNING.multipliers.alpha).toBeGreaterThan(0);
            expect(THEME_TUNING.multipliers.chroma).toBeGreaterThan(0);
            expect(THEME_TUNING.multipliers.lightness).toBeGreaterThan(0);
        });
    });
});
