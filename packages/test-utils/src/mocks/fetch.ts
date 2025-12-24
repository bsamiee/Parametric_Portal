/**
 * Fetch mock utilities: type-safe mock factories for HTTP testing.
 */
import { Effect, pipe } from 'effect';
import { vi } from 'vitest';

// --- [TYPES] -----------------------------------------------------------------

type ResponseType = 'blob' | 'error' | 'json' | 'text';
type MockResponseInit = {
    readonly headers?: Record<string, string>;
    readonly status?: number;
    readonly statusText?: string;
};
type MockFetchOptions = {
    readonly blob?: Blob;
    readonly error?: Error;
    readonly init?: MockResponseInit;
    readonly json?: unknown;
    readonly text?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: { headers: { 'Content-Type': 'application/json' }, status: 200, statusText: 'OK' },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const FetchMock = Object.freeze({
    create: (options: MockFetchOptions): typeof fetch => {
        const mockFn = vi.fn<typeof fetch>();
        const responseType = FetchMock.getResponseType(options);
        FetchMock.handlers[responseType](mockFn, options);
        return mockFn;
    },
    effect: <T>(data: T) =>
        pipe(
            Effect.sync(() => FetchMock.create({ json: data })),
            Effect.tap((mock) =>
                Effect.sync(() => {
                    globalThis.fetch = mock;
                }),
            ),
        ),
    getResponseType: (options: MockFetchOptions): ResponseType =>
        (['error', 'json', 'text', 'blob'] as const).find((key) =>
            key === 'blob' ? true : options[key] !== undefined,
        ) ?? 'blob',
    handlers: {
        blob: (mockFn: ReturnType<typeof vi.fn<typeof fetch>>, options: MockFetchOptions) =>
            mockFn.mockResolvedValue(new Response(options.blob, options.init)),
        error: (mockFn: ReturnType<typeof vi.fn<typeof fetch>>, options: MockFetchOptions) =>
            mockFn.mockRejectedValue(options.error),
        json: (mockFn: ReturnType<typeof vi.fn<typeof fetch>>, options: MockFetchOptions) =>
            mockFn.mockResolvedValue(FetchMock.response.json(options.json, options.init)),
        text: (mockFn: ReturnType<typeof vi.fn<typeof fetch>>, options: MockFetchOptions) =>
            mockFn.mockResolvedValue(FetchMock.response.text(options.text ?? '', options.init)),
    } as const satisfies Record<
        ResponseType,
        (mockFn: ReturnType<typeof vi.fn<typeof fetch>>, options: MockFetchOptions) => void
    >,
    install: (options: MockFetchOptions): (() => void) => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = FetchMock.create(options);
        return () => {
            globalThis.fetch = originalFetch;
        };
    },
    response: {
        json: <T>(data: T, init?: MockResponseInit): Response =>
            new Response(JSON.stringify(data), {
                headers: { ...B.defaults.headers, ...init?.headers },
                status: init?.status ?? B.defaults.status,
                statusText: init?.statusText ?? B.defaults.statusText,
            }),
        text: (text: string, init?: MockResponseInit): Response =>
            new Response(text, {
                headers: { 'Content-Type': 'text/plain', ...init?.headers },
                status: init?.status ?? B.defaults.status,
                statusText: init?.statusText ?? B.defaults.statusText,
            }),
    },
});

// --- [EXPORT] ----------------------------------------------------------------

export { B as FETCH_MOCK_TUNING, FetchMock };
