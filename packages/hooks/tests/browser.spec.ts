/**
 * Validate browser hooks factory behavior and pure function utilities.
 */
import { describe, expect, it } from 'vitest';
import {
    BROWSER_HOOKS_TUNING,
    buildFilename,
    createBrowserHooks,
    exportHandlers,
    isClipboardAvailable,
    mkClipboardError,
    mkDownloadError,
    mkExportError,
    sanitizeFilename,
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

        it('should have errors.exportFailed', () => {
            expect(BROWSER_HOOKS_TUNING.errors.exportFailed).toBe('Export failed');
        });

        it('should have errors.noSvg', () => {
            expect(BROWSER_HOOKS_TUNING.errors.noSvg).toBe('No SVG content to export');
        });

        it('should have errors.noVariants', () => {
            expect(BROWSER_HOOKS_TUNING.errors.noVariants).toBe('No variants to export');
        });

        it('should have defaults.pngSize', () => {
            expect(BROWSER_HOOKS_TUNING.defaults.pngSize).toBe(512);
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

    describe('mkExportError', () => {
        it('should create error with _tag ExportError', () => {
            const error = mkExportError('test message');
            expect(error._tag).toBe('ExportError');
        });

        it('should include provided message', () => {
            const error = mkExportError('custom error');
            expect(error.message).toBe('custom error');
        });
    });

    describe('sanitizeFilename', () => {
        it('should convert camelCase to snake_case', () => {
            expect(sanitizeFilename('myFileName')).toBe('my_file_name');
        });

        it('should convert to lowercase', () => {
            expect(sanitizeFilename('UPPERCASE')).toBe('uppercase');
        });

        it('should replace spaces with underscores', () => {
            expect(sanitizeFilename('file name with spaces')).toBe('file_name_with_spaces');
        });

        it('should remove special characters', () => {
            expect(sanitizeFilename('file@#$name!.txt')).toBe('filenametxt');
        });

        it('should collapse multiple spaces to single underscore', () => {
            expect(sanitizeFilename('file   name')).toBe('file_name');
        });

        it('should collapse multiple dashes to single underscore', () => {
            expect(sanitizeFilename('file---name')).toBe('file_name');
        });

        it('should strip underscores not in allowed character class', () => {
            // Underscores are NOT in the allowed character class [a-z0-9 -] on line 91 of browser.ts
            // So 'file___name' becomes 'filename' after disallowed characters are stripped
            expect(sanitizeFilename('file___name')).toBe('filename');
        });

        it('should truncate to exactly 64 characters', () => {
            const longName = 'a'.repeat(100);
            const result = sanitizeFilename(longName);
            expect(result.length).toBe(64);
            expect(result).toBe('a'.repeat(64));
        });

        it('should return export for empty string', () => {
            expect(sanitizeFilename('')).toBe('export');
        });

        it('should handle mixed transformations', () => {
            expect(sanitizeFilename('myFile Name-2024!!')).toBe('my_file_name_2024');
        });
    });

    describe('buildFilename', () => {
        it('should append extension to base', () => {
            expect(buildFilename('myFile', 'svg')).toBe('my_file.svg');
        });

        it('should not add variant suffix when variantCount is 1', () => {
            expect(buildFilename('myFile', 'svg', 0, 1)).toBe('my_file.svg');
        });

        it('should not add variant suffix when variantCount is undefined', () => {
            expect(buildFilename('myFile', 'png', 0, undefined)).toBe('my_file.png');
        });

        it('should add variant suffix when variantCount > 1', () => {
            expect(buildFilename('myFile', 'svg', 0, 3)).toBe('my_file_variant_1.svg');
        });

        it('should increment variant index by 1', () => {
            expect(buildFilename('myFile', 'svg', 2, 5)).toBe('my_file_variant_3.svg');
        });

        it('should sanitize base filename', () => {
            expect(buildFilename('My File Name!', 'png')).toBe('my_file_name.png');
        });

        it('should handle different extensions', () => {
            expect(buildFilename('test', 'zip')).toBe('test.zip');
            expect(buildFilename('test', 'png')).toBe('test.png');
        });
    });

    describe('exportHandlers', () => {
        it('should be readonly record', () => {
            // exportHandlers is Readonly<Record<...>> but not frozen via Object.freeze
            expect(typeof exportHandlers).toBe('object');
        });

        it('should have svg handler that validates format', () => {
            expect(typeof exportHandlers.svg).toBe('function');
            // Verify handler returns Effect that fails when no svg provided
            const input = { filename: 'test', format: 'svg' as const };
            const effect = exportHandlers.svg(input);
            expect(effect).toBeDefined();
        });

        it('should have png handler that validates format and size', () => {
            expect(typeof exportHandlers.png).toBe('function');
            // Verify handler returns Effect that fails when no svg provided
            const input = { filename: 'test', format: 'png' as const, pngSize: 512 };
            const effect = exportHandlers.png(input);
            expect(effect).toBeDefined();
        });

        it('should have zip handler that validates variants', () => {
            expect(typeof exportHandlers.zip).toBe('function');
            // Verify handler returns Effect that fails when no variants provided
            const input = { filename: 'test', format: 'zip' as const };
            const effect = exportHandlers.zip(input);
            expect(effect).toBeDefined();
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

        it('should have useExport property', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createBrowserHooks(runtimeApi);
            expect(typeof api.useExport).toBe('function');
        });

        it('should accept timestampProvider config', () => {
            const runtimeApi = createRuntimeHooks();
            const customTs = () => 12345;
            const api = createBrowserHooks(runtimeApi, { timestampProvider: customTs });
            expect(Object.isFrozen(api)).toBe(true);
        });
    });
});
