/**
 * Validate Effect DevTools layer creation and browser environment detection.
 */
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDevToolsLayer, createDevToolsLayerEffect } from '../src/experimental.ts';
import { captureGlobals, type GlobalEnv, layer, restoreGlobals, setupBrowser, setupNoBrowser } from './utils.ts';

// --- [TESTS] -----------------------------------------------------------------

describe('experimental', () => {
    let orig: GlobalEnv;

    beforeEach(() => {
        orig = captureGlobals();
    });

    afterEach(() => {
        restoreGlobals(orig);
    });

    describe('createDevToolsLayer', () => {
        it('returns layer and isEnabled properties', () => {
            const result = createDevToolsLayer({ enabled: false });
            expect([typeof result.layer, typeof result.isEnabled]).toEqual(['object', 'boolean']);
        });

        it('disabled when enabled=false', () => {
            setupBrowser({ window: true, ws: true });
            expect(createDevToolsLayer({ enabled: false }).isEnabled).toBe(false);
        });

        it('disabled when no window', () => {
            setupNoBrowser();
            expect(createDevToolsLayer({ enabled: true }).isEnabled).toBe(false);
        });

        it('disabled when no WebSocket', () => {
            setupBrowser({ window: true, ws: false });
            expect(createDevToolsLayer({ enabled: true }).isEnabled).toBe(false);
        });

        it('enabled in full browser environment', () => {
            (globalThis as { window?: unknown }).window = {};
            (globalThis as { WebSocket?: unknown }).WebSocket = vi.fn();
            expect(createDevToolsLayer({ enabled: true }).isEnabled).toBe(true);
        });
    });

    describe('createDevToolsLayerEffect', () => {
        it('resolves to DevToolsResult', async () => {
            const { layer: l } = layer();
            const result = await Effect.runPromise(
                createDevToolsLayerEffect({ enabled: false }).pipe(Effect.provide(l)),
            );
            expect([typeof result.layer, typeof result.isEnabled]).toEqual(['object', 'boolean']);
        });

        it('logs message on disabled', async () => {
            const { layer: l, logs } = layer({ logLevel: 'Debug' });
            await Effect.runPromise(createDevToolsLayerEffect({ enabled: false }).pipe(Effect.provide(l)));
            expect(logs.some((log) => /disabled|DevTools/i.test(log.message))).toBe(true);
        });
    });
});
