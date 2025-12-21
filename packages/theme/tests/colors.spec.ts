/**
 * Validate OKLCH color manipulation via property-based testing.
 */
import { it } from '@fast-check/vitest';
import { Effect } from 'effect';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import {
    adjust,
    COLOR_TUNING,
    contrast,
    createOklch,
    gamutMap,
    isInGamut,
    mix,
    parseOklch,
    toCSS,
    toSRGB,
} from '../src/colors.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const arbitraryAlpha = fc.float({ max: 1, min: 0, noDefaultInfinity: true, noNaN: true });
const arbitraryChroma = fc.float({ max: Math.fround(0.39), min: 0, noDefaultInfinity: true, noNaN: true });
const arbitraryHue = fc.integer({ max: 359, min: 0 });
const arbitraryLightness = fc.float({ max: 1, min: 0, noDefaultInfinity: true, noNaN: true });

// --- [TESTS] -----------------------------------------------------------------

describe('colors package', () => {
    describe('color creation', () => {
        it.prop([arbitraryLightness, arbitraryChroma, arbitraryHue, arbitraryAlpha])(
            'creates oklch color',
            (l, c, h, a) => {
                const result = Effect.runSync(createOklch(l, c, h, a));
                expect(result.l).toBe(l);
                expect(result.c).toBe(c);
                expect(result.h).toBe(h);
                expect(result.a).toBe(a);
            },
        );

        it.prop([arbitraryLightness, arbitraryChroma, arbitraryHue])('defaults alpha to 1', (l, c, h) => {
            const result = Effect.runSync(createOklch(l, c, h));
            expect(result.a).toBe(1);
        });

        it('rejects invalid lightness', () => {
            const result = Effect.runSyncExit(createOklch(1.5, 0.2, 180));
            expect(result._tag).toBe('Failure');
        });

        it('rejects invalid chroma', () => {
            const result = Effect.runSyncExit(createOklch(0.5, 0.5, 180));
            expect(result._tag).toBe('Failure');
        });
    });

    describe('css generation', () => {
        it.prop([arbitraryLightness, arbitraryChroma, arbitraryHue])('generates css without alpha', (l, c, h) => {
            const color = Effect.runSync(createOklch(l, c, h, 1));
            const css = toCSS(color);
            expect(css).toMatch(/^oklch\(\d+\.\d+%\s+\d+\.\d+\s+\d+\.\d+\)$/);
            expect(css).not.toContain('/');
        });

        it.prop([
            arbitraryLightness,
            arbitraryChroma,
            arbitraryHue,
            fc.float({ max: Math.fround(0.99), min: Math.fround(0.01), noDefaultInfinity: true, noNaN: true }),
        ])('generates css with alpha', (l, c, h, a) => {
            const color = Effect.runSync(createOklch(l, c, h, a));
            const css = toCSS(color);
            expect(css).toMatch(/^oklch\(\d+\.\d+%\s+\d+\.\d+\s+\d+\.\d+\s+\/\s+\d+\.\d+\)$/);
        });

        it('formats lightness as percentage', () => {
            const color = Effect.runSync(createOklch(0.5, 0.2, 180));
            const css = toCSS(color);
            expect(css).toContain('50.0%');
        });
    });

    describe('css parsing', () => {
        it('parses oklch css string', () => {
            const css = 'oklch(50.0% 0.200 180.0)';
            const color = Effect.runSync(parseOklch(css));
            expect(color.l).toBeCloseTo(0.5, 2);
            expect(color.c).toBeCloseTo(0.2, 2);
            expect(color.h).toBeCloseTo(180, 1);
            expect(color.a).toBe(1);
        });

        it('parses oklch with alpha', () => {
            const css = 'oklch(50.0% 0.200 180.0 / 0.80)';
            const color = Effect.runSync(parseOklch(css));
            expect(color.a).toBeCloseTo(0.8, 2);
        });

        it('rejects invalid css string', () => {
            const result = Effect.runSyncExit(parseOklch('not-a-color'));
            expect(result._tag).toBe('Failure');
        });
    });

    describe('color mixing', () => {
        it.prop([
            arbitraryLightness,
            arbitraryChroma,
            arbitraryHue,
            arbitraryLightness,
            arbitraryChroma,
            arbitraryHue,
            fc.float({ max: 1, min: 0 }),
        ])('mixes two colors', (l1, c1, h1, l2, c2, h2, ratio) => {
            const color1 = Effect.runSync(createOklch(l1, c1, h1));
            const color2 = Effect.runSync(createOklch(l2, c2, h2));
            const mixed = Effect.runSync(mix(color1, color2, ratio));
            expect(mixed.l).toBeGreaterThanOrEqual(0);
            expect(mixed.l).toBeLessThanOrEqual(1);
            expect(mixed.c).toBeGreaterThanOrEqual(0);
            expect(mixed.c).toBeLessThanOrEqual(0.4);
        });

        it('at ratio 0 returns first color', () => {
            const color1 = Effect.runSync(createOklch(0.3, 0.1, 120));
            const color2 = Effect.runSync(createOklch(0.7, 0.3, 240));
            const mixed = Effect.runSync(mix(color1, color2, 0));
            expect(mixed.l).toBeCloseTo(color1.l, 2);
            expect(mixed.c).toBeCloseTo(color1.c, 2);
        });

        it('at ratio 1 returns second color', () => {
            const color1 = Effect.runSync(createOklch(0.3, 0.1, 120));
            const color2 = Effect.runSync(createOklch(0.7, 0.3, 240));
            const mixed = Effect.runSync(mix(color1, color2, 1));
            expect(mixed.l).toBeCloseTo(color2.l, 2);
            expect(mixed.c).toBeCloseTo(color2.c, 2);
        });
    });

    describe('color adjustment', () => {
        it('adjusts lightness', () => {
            const color = Effect.runSync(createOklch(0.5, 0.2, 180));
            const adjusted = Effect.runSync(adjust(color, { lightness: 0.1 }));
            expect(adjusted.l).toBeCloseTo(0.6, 2);
        });

        it('adjusts chroma', () => {
            const color = Effect.runSync(createOklch(0.5, 0.2, 180));
            const adjusted = Effect.runSync(adjust(color, { chroma: 0.05 }));
            expect(adjusted.c).toBeCloseTo(0.25, 2);
        });

        it('adjusts hue', () => {
            const color = Effect.runSync(createOklch(0.5, 0.2, 180));
            const adjusted = Effect.runSync(adjust(color, { hue: 30 }));
            expect(adjusted.h).toBeCloseTo(210, 1);
        });

        it('clamps lightness to valid range', () => {
            const color = Effect.runSync(createOklch(0.9, 0.2, 180));
            const adjusted = Effect.runSync(adjust(color, { lightness: 0.2 }));
            expect(adjusted.l).toBeLessThanOrEqual(1);
        });

        it('wraps hue around 360', () => {
            const color = Effect.runSync(createOklch(0.5, 0.2, 350));
            const adjusted = Effect.runSync(adjust(color, { hue: 30 }));
            expect(adjusted.h).toBeCloseTo(20, 1);
        });
    });

    describe('contrast calculation', () => {
        it('calculates apca contrast', () => {
            const fg = Effect.runSync(createOklch(0.2, 0.1, 180));
            const bg = Effect.runSync(createOklch(0.9, 0.05, 180));
            const contrastValue = contrast(fg, bg);
            expect(contrastValue).toBeGreaterThan(0);
        });

        it('returns higher contrast for greater lightness difference', () => {
            const fg1 = Effect.runSync(createOklch(0.3, 0.1, 180));
            const fg2 = Effect.runSync(createOklch(0.1, 0.1, 180));
            const bg = Effect.runSync(createOklch(0.9, 0.05, 180));
            const contrast1 = Math.abs(contrast(fg1, bg));
            const contrast2 = Math.abs(contrast(fg2, bg));
            expect(contrast2).toBeGreaterThan(contrast1);
        });
    });

    describe('gamut mapping', () => {
        it.prop([arbitraryLightness, fc.float({ max: Math.fround(0.37), min: 0 }), arbitraryHue])(
            'identifies colors in srgb gamut',
            (l, c, h) => {
                const color = Effect.runSync(createOklch(l, c, h));
                expect(isInGamut(color, 'srgb')).toBe(true);
            },
        );

        it('identifies colors outside srgb gamut', () => {
            const color = Effect.runSync(createOklch(0.5, 0.38, 180));
            expect(isInGamut(color, 'srgb')).toBe(false);
        });

        it('maps color to srgb gamut', () => {
            const color = Effect.runSync(createOklch(0.5, 0.39, 180));
            const mapped = Effect.runSync(gamutMap(color, 'srgb'));
            expect(isInGamut(mapped, 'srgb')).toBe(true);
            expect(mapped.c).toBeLessThanOrEqual(COLOR_TUNING.gamut.maxChroma);
        });
    });

    describe('srgb conversion', () => {
        it.prop([arbitraryLightness, arbitraryChroma, arbitraryHue])('converts to srgb', (l, c, h) => {
            const color = Effect.runSync(createOklch(l, c, h));
            const rgb = toSRGB(color);
            expect(rgb).toMatch(/^rgb\(\d+,\s+\d+,\s+\d+\)$/);
        });

        it('converts to rgba with alpha', () => {
            const color = Effect.runSync(createOklch(0.5, 0.2, 180, 0.8));
            const rgb = toSRGB(color);
            expect(rgb).toMatch(/^rgba\(\d+,\s+\d+,\s+\d+,\s+\d+\.\d+\)$/);
        });
    });

    describe('tuning constants', () => {
        it('exposes frozen config', () => {
            expect(Object.isFrozen(COLOR_TUNING)).toBe(true);
        });

        it('defines apca parameters', () => {
            expect(COLOR_TUNING.apca.normBg).toBeGreaterThan(0);
            expect(COLOR_TUNING.apca.normTxt).toBeGreaterThan(0);
            expect(COLOR_TUNING.apca.scaleBoW).toBeGreaterThan(0);
        });

        it('defines gamut limits', () => {
            expect(COLOR_TUNING.gamut.maxChroma).toBeLessThanOrEqual(0.4);
            expect(COLOR_TUNING.gamut.p3MaxChroma).toBeGreaterThan(COLOR_TUNING.gamut.maxChroma);
        });
    });
});
