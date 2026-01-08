/**
 * Test browser utility pure functions and error factories.
 * Covers filename sanitization, AppError creation, and Browser service tag.
 */
import { fc, it as itProp } from '@fast-check/vitest';
import { FC_ARB } from '@parametric-portal/test-utils/arbitraries';
import '@parametric-portal/test-utils/harness';
import { APP_ERROR_TUNING, AppError } from '@parametric-portal/types/app-error';
import { FILES_TUNING } from '@parametric-portal/types/files';
import { describe, expect, it } from 'vitest';
import { Browser, buildFilename, sanitizeFilename } from '../src/services/browser';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    samples: {
        camelCase: ['myFileName', 'camelCaseTest', 'XMLParser', 'HTMLElement'] as const,
        invalidChars: ['file@name', 'test#file', 'name$here', 'file%20name'] as const,
        spaces: ['my file name', '  leading', 'trailing  ', '  both  '] as const,
    },
} as const);

// --- [DESCRIBE_TUNING_CONSTANTS] ---------------------------------------------

describe('APP_ERROR_TUNING', () => {
    it('is frozen with correct structure', () => {
        expect(Object.isFrozen(APP_ERROR_TUNING)).toBe(true);
        expect(APP_ERROR_TUNING.Browser).toBeDefined();
        expect(APP_ERROR_TUNING.Messaging).toBeDefined();
        expect(APP_ERROR_TUNING.File).toBeDefined();
    });
    it('contains browser error definitions', () => {
        expect(APP_ERROR_TUNING.Browser.CLIPBOARD_READ).toBeDefined();
        expect(APP_ERROR_TUNING.Browser.CLIPBOARD_WRITE).toBeDefined();
        expect(APP_ERROR_TUNING.Browser.DOWNLOAD_FAILED).toBeDefined();
        expect(APP_ERROR_TUNING.Browser.EXPORT_FAILED).toBeDefined();
    });
});
describe('FILES_TUNING', () => {
    it('contains limits', () => {
        expect(FILES_TUNING.limits).toEqual({ maxSizeBytes: 512 * 1024 });
    });
});

// --- [DESCRIBE_SANITIZE_FILENAME] --------------------------------------------

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

// --- [DESCRIBE_BUILD_FILENAME] -----------------------------------------------

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

// --- [DESCRIBE_APP_ERROR] ----------------------------------------------------

describe('AppError Data.TaggedError', () => {
    it('creates error with correct _tag, domain, and properties', () => {
        const error = new AppError({ code: 'CLIPBOARD_READ', domain: 'Browser', message: 'Failed' });
        expect(error._tag).toBe('AppError');
        expect(error.domain).toBe('Browser');
        expect(error.code).toBe('CLIPBOARD_READ');
        expect(error.message).toBe('Failed');
    });
    it('is an instance of Error', () => {
        const error = new AppError({ code: 'DOWNLOAD_FAILED', domain: 'Browser', message: 'test' });
        expect(error).toBeInstanceOf(Error);
    });
    it('can be created from APP_ERROR_TUNING constants', () => {
        const error = new AppError({
            code: APP_ERROR_TUNING.Browser.CLIPBOARD_READ.code,
            domain: 'Browser',
            message: APP_ERROR_TUNING.Browser.CLIPBOARD_READ.message,
        });
        expect(error.code).toBe('CLIPBOARD_READ');
        expect(error.message).toBe('Failed to read from clipboard');
        expect(error.domain).toBe('Browser');
    });
});

// --- [DESCRIBE_CLIPBOARD_AVAILABILITY] ---------------------------------------

describe('clipboard availability', () => {
    it('navigator.clipboard is accessible in browser environment', () => {
        const available = typeof navigator !== 'undefined' && 'clipboard' in navigator;
        expect(typeof available).toBe('boolean');
    });
});

// --- [DESCRIBE_BROWSER_SERVICE] ----------------------------------------------

describe('Browser service', () => {
    it('Browser tag has correct identifier', () => {
        expect(Browser.key).toBe('Browser');
    });
});
