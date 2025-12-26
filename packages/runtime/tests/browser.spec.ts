/**
 * Browser utility tests: pure functions for filename sanitization, error factories, clipboard detection.
 */
import { fc, it as itProp } from '@fast-check/vitest';
import { FC_ARB } from '@parametric-portal/test-utils/arbitraries';
import { TEST_CONSTANTS } from '@parametric-portal/test-utils/constants';
import '@parametric-portal/test-utils/harness';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';
import {
    BROWSER_TUNING,
    buildFilename,
    exportHandlers,
    isClipboardAvailable,
    mkClipboardError,
    mkDownloadError,
    mkExportError,
    sanitizeFilename,
} from '../src/hooks/browser';

// Note: Browser mode uses real navigator.clipboard - no stubbing needed
// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    samples: {
        camelCase: ['myFileName', 'camelCaseTest', 'XMLParser', 'HTMLElement'] as const,
        invalidChars: ['file@name', 'test#file', 'name$here', 'file%20name'] as const,
        spaces: ['my file name', '  leading', 'trailing  ', '  both  '] as const,
    },
} as const);

// --- [DESCRIBE] BROWSER_TUNING -----------------------------------------------

describe('BROWSER_TUNING', () => {
    it('is frozen with correct structure', () => {
        expect(Object.isFrozen(BROWSER_TUNING)).toBe(true);
        expect(BROWSER_TUNING.defaults).toEqual({ mimeType: 'text/plain', pngSize: 512 });
    });
    it('contains error definitions', () => {
        expect(BROWSER_TUNING.errors.clipboardRead).toBeDefined();
        expect(BROWSER_TUNING.errors.clipboardWrite).toBeDefined();
        expect(BROWSER_TUNING.errors.downloadFailed).toBeDefined();
        expect(BROWSER_TUNING.errors.exportFailed).toBeDefined();
    });
});

// --- [DESCRIBE] sanitizeFilename ---------------------------------------------

describe('sanitizeFilename', () => {
    itProp.prop([FC_ARB.safeFilename()])('returns non-empty string', (input) => {
        const result = sanitizeFilename(input);
        expect(result.length).toBeGreaterThan(0);
        expect(result.length).toBeLessThanOrEqual(64);
    });
    itProp.prop([FC_ARB.filename()])('output contains only safe characters', (input) => {
        const result = sanitizeFilename(input);
        expect(/^[a-z0-9_]*$/.test(result) || result === 'export').toBe(true);
    });
    it.each(B.samples.camelCase)('converts camelCase: %s', (input) => {
        const result = sanitizeFilename(input);
        expect(result).not.toMatch(/[A-Z]/);
        expect(result.includes('_')).toBe(true);
    });
    it.each(B.samples.spaces)('replaces spaces with underscores: "%s"', (input) => {
        const result = sanitizeFilename(input);
        expect(result).not.toContain(' ');
    });
    it.each(B.samples.invalidChars)('strips invalid characters: %s', (input) => {
        const result = sanitizeFilename(input);
        expect(result).not.toMatch(/[@#$%]/);
    });
    it('returns "export" for empty string', () => expect(sanitizeFilename('')).toBe('export'));
    it('returns "export" for only special chars', () => expect(sanitizeFilename('@#$%')).toBe('export'));
    it('truncates to 64 characters', () => {
        const longInput = 'a'.repeat(100);
        expect(sanitizeFilename(longInput).length).toBeLessThanOrEqual(64);
    });
    it('normalizes multiple underscores', () => {
        const result = sanitizeFilename('test___file___name');
        expect(result).not.toMatch(/_+_/);
    });
    it('normalizes hyphens to underscores', () => {
        const result = sanitizeFilename('test-file-name');
        expect(result).toBe('test_file_name');
    });
});

// --- [DESCRIBE] buildFilename ------------------------------------------------

describe('buildFilename', () => {
    itProp.prop([FC_ARB.safeFilename(), FC_ARB.fileExtension()])('builds simple filename', (base, ext) => {
        const result = buildFilename(base, ext);
        expect(result.endsWith(`.${ext}`)).toBe(true);
    });
    itProp.prop([FC_ARB.safeFilename(), FC_ARB.fileExtension(), FC_ARB.variantIndex(), FC_ARB.variantCount()])(
        'builds variant filename when count > 1',
        (base, ext, idx, count) => {
            fc.pre(count > 1 && idx < count);
            const result = buildFilename(base, ext, idx, count);
            expect(result.includes('_variant_')).toBe(true);
            expect(result.endsWith(`.${ext}`)).toBe(true);
        },
    );
    itProp.prop([FC_ARB.variantIndex(), FC_ARB.variantCount()])('variant index is 1-based in output', (idx, count) => {
        fc.pre(count > 1 && idx < count);
        const result = buildFilename('test', 'png', idx, count);
        expect(result).toContain(`_variant_${idx + 1}`);
    });
    it('omits variant suffix when count is 1', () => {
        const result = buildFilename('test', 'svg', 0, 1);
        expect(result).not.toContain('_variant_');
    });
    it('omits variant suffix when count is undefined', () => {
        const result = buildFilename('test', 'png');
        expect(result).not.toContain('_variant_');
    });
    it('includes 1-based variant index', () => {
        const result = buildFilename('icon', 'svg', 0, 3);
        expect(result).toContain('_variant_1');
    });
    it('sanitizes base filename', () => {
        const result = buildFilename('My Icon File', 'png');
        expect(result).not.toContain(' ');
        expect(result.endsWith('.png')).toBe(true);
    });
});

// --- [DISPATCH_TABLES] -------------------------------------------------------

const errorFactoryTests = [
    { def: TEST_CONSTANTS.errors.clipboardRead, factory: mkClipboardError, tag: 'ClipboardError' },
    { def: TEST_CONSTANTS.errors.downloadFailed, factory: mkDownloadError, tag: 'DownloadError' },
    { def: TEST_CONSTANTS.errors.exportFailed, factory: mkExportError, tag: 'ExportError' },
] as const;

// --- [DESCRIBE] error factories ----------------------------------------------

describe('error factories', () => {
    it.each(errorFactoryTests)('$tag creates error with correct _tag, code, and stack', ({ def, factory, tag }) => {
        const error = factory(def);
        expect(error._tag).toBe(tag);
        expect(error.code).toBe(def.code);
        expect(error.message).toBe(def.message);
        expect(error).toBeInstanceOf(Error);
        expect(error.stack).toBeDefined();
    });
});

// --- [DESCRIBE] isClipboardAvailable -----------------------------------------

describe('isClipboardAvailable', () => {
    it('returns boolean indicating clipboard API availability', () => {
        const result = isClipboardAvailable();
        expect(typeof result).toBe('boolean');
        // In browser mode, clipboard is typically available
        expect(result).toBe(typeof navigator !== 'undefined' && 'clipboard' in navigator);
    });
});

// --- [DESCRIBE] exportHandlers -----------------------------------------------

describe('exportHandlers', () => {
    it('is frozen dispatch table with all format handlers', () => {
        expect(Object.isFrozen(exportHandlers)).toBe(true);
        expect(Object.keys(exportHandlers).sort((a, b) => a.localeCompare(b))).toEqual(['png', 'svg', 'zip']);
    });
    it.each(['png', 'svg', 'zip'] as const)('%s handler returns Effect (fails without DOM)', (format) => {
        const effect = exportHandlers[format]({ format });
        const result = Effect.runSyncExit(effect);
        expect(Exit.isExit(result)).toBe(true);
        expect(result).toBeFailure();
    });
});
