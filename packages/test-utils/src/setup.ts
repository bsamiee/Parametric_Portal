/**
 * Initialize shared test lifecycle hooks for node and browser environments.
 * Fast-check config, fake timers, storage clearing, Effect equality testers.
 */
import './effect-test';
import { addEqualityTesters } from '@effect/vitest';
import fc from 'fast-check';
import { afterEach, beforeEach, vi } from 'vitest';
import { TEST_CONSTANTS } from './constants';

// --- [CONSTANTS] -------------------------------------------------------------

const isBrowser = globalThis.window !== undefined;

// --- [ENTRY_POINT] -----------------------------------------------------------

fc.configureGlobal(TEST_CONSTANTS.fc);
addEqualityTesters();

beforeEach(async () => {
    // @ts-expect-error fake-indexeddb exports don't match package.json types
    !isBrowser && (await import('fake-indexeddb/auto'));
    globalThis.localStorage?.clear();
    globalThis.sessionStorage?.clear();
    globalThis.indexedDB && (indexedDB as unknown as { _databases: Map<string, unknown> })._databases?.clear();
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.frozenTime);
});

afterEach(() => vi.useRealTimers());
