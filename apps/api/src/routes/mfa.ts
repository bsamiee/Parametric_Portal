/** MFA group handlers for TOTP enrollment, verification, and recovery. */

import { HttpApiBuilder } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { Audit } from '@parametric-portal/server/audit';
import { getAppId, getClientInfo } from '@parametric-portal/server/context';
import { HttpError } from '@parametric-portal/server/http-errors';
import { MetricsService } from '@parametric-portal/server/metrics';
import { MfaSecretsRepository, MfaService } from '@parametric-portal/server/mfa';
import { Middleware } from '@parametric-portal/server/middleware';
import { RateLimit } from '@parametric-portal/server/rate-limit';
import { Effect, Layer, Option } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const dbError = HttpError.chain(HttpError.Internal, { message: 'Database operation failed' });

// --- [LAYERS] ----------------------------------------------------------------

const MfaSecretsRepositoryLive = Layer.effect(
    MfaSecretsRepository,
    Effect.gen(function* () {
        const db = yield* DatabaseService;
        const metrics = yield* MetricsService;
        return {
            delete: (userId: Parameters<typeof db.mfaSecrets.delete>[0]) => db.mfaSecrets.delete(userId).pipe(Effect.provideService(MetricsService, metrics), dbError),
            findByUserId: (userId: Parameters<typeof db.mfaSecrets.findByUserId>[0]) => db.mfaSecrets.findByUserId(userId).pipe(Effect.provideService(MetricsService, metrics), dbError),
            upsert: (data: Parameters<typeof db.mfaSecrets.upsert>[0]) => db.mfaSecrets.upsert(data).pipe(Effect.provideService(MetricsService, metrics), dbError),
        };
    }),
).pipe(Layer.provide(MetricsService.layer));
const MfaLive = HttpApiBuilder.group(ParametricApi, 'mfa', (handlers) =>
    Effect.gen(function* () {
        const mfa = yield* MfaService;
        const db = yield* DatabaseService;
        return handlers
            .handle('status', () =>
                Effect.gen(function* () {
                    const { userId } = yield* Middleware.Session;
                    return yield* mfa.getStatus(userId);
                }),
            )
            .handle('enroll', () =>
                Effect.gen(function* () {
                    const session = yield* Middleware.Session;
                    const ctx = yield* getClientInfo;
                    const appId = yield* getAppId;
                    const userOpt = yield* db.users.findById(session.userId).pipe(dbError);
                    const user = yield* Option.match(userOpt, {
                        onNone: () => Effect.fail(new HttpError.Auth({ reason: 'User not found' })),
                        onSome: Effect.succeed,
                    });
                    const result = yield* mfa.enroll(user.id, user.email);
                    yield* Audit.log(db.audit, {
                        actorId: session.userId,
                        appId,
                        changes: null,
                        entityId: session.userId,
                        entityType: 'mfa_secret',
                        ipAddress: ctx.ipAddress,
                        operation: 'mfa_enroll',
                        userAgent: ctx.userAgent,
                    });
                    return result;
                }).pipe(RateLimit.middleware.mfa),
            )
            .handle('verify', ({ payload }) =>
                Effect.gen(function* () {
                    const session = yield* Middleware.Session;
                    const ctx = yield* getClientInfo;
                    const appId = yield* getAppId;
                    // Verify MFA and mark session atomically
                    const result = yield* db.withTransaction(
                        Effect.gen(function* () {
                            const verifyResult = yield* mfa.verify(session.userId, payload.code);
                            yield* db.sessions.markMfaVerified(session.sessionId).pipe(dbError);
                            return verifyResult;
                        }),
                    ).pipe(dbError);
                    yield* Audit.log(db.audit, {
                        actorId: session.userId,
                        appId,
                        changes: null,
                        entityId: session.userId,
                        entityType: 'mfa_secret',
                        ipAddress: ctx.ipAddress,
                        operation: 'mfa_verify',
                        userAgent: ctx.userAgent,
                    });
                    return result;
                }).pipe(RateLimit.middleware.mfa),
            )
            .handle('disable', () =>
                Effect.gen(function* () {
                    const session = yield* Middleware.Session;
                    const ctx = yield* getClientInfo;
                    const appId = yield* getAppId;
                    yield* Middleware.requireMfaVerified;
                    const result = yield* mfa.disable(session.userId);
                    yield* Audit.log(db.audit, {
                        actorId: session.userId,
                        appId,
                        changes: null,
                        entityId: session.userId,
                        entityType: 'mfa_secret',
                        ipAddress: ctx.ipAddress,
                        operation: 'mfa_disable',
                        userAgent: ctx.userAgent,
                    });
                    return result;
                }),
            )
            .handle('recover', ({ payload }) =>
                Effect.gen(function* () {
                    const session = yield* Middleware.Session;
                    // Use recovery code and mark session atomically
                    const result = yield* db.withTransaction(
                        Effect.gen(function* () {
                            const recoverResult = yield* mfa.useRecoveryCode(session.userId, payload.code.toUpperCase());
                            yield* db.sessions.markMfaVerified(session.sessionId).pipe(dbError);
                            return recoverResult;
                        }),
                    ).pipe(dbError);
                    return result;
                }).pipe(RateLimit.middleware.mfa),
            );
    }),
).pipe(Layer.provide(MfaService.Default), Layer.provide(MfaSecretsRepositoryLive));

// --- [EXPORT] ----------------------------------------------------------------

export { MfaLive };
