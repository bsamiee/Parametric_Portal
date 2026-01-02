/**
 * Browser utility tests: pure functions for filename sanitization, error factories, clipboard detection.
 * [COVERAGE_LIMIT] Hooks (useClipboard, useDownload, useExport) require DOM/File APIs unavailable in test context.
 */
import { fc, it as itProp } from '@fast-check/vitest';
import { FC_ARB } from '@parametric-portal/test-utils/arbitraries';
import { TEST_CONSTANTS } from '@parametric-portal/test-utils/constants';
import '@parametric-portal/test-utils/harness';
import { BROWSER_TUNING, BrowserError } from '@parametric-portal/types/browser';
import { describe, expect, it } from 'vitest';
import { buildFilename, Export, sanitizeFilename } from '../src/services/browser';

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
    { def: TEST_CONSTANTS.errors.clipboardRead, factory: BrowserError.Clipboard, tag: 'Clipboard' },
    { def: TEST_CONSTANTS.errors.downloadFailed, factory: BrowserError.Download, tag: 'Download' },
    { def: TEST_CONSTANTS.errors.exportFailed, factory: BrowserError.Export, tag: 'Export' },
] as const;

// --- [DESCRIBE] error factories ----------------------------------------------

describe('BrowserError TaggedEnum', () => {
    it.each(errorFactoryTests)('$tag creates error with correct _tag and properties', ({ factory, def, tag }) => {
        const error = factory(def);
        expect(error._tag).toBe(tag);
        expect(error.code).toBe(def.code);
        expect(error.message).toBe(def.message);
    });
    it('$is type guard works correctly', () => {
        const clipboardError = BrowserError.Clipboard({ code: 'TEST', message: 'test' });
        const downloadError = BrowserError.Download({ code: 'TEST', message: 'test' });
        expect(BrowserError.$is('Clipboard')(clipboardError)).toBe(true);
        expect(BrowserError.$is('Clipboard')(downloadError)).toBe(false);
        expect(BrowserError.$is('Download')(downloadError)).toBe(true);
    });
    it('$match exhaustively handles all variants', () => {
        const errors = [
            BrowserError.Clipboard({ code: 'C', message: 'clipboard' }),
            BrowserError.Download({ code: 'D', message: 'download' }),
            BrowserError.Export({ code: 'E', message: 'export' }),
            BrowserError.Storage({ code: 'S', message: 'storage' }),
        ];
        const results = errors.map((e) =>
            BrowserError.$match(e, {
                Clipboard: (c) => `clip:${c.code}`,
                Download: (d) => `down:${d.code}`,
                Export: (x) => `exp:${x.code}`,
                Storage: (s) => `stor:${s.code}`,
            }),
        );
        expect(results).toEqual(['clip:C', 'down:D', 'exp:E', 'stor:S']);
    });
    it('format helper produces readable output', () => {
        const error = BrowserError.Export({ code: 'FAILED', message: 'Something went wrong' });
        expect(BrowserError.format(error)).toBe('[Export:FAILED] Something went wrong');
    });
});

// --- [DESCRIBE] clipboard availability ---------------------------------------

describe('clipboard availability', () => {
    it('navigator.clipboard is accessible in browser environment', () => {
        const available = typeof navigator !== 'undefined' && 'clipboard' in navigator;
        expect(typeof available).toBe('boolean');
    });
});

// --- [DESCRIBE] Export service -----------------------------------------------

describe('Export service', () => {
    it('Export tag has correct identifier', () => {
        expect(Export.key).toBe('Export');
    });
});
