/**
 * Validate performance observer metric formatting, log creation, and lifecycle.
 */
import { it } from '@fast-check/vitest';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import {
    createLogEntry,
    formatDuration,
    formatEntryMessage,
    getMetricSummary,
    getSupportedTypes,
    isSupported,
    observePerformance,
    PERFORMANCE_TUNING,
} from '../src/performance.ts';
import type { LogEntry } from '../src/types.ts';
import { captureGlobals, type GlobalEnv, layer, perfEntry, restoreGlobals } from './utils.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    entryTypes: PERFORMANCE_TUNING.defaults.entryTypes,
    msgPatterns: [
        ['longtask', { duration: 150 }, /\[PERF\] longtask.*150\.00ms.*>50ms/],
        ['first-input', { duration: 50 }, /\[PERF\] first-input.*delay=50\.00ms/],
        ['largest-contentful-paint', { startTime: 2500 }, /\[PERF\] largest-contentful-paint.*2500\.00ms/],
        ['resource', { duration: 200, name: 'script.js' }, /\[PERF\] resource.*script\.js.*200\.00ms/],
    ] as const,
} as const);

const perfLog = (entryType: string, spans: Record<string, number> = {}): LogEntry => ({
    annotations: { entryType },
    fiberId: 'performance',
    level: 'Debug',
    message: 'test',
    spans,
    timestamp: new Date(),
});

// --- [TESTS] -----------------------------------------------------------------

describe('performance', () => {
    describe('formatDuration', () => {
        it.prop([fc.float({ max: 10000, min: 0, noNaN: true })])('always ends with ms', (duration) => {
            expect(formatDuration(duration)).toMatch(/^\d+\.\d{2}ms$/);
        });

        it.each([
            [0, '0.00ms'],
            [100.5, '100.50ms'],
            [999.99, '999.99ms'],
        ])('%d → %s', (input, expected) => {
            expect(formatDuration(input)).toBe(expected);
        });
    });

    describe('formatEntryMessage', () => {
        it.each(B.msgPatterns)('%s formats correctly', (type, overrides, pattern) => {
            expect(formatEntryMessage(perfEntry(type, overrides))).toMatch(pattern);
        });

        it('layout-shift with value', () => {
            const entry = perfEntry('layout-shift');
            (entry as PerformanceEntry & { value: number }).value = 0.1234;
            expect(formatEntryMessage(entry)).toContain('score=0.1234');
        });

        it('layout-shift without value', () => {
            expect(formatEntryMessage(perfEntry('layout-shift'))).toContain('score=unknown');
        });
    });

    describe('createLogEntry', () => {
        it.each(
            B.entryTypes.map((t) => [t, t === 'longtask' ? 'Warning' : 'Debug'] as const),
        )('%s → level=%s', (type, expectedLevel) => {
            const entry = createLogEntry(perfEntry(type));
            expect([entry.level, entry.fiberId, entry.annotations['entryType']]).toEqual([
                expectedLevel,
                'performance',
                type,
            ]);
        });

        it.prop([fc.float({ max: 1000, min: 0, noNaN: true })])('captures duration in spans', (duration) => {
            expect(createLogEntry(perfEntry('longtask', { duration })).spans['duration']).toBe(duration);
        });
    });

    describe('getMetricSummary', () => {
        it('empty array returns zeros', () => {
            expect(getMetricSummary([])).toEqual({ cls: 0, fid: 0, lcp: 0, longTasks: 0 });
        });

        it('filters by fiberId=performance', () => {
            expect(getMetricSummary([{ ...perfLog('longtask'), fiberId: 'other' }]).longTasks).toBe(0);
        });

        it.prop([fc.integer({ max: 10, min: 1 })])('counts longTasks', (count) => {
            const logs = Array.from({ length: count }, () => perfLog('longtask'));
            expect(getMetricSummary(logs).longTasks).toBe(count);
        });

        it.prop([fc.float({ max: 500, min: 1, noNaN: true })])('extracts fid from duration', (duration) => {
            expect(getMetricSummary([perfLog('first-input', { duration })]).fid).toBe(duration);
        });

        it.prop([fc.array(fc.float({ max: 1, min: 0, noNaN: true }), { maxLength: 5, minLength: 1 })])(
            'sums cls values',
            (values) => {
                const logs = values.map((v) => ({
                    ...perfLog('layout-shift'),
                    annotations: { entryType: 'layout-shift', value: v },
                }));
                const expected = values.reduce((sum, v) => sum + v, 0);
                expect(getMetricSummary(logs).cls).toBeCloseTo(expected);
            },
        );
    });

    describe('isSupported', () => {
        let orig: GlobalEnv;
        beforeEach(() => {
            orig = captureGlobals();
        });
        afterEach(() => {
            restoreGlobals(orig);
        });

        it.each([
            [
                'no window',
                () => {
                    (globalThis as { window?: unknown }).window = undefined;
                },
            ],
            [
                'no PerformanceObserver',
                () => {
                    (globalThis as { window?: unknown }).window = {};
                    (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver = undefined;
                },
            ],
            [
                'no supportedEntryTypes',
                () => {
                    (globalThis as { window?: unknown }).window = {};
                    (globalThis as { PerformanceObserver?: object }).PerformanceObserver = {};
                },
            ],
        ])('false when %s', (_, setup) => {
            setup();
            expect(isSupported()).toBe(false);
        });

        it('true with full browser API', () => {
            (globalThis as { window?: unknown }).window = {};
            (
                globalThis as { PerformanceObserver?: { supportedEntryTypes: ReadonlyArray<string> } }
            ).PerformanceObserver = {
                supportedEntryTypes: ['longtask'],
            };
            expect(isSupported()).toBe(true);
        });
    });

    describe('getSupportedTypes', () => {
        let orig: GlobalEnv;
        beforeEach(() => {
            orig = captureGlobals();
        });
        afterEach(() => {
            restoreGlobals(orig);
        });

        it('filters to browser-supported types', () => {
            (
                globalThis as { PerformanceObserver?: { supportedEntryTypes: ReadonlyArray<string> } }
            ).PerformanceObserver = {
                supportedEntryTypes: ['longtask', 'first-input'],
            };
            expect(getSupportedTypes(['longtask', 'layout-shift', 'first-input'])).toEqual(['longtask', 'first-input']);
        });
    });

    describe('observePerformance', () => {
        let orig: GlobalEnv;
        beforeEach(() => {
            orig = captureGlobals();
        });
        afterEach(() => {
            restoreGlobals(orig);
        });

        it('returns isSupported=false in non-browser', () => {
            (globalThis as { window?: unknown }).window = undefined;
            const { layer: l, logs } = layer();
            const result = observePerformance({ loggerLayer: l, logs });
            expect([result.isSupported, typeof result.disconnect]).toEqual([false, 'function']);
        });

        it('disconnect callable when supported', () => {
            (globalThis as { window?: unknown }).window = {};
            const disconnect = vi.fn();
            const observe = vi.fn();
            const Mock = vi.fn(function (this: { disconnect: typeof disconnect; observe: typeof observe }) {
                this.disconnect = disconnect;
                this.observe = observe;
            }) as unknown as typeof PerformanceObserver;
            (Mock as { supportedEntryTypes: ReadonlyArray<string> }).supportedEntryTypes = ['longtask'];
            (globalThis as { PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver = Mock;

            const { layer: l, logs } = layer();
            const result = observePerformance({ entryTypes: ['longtask'], loggerLayer: l, logs });

            expect(result.isSupported).toBe(true);
            result.disconnect();
            expect(disconnect).toHaveBeenCalled();
        });
    });
});
