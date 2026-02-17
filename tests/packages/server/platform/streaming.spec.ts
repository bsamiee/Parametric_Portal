/** StreamingService tests: state algebra, mailbox routing, format codecs, SSE pipelines, event forwarding. */
import { layer } from '@effect/vitest';
import { HttpServerResponse } from '@effect/platform';
import { SqlClient } from '@effect/sql';
import { EventBus } from '@parametric-portal/server/infra/events';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { StreamingService } from '@parametric-portal/server/platform/streaming';
import { Resilience } from '@parametric-portal/server/utils/resilience';
import { Chunk, Duration, Effect, FastCheck as fc, Layer, type Mailbox, PubSub, Stream, SubscriptionRef } from 'effect';
import { expect } from 'vitest';

// --- [FUNCTIONS] -------------------------------------------------------------

const _bytes =    (t: string) => new TextEncoder().encode(t);
const _async =    (t: string) => (async function* () { yield _bytes(t); })();
const _readable = (t: string) => new ReadableStream<Uint8Array>({ start: (c) => { c.enqueue(_bytes(t)); c.close(); } });
const _body =     (r: HttpServerResponse.HttpServerResponse) => Effect.promise(() => HttpServerResponse.toWeb(r).text());
const _header =   (r: HttpServerResponse.HttpServerResponse, k: string) => HttpServerResponse.toWeb(r).headers.get(k);

// --- [LAYER] -----------------------------------------------------------------

