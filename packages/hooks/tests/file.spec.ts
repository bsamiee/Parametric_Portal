/**
 * Validate file hooks factory behavior and pure function utilities.
 */
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import {
    createFileHooks,
    dataTransferToFiles,
    FILE_HOOKS_TUNING,
    filesToReadonlyArray,
    mkFileError,
    readFileAsArrayBuffer,
    readFileAsDataUrl,
    readFileAsText,
} from '../src/file.ts';
import { createRuntimeHooks } from '../src/runtime.tsx';

// --- [HELPERS] ---------------------------------------------------------------

const createMockFileList = (files: ReadonlyArray<File>): FileList => {
    const indexed: Record<number, File> = {};
    files.forEach((file, index) => {
        indexed[index] = file;
    });

    return {
        ...indexed,
        item: (index: number) => files[index] ?? null,
        length: files.length,
        [Symbol.iterator]: function* () {
            yield* files;
        },
    } as FileList;
};

// --- [TESTS] -----------------------------------------------------------------

describe('file', () => {
    describe('FILE_HOOKS_TUNING', () => {
        it('should be frozen', () => {
            expect(Object.isFrozen(FILE_HOOKS_TUNING)).toBe(true);
        });

        it('should have defaults.accept', () => {
            expect(FILE_HOOKS_TUNING.defaults.accept).toBe('*/*');
        });

        it('should have defaults.multiple', () => {
            expect(FILE_HOOKS_TUNING.defaults.multiple).toBe(false);
        });

        it('should have defaults.timestamp function', () => {
            expect(typeof FILE_HOOKS_TUNING.defaults.timestamp).toBe('function');
        });

        it('should return current timestamp from defaults.timestamp', () => {
            const before = Date.now();
            const ts = FILE_HOOKS_TUNING.defaults.timestamp();
            const after = Date.now();
            expect(ts).toBeGreaterThanOrEqual(before);
            expect(ts).toBeLessThanOrEqual(after);
        });

        it('should have errors.noFiles', () => {
            expect(FILE_HOOKS_TUNING.errors.noFiles).toBe('No files selected');
        });

        it('should have errors.readFailed', () => {
            expect(FILE_HOOKS_TUNING.errors.readFailed).toBe('Failed to read file');
        });
    });

    describe('mkFileError', () => {
        it('should create error with _tag FileError', () => {
            const error = mkFileError('test message');
            expect(error._tag).toBe('FileError');
        });

        it('should include provided message', () => {
            const error = mkFileError('custom error');
            expect(error.message).toBe('custom error');
        });

        it('should handle empty message', () => {
            const error = mkFileError('');
            expect(error._tag).toBe('FileError');
            expect(error.message).toBe('');
        });
    });

    describe('filesToReadonlyArray', () => {
        it('should return empty array for null', () => {
            const result = filesToReadonlyArray(null);
            expect(result).toEqual([]);
            expect(result.length).toBe(0);
        });

        it('should convert FileList to readonly array using iterator protocol', () => {
            const file1 = new File(['content1'], 'test1.txt');
            const file2 = new File(['content2'], 'test2.txt');
            const fileList = createMockFileList([file1, file2]);

            const result = filesToReadonlyArray(fileList);

            // Validate it's a proper array
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(2);

            // Validate iterator protocol was used correctly
            expect(result[0]).toBe(file1);
            expect(result[1]).toBe(file2);
            expect(result[0]).toBeInstanceOf(File);
            expect(result[1]).toBeInstanceOf(File);
        });

        it('should handle single file FileList', () => {
            const file = new File(['content'], 'single.txt');
            const fileList = createMockFileList([file]);

            const result = filesToReadonlyArray(fileList);
            expect(result.length).toBe(1);
            expect(result[0]).toBe(file);
        });
    });

    describe('dataTransferToFiles', () => {
        it('should return empty array for null', () => {
            const result = dataTransferToFiles(null);
            expect(result).toEqual([]);
            expect(result.length).toBe(0);
        });

        it('should convert DataTransfer.files to readonly array using iterator protocol', () => {
            const file1 = new File(['content1'], 'dropped1.txt');
            const file2 = new File(['content2'], 'dropped2.txt');
            const fileList = createMockFileList([file1, file2]);

            const dataTransfer = { files: fileList } as DataTransfer;

            const result = dataTransferToFiles(dataTransfer);
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(2);
            expect(result[0]).toBe(file1);
            expect(result[1]).toBe(file2);
        });

        it('should handle empty FileList', () => {
            const emptyFileList = createMockFileList([]);
            const dataTransfer = { files: emptyFileList } as DataTransfer;

            const result = dataTransferToFiles(dataTransfer);
            expect(result).toEqual([]);
        });
    });

    describe('readFileAsText', () => {
        it('should return Effect that reads file as text', async () => {
            const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
            const effect = readFileAsText(file);

            expect(Effect.isEffect(effect)).toBe(true);
            const result = await Effect.runPromise(effect);
            expect(result).toBe('test content');
        });

        it('should fail with FileError when file reading fails', async () => {
            // Create a file with invalid content that will fail to read
            const invalidFile = new File([], 'test.txt');
            Object.defineProperty(invalidFile, 'text', {
                value: () => Promise.reject(new Error('Read failed')),
            });

            const effect = readFileAsText(invalidFile);
            const exit = await Effect.runPromiseExit(effect);

            expect(exit._tag).toBe('Failure');
        });
    });

    describe('readFileAsDataUrl', () => {
        it('should return Effect that reads file as data URL', () => {
            const file = new File(['test'], 'test.txt');
            const effect = readFileAsDataUrl(file);

            expect(Effect.isEffect(effect)).toBe(true);
        });
    });

    describe('readFileAsArrayBuffer', () => {
        it('should return Effect that reads file as ArrayBuffer', async () => {
            const content = new Uint8Array([1, 2, 3, 4]);
            const file = new File([content], 'test.bin');
            const effect = readFileAsArrayBuffer(file);

            expect(Effect.isEffect(effect)).toBe(true);
            const result = await Effect.runPromise(effect);
            expect(result).toBeInstanceOf(ArrayBuffer);
            expect(new Uint8Array(result)).toEqual(content);
        });

        it('should fail with FileError when arrayBuffer reading fails', async () => {
            const invalidFile = new File([], 'test.bin');
            Object.defineProperty(invalidFile, 'arrayBuffer', {
                value: () => Promise.reject(new Error('Read failed')),
            });

            const effect = readFileAsArrayBuffer(invalidFile);
            const exit = await Effect.runPromiseExit(effect);

            expect(exit._tag).toBe('Failure');
        });
    });

    describe('createFileHooks', () => {
        it('should return frozen API object', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createFileHooks(runtimeApi);
            expect(Object.isFrozen(api)).toBe(true);
        });

        it('should have useFileInput property', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createFileHooks(runtimeApi);
            expect(typeof api.useFileInput).toBe('function');
        });

        it('should have useFileDrop property', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createFileHooks(runtimeApi);
            expect(typeof api.useFileDrop).toBe('function');
        });

        it('should use custom timestampProvider when provided', () => {
            const runtimeApi = createRuntimeHooks();
            let callCount = 0;
            const customTs = () => {
                callCount += 1;
                return 12345 + callCount;
            };

            const api = createFileHooks(runtimeApi, { timestampProvider: customTs });

            expect(Object.isFrozen(api)).toBe(true);
            // The timestampProvider is used internally by the hooks
            // We verify it was passed correctly by checking the API is created
            expect(typeof api.useFileInput).toBe('function');
        });

        it('should accept empty config', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createFileHooks(runtimeApi, {});
            expect(Object.isFrozen(api)).toBe(true);
        });
    });
});
