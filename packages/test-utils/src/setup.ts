/**
 * Test setup: shared lifecycle hooks for node and browser environments.
 */
import './matchers/effect';
import { addEqualityTesters } from '@effect/vitest';
import fc from 'fast-check';
import { afterEach, beforeEach, vi } from 'vitest';
import { TEST_CONSTANTS } from './constants';

// --- [ENTRY_POINT] -----------------------------------------------------------

fc.configureGlobal(TEST_CONSTANTS.fc);
addEqualityTesters();

beforeEach(() => {
    localStorage?.clear?.();
    sessionStorage?.clear?.();
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.frozenTime);
});

afterEach(() => vi.useRealTimers());
