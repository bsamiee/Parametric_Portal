/**
 * MFA group handlers for TOTP enrollment, verification, and recovery.
 */
import { HttpApiBuilder } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { HttpError } from '@parametric-portal/server/http-errors';
import { MetricsService } from '@parametric-portal/server/metrics';
import { MfaSecretsRepository, MfaService } from '@parametric-portal/server/mfa';
import { Middleware } from '@parametric-portal/server/middleware';
import { Effect, Layer, Option } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

/** Convert DB errors to InternalError at infra boundary */
const dbError = HttpError.chain(HttpError.Internal, { message: 'Database operation failed' });

// --- [LAYERS] ----------------------------------------------------------------

/** Bridge layer: converts database errors to InternalError */
const MfaSecretsRepositoryLive = Layer.effect(
    MfaSecretsRepository,
    Effect.gen(function* () {
        const db = yield* DatabaseService;
        const metrics = yield* MetricsService;
        return {
            delete: (userId: Parameters<typeof db.mfaSecrets.delete>[0]) =>
                db.mfaSecrets.delete(userId).pipe(Effect.provideService(MetricsService, metrics), dbError),
            findByUserId: (userId: Parameters<typeof db.mfaSecrets.findByUserId>[0]) =>
                db.mfaSecrets.findByUserId(userId).pipe(Effect.provideService(MetricsService, metrics), dbError),
            upsert: (data: Parameters<typeof db.mfaSecrets.upsert>[0]) =>
                db.mfaSecrets.upsert(data).pipe(Effect.provideService(MetricsService, metrics), dbError),
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
                    const userOpt = yield* db.users.findById(session.userId).pipe(dbError);
                    const user = yield* Option.match(userOpt, {
                        onNone: () => Effect.fail(new HttpError.Auth({ reason: 'User not found' })),
                        onSome: Effect.succeed,
                    });
                    return yield* mfa.enroll(session.userId, user.email);
                }),
            )
            .handle('verify', ({ payload }) =>
                Effect.gen(function* () {
                    const session = yield* Middleware.Session;
                    return yield* mfa.verify(session.userId, payload.code);
                }),
            )
            .handle('disable', () =>
                Effect.gen(function* () {
                    const session = yield* Middleware.Session;
                    return yield* mfa.disable(session.userId);
                }),
            )
            .handle('recover', ({ payload }) =>
                Effect.gen(function* () {
                    const session = yield* Middleware.Session;
                    return yield* mfa.useRecoveryCode(session.userId, payload.code);
                }),
            );
    }),
).pipe(Layer.provide(MfaService.Default), Layer.provide(MfaSecretsRepositoryLive));

// --- [EXPORT] ----------------------------------------------------------------

export { MfaLive };
