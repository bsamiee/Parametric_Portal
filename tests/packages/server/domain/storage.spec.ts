/** Storage tests: adapter delegation + audit event contracts. */
import { it } from '@effect/vitest';
import { StorageService } from '@parametric-portal/server/domain/storage';
import { StorageAdapter } from '@parametric-portal/server/infra/storage';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { Effect, FastCheck as fc, Stream } from 'effect';
import { expect, vi } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _state = vi.hoisted(() => ({
    aborts:  [] as Array<{ key: string; uploadId: string }>,
    audits:  [] as Array<{ event: string; payload: unknown }>,
    copies:  [] as Array<{ destKey: string; sourceKey: string }>,
    puts:    [] as Array<{ key: string; size: number }>,
    removes: [] as Array<string>,
    streams: [] as Array<{ key: string; partSizeBytes?: number }>,
}));
const _audit = { log: (event: string, payload: unknown) => Effect.sync(() => { _state.audits.push({ event, payload }); }) } as const;
const _storage = {
    abortUpload: (key: string, uploadId: string) => Effect.sync(() => { _state.aborts.push({ key, uploadId }); }),
    copy: (input: { sourceKey: string; destKey: string } | ReadonlyArray<{ sourceKey: string; destKey: string }>) =>
        Effect.sync(() => {
            const items = Array.isArray(input) ? input : [input];
            items.forEach((item) => { _state.copies.push({ destKey: item.destKey, sourceKey: item.sourceKey }); });
            return Array.isArray(input)
                ? items.map((item) => ({ ...item, etag: `etag-${item.destKey}` }))
                : { ...items[0], etag: `etag-${items[0]?.destKey}` };
        }),
    put: (input: { key: string; body: Uint8Array | string } | ReadonlyArray<{ key: string; body: Uint8Array | string }>) =>
        Effect.sync(() => {
            const toSize = (body: Uint8Array | string) => typeof body === 'string' ? body.length : body.byteLength;
            const items = Array.isArray(input) ? input : [input];
            const results = items.map((item) => ({ etag: `etag-${item.key}`, key: item.key, size: toSize(item.body) }));
            results.forEach((result) => { _state.puts.push({ key: result.key, size: result.size }); });
            return Array.isArray(input) ? results : results[0];
        }),
    putStream: (input: { key: string; stream: Stream.Stream<Uint8Array, unknown>; partSizeBytes?: number }) =>
        Effect.sync(() => {
            _state.streams.push({ key: input.key, partSizeBytes: input.partSizeBytes });
            return { etag: `etag-${input.key}`, key: input.key, partCount: 1, totalSize: 7, uploadId: 'up-1' };
        }),
    remove: (input: string | ReadonlyArray<string>) => Effect.sync(() => { (Array.isArray(input) ? input : [input]).forEach((key) => { _state.removes.push(key); }); }),
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _details = (i: number) => (_state.audits[i]?.payload as { details: Record<string, unknown> }).details;
const _subjectId = (i: number) => (_state.audits[i]?.payload as { subjectId: unknown }).subjectId;
const _reset = () => {
    _state.aborts.length = 0; _state.audits.length = 0; _state.copies.length = 0;
    _state.puts.length = 0; _state.removes.length = 0; _state.streams.length = 0;
};
const _provide = <A, E>(eff: Effect.Effect<A, E, unknown>) => eff.pipe(
    Effect.provide(StorageService.Default),
    Effect.provideService(StorageAdapter, _storage as never),
    Effect.provideService(AuditService, _audit as never),
) as Effect.Effect<A, E, never>;

// --- [MOCKS] -----------------------------------------------------------------

vi.mock('@parametric-portal/server/observe/telemetry', async () => {
    const { identity } = await import('effect/Function');
    return { Telemetry: { span: () => identity } };
});

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect('P1: all operations delegate to adapter + emit correct audit events', () =>
    Effect.gen(function* () {
        _reset();
        const service = yield* StorageService;
        yield* service.put({ body: 'abc', contentType: 'text/plain', key: 'k-1', metadata: { type: 'doc' } });
        yield* service.put([{ body: 'abcd', key: 'k-2' }, { body: new Uint8Array([1, 2, 3]), key: 'k-3' }]);
        yield* service.copy({ destKey: 'k-1-copy', metadata: { origin: 'k-1' }, sourceKey: 'k-1' });
        yield* service.copy([{ destKey: 'k-2-copy', sourceKey: 'k-2' }, { destKey: 'k-3-copy', sourceKey: 'k-3' }]);
        yield* service.remove('k-1');
        yield* service.remove(['k-2', 'k-3']);
        yield* service.putStream({ contentType: 'video/mp4', key: 'k-stream', partSizeBytes: 1024, stream: Stream.fromIterable([new Uint8Array([1, 2, 3])]) });
        yield* service.abortUpload('k-stream', 'up-1');
        expect(_state.puts).toStrictEqual([{ key: 'k-1', size: 3 }, { key: 'k-2', size: 4 }, { key: 'k-3', size: 3 }]);
        expect(_state.copies).toStrictEqual([{ destKey: 'k-1-copy', sourceKey: 'k-1' }, { destKey: 'k-2-copy', sourceKey: 'k-2' }, { destKey: 'k-3-copy', sourceKey: 'k-3' }]);
        expect(_state.removes).toStrictEqual(['k-1', 'k-2', 'k-3']);
        expect(_state.streams[0]).toStrictEqual({ key: 'k-stream', partSizeBytes: 1024 });
        expect(_state.aborts[0]).toStrictEqual({ key: 'k-stream', uploadId: 'up-1' });
        expect(_state.audits.map((a) => a.event)).toStrictEqual(['Storage.upload', 'Storage.upload', 'Storage.copy', 'Storage.copy', 'Storage.delete', 'Storage.delete', 'Storage.stream_upload', 'Storage.abort_multipart']);
        expect(_details(0)).toStrictEqual({ contentType: 'text/plain', key: 'k-1', size: 3 });
        expect(_details(1)).toStrictEqual({ count: 2, keys: ['k-2', 'k-3'], totalSize: 7 });
        expect(_details(2)).toStrictEqual({ destKey: 'k-1-copy', sourceKey: 'k-1' });
        expect(_details(3)).toStrictEqual({ copies: [{ dest: 'k-2-copy', source: 'k-2' }, { dest: 'k-3-copy', source: 'k-3' }], count: 2 });
        expect(_details(4)).toStrictEqual({ key: 'k-1' });
        expect(_details(5)).toStrictEqual({ count: 2, keys: ['k-2', 'k-3'] });
        expect(_details(6)).toStrictEqual({ contentType: 'video/mp4', key: 'k-stream', size: 7 });
        expect(_details(7)).toStrictEqual({ key: 'k-stream', uploadId: 'up-1' });
        expect([_subjectId(0), _subjectId(1), _subjectId(2), _subjectId(3), _subjectId(4), _subjectId(5), _subjectId(6), _subjectId(7)]).toStrictEqual(['k-1', 'k-2', 'k-1-copy', 'k-2-copy', 'k-1', 'k-2', 'k-stream', 'k-stream']);
    }).pipe(_provide));
it.effect.prop('P2: put audit — event name + subjectId match key', { key: fc.string({ minLength: 1 }) }, ({ key }) =>
    Effect.gen(function* () {
        _reset();
        const service = yield* StorageService;
        yield* service.put({ body: 'x', key });
        expect(_state.audits).toHaveLength(1);
        expect(_state.audits[0]?.event).toBe('Storage.upload');
        expect((_state.audits[0]?.payload as { subjectId: string }).subjectId).toBe(key);
    }).pipe(_provide));
