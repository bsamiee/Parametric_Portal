/** CacheService tests: node parsing, redis config, kv/sets factories, key registry, invalidation, presence, headers, health. */
import { it } from '@effect/vitest';
import { HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { CacheService, _invalidateLocal, _makeKeyRegistry, _makeKv, _makeSets, _parseNodes, _redisConfig } from '@parametric-portal/server/platform/cache';
import { Context } from '@parametric-portal/server/context';
import { Env } from '@parametric-portal/server/env';
import { Duration, Effect, FastCheck as fc, Option, Schema as S } from 'effect';
import { expect, vi } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _port = fc.integer({ max: 65_535, min: 1 });
const _host = fc.stringMatching(/^[a-z][a-z0-9.-]{0,20}$/);
const _key =  fc.string({ maxLength: 32, minLength: 1 });
const _N =    Option.none();
const _R =    { autoPipeline: false, autoResendUnfulfilledCommands: true, autoResubscribe: true, blockingTimeout: _N, commandTimeout: _N, connectionName: 't', connectTimeout: 5000, db: _N, disableClientInfo: false, enableOfflineQueue: true, enableReadyCheck: true, host: 'localhost', keepAlive: 0, lazyConnect: false, maxLoadingRetryTime: 10000, maxRetriesPerRequest: 20, mode: 'standalone' as const, noDelay: true, password: _N, port: 6379, retryBaseMs: 50, retryCapMs: 2000, retryMaxAttempts: 3, sentinelCommandTimeout: _N, sentinelFailoverDetector: false, sentinelName: 'master', sentinelNodes: '', sentinelPassword: _N, sentinelRole: 'master' as const, sentinelTls: false, sentinelUsername: _N, socketTimeout: 15000, tlsCa: _N, tlsCert: _N, tlsEnabled: false, tlsKey: _N, tlsRejectUnauthorized: true, tlsServername: _N, username: _N } as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _redis = (ov: Record<string, unknown> = {}) => ({
    del:      vi.fn(() => Promise.resolve(1)), expire: vi.fn(() => Promise.resolve(1)), get: vi.fn(() => Promise.resolve(null as string | null)),
    hdel:     vi.fn(() => Promise.resolve(1)), hgetall: vi.fn(() => Promise.resolve({})),
    multi:    vi.fn(() => ({ expire: vi.fn().mockReturnValue({ exec: vi.fn(() => Promise.resolve([[null, 1]])) }), hset: vi.fn().mockReturnThis() })),ping: vi.fn(() => Promise.resolve('PONG')),
    sadd:     vi.fn(() => Promise.resolve(1)), set: vi.fn(() => Promise.resolve('OK')),
    smembers: vi.fn(() => Promise.resolve([] as string[])), srem: vi.fn(() => Promise.resolve(1)), ...ov,
});
const _p = <A, E>(svc: unknown, eff: Effect.Effect<A, E, CacheService>) => eff.pipe(Effect.provideService(CacheService, svc as never));
const _env = (redis: Record<string, unknown>) => ({ cache: { prefix: 'p:', redis: { ..._R, ...redis } } });

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect.prop('P1: parseNodes — roundtrip + determinism + invalid rejection', { bad: fc.oneof(
    fc.constant(''), fc.constant(':'), fc.constant('host:0'), fc.constant('host:65536'), fc.constant('host:abc'), fc.constant(':1234'),
), host: _host, port: _port }, ({ host, port, bad }) =>
    Effect.sync(() => {
        expect(_parseNodes(`${host}:${port}`)).toEqual([{ host, port }]);
        expect(_parseNodes(`${host}:${port},${host}:${port}`)).toHaveLength(2);
        expect(_parseNodes(bad)).toEqual([]);
    }));
it.effect('P2: redisConfig — standalone + sentinel + retry boundaries + TLS fields', () =>
    Effect.gen(function* () {
        const standalone = yield* _redisConfig.pipe(Effect.provideService(Env.Service, _env({}) as never));
        expect(standalone.mode).toBe('standalone');
        expect(standalone.redisOpts.keyPrefix).toBe('p:');
        expect(standalone.redisOpts.retryStrategy?.(1)).toBe(50);
        expect([standalone.redisOpts.retryStrategy?.(4), standalone.redisOpts.retryStrategy?.(50)]).toEqual([null, null]);
        const capped = yield* _redisConfig.pipe(Effect.provideService(Env.Service, _env({ retryMaxAttempts: 100 }) as never));
        expect(capped.redisOpts.retryStrategy?.(100)).toBe(2000);
        const sentinel = yield* _redisConfig.pipe(Effect.provideService(Env.Service, _env({ mode: 'sentinel', sentinelNodes: 'h1:26379,h2:26380' }) as never));
        expect(sentinel.mode).toBe('sentinel');
        expect('sentinels' in sentinel.redisOpts ? sentinel.redisOpts.sentinels : []).toEqual([{ host: 'h1', port: 26379 }, { host: 'h2', port: 26380 }]);
        const fallback = yield* _redisConfig.pipe(Effect.provideService(Env.Service, _env({ mode: 'sentinel' }) as never));
        expect('sentinels' in fallback.redisOpts ? fallback.redisOpts.sentinels : []).toEqual([{ host: 'localhost', port: 26379 }]);
        expect((yield* _redisConfig.pipe(Effect.provideService(Env.Service, _env({ tlsEnabled: true }) as never))).redisOpts.tls).toMatchObject({ rejectUnauthorized: true });
    }));
it.effect.prop('P3: kv — get branches (null, valid, malformed, mismatch, error) + set args', { key: _key }, ({ key }) =>
    Effect.gen(function* () {
        const r = _redis();
        const kv = _makeKv(r as never);
        expect(Option.isNone(yield* kv.get(key, S.String))).toBe(true);
        r.get.mockResolvedValueOnce(JSON.stringify('hello'));
        expect(Option.getOrThrow(yield* kv.get(key, S.String))).toBe('hello');
        r.get.mockResolvedValueOnce('not{json'); r.get.mockResolvedValueOnce(JSON.stringify(42)); r.get.mockRejectedValueOnce(new Error('d'));
        const [a, b, c] = [yield* kv.get(key, S.String), yield* kv.get(key, S.String), yield* kv.get(key, S.String)];
        expect([Option.isNone(a), Option.isNone(b), Option.isNone(c)]).toEqual([true, true, true]);
        yield* kv.set(key, { data: 1 }, Duration.seconds(60));
        expect(r.set).toHaveBeenCalledWith(key, '{"data":1}', 'PX', 60000);
    }));
it.effect.prop('P4: sets — noop guard, member ops, error fallback, touch ceiling + floor', { key: _key }, ({ key }) =>
    Effect.gen(function* () {
        const r = _redis({ smembers: vi.fn(() => Promise.resolve(['x'])) });
        const sets = _makeSets(r as never);
        yield* sets.add(key);
        expect(r.sadd).not.toHaveBeenCalled();
        yield* sets.add(key, 'a', 'b');
        expect(r.sadd).toHaveBeenCalledWith(key, 'a', 'b');
        yield* sets.remove(key);
        expect(r.srem).not.toHaveBeenCalled();
        yield* sets.remove(key, 'a');
        expect(r.srem).toHaveBeenCalledWith(key, 'a');
        expect(yield* sets.members(key)).toEqual(['x']);
        r.smembers = vi.fn(() => Promise.reject(new Error('fail')));
        expect(yield* _makeSets(r as never).members(key)).toEqual([]);
        yield* sets.touch(key, Duration.millis(1500)); expect(r.expire).toHaveBeenCalledWith(key, 2);
        r.expire.mockClear(); yield* sets.touch(key, Duration.millis(100)); expect(r.expire).toHaveBeenCalledWith(key, 1);
    }));
it.effect('P5: keyRegistry + invalidateLocal — ref counting, glob, regex escaping, unknown store', () =>
    Effect.gen(function* () {
        const reg = _makeKeyRegistry();
        reg.register('s', 'k'); reg.register('s', 'k');
        expect(reg.refs.get('s')?.get('k')).toBe(2);
        reg.unregister('s', 'k'); expect(reg.refs.get('s')?.get('k')).toBe(1);
        reg.unregister('s', 'k'); expect(reg.refs.has('s')).toBe(false);
        reg.unregister('x', 'x'); expect(reg.refs.size).toBe(0);
        const refs = new Map([['store', new Map([['user:1', 1], ['user:2', 1], ['order:1', 1], ['u.s$r:3', 1]])]]);
        const inv = vi.fn(() => Effect.void);
        expect(yield* _invalidateLocal(refs, { invalidate: inv }, 'key',     'store', 'user:1')).toBe(1);
        expect(yield* _invalidateLocal(refs, { invalidate: inv }, 'pattern', 'store', 'user:*')).toBe(2);
        expect(yield* _invalidateLocal(refs, { invalidate: inv }, 'pattern', 'store', 'nope:*')).toBe(0);
        expect(yield* _invalidateLocal(refs, { invalidate: inv }, 'pattern', 'store', 'u.s$r:*')).toBe(1);
        expect(yield* _invalidateLocal(refs, { invalidate: inv }, 'pattern', 'gone',  '*')).toBe(0);
    }));

// --- [EDGE_CASES] ------------------------------------------------------------

it.effect.prop('E1: setNX — acquire/exists/fail-closed + TTL propagation', { key: _key, value: fc.string({ maxLength: 64, minLength: 1 }) }, ({ key, value }) =>
    Effect.gen(function* () {
        const set = vi.fn<(...args: ReadonlyArray<unknown>) => Promise<string | null>>().mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
        const [acquired, existing] = yield* Effect.all([CacheService.setNX(key, value, Duration.seconds(10)), CacheService.setNX(key, value, Duration.seconds(10))].map((e) => _p({ _redis: { set } }, e)));
        expect(acquired).toEqual({ alreadyExists: false, key });
        expect(existing).toEqual({ alreadyExists: true, key });
        expect(set).toHaveBeenCalledWith(key, value, 'PX', 10000, 'NX');
        const errResult = yield* _p({ _redis: { set: vi.fn(() => Promise.reject(new Error('d'))) } }, CacheService.setNX(key, value, Duration.seconds(10)));
        expect(errResult).toEqual({ alreadyExists: true, key });
    }));
it.effect('E2: presence — getAll decodes+filters, error fallback, set/remove/refresh', () =>
    Effect.gen(function* () {
        const r = _redis({ hgetall: vi.fn(() => Promise.resolve({ bad: '{"userId":7}', ok: '{"connectedAt":1,"userId":"u-1"}' })) });
        expect(yield* _p({ _redis: r }, CacheService.presence.getAll('t'))).toEqual([{ connectedAt: 1, socketId: 'ok', userId: 'u-1' }]);
        yield* _p({ _redis: r }, CacheService.presence.set('t', 's1', { connectedAt: 0, userId: 'u' }));
        expect(r.multi).toHaveBeenCalled();
        yield* _p({ _redis: r }, CacheService.presence.remove('t', 's1'));
        expect(r.hdel).toHaveBeenCalledWith('presence:t', 's1');
        yield* _p({ _redis: r }, CacheService.presence.refresh('t'));
        expect(r.expire).toHaveBeenCalledWith('presence:t', 120);
        expect(yield* _p({ _redis: _redis({ hgetall: vi.fn(() => Promise.reject(new Error('x'))) }) }, CacheService.presence.getAll('t'))).toEqual([]);
    }));
it.effect('E3: headers — passthrough + rate-limit injection + remaining clamping', () =>
    Effect.gen(function* () {
        const mk = (opts: Record<string, unknown>) => Context.Request.within('00000000-0000-7000-8000-000000000777', CacheService.headers(Effect.succeed(HttpServerResponse.empty({ status: 200 }))).pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, {} as never)), { requestId: '00000000-0000-7000-8000-000000000444', ...opts });
        const rl = (rem: number) => mk({ rateLimit: Option.some({ delay: Duration.zero, limit: 10, remaining: rem, resetAfter: Duration.seconds(1) }) });
        expect((yield* mk({})).status).toBe(200);
        const [n, lo, hi] = yield* Effect.all([rl(2), rl(-5), rl(999)]);
        expect([n, lo, hi].map((r) => HttpServerResponse.toWeb(r).headers.get(Context.Request.Headers.rateLimit.remaining))).toEqual(['2', '0', '10']);
        expect(HttpServerResponse.toWeb(n).headers.get(Context.Request.Headers.rateLimit.limit)).toBe('10');
    }));
it.effect('E4: health — connected + non-PONG + disconnected', () =>
    Effect.all([_p({ _redis: _redis() }, CacheService.health()), _p({ _redis: _redis({ ping: vi.fn(() => Promise.resolve('LOADING')) }) }, CacheService.health()), _p({ _redis: _redis({ ping: vi.fn(() => Promise.reject(new Error('x'))) }) }, CacheService.health())]).pipe(
        Effect.tap(([ok, nonPong, err]) => { expect(ok.connected).toBe(true); expect(nonPong.connected).toBe(false); expect(err).toEqual({ connected: false, latencyMs: 0 }); })));
