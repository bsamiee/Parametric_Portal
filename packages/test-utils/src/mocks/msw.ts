/**
 * MSW server: request interception for API testing with typed handlers.
 */
import { delay, HttpResponse, http, type RequestHandler } from 'msw';
import { type SetupServer, setupServer } from 'msw/node';

// --- [TYPES] -----------------------------------------------------------------

type HttpMethod = 'delete' | 'get' | 'patch' | 'post' | 'put';
type JsonData = Record<string, unknown> | ReadonlyArray<unknown> | boolean | null | number | string;
type MockResponseInit = {
    readonly delay?: number;
    readonly status?: number;
};
type MswMockApi = {
    readonly delete: <T extends JsonData>(url: string, data: T, init?: MockResponseInit) => RequestHandler;
    readonly get: <T extends JsonData>(url: string, data: T, init?: MockResponseInit) => RequestHandler;
    readonly patch: <T extends JsonData>(url: string, data: T, init?: MockResponseInit) => RequestHandler;
    readonly post: <T extends JsonData>(url: string, data: T, init?: MockResponseInit) => RequestHandler;
    readonly put: <T extends JsonData>(url: string, data: T, init?: MockResponseInit) => RequestHandler;
};
type MswServerApi = {
    readonly close: () => void;
    readonly create: <T extends JsonData>(
        method: HttpMethod,
        url: string,
        data: T,
        init?: MockResponseInit,
    ) => RequestHandler;
    readonly error: (url: string, status?: number, message?: string) => RequestHandler;
    readonly instance: SetupServer;
    readonly networkError: (url: string) => RequestHandler;
    readonly reset: () => void;
    readonly start: () => void;
    readonly use: (...handlers: ReadonlyArray<RequestHandler>) => void;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaultStatus: { delete: 204, get: 200, patch: 200, post: 201, put: 200 } as const satisfies Record<
        HttpMethod,
        number
    >,
    methods: {
        delete: http.delete,
        get: http.get,
        patch: http.patch,
        post: http.post,
        put: http.put,
    } as const satisfies Record<HttpMethod, typeof http.get>,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const MswServer: MswServerApi = Object.freeze({
    close: (): void => MswServer.instance.close(),
    create: <T extends JsonData>(method: HttpMethod, url: string, data: T, init?: MockResponseInit): RequestHandler => {
        const handler = B.methods[method];
        const status = init?.status ?? B.defaultStatus[method];
        const resolver = init?.delay
            ? async () => {
                  await delay(init.delay);
                  return HttpResponse.json(data, { status });
              }
            : () => HttpResponse.json(data, { status });
        return handler(url, resolver);
    },
    error: (url: string, status = 500, message = 'Internal Server Error'): RequestHandler =>
        http.get(url, () => HttpResponse.json({ error: message }, { status })),
    instance: setupServer() as SetupServer,
    networkError: (url: string): RequestHandler => http.get(url, () => HttpResponse.error()),
    reset: (): void => MswServer.instance.resetHandlers(),
    start: (): void => MswServer.instance.listen({ onUnhandledRequest: 'error' }),
    use: (...handlers: ReadonlyArray<RequestHandler>): void => MswServer.instance.use(...handlers),
});
const MswMock: MswMockApi = Object.freeze({
    delete: <T extends JsonData>(url: string, data: T, init?: MockResponseInit) =>
        MswServer.create('delete', url, data, init),
    get: <T extends JsonData>(url: string, data: T, init?: MockResponseInit) =>
        MswServer.create('get', url, data, init),
    patch: <T extends JsonData>(url: string, data: T, init?: MockResponseInit) =>
        MswServer.create('patch', url, data, init),
    post: <T extends JsonData>(url: string, data: T, init?: MockResponseInit) =>
        MswServer.create('post', url, data, init),
    put: <T extends JsonData>(url: string, data: T, init?: MockResponseInit) =>
        MswServer.create('put', url, data, init),
});

// --- [EXPORT] ----------------------------------------------------------------

export { B as MSW_TUNING, MswMock, MswServer };
