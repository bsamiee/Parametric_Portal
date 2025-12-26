/**
 * File hook tests: FileOps pure functions, fiber interruption, async state transitions.
 */
import { it as itProp } from '@fast-check/vitest';
import { Effect } from 'effect';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FILE_TUNING, FileOps, interruptFiber } from '../src/hooks/file';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    fileContent: 'Hello, World!',
    fileName: 'test.txt',
    mimeType: 'text/plain',
    samples: {
        arrayBuffer: new ArrayBuffer(8),
        dataUrl: 'data:text/plain;base64,SGVsbG8sIFdvcmxkIQ==',
        text: 'Sample file content',
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const createMockFile = (content: string, name: string, type: string): File => new File([content], name, { type });
const createMockFileList = (files: File[]): FileList => {
    const dt = new DataTransfer();
    files.forEach((f) => {
        dt.items.add(f);
    });
    return dt.files;
};
const createMockDataTransfer = (files: File[]): DataTransfer => {
    const dt = new DataTransfer();
    files.forEach((f) => {
        dt.items.add(f);
    });
    return dt;
};

// --- [DESCRIBE] FILE_TUNING --------------------------------------------------

describe('FILE_TUNING', () => {
    it('is frozen with correct structure', () => {
        expect(Object.isFrozen(FILE_TUNING)).toBe(true);
        expect(FILE_TUNING.defaults).toEqual({ accept: '*/*', multiple: false });
    });
    it('has error definitions', () => {
        expect(FILE_TUNING.errors.empty).toEqual({ code: 'FILE_EMPTY', message: 'No files selected' });
        expect(FILE_TUNING.errors.readFailed).toEqual({ code: 'READ_FAILED', message: 'Failed to read file' });
    });
    it('defaults.accept is wildcard', () => expect(FILE_TUNING.defaults.accept).toBe('*/*'));
    it('defaults.multiple is false', () => expect(FILE_TUNING.defaults.multiple).toBe(false));
});

// --- [DESCRIBE] FileOps.fromFileList -----------------------------------------

describe('FileOps.fromFileList', () => {
    it('returns empty array for null', () => {
        expect(FileOps.fromFileList(null)).toEqual([]);
    });
    it('returns empty array for empty FileList', () => {
        const fileList = createMockFileList([]);
        expect(FileOps.fromFileList(fileList)).toEqual([]);
    });
    it('converts FileList to readonly array', () => {
        const file = createMockFile(B.fileContent, B.fileName, B.mimeType);
        const fileList = createMockFileList([file]);
        const result = FileOps.fromFileList(fileList);
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(file);
    });
    itProp.prop([fc.integer({ max: 5, min: 1 })])('preserves file count', (count) => {
        const files = Array.from({ length: count }, (_, i) =>
            createMockFile(`content-${i}`, `file-${i}.txt`, B.mimeType),
        );
        const fileList = createMockFileList(files);
        expect(FileOps.fromFileList(fileList)).toHaveLength(count);
    });
    it('preserves file order', () => {
        const files = ['a.txt', 'b.txt', 'c.txt'].map((name) => createMockFile('', name, B.mimeType));
        const fileList = createMockFileList(files);
        const result = FileOps.fromFileList(fileList);
        expect(result.map((f) => f.name)).toEqual(['a.txt', 'b.txt', 'c.txt']);
    });
});

// --- [DESCRIBE] FileOps.fromDataTransfer -------------------------------------

describe('FileOps.fromDataTransfer', () => {
    it('returns empty array for null', () => {
        expect(FileOps.fromDataTransfer(null)).toEqual([]);
    });
    it('returns empty array for empty DataTransfer', () => {
        const dt = createMockDataTransfer([]);
        expect(FileOps.fromDataTransfer(dt)).toEqual([]);
    });
    it('extracts files from DataTransfer', () => {
        const file = createMockFile(B.fileContent, B.fileName, B.mimeType);
        const dt = createMockDataTransfer([file]);
        const result = FileOps.fromDataTransfer(dt);
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(file);
    });
    itProp.prop([fc.integer({ max: 5, min: 1 })])('preserves file count from drop', (count) => {
        const files = Array.from({ length: count }, (_, i) =>
            createMockFile(`content-${i}`, `file-${i}.txt`, B.mimeType),
        );
        const dt = createMockDataTransfer(files);
        expect(FileOps.fromDataTransfer(dt)).toHaveLength(count);
    });
});

// --- [DESCRIBE] FileOps.text -------------------------------------------------

describe('FileOps.text', () => {
    it('reads file text content', async () => {
        const file = createMockFile(B.samples.text, B.fileName, B.mimeType);
        const result = await Effect.runPromise(FileOps.text(file));
        expect(result).toBe(B.samples.text);
    });
    itProp.prop([fc.string({ maxLength: 100, minLength: 1 })])('reads arbitrary text', async (content) => {
        const file = createMockFile(content, 'test.txt', 'text/plain');
        const result = await Effect.runPromise(FileOps.text(file));
        expect(result).toBe(content);
    });
    it('reads empty file', async () => {
        const file = createMockFile('', 'empty.txt', B.mimeType);
        const result = await Effect.runPromise(FileOps.text(file));
        expect(result).toBe('');
    });
    it('reads unicode content', async () => {
        const unicode = '你好世界 🌍 مرحبا';
        const file = createMockFile(unicode, 'unicode.txt', 'text/plain; charset=utf-8');
        const result = await Effect.runPromise(FileOps.text(file));
        expect(result).toBe(unicode);
    });
});

// --- [DESCRIBE] FileOps.readAsArrayBuffer ------------------------------------

describe('FileOps.readAsArrayBuffer', () => {
    it('reads file as ArrayBuffer', async () => {
        const file = createMockFile(B.fileContent, B.fileName, B.mimeType);
        const result = await Effect.runPromise(FileOps.readAsArrayBuffer(file));
        expect(result).toBeInstanceOf(ArrayBuffer);
        expect(result.byteLength).toBe(B.fileContent.length);
    });
    itProp.prop([fc.string({ maxLength: 100, minLength: 1 })])('buffer length matches content', async (content) => {
        const file = createMockFile(content, 'test.txt', B.mimeType);
        const result = await Effect.runPromise(FileOps.readAsArrayBuffer(file));
        expect(result.byteLength).toBe(new Blob([content]).size);
    });
    it('reads empty file as empty buffer', async () => {
        const file = createMockFile('', 'empty.txt', B.mimeType);
        const result = await Effect.runPromise(FileOps.readAsArrayBuffer(file));
        expect(result.byteLength).toBe(0);
    });
});

// --- [DESCRIBE] FileOps.readAsDataUrl ----------------------------------------

describe('FileOps.readAsDataUrl', () => {
    it('reads file as data URL', async () => {
        const file = createMockFile(B.fileContent, B.fileName, B.mimeType);
        const result = await Effect.runPromise(FileOps.readAsDataUrl(file));
        expect(result).toMatch(/^data:/);
        expect(result).toContain('base64');
    });
    it('data URL contains correct mime type prefix', async () => {
        const file = createMockFile('test', 'test.txt', 'text/plain');
        const result = await Effect.runPromise(FileOps.readAsDataUrl(file));
        expect(result.startsWith('data:text/plain')).toBe(true);
    });
    it('handles binary content', async () => {
        const binaryContent = String.fromCharCode(0, 1, 2, 255);
        const file = createMockFile(binaryContent, 'binary.bin', 'application/octet-stream');
        const result = await Effect.runPromise(FileOps.readAsDataUrl(file));
        expect(result).toMatch(/^data:application\/octet-stream;base64,/);
    });
    itProp.prop([fc.string({ maxLength: 50, minLength: 1 })])('produces valid data URL', async (content) => {
        const file = createMockFile(content, 'test.txt', B.mimeType);
        const result = await Effect.runPromise(FileOps.readAsDataUrl(file));
        expect(result).toMatch(/^data:[^;]+;base64,.+$/);
    });
});

// --- [DESCRIBE] interruptFiber -----------------------------------------------

describe('interruptFiber', () => {
    it('returns cleanup function', () => {
        // biome-ignore lint/suspicious/noExplicitAny: mock runtime for testing
        const mockRuntime = { runFork: () => ({}) } as any;
        // biome-ignore lint/suspicious/noExplicitAny: mock fiber for testing
        const mockFiber = {} as any;
        const cleanup = interruptFiber(mockRuntime, mockFiber);
        expect(typeof cleanup).toBe('function');
    });
    it('calls runtime.runFork on cleanup', () => {
        const callTracker = { forkCalled: false };
        const mockRuntime = {
            runFork: () => {
                callTracker.forkCalled = true;
                return {};
            },
            // biome-ignore lint/suspicious/noExplicitAny: mock runtime for testing
        } as any;
        // biome-ignore lint/suspicious/noExplicitAny: mock fiber for testing
        const mockFiber = {} as any;
        const cleanup = interruptFiber(mockRuntime, mockFiber);
        cleanup();
        expect(callTracker.forkCalled).toBe(true);
    });
});

// --- [DESCRIBE] file type detection ------------------------------------------

describe('file type detection', () => {
    const mimeTypes = [
        ['image/png', '.png'],
        ['image/jpeg', '.jpg'],
        ['application/pdf', '.pdf'],
        ['text/csv', '.csv'],
        ['application/json', '.json'],
    ] as const;
    it.each(mimeTypes)('preserves mime type %s for %s files', async (mime, ext) => {
        const file = createMockFile('content', `test${ext}`, mime);
        expect(file.type).toBe(mime);
    });
});

// --- [DESCRIBE] edge cases ---------------------------------------------------

describe('edge cases', () => {
    it('handles file with no extension', async () => {
        const file = createMockFile('content', 'noextension', B.mimeType);
        const result = await Effect.runPromise(FileOps.text(file));
        expect(result).toBe('content');
    });
    it('handles file with multiple dots in name', async () => {
        const file = createMockFile('content', 'file.backup.2024.txt', B.mimeType);
        expect(file.name).toBe('file.backup.2024.txt');
        const result = await Effect.runPromise(FileOps.text(file));
        expect(result).toBe('content');
    });
    it('handles large file content', async () => {
        const largeContent = 'x'.repeat(10000);
        const file = createMockFile(largeContent, 'large.txt', B.mimeType);
        const result = await Effect.runPromise(FileOps.text(file));
        expect(result.length).toBe(10000);
    });
    it('handles special characters in filename', async () => {
        const file = createMockFile('content', 'file (1) [copy].txt', B.mimeType);
        expect(file.name).toBe('file (1) [copy].txt');
    });
});

// --- [DESCRIBE] FileOps frozen -----------------------------------------------

describe('FileOps', () => {
    it('is frozen object', () => expect(Object.isFrozen(FileOps)).toBe(true));
    it('has all required methods', () => {
        expect(typeof FileOps.fromDataTransfer).toBe('function');
        expect(typeof FileOps.fromFileList).toBe('function');
        expect(typeof FileOps.readAsArrayBuffer).toBe('function');
        expect(typeof FileOps.readAsDataUrl).toBe('function');
        expect(typeof FileOps.text).toBe('function');
    });
});