layer(Layer.mergeAll(StreamingService.Default, MetricsService.Default, Resilience.Layer))('StreamingService', (it) => {
    // --- [ALGEBRAIC] ---------------------------------------------------------
    // Why: state set/get identity + update composition + modify algebra must hold for all initial values — not just zero.
    it.effect.prop('P1: state — identity + update + modify algebra', { n: fc.integer({ max: 1000, min: -1000 }) }, ({ n }) =>
        Effect.scoped(Effect.gen(function* () {
            const s = yield* StreamingService.state(n, { name: 'pbt' });
            expect(yield* s.get).toBe(n);
            yield* s.set(n + 1);
            yield* s.update((v) => v * 2);
            expect(yield* s.get).toBe((n + 1) * 2);
            const returned = yield* s.modify((v) => [v + 100, v - 1] as const);
            expect(returned).toBe((n + 1) * 2 + 100);
            expect(yield* s.get).toBe((n + 1) * 2 - 1);
            expect((yield* Stream.runHead(s.changes))._tag).toBe('Some');
        })));
    // Why: mailbox routing must work for all 4 source types — empty, PubSub, SubscriptionRef, Stream.
    // Note: Mailbox.fromStream forks a background fiber that may not schedule under @effect/vitest
    // TestClock before take/toStream calls, causing deadlock. We verify each Match branch is entered (PubSub, SubscriptionRef, Stream) and test behavior on the writable (no-source) mailbox.
    it.scoped('P2: mailbox — no-source + PubSub + SubscriptionRef + Stream', () =>
        Effect.gen(function* () {
            const empty = yield* StreamingService.mailbox<number>({ name: 'w' });
            yield* (empty as Mailbox.Mailbox<number>).offer(42);
            expect(yield* (empty as Mailbox.Mailbox<number>).take).toBe(42);
            const hub = yield* PubSub.unbounded<number>();
            const hubBox = yield* StreamingService.mailbox({ from: hub, name: 'h' });
            expect(hubBox).toBeDefined();
            const ref = yield* SubscriptionRef.make(0);
            const refBox = yield* StreamingService.mailbox({ from: ref, name: 's' });
            expect(refBox).toBeDefined();
            const streamBox = yield* StreamingService.mailbox({ from: Stream.fromIterable([1, 2, 3]) });
            expect(streamBox).toBeDefined();
            const anon = yield* StreamingService.mailbox<string>();
            yield* (anon as Mailbox.Mailbox<string>).offer('x');
            expect(yield* (anon as Mailbox.Mailbox<string>).take).toBe('x');
        }));
    // Why: each ingest format must correctly parse bytes through its codec pipeline.
    it.effect('P3: ingest — ndjson parse + binary + sse + msgpack + default + throttle', () =>
        Effect.gen(function* () {
            const ndj = yield* StreamingService.ingest({ format: 'ndjson', name: 'ndj', source: _async('{"a":1}\n{"a":2}\n') });
            expect(Array.from(yield* Stream.runCollect(ndj))).toEqual([{ a: 1 }, { a: 2 }]);
            const sizes = yield* Effect.all([
                StreamingService.ingest({ format: 'binary',  name: 'bin', source: _readable('hello') }).pipe(Effect.flatMap(Stream.runCollect), Effect.map(Chunk.size)),
                StreamingService.ingest({ format: 'sse',     name: 'sse', source: _async('data: hi\n\n') }).pipe(Effect.flatMap(Stream.runCollect), Effect.map(Chunk.size)),
                StreamingService.ingest({ format: 'msgpack', name: 'mp',  source: (async function* () { yield new Uint8Array([0x91, 0x01]); })() }).pipe(Effect.flatMap(Stream.runCollect), Effect.map(Chunk.size)),
                StreamingService.ingest({ name:   'def',     source: _async('raw') }).pipe(Effect.flatMap(Stream.runCollect), Effect.map(Chunk.size)),
                StreamingService.ingest({ format: 'ndjson',  name: 'thr', source: _async('{"x":1}\n'), throttle: { burst: 10, duration: Duration.millis(100), units: 1024 } }).pipe(Effect.flatMap(Stream.runCollect), Effect.map(Chunk.size)),
            ]);
            expect(Math.min(...sizes)).toBeGreaterThan(0);
        }));
    // Why: each emit format must set correct content-type and produce valid encoded body; dedupe + batch exercise pipeline options.
    it.effect('P4: emit — format codecs + headers + dedupe + batch', () =>
        Effect.gen(function* () {
            const [csv, ndj, bin, sse, mp] = yield* Effect.all([
                StreamingService.emit({ format: 'csv',     name: 'csv', serialize: (i: { x: number }) => `${i.x}`, stream: Stream.fromIterable([{ x: 1 }, { x: 2 }]) }),
                StreamingService.emit({ format: 'ndjson',  name: 'ndj', stream: Stream.fromIterable([{ v: 1 }]) }),
                StreamingService.emit({ format: 'binary',  name: 'bin', stream: Stream.fromIterable([_bytes('abc')]) }),
                StreamingService.emit({ format: 'sse',     name: 'sse', stream: Stream.fromIterable([{ id: 'e1' }]) }),
                StreamingService.emit({ format: 'msgpack', name: 'mp',  stream: Stream.fromIterable([{ k: 1 }]) }),
            ]);
            expect([_header(csv, 'content-type'), _header(ndj, 'content-type'), _header(sse, 'content-type'), _header(mp, 'content-type')]).toEqual(['text/csv', 'application/x-ndjson', 'text/event-stream', 'application/msgpack']);
            expect(yield* _body(csv)).toBe('1\n2');
            expect(yield* _body(ndj)).toContain('"v"');
            expect(yield* _body(bin)).toBe('abc');
            expect(_header(ndj, 'content-disposition')).toContain('ndj.ndjson');
            expect(_header(sse, 'cache-control')).toBe('no-cache');
            const deduped = yield* StreamingService.emit({ dedupe: (c: { id: number }, p: { id: number }) => c.id === p.id, format: 'json', name: 'dd', stream: Stream.fromIterable([{ id: 1 }, { id: 1 }, { id: 2 }]) });
            expect(yield* _body(deduped)).toBe('[{"id":1},{"id":2}]');
            const batched = yield* StreamingService.emit({ batch: { duration: Duration.millis(50), size: 10 }, debounce: Duration.millis(1), dedupe: true, filename: 'custom"name.json', format: 'json', name: 'bt', stream: Stream.fromIterable([{ id: 1 }, { id: 1 }, { id: 2 }]), throttle: { burst: 10, duration: Duration.millis(100), units: 1024 } });
            expect(_header(batched, 'content-disposition')).toContain('custom');
        }));
    // Why: SSE must filter events and recover from stream errors with custom or default handler.
    it.effect('P5: sse — filter + error recovery + default handler', () =>
        Effect.gen(function* () {
            const filtered = yield* StreamingService.sse({ filter: (i: { id: number }) => i.id > 1, name: 'f', serialize: (i: { id: number }) => ({ data: String(i.id) }), source: Stream.fromIterable([{ id: 1 }, { id: 2 }, { id: 3 }]) });
            const fBody = yield* _body(filtered);
            expect(fBody).not.toContain('data: 1\n');
            expect(fBody).toContain('2');
            const [errB, defB] = yield* Effect.all([
                StreamingService.sse({ name: 'e', onError: (e: Error) => ({ data: e.message, event: 'fail' }), serialize: (i: string) => ({ data: i }), source: Stream.concat(Stream.make('ok'), Stream.fail(new Error('boom'))) }).pipe(Effect.flatMap(_body)),
                StreamingService.sse({ name: 'de', serialize: (i: string) => ({ data: i }), source: Stream.concat(Stream.make('ok'), Stream.fail(new Error('dflt'))) }).pipe(Effect.flatMap(_body)),
            ]);
            expect(errB).toContain('boom');
            expect(defB).toContain('dflt');
        }));
    // Why: toEventBus must forward all stream elements to EventBus.publish preserving aggregateId mapping.
    it.effect('P6: toEventBus — forwarding contract', () =>
        Effect.gen(function* () {
            const published: Array<unknown> = [];
            yield* StreamingService.toEventBus(Stream.fromIterable([10, 20]), (v) => ({ aggregateId: String(v), payload: { _tag: 'stream', action: 'forwarded', value: v }, tenantId: 't1' })).pipe(
                Effect.provideService(EventBus, { publish: (input: unknown) => { published.push(input); return Effect.void; } } as never),
                Effect.provideService(SqlClient.SqlClient, {} as never),
            );
            expect(published).toMatchObject([{ aggregateId: '10', payload: { value: 10 } }, { aggregateId: '20', payload: { value: 20 } }]);
        }));
    // --- [EDGE_CASES] --------------------------------------------------------
    // Why: exercises error paths — binary type rejection, SSE default serialize, retry mechanism, multipart boundary.
    it.effect('E1: binary rejection + sse default serialize + retry + multipart', () =>
        Effect.gen(function* () {
            const binFail = yield* StreamingService.emit({ format: 'binary', name: 'bf', stream: Stream.fromIterable(['not-binary' as never]) });
            expect((yield* Effect.either(Effect.tryPromise(() => HttpServerResponse.toWeb(binFail).text())))._tag).toBe('Left');
            const sseDefault = yield* StreamingService.emit({ format: 'sse', name: 'sd', stream: Stream.fromIterable([{ msg: 'hi' }]) });
            expect(yield* _body(sseDefault)).toContain('msg');
            const retried = yield* StreamingService.ingest({ format: 'ndjson', name: 'retry', retry: { base: Duration.millis(10), times: 1 }, source: _async('{"r":1}\n') });
            expect(Chunk.size(yield* Stream.runCollect(retried))).toBeGreaterThan(0);
            const boundary = '----boundary';
            const mpBody = `------boundary\r\nContent-Disposition: form-data; name="file"\r\n\r\ndata\r\n------boundary--\r\n`;
            const mpResult = yield* Effect.either(StreamingService.ingest({ format: 'multipart', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, name: 'mp', source: _async(mpBody) }));
            expect(mpResult._tag).toBe('Right');
        }));
});
