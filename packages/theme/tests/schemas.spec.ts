/**
 * Validate theme schema validation via property-based testing.
 */
import { it } from '@fast-check/vitest';
import { Effect } from 'effect';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import {
    isAlpha,
    isChroma,
    isHue,
    isLightness,
    isOklchColor,
    validateOklchColor,
    validateTheme,
} from '../src/schemas.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const arbitraryAlpha = fc.float({ max: 1, min: 0, noDefaultInfinity: true, noNaN: true });
const arbitraryChroma = fc.float({ max: Math.fround(0.39), min: 0, noDefaultInfinity: true, noNaN: true });
const arbitraryHue = fc.integer({ max: 359, min: 0 });
const arbitraryLightness = fc.float({ max: 1, min: 0, noDefaultInfinity: true, noNaN: true });
const arbitraryOklchColor = fc.record({
    a: arbitraryAlpha,
    c: arbitraryChroma,
    h: arbitraryHue,
    l: arbitraryLightness,
});
const arbitraryThemeName = fc.stringMatching(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
const arbitraryThemeScale = fc.integer({ max: 20, min: 2 });

// --- [TESTS] -----------------------------------------------------------------

describe('schemas package', () => {
    describe('alpha schema', () => {
        it.prop([arbitraryAlpha])('validates alpha in range', (alpha) => {
            expect(isAlpha(alpha)).toBe(true);
        });

        it.prop([fc.float({ max: Math.fround(-0.1), min: -10 })])('rejects alpha below 0', (alpha) => {
            expect(isAlpha(alpha)).toBe(false);
        });

        it.prop([fc.float({ max: 10, min: Math.fround(1.1) })])('rejects alpha above 1', (alpha) => {
            expect(isAlpha(alpha)).toBe(false);
        });
    });

    describe('chroma schema', () => {
        it.prop([arbitraryChroma])('validates chroma in range', (chroma) => {
            expect(isChroma(chroma)).toBe(true);
        });

        it.prop([fc.float({ max: Math.fround(-0.1), min: -10 })])('rejects chroma below 0', (chroma) => {
            expect(isChroma(chroma)).toBe(false);
        });

        it.prop([fc.float({ max: 10, min: Math.fround(0.41) })])('rejects chroma above 0.4', (chroma) => {
            expect(isChroma(chroma)).toBe(false);
        });
    });

    describe('hue schema', () => {
        it.prop([arbitraryHue])('validates hue in range', (hue) => {
            expect(isHue(hue)).toBe(true);
        });

        it('normalizes hue above 360', () => {
            const result = Effect.runSync(Effect.succeed(400).pipe(Effect.flatMap((h) => Effect.succeed(h % 360))));
            expect(result).toBeLessThan(360);
        });

        it('normalizes negative hue', () => {
            const result = Effect.runSync(
                Effect.succeed(-40).pipe(Effect.flatMap((h) => Effect.succeed(((h % 360) + 360) % 360))),
            );
            expect(result).toBeGreaterThanOrEqual(0);
            expect(result).toBeLessThan(360);
        });
    });

    describe('lightness schema', () => {
        it.prop([arbitraryLightness])('validates lightness in range', (lightness) => {
            expect(isLightness(lightness)).toBe(true);
        });

        it.prop([fc.float({ max: Math.fround(-0.1), min: -10 })])('rejects lightness below 0', (lightness) => {
            expect(isLightness(lightness)).toBe(false);
        });

        it.prop([fc.float({ max: 10, min: Math.fround(1.1) })])('rejects lightness above 1', (lightness) => {
            expect(isLightness(lightness)).toBe(false);
        });
    });

    describe('oklch color schema', () => {
        it.prop([arbitraryOklchColor])('validates oklch color', (color) => {
            expect(isOklchColor(color)).toBe(true);
        });

        it('validates complete oklch color structure', () => {
            const color = { a: 1, c: 0.2, h: 180, l: 0.5 };
            const result = Effect.runSync(validateOklchColor(color));
            expect(result).toEqual(color);
        });

        it('rejects invalid oklch color', () => {
            const result = Effect.runSyncExit(validateOklchColor({ a: 2, c: 0.5, h: 400, l: 1.5 }));
            expect(result._tag).toBe('Failure');
        });
    });

    describe('theme input schema', () => {
        it.prop([arbitraryThemeName, arbitraryLightness, arbitraryChroma, arbitraryHue, arbitraryThemeScale])(
            'validates theme input',
            (name, lightness, chroma, hue, scale) => {
                const theme = { chroma, hue, lightness, name, scale };
                const result = Effect.runSync(validateTheme(theme));
                expect(result.name).toBe(name);
                expect(result.lightness).toBe(lightness);
                expect(result.chroma).toBe(chroma);
                expect(result.hue).toBe(hue);
                expect(result.scale).toBe(scale);
            },
        );

        it('validates theme with optional alpha', () => {
            const theme = { alpha: 0.8, chroma: 0.2, hue: 180, lightness: 0.5, name: 'test', scale: 5 };
            const result = Effect.runSync(validateTheme(theme));
            expect(result.alpha).toBe(0.8);
        });

        it('validates theme with modifiers', () => {
            const theme = {
                chroma: 0.2,
                hue: 180,
                lightness: 0.5,
                modifiers: { focus: true, hover: true },
                name: 'test',
                scale: 5,
            };
            const result = Effect.runSync(validateTheme(theme));
            expect(result.modifiers?.hover).toBe(true);
            expect(result.modifiers?.focus).toBe(true);
        });

        it('validates theme with custom modifiers', () => {
            const theme = {
                chroma: 0.2,
                customModifiers: [{ alphaShift: 0, chromaShift: 0.1, lightnessShift: 0.05, name: 'custom' }],
                hue: 180,
                lightness: 0.5,
                name: 'test',
                scale: 5,
            };
            const result = Effect.runSync(validateTheme(theme));
            expect(result.customModifiers).toHaveLength(1);
            expect(result.customModifiers?.[0]?.name).toBe('custom');
        });

        it('rejects invalid theme name', () => {
            const theme = { chroma: 0.2, hue: 180, lightness: 0.5, name: 'Invalid Name', scale: 5 };
            const result = Effect.runSyncExit(validateTheme(theme));
            expect(result._tag).toBe('Failure');
        });

        it('rejects scale outside range', () => {
            const theme = { chroma: 0.2, hue: 180, lightness: 0.5, name: 'test', scale: 25 };
            const result = Effect.runSyncExit(validateTheme(theme));
            expect(result._tag).toBe('Failure');
        });
    });

    describe('modifier override schema', () => {
        it('accepts boolean true', () => {
            const theme = { chroma: 0.2, hue: 180, lightness: 0.5, modifiers: { hover: true }, name: 'test', scale: 5 };
            const result = Effect.runSync(validateTheme(theme));
            expect(result.modifiers?.hover).toBe(true);
        });

        it('accepts custom shift values', () => {
            const theme = {
                chroma: 0.2,
                hue: 180,
                lightness: 0.5,
                modifiers: { hover: { chromaShift: 2, lightnessShift: 1 } },
                name: 'test',
                scale: 5,
            };
            const result = Effect.runSync(validateTheme(theme));
            expect(result.modifiers?.hover).toEqual({ chromaShift: 2, lightnessShift: 1 });
        });
    });

    describe('layout schemas', () => {
        it('validates grid layout', () => {
            const schema = import('../src/schemas.ts').then((m) => m.GridLayoutSchema);
            expect(schema).toBeDefined();
        });

        it('validates stack layout', () => {
            const schema = import('../src/schemas.ts').then((m) => m.StackLayoutSchema);
            expect(schema).toBeDefined();
        });

        it('validates sticky layout', () => {
            const schema = import('../src/schemas.ts').then((m) => m.StickyLayoutSchema);
            expect(schema).toBeDefined();
        });

        it('validates container layout', () => {
            const schema = import('../src/schemas.ts').then((m) => m.ContainerLayoutSchema);
            expect(schema).toBeDefined();
        });
    });

    describe('font schemas', () => {
        it('validates font weight range', () => {
            const schema = import('../src/schemas.ts').then((m) => m.FontWeightSchema);
            expect(schema).toBeDefined();
        });

        it('validates font input', () => {
            const schema = import('../src/schemas.ts').then((m) => m.FontInputSchema);
            expect(schema).toBeDefined();
        });
    });
});
