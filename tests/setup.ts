/**
 * Universal test infrastructure.
 * Registers Effect equality testers, configures fast-check, suppresses logger.
 */

// --- [IMPORTS] ---------------------------------------------------------------

import { addEqualityTesters } from '@effect/vitest';
import { FastCheck as fc, Logger } from 'effect';

// --- [SETUP] -----------------------------------------------------------------

addEqualityTesters();
fc.configureGlobal({
    endOnFailure: !process.env['CI'],
    interruptAfterTimeLimit: 30_000,
    numRuns: process.env['CI'] ? 200 : 50,
    skipAllAfterTimeLimit: 25_000,
    verbose: process.env['CI'] ? 0 : 1,
});

// Suppress Effect's default structured logger during tests. `it.effect` already
// removes the default logger via its TestEnv layer, but this patch covers
// `it.live` tests and layer construction that logs outside the test harness.
Logger.defaultLogger.log = () => {};
