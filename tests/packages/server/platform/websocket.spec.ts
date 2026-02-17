/** WebSocketService tests: schema roundtrips, codec inverse, error algebra, key construction, service boot + dispatch. */
import { it } from '@effect/vitest';
import { Socket } from '@effect/platform';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Context as Ctx } from '@parametric-portal/server/context';
import { Env } from '@parametric-portal/server/env';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { Resilience } from '@parametric-portal/server/utils/resilience';
import { WebSocketService } from '@parametric-portal/server/platform/websocket';
import { Effect, FastCheck as fc, Layer, Option, Schema as S } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _reason = fc.constantFrom<WebSocketService.ErrorReason>('send_failed', 'room_limit', 'not_in_room', 'invalid_message', 'disconnecting');
const _PROPS = {
    disconnecting: { retryable: false, terminal: true  }, invalid_message: { retryable: false, terminal: true  },
    not_in_room:   { retryable: false, terminal: false }, room_limit:      { retryable: false, terminal: false },
    send_failed:   { retryable: true,  terminal: false },
} as const;
const VALID_INBOUND = [
    '{"_tag":"join","roomId":"r"}', '{"_tag":"leave","roomId":"r"}', '{"_tag":"pong"}', '{"_tag":"meta.get"}',
    '{"_tag":"send","roomId":"r","data":1}','{"_tag":"direct","targetSocketId":"s","data":1}', '{"_tag":"meta.set","metadata":{"k":"v"}}',
] as const;
const VALID_OUTBOUND = [
    { _tag: 'error' as const,          reason: 'x' }, { _tag: 'ping' as const, serverTime: 0 },
    { _tag: 'room.message' as const,   data: null, roomId: 'r' },
    { _tag: 'direct.message' as const, data: null, fromSocketId: 's' },
    { _tag: 'meta.data' as const,      metadata: { k: 'v' } },
] as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _mkSubscriber = () => ({ on: () => {}, quit: () => Promise.resolve(), unsubscribe: () => {} });
const _fakeRequest = { appNamespace: Option.none(), circuit: Option.none(), cluster: Option.none(), ipAddress: Option.none(), rateLimit: Option.none(), requestId: 'test', session: Option.none(), tenantId: 't1', userAgent: Option.none() } as never;
const _mkSocket = (messages: ReadonlyArray<string> = [], afterMessages?: () => void): Socket.Socket => ({
    [Socket.TypeId]: Socket.TypeId,
    run: () => Effect.void,
    runRaw: (handler: (data: string | Uint8Array) => Effect.Effect<void, unknown, unknown>) =>
        Effect.forEach(messages, (msg) => handler(msg).pipe(Effect.ignore), { discard: true }).pipe(
            Effect.tap(() => { afterMessages?.(); }),
            Effect.andThen(Effect.yieldNow()),
        ),
    writer: Effect.succeed((_data: string | Uint8Array) => Effect.void),
}) as never;
const _fakeCache = {
    kv:     { del: () => Effect.void, get: () => Effect.succeed(Option.none()), set: () => Effect.void },
    pubsub: { duplicate: Effect.sync(_mkSubscriber), publish: () => Effect.void, subscribe: () => Effect.void },
    sets:   { add: () => Effect.void, members: () => Effect.succeed([]), remove: () => Effect.void, touch: () => Effect.void },
} as never;
const _testLayer = (WebSocketService as unknown as { DefaultWithoutDependencies: Layer.Layer<WebSocketService> }).DefaultWithoutDependencies.pipe(
    Layer.provide(Layer.succeed(CacheService, _fakeCache)),
    Layer.provide(Layer.succeed(Env.Service, { websocket: { broadcastChannel: 'ws:test', maxRoomsPerSocket: 10, pingIntervalMs: 600_000, pongTimeoutMs: 900_000, reaperIntervalMs: 600_000 } } as never)),
    Layer.provide(MetricsService.Default), Layer.provide(Resilience.Layer),
    Layer.provide(Layer.succeed(Ctx.Request, _fakeRequest)),
);
const _callSiteLayer = Layer.mergeAll(Layer.succeed(CacheService, _fakeCache), Layer.succeed(Ctx.Request, _fakeRequest));

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect.prop('P1: error properties match external oracle, deterministic', { reason: _reason }, ({ reason }) =>
    Effect.sync(() => {
        const error = WebSocketService.Error.from(reason, 'sock-1', { detail: 'test' });
        expect(error.isRetryable).toBe(_PROPS[reason].retryable);
        expect(error.isTerminal).toBe(_PROPS[reason].terminal);
        expect(error.reason).toBe(reason);
        expect(error.socketId).toBe('sock-1');
        expect(error._tag).toBe('WsError');
        expect(WebSocketService.Error.from(reason).isRetryable).toBe(error.isRetryable);
    }));
