/** WebhookService tests: error algebra, mapHttp branches, endpoint/payload schemas, httpDeliver, config stability. */
import { it } from '@effect/vitest';
import { HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from '@effect/platform';
import { WebhookService } from '@parametric-portal/server/infra/webhooks';
import { Effect, FastCheck as fc, Layer, Schema as S } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _reason =        fc.constantFrom<WebhookService.ErrorReason>('InvalidResponse', 'MaxRetries', 'NetworkError', 'NotFound', 'SignatureError', 'Timeout', 'VerificationFailed');
const _secret =        fc.string({ maxLength: 64, minLength: 32, unit: fc.constantFrom(...'0123456789abcdef'.split('')) });
const _host =          fc.string({ maxLength: 12, minLength: 3, unit: fc.constantFrom(...'abcdefghijklmnop0123456789'.split('')) });
const _httpStatus4xx = fc.integer({ max: 499, min: 400 });
const _httpStatus5xx = fc.integer({ max: 599, min: 500 });
const _deliveryId =    fc.uuid();
const _RETRYABLE =     new Set<string>(['Timeout', 'NetworkError']);
const _ENDPOINT = { secret: 'a'.repeat(32), url: 'https://test.example.com/hook' } as const;
const _mockHttpLayer = (status: number) => Layer.succeed(HttpClient.HttpClient, HttpClient.make((req) => Effect.succeed(HttpClientResponse.fromWeb(req, new Response('ok', { status })))));

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect.prop('P1: error complement — retryable XOR terminal, _props consistent', { reason: _reason }, ({ reason }) =>
    Effect.sync(() => {
        const error = WebhookService.Error.from(reason, 'dlv-1');
        expect(error._tag).toBe('WebhookError');
        expect(error.reason).toBe(reason);
        expect(error.isRetryable).toBe(_RETRYABLE.has(reason));
        expect(error.isRetryable).toBe(!error.isTerminal);
        expect(WebhookService.Error._props[reason].retryable).toBe(error.isRetryable);
        expect(WebhookService.Error._props[reason].terminal).toBe(error.isTerminal);
    }),
);
it.effect.prop('P2: endpoint decode + payload defaults + settings default', { host: _host, payloadId: fc.uuid(), secret: _secret }, ({ host, payloadId, secret }) =>
    Effect.gen(function* () {
        const endpoint = yield* S.decodeUnknown(WebhookService.Endpoint)({ secret, url: `https://${host}.example.com/hook` });
        expect(endpoint.url).toContain('https://');
        expect(endpoint.secret.length).toBeGreaterThanOrEqual(32);
        expect(endpoint.timeout).toBe(5000);
        const payload = yield* S.decodeUnknown(WebhookService.Payload)({ data: { x: 1 }, id: payloadId, timestamp: Date.now(), type: 'test.event' });
        expect(payload.schemaVersion).toBe(1);
        expect(payload.id).toBe(payloadId);
        const settings = yield* S.decodeUnknown(WebhookService.Settings)({});
        expect(settings.webhooks).toEqual([]);
    }),
);
it.effect.prop('P3: mapHttp — 4xx→InvalidResponse, 5xx→NetworkError, identity passthrough', { deliveryId: _deliveryId, reason: _reason, status4xx: _httpStatus4xx, status5xx: _httpStatus5xx }, ({ deliveryId, reason, status4xx, status5xx }) =>
    Effect.sync(() => {
        const request = HttpClientRequest.get('https://example.com');
        const mapped4xx = WebhookService.Error.mapHttp(deliveryId)(new HttpClientError.ResponseError({ reason: 'StatusCode', request, response: { status: status4xx } as never }));
        expect([mapped4xx.reason, mapped4xx.statusCode, mapped4xx.deliveryId]).toEqual(['InvalidResponse', status4xx, deliveryId]);
        const mapped5xx = WebhookService.Error.mapHttp(deliveryId)(new HttpClientError.ResponseError({ reason: 'StatusCode', request, response: { status: status5xx } as never }));
        expect([mapped5xx.reason, mapped5xx.statusCode]).toEqual(['NetworkError', status5xx]);
        const original = WebhookService.Error.from(reason, deliveryId);
        expect(WebhookService.Error.mapHttp('other-id')(original)).toBe(original);
    }),
);
it.effect.prop('P4: schema roundtrip — DeliveryRecord + DeliveryResult', { durationMs: fc.nat({ max: 30_000 }), status: fc.constantFrom('delivered' as const, 'failed' as const), statusCode: fc.integer({ max: 599, min: 100 }) }, ({ durationMs, status, statusCode }) =>
    Effect.gen(function* () {
        const record = yield* S.decodeUnknown(WebhookService.DeliveryRecord)({ deliveryId: 'dlv-1', endpointUrl: 'https://a.com/hook', status, tenantId: 't1', timestamp: Date.now(), type: 'test' });
        expect(record.status).toBe(status);
        const result = yield* S.decodeUnknown(WebhookService.DeliveryResult)({ deliveredAt: Date.now(), durationMs, statusCode });
        expect(result.durationMs).toBe(durationMs);
    }),
);
it.effect('P5: httpDeliver returns delivery result with mocked HttpClient', () =>
    Effect.gen(function* () {
        const endpoint = yield* S.decodeUnknown(WebhookService.Endpoint)(_ENDPOINT);
        const payload = new WebhookService.Payload({ data: { test: true }, id: crypto.randomUUID(), timestamp: Date.now(), type: 'webhook.test' });
        const result = yield* WebhookService.httpDeliver(endpoint, payload, 'dlv-test');
        expect(result.statusCode).toBe(200);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
        expect(result.deliveredAt).toBeGreaterThanOrEqual(0);
    }).pipe(Effect.provide(_mockHttpLayer(200))),
);

// --- [EDGE_CASES] ------------------------------------------------------------

it.effect('E1: mapHttp unknown → NetworkError + config/signature stability', () =>
    Effect.sync(() => {
        const mapped = WebhookService.Error.mapHttp('dlv-2')({ socket: 'reset' });
        expect(mapped.reason).toBe('NetworkError');
        expect(mapped.deliveryId).toBe('dlv-2');
        expect(WebhookService.Config.signature.format('abc123')).toBe('sha256=abc123');
        expect(WebhookService.Config.signature.header).toBe('X-Webhook-Signature');
        expect(WebhookService.Config.concurrency.perEndpoint).toBe(5);
        expect(WebhookService.Config.retry.maxAttempts).toBe(5);
    }),
);
it.effect('E2: endpoint rejects http, short secret, boundary secret, missing fields', () =>
    Effect.gen(function* () {
        const [httpUrl, shortSecret, boundary, missing] = yield* Effect.all([
            S.decodeUnknown(WebhookService.Endpoint)({ secret: 'a'.repeat(32), url: 'http://insecure.example.com/hook' }).pipe(Effect.flip),
            S.decodeUnknown(WebhookService.Endpoint)({ secret: 'short',        url: 'https://valid.example.com/hook' }).pipe(Effect.flip),
            S.decodeUnknown(WebhookService.Endpoint)({ secret: 'a'.repeat(31), url: 'https://valid.example.com/hook' }).pipe(Effect.flip),
            S.decodeUnknown(WebhookService.Endpoint)({}).pipe(Effect.flip),
        ]);
        expect(String(httpUrl)).toContain('url');
        expect(String(shortSecret)).toContain('secret');
        expect(String(boundary)).toContain('secret');
        expect(String(missing)).toContain('secret');
    }),
);
it.effect('E3: error.from with opts + payload schemaVersion bounds', () =>
    Effect.gen(function* () {
        const withOpts = WebhookService.Error.from('NetworkError', 'dlv-3', { cause: 'timeout', statusCode: 503 });
        expect(withOpts.cause).toBe('timeout');
        expect(withOpts.statusCode).toBe(503);
        expect(WebhookService.Error.from('NotFound').deliveryId).toBeUndefined();
        yield* S.decodeUnknown(WebhookService.Payload)({ data: {}, id: 'a', schemaVersion: 1, timestamp: 1, type: 't' });
        yield* S.decodeUnknown(WebhookService.Payload)({ data: {}, id: 'a', schemaVersion: 255, timestamp: 1, type: 't' });
        const low = yield* S.decodeUnknown(WebhookService.Payload)({ data: {}, id: 'a', schemaVersion: 0, timestamp: 1, type: 't' }).pipe(Effect.flip);
        expect(String(low)).toContain('schemaVersion');
        const high = yield* S.decodeUnknown(WebhookService.Payload)({ data: {}, id: 'a', schemaVersion: 256, timestamp: 1, type: 't' }).pipe(Effect.flip);
        expect(String(high)).toContain('schemaVersion');
    }),
);
it.effect('E4: httpDeliver fails on non-OK status → WebhookError', () =>
    Effect.gen(function* () {
        const endpoint = yield* S.decodeUnknown(WebhookService.Endpoint)(_ENDPOINT);
        const payload = new WebhookService.Payload({ data: {}, id: crypto.randomUUID(), timestamp: Date.now(), type: 'test' });
        const error = yield* WebhookService.httpDeliver(endpoint, payload, 'dlv-fail').pipe(Effect.flip);
        expect(error._tag).toBe('WebhookError');
    }).pipe(Effect.provide(_mockHttpLayer(500))),
);
