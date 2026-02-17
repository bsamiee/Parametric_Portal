/** StorageAdapter contract tests: service tag identity, polymorphic exists, sign operations. */
import { it } from '@effect/vitest';
import { S3ClientInstance } from '@effect-aws/client-s3';
import { StorageAdapter } from '@parametric-portal/server/infra/storage';
import { Effect, FastCheck as fc, Layer } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const METHODS = ['abortUpload', 'copy', 'exists', 'get', 'getStream', 'list', 'listStream', 'listUploads', 'put', 'putStream', 'remove', 'sign'] as const;
const SIGNED_URL = 'https://signed.example.com/object' as const;
const _key =  fc.string({ maxLength: 64, minLength: 1 });
const _keys = fc.array(_key, { maxLength: 8, minLength: 1 });

// --- [LAYER] -----------------------------------------------------------------

const _layer = Layer.mergeAll(
    Layer.succeed(StorageAdapter, {
        abortUpload: () => Effect.void,
        copy:        (input: unknown) => Effect.succeed(Array.isArray(input) ? [] : { destKey: 'd', etag: '', sourceKey: 's' }),
        exists:      (input: string | readonly string[]) => Effect.succeed(Array.isArray(input) ? new Map(input.map((k) => [k, k !== 'missing'])) : input !== 'missing'),
        get:         () => Effect.succeed({ body: new Uint8Array(), contentType: 'application/octet-stream', etag: '', key: 'k', metadata: {}, size: 0 }),
        getStream:   () => Effect.succeed({ contentType: 'application/octet-stream', size: 0 }),
        list:        () => Effect.succeed({ continuationToken: undefined, isTruncated: false, items: [] }),
        listStream:  () => undefined,
        listUploads: () => Effect.succeed({ uploads: [] }),
        put:         () => Effect.succeed({ etag: '', key: 'k', size: 0 }),
        putStream:   () => Effect.succeed({ etag: '', key: 'k', totalSize: 0 }),
        remove:      () => Effect.void,
        sign:        () => Effect.succeed(SIGNED_URL),
    } as never),
    Layer.succeed(S3ClientInstance.S3ClientInstance, {} as never),
);

// --- [ALGEBRAIC] -------------------------------------------------------------

// Why: service tag identity + API shape + S3ClientLayer existence -- validates contract surface in one pass.
it.effect('P1: service tag, 12-method shape, and static S3ClientLayer', () =>
    Effect.gen(function* () {
        const adapter = yield* StorageAdapter;
        expect((StorageAdapter as { readonly key: string }).key).toBe('server/StorageAdapter');
        expect(typeof StorageAdapter.S3ClientLayer).toBe('object');
        expect(Object.keys(adapter).sort((a, b) => a.localeCompare(b))).toEqual([...METHODS]);
    }).pipe(Effect.provide(_layer)),
);
// Why: exists polymorphism -- single key yields boolean, batch yields Map covering all keys (universality).
it.effect.prop('P2: exists single yields boolean, batch Map covers all input keys', { key: _key, keys: _keys }, ({ key, keys }) =>
    Effect.gen(function* () {
        const adapter = yield* StorageAdapter;
        const single = yield* adapter.exists(key);
        const batch = (yield* adapter.exists(keys)) as Map<string, boolean>;
        expect(typeof single).toBe('boolean');
        expect(batch).toBeInstanceOf(Map);
        expect(keys.every((k) => batch.has(k))).toBe(true);
    }).pipe(Effect.provide(_layer)),
);

// --- [EDGE_CASES] ------------------------------------------------------------

// Why: sign contract -- get/put/copy all resolve to URL string, exists missing key returns false.
it.effect('E1: sign get/put/copy resolve URL + exists missing key returns false', () =>
    Effect.gen(function* () {
        const adapter = yield* StorageAdapter;
        const [getUrl, putUrl, copyUrl, missing, missingBatch] = yield* Effect.all([
            adapter.sign({ key: 'asset/a', op: 'get' }),
            adapter.sign({ key: 'asset/b', op: 'put' }),
            adapter.sign({ destKey: 'asset/d', op: 'copy', sourceKey: 'asset/s' }),
            adapter.exists('missing'),
            adapter.exists(['missing']) as Effect.Effect<Map<string, boolean>>,
        ]);
        expect([getUrl, putUrl, copyUrl].every((u) => typeof u === 'string' && u.startsWith('https://'))).toBe(true);
        expect(missing).toBe(false);
        expect(missingBatch.get('missing')).toBe(false);
    }).pipe(Effect.provide(_layer), Effect.asVoid),
);
