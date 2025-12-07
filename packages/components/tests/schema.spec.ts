/**
 * Schema tests: verify resolve polymorphism, B constant structure, utility functions.
 * Uses fast-check for property-based testing with vitest runner.
 */
import { it } from '@fast-check/vitest';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import {
    B,
    type Computed,
    compute,
    createBuilderContext,
    resolve,
    type SchemaKey,
    stateCls,
    utilities,
} from '../src/schema.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const SCHEMA_KEYS: ReadonlyArray<SchemaKey> = ['scale', 'behavior', 'overlay', 'feedback', 'animation'];
const STATE_KEYS = ['ctrl', 'data', 'el', 'fb', 'menu', 'nav', 'ov'] as const;
const COMPUTE_KEYS = Object.keys(compute) as ReadonlyArray<keyof Computed>;

const SCALE_CONFIGS = [
    { baseUnit: 0.25, density: 1, radiusMultiplier: 0.25, scale: 5 },
    { baseUnit: 0.125, density: 0.5, radiusMultiplier: 0, scale: 1 },
    { baseUnit: 0.5, density: 2, radiusMultiplier: 1, scale: 10 },
] as const;

// --- [ENTRY_POINT] -----------------------------------------------------------

describe('components schema', () => {
    describe('resolve polymorphic function', () => {
        describe.each(SCHEMA_KEYS)('resolve("%s")', (key) => {
            it('applies defaults when no input provided', () => {
                const result = resolve(key);
                expect(result).toBeDefined();
                expect(result._tag).toBe(key);
            });

            it('returns object with correct _tag discriminant', () => {
                const result = resolve(key, {});
                expect(result._tag).toBe(key);
            });
        });

        it('merges input with defaults for scale', () => {
            const result = resolve('scale', { scale: 8 });
            expect(result.scale).toBe(8);
            expect(result.density).toBe(1);
            expect(result.baseUnit).toBe(0.25);
        });

        it('merges input with defaults for behavior', () => {
            const result = resolve('behavior', { disabled: true });
            expect(result.disabled).toBe(true);
            expect(result.loading).toBe(false);
            expect(result.focusable).toBe(true);
        });
    });

    describe('compute dispatch table', () => {
        describe.each(COMPUTE_KEYS)('compute.%s', (key) => {
            it('produces valid rem/px string', () => {
                const scale = resolve('scale', { scale: 5 });
                const result = compute[key](scale);
                expect(result).toMatch(/^\d+\.\d{3}(rem|px)$/);
            });

            it('produces positive values', () => {
                const scale = resolve('scale', { scale: 5 });
                const result = compute[key](scale);
                expect(parseFloat(result)).toBeGreaterThan(0);
            });
        });

        describe.each(SCALE_CONFIGS)('with config %o', (config) => {
            it('computes all 36 values correctly', () => {
                const scale = resolve('scale', config);
                const computed = utilities.computeScale(scale);
                expect(Object.keys(computed).length).toBe(36);
                for (const v of Object.values(computed)) {
                    expect(v).toMatch(/^\d+(\.\d{3})?(rem|px)$/);
                }
            });
        });
    });

    describe('utilities.computeScale', () => {
        it.prop([
            fc.integer({ max: 10, min: 1 }),
            fc.float({ max: Math.fround(2), min: Math.fround(0.5), noNaN: true }),
        ])('produces valid computed object for scale=%i density=%f', (scale, density) => {
            const s = resolve('scale', { density, scale });
            const c = utilities.computeScale(s);
            expect(Object.keys(c).length).toBe(36);
            for (const v of Object.values(c)) {
                expect(parseFloat(v)).toBeGreaterThan(0);
            }
        });
    });

    describe('utilities.cssVars', () => {
        it('converts computed to css custom properties', () => {
            const scale = resolve('scale', { scale: 5 });
            const computed = utilities.computeScale(scale);
            const vars = utilities.cssVars(computed, 'ctrl');
            expect(vars['--ctrl-height']).toBe(computed.height);
            expect(vars['--ctrl-gap']).toBe(computed.gap);
            expect(vars['--ctrl-font-size']).toBe(computed.fontSize);
            expect(vars['--ctrl-padding-x']).toBe(computed.paddingX);
        });

        it('converts camelCase to kebab-case', () => {
            const scale = resolve('scale', { scale: 5 });
            const computed = utilities.computeScale(scale);
            const vars = utilities.cssVars(computed, 'test');
            expect(vars['--test-badge-padding-x']).toBeDefined();
            expect(vars['--test-dropdown-max-height']).toBeDefined();
            expect(vars['--test-small-font-size']).toBeDefined();
        });
    });

    describe('stateCls dispatch table', () => {
        const DISABLED_EXPECTATIONS: Record<(typeof STATE_KEYS)[number], string> = {
            ctrl: 'opacity',
            data: 'opacity',
            el: 'opacity',
            fb: 'opacity',
            menu: 'opacity',
            nav: 'opacity',
            ov: 'pointer-events-none',
        };

        describe.each(STATE_KEYS)('stateCls.%s', (category) => {
            it('returns empty string for default behavior', () => {
                const b = resolve('behavior', {});
                const cls = stateCls[category](b);
                expect(cls).toBe('');
            });

            it('returns correct disabled class', () => {
                const b = resolve('behavior', { disabled: true });
                const cls = stateCls[category](b);
                expect(cls).toContain(DISABLED_EXPECTATIONS[category]);
            });
        });

        it('handles loading state for ctrl category', () => {
            const b = resolve('behavior', { loading: true });
            const cls = stateCls.ctrl(b);
            expect(cls).toContain('cursor-wait');
        });

        it('handles readonly state for ctrl category', () => {
            const b = resolve('behavior', { readonly: true });
            const cls = stateCls.ctrl(b);
            expect(cls).toContain('cursor-default');
        });

        it('merges multiple states correctly', () => {
            const b = resolve('behavior', { disabled: true, loading: true });
            const cls = stateCls.ctrl(b);
            expect(cls).toContain('opacity');
        });
    });

    describe('utilities.strokeWidth', () => {
        it.each([
            [0, B.icon.stroke.base],
            [5, B.icon.stroke.base - 5 * B.icon.stroke.factor],
            [20, B.icon.stroke.min],
            [100, B.icon.stroke.min],
        ])('utilities.strokeWidth(%i) = %f', (scale, expected) => {
            expect(utilities.strokeWidth(scale)).toBeCloseTo(expected, 2);
        });

        it.prop([fc.integer({ max: 100, min: 0 })])('clamps between min and max for scale=%i', (scale) => {
            const result = utilities.strokeWidth(scale);
            expect(result).toBeGreaterThanOrEqual(B.icon.stroke.min);
            expect(result).toBeLessThanOrEqual(B.icon.stroke.max);
        });
    });

    describe('createBuilderContext', () => {
        it('builds context with scale and computed values', () => {
            const ctx = createBuilderContext('ctrl', ['scale', 'behavior'], {
                behavior: { focusable: false },
                scale: { scale: 5 },
            });
            expect(ctx.scale._tag).toBe('scale');
            expect(ctx.behavior._tag).toBe('behavior');
            expect(ctx.behavior.focusable).toBe(false);
            expect(ctx.computed).toBeDefined();
            expect(ctx.vars['--ctrl-height']).toBeDefined();
        });

        it('handles multiple resolvers', () => {
            const ctx = createBuilderContext('data', ['scale', 'behavior', 'animation'], {
                animation: { duration: 300 },
                scale: { scale: 3 },
            });
            expect(ctx.scale._tag).toBe('scale');
            expect(ctx.behavior._tag).toBe('behavior');
            expect(ctx.animation._tag).toBe('animation');
            expect(ctx.animation.duration).toBe(300);
        });
    });

    describe('B constant', () => {
        it('is frozen', () => {
            expect(Object.isFrozen(B)).toBe(true);
        });

        it('contains all category configs', () => {
            const categories = ['algo', 'ctrl', 'data', 'el', 'fb', 'icon', 'menu', 'nav', 'ov', 'util'] as const;
            for (const cat of categories) {
                expect(B[cat]).toBeDefined();
            }
        });

        it('has all algorithm constants', () => {
            const algoKeys = [
                'badgePxMul',
                'fontBase',
                'fontStep',
                'gapMul',
                'hBase',
                'hStep',
                'iconRatio',
                'pxMul',
                'pyMul',
                'rMax',
            ] as const;
            for (const key of algoKeys) {
                expect(B.algo[key]).toBeDefined();
                expect(typeof B.algo[key]).toBe('number');
            }
        });
    });
});
