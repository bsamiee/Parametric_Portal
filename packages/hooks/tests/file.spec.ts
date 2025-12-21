/**
 * Validate file hooks factory behavior and pure function utilities.
 */
import { describe, expect, it } from 'vitest';
import {
    createFileHooks,
    dataTransferToFiles,
    FILE_HOOKS_TUNING,
    filesToReadonlyArray,
    mkFileError,
} from '../src/file.ts';
import { createRuntimeHooks } from '../src/runtime.tsx';

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

        it('should convert FileList to readonly array', () => {
            const fileList = {
                0: new File(['content'], 'test.txt'),
                item: (index: number) => (index === 0 ? new File(['content'], 'test.txt') : null),
                length: 1,
                [Symbol.iterator]: function* () {
                    yield new File(['content'], 'test.txt');
                },
            } as FileList;

            const result = filesToReadonlyArray(fileList);
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(1);
            expect(result[0]).toBeInstanceOf(File);
        });
    });

    describe('dataTransferToFiles', () => {
        it('should return empty array for null', () => {
            const result = dataTransferToFiles(null);
            expect(result).toEqual([]);
            expect(result.length).toBe(0);
        });

        it('should convert DataTransfer.files to readonly array', () => {
            const fileList = {
                0: new File(['content'], 'dropped.txt'),
                item: (index: number) => (index === 0 ? new File(['content'], 'dropped.txt') : null),
                length: 1,
                [Symbol.iterator]: function* () {
                    yield new File(['content'], 'dropped.txt');
                },
            } as FileList;

            const dataTransfer = {
                files: fileList,
            } as DataTransfer;

            const result = dataTransferToFiles(dataTransfer);
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(1);
            expect(result[0]).toBeInstanceOf(File);
        });

        it('should handle empty FileList', () => {
            const emptyFileList = {
                item: () => null,
                length: 0,
                [Symbol.iterator]: function* () {},
            } as FileList;

            const dataTransfer = {
                files: emptyFileList,
            } as DataTransfer;

            const result = dataTransferToFiles(dataTransfer);
            expect(result).toEqual([]);
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

        it('should accept timestampProvider config', () => {
            const runtimeApi = createRuntimeHooks();
            const customTs = () => 12345;
            const api = createFileHooks(runtimeApi, { timestampProvider: customTs });
            expect(Object.isFrozen(api)).toBe(true);
        });

        it('should accept empty config', () => {
            const runtimeApi = createRuntimeHooks();
            const api = createFileHooks(runtimeApi, {});
            expect(Object.isFrozen(api)).toBe(true);
        });
    });
});
