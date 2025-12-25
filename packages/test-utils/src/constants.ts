/**
 * Test constants: deterministic values for reproducible tests.
 */

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const env = (key: string): string | undefined => (typeof process === 'undefined' ? undefined : process.env[key]);

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        timerAdvanceMs: 10,
    },
    errors: {
        clipboardRead: { code: 'CLIPBOARD_READ', message: 'Failed to read from clipboard' },
        clipboardWrite: { code: 'CLIPBOARD_WRITE', message: 'Failed to write to clipboard' },
        downloadFailed: { code: 'DOWNLOAD_FAILED', message: 'Download failed' },
        exportFailed: { code: 'EXPORT_FAILED', message: 'Export failed' },
    },
    fc: {
        interruptAfterTimeLimit: 5_000,
        numRuns: env('CI') ? 100 : 50,
        ...(env('FC_SEED') ? { seed: Number.parseInt(env('FC_SEED') as string, 10) } : {}),
    },
    frozenTime: new Date('2025-01-15T12:00:00.000Z'),
    storage: { version: 0 },
});

// --- [EXPORT] ----------------------------------------------------------------

export { B as TEST_CONSTANTS };