it.effect('P2: codec roundtrip — inbound decode + outbound encode', () =>
    Effect.gen(function* () {
        const decoded = yield* Effect.all(VALID_INBOUND.map((raw) => WebSocketService.decodeInbound(raw)));
        expect(decoded.map((m) => m._tag)).toEqual(['join', 'leave', 'pong', 'meta.get', 'send', 'direct', 'meta.set']);
        const encoded = yield* Effect.all(VALID_OUTBOUND.map((msg) => WebSocketService.encodeOutbound(msg)));
        encoded.forEach((json) => { expect(json).toContain('"_tag"'); });
        expect(encoded[1]).toContain('"serverTime"');
        expect(String(yield* WebSocketService.decodeInbound('{"_tag":"join"}').pipe(Effect.flip))).toContain('roomId');
        expect((yield* WebSocketService.decodeInbound('not-json').pipe(Effect.flip))._tag).toBe('ParseError');
    }));
it.effect('P3: transport envelope roundtrip — encode then decode recovers structure', () =>
    Effect.gen(function* () {
        const envelopes = [
            { _tag: 'room' as const, data: { x: 1 }, nodeId: 'n1', roomId: 'r1', tenantId: 't1' },
            { _tag: 'direct' as const, data: 'hi', fromSocketId: 'fs', nodeId: 'n2', targetSocketId: 'ts', tenantId: 't2' },
            { _tag: 'broadcast' as const, data: [1, 2], nodeId: 'n3', tenantId: 't3' },
        ] as const;
        const rt = (e: typeof envelopes[number]) => WebSocketService.encodeTransport(e).pipe(Effect.flatMap(WebSocketService.decodeTransport));
        const [r0, r1, r2] = yield* Effect.all([rt(envelopes[0]), rt(envelopes[1]), rt(envelopes[2])]);
        expect(r0._tag).toBe('room');
        expect(r1._tag).toBe('direct');
        expect(r2._tag).toBe('broadcast');
        expect(r0._tag === 'room' ? r0.roomId : '').toBe('r1');
        expect(r1._tag === 'direct' ? r1.targetSocketId : '').toBe('ts');
        expect(r2._tag === 'broadcast' ? r2.tenantId : '').toBe('t3');
    }));
it.effect('P4: toPayload + mapper — error shape + non-WsError fallback', () =>
    Effect.sync(() => {
        expect(WebSocketService.Error.toPayload(WebSocketService.Error.from('send_failed'))).toEqual({ _tag: 'error', reason: 'send_failed' });
        expect(WebSocketService.Error.toPayload(new Error('boom'))).toEqual({ _tag: 'error', reason: 'invalid_message' });
        expect(WebSocketService.Error.toPayload(null)).toEqual({ _tag: 'error', reason: 'invalid_message' });
        const mapped = WebSocketService.Error.mapper('room_limit', 'sock-2')(new Error('full'));
        expect(mapped.reason).toBe('room_limit');
        expect(mapped.socketId).toBe('sock-2');
        expect(mapped.cause).toBeInstanceOf(Error);
    }));

// --- [EDGE_CASES] ------------------------------------------------------------

it.effect('E1: schema surface — validators accept/reject, keys use correct format', () =>
    Effect.gen(function* () {
        expect(S.is(WebSocketService.OutboundMsg)({ _tag: 'error', reason: 'x' })).toBe(true);
        expect(S.is(WebSocketService.OutboundMsg)({ _tag: 'bogus' })).toBe(false);
        expect(S.is(WebSocketService.ErrorReason)('disconnecting')).toBe(true);
        expect(S.is(WebSocketService.ErrorReason)('bogus')).toBe(false);
        expect(S.is(WebSocketService.Command)({ _tag: 'join', roomId: 'r' })).toBe(true);
        expect(S.is(WebSocketService.Command)({ _tag: 'pong' })).toBe(false);
        expect(S.is(WebSocketService.Signal)({ _tag: 'pong' })).toBe(true);
        expect(S.is(WebSocketService.Signal)({ _tag: 'join' })).toBe(false);
        const presence = yield* S.decodeUnknown(WebSocketService.PresencePayload)({ connectedAt: 1000, userId: 'u1' });
        expect(presence.userId).toBe('u1');
        expect(presence.connectedAt).toBe(1000);
        expect(WebSocketService.keys.meta('sock-1')).toBe('ws:meta:sock-1');
        expect(WebSocketService.keys.room('t1', 'r1')).toBe('room:t1:r1');
    }));
it.scoped('E2: service boot — presence empty, dispatch lifecycle completes', () =>
    Effect.gen(function* () {
        const svc = yield* WebSocketService;
        const [members, all] = yield* Effect.all([
            svc.presence.roomMembers('t1', 'r1'),
            svc.presence.getAll('t1').pipe(Effect.provide(_callSiteLayer)),
        ]);
        expect(members).toEqual([]);
        expect(all).toEqual([]);
        yield* svc.accept(_mkSocket([
            '{"_tag":"join","roomId":"r1"}', '{"_tag":"send","roomId":"r1","data":"hi"}', '{"_tag":"leave","roomId":"r1"}',
        ]), 'user-1', 't1').pipe(Effect.scoped, Effect.provide(_callSiteLayer), Effect.ignore);
    }).pipe(Effect.provide(_testLayer)));
