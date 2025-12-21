/**
 * Validate file validation logic via property-based testing.
 */
import { it } from '@fast-check/vitest';
import { Effect } from 'effect';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import { FILES_TUNING, files } from '../src/files.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const loadApi = () => files();

const createMockFile = (props: {
    readonly lastModified?: number;
    readonly name?: string;
    readonly size?: number;
    readonly type?: string;
}): File => {
    const blob = new Blob(['<svg></svg>'], { type: props.type ?? 'image/svg+xml' });
    const file = new File([blob], props.name ?? 'test.svg', {
        lastModified: props.lastModified ?? Date.now(),
        type: props.type ?? 'image/svg+xml',
    });
    Object.defineProperty(file, 'size', { value: props.size ?? blob.size });
    return file;
};

// --- [TESTS] -----------------------------------------------------------------

describe('files package', () => {
    describe('api surface', () => {
        it('returns frozen api object', () => {
            const api = loadApi();
            expect(Object.isFrozen(api)).toBe(true);
            expect(api.validateFile).toBeDefined();
            expect(api.validateSvgContent).toBeDefined();
            expect(api.mkFileError).toBeDefined();
        });

        it('exposes tuning constants', () => {
            expect(Object.isFrozen(FILES_TUNING)).toBe(true);
            expect(FILES_TUNING.limits.maxSizeBytes).toBe(512 * 1024);
            expect(FILES_TUNING.mimeTypes).toContain('image/svg+xml');
        });
    });

    describe('file validation', () => {
        it.prop([fc.string({ maxLength: 50, minLength: 1 }), fc.integer({ max: 512 * 1024, min: 1 })])(
            'validates valid svg file',
            (name, size) => {
                const api = loadApi();
                const file = createMockFile({ name: `${name}.svg`, size, type: 'image/svg+xml' });
                const result = Effect.runSync(api.validateFile(file));
                expect(result.name).toBe(`${name}.svg`);
                expect(result.size).toBe(size);
                expect(result.mimeType).toBe('image/svg+xml');
            },
        );

        it('rejects empty file', () => {
            const api = loadApi();
            const file = createMockFile({ size: 0 });
            const result = Effect.runSyncExit(api.validateFile(file));
            expect(result._tag).toBe('Failure');
        });

        it('rejects file exceeding size limit', () => {
            const api = loadApi();
            const file = createMockFile({ size: FILES_TUNING.limits.maxSizeBytes + 1 });
            const result = Effect.runSyncExit(api.validateFile(file));
            expect(result._tag).toBe('Failure');
        });

        it('rejects invalid mime type', () => {
            const api = loadApi();
            const file = createMockFile({ type: 'image/png' });
            const result = Effect.runSyncExit(api.validateFile(file));
            expect(result._tag).toBe('Failure');
        });

        it.prop([fc.integer({ max: 1024 * 1024, min: 1 })])('accepts custom size limit', (customLimit) => {
            const api = loadApi();
            const file = createMockFile({ size: customLimit });
            const result = Effect.runSync(api.validateFile(file, customLimit));
            expect(result.size).toBe(customLimit);
        });
    });

    describe('svg content validation', () => {
        it.prop([fc.string()])('validates content with svg tag', (content) => {
            const api = loadApi();
            const svgContent = `${content}<svg>${content}</svg>${content}`;
            const result = Effect.runSync(api.validateSvgContent(svgContent));
            expect(result).toBe(svgContent);
        });

        it.prop([fc.string().filter((s) => !s.includes('<svg'))])('rejects content without svg tag', (content) => {
            const api = loadApi();
            const result = Effect.runSyncExit(api.validateSvgContent(content));
            expect(result._tag).toBe('Failure');
        });
    });

    describe('error creation', () => {
        it.prop([fc.string(), fc.string()])('creates file error', (code, message) => {
            const api = loadApi();
            const error = api.mkFileError(code, message);
            expect(error._tag).toBe('FileError');
            expect(error.code).toBe(code);
            expect(error.message).toBe(message);
        });
    });

    describe('schema validation', () => {
        it('exposes metadata schema', () => {
            const api = loadApi();
            expect(api.schemas.fileMetadata).toBeDefined();
            expect(api.schemas.svgContent).toBeDefined();
            expect(api.schemas.svgFile).toBeDefined();
        });
    });

    describe('error codes', () => {
        it('provides standard error codes', () => {
            const api = loadApi();
            expect(api.errors.empty.code).toBe('FILE_EMPTY');
            expect(api.errors.invalidType.code).toBe('INVALID_TYPE');
            expect(api.errors.tooLarge.code).toBe('FILE_TOO_LARGE');
            expect(api.errors.readFailed.code).toBe('READ_FAILED');
        });
    });
});
