/**
 * Validate browser hooks factory behavior and pure function utilities.
 */
import { describe, expect, it } from 'vitest';
import {
    BROWSER_HOOKS_TUNING,
    createBrowserHooks,
    isClipboardAvailable,
    mkClipboardError,
    mkDownloadError,
} from '../src/browser.ts';
import { createRuntimeHooks } from '../src/runtime.tsx';

// --- [TESTS] -----------------------------------------------------------------

describe('browser', () => {
    describe('BROWSER_HOOKS_TUNING', () => {
        it('should be frozen', () => {
            expect(Object.isFrozen(BROWSER_HOOKS_TUNING)).toBe(true);
        });

        it('should have defaults.mimeType', () => {
            expect(BROWSER_HOOKS_TUNING.defaults.mimeType).toBe('text/plain');
        });

        it('should have defaults.timestamp function', () => {
            expect(typeof BROWSER_HOOKS_TUNING.defaults.timestamp).toBe('function');
        });

        it('should return current timestamp from defaults.timestamp', () => {
            const before = Date.now();
            const ts = BROWSER_HOOKS_TUNING.defaults.timestamp();
            const after = Date.now();
            expect(ts).toBeGreaterThanOrEqual(before);
            expect(ts).toBeLessThanOrEqual(after);
        });

        it('should have errors.clipboardUnavailable', () => {
            expect(BROWSER_HOOKS_TUNING.errors.clipboardUnavailable).toBe('Clipboard API not available');
        });

        it('should have errors.clipboardWrite', () => {
            expect(BROWSER_HOOKS_TUNING.errors.clipboardWrite).toBe('Failed to write to clipboard');
        });

        it('should have errors.clipboardRead', () => {
            expect(BROWSER_HOOKS_TUNING.errors.clipboardRead).toBe('Failed to read from clipboard');
        });

        it('should have errors.downloadFailed', () => {
            expect(BROWSER_HOOKS_TUNING.errors.downloadFailed).toBe('Download failed');
        });
    });

    describe('isClipboardAvailable', () => {
        it('should be a function', () => {
            expect(typeof isClipboardAvailable).toBe('function');
        });

        it('should return boolean', () => {
            const result = isClipboardAvailable();
            expect(typeof result).toBe('boolean');
        });
    });

    describe('mkClipboardError', () => {
        it('should create error with _tag ClipboardError', () => {
            const error = mkClipboardError('test message');
            expect(error._tag).toBe('ClipboardError');
        });

        it('should include provided message', () => {
            const error = mkClipboardError('custom error');
            expect(error.message).toBe('custom error');
        });
    });

    describe('mkDownloadError', () => {
        it('should create error with _tag DownloadError', () => {
            const error = mkDownloadError('test message');
            expect(error._tag).toBe('DownloadError');
        });

        it('should include provided message', () => {
            const error = mkDownloadError('custom error');
            expect(error.message).toBe('custom error');
        });
    });

    describe('createBrowserHooks', () => {
        it('should return frozen API object', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createBrowserHooks(runtimeApi);
            expect(Object.isFrozen(api)).toBe(true);
        });

        it('should have useClipboard property', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createBrowserHooks(runtimeApi);
            expect(typeof api.useClipboard).toBe('function');
        });

        it('should have useDownload property', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createBrowserHooks(runtimeApi);
            expect(typeof api.useDownload).toBe('function');
        });

        it('should accept timestampProvider config', () => {
            const runtimeApi = createRuntimeHooks();
            const customTs = () => 12345;
            const api = createBrowserHooks(runtimeApi, { timestampProvider: customTs });
            expect(Object.isFrozen(api)).toBe(true);
        });
    });
});
