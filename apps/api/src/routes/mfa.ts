/** MFA group handlers for TOTP enrollment, verification, and recovery. */

import { HttpApiBuilder } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { Audit } from '@parametric-portal/server/audit';
import { HttpError } from '@parametric-portal/server/http-errors';
import { MetricsService } from '@parametric-portal/server/metrics';
import { MfaSecretsRepository, MfaService } from '@parametric-portal/server/mfa';
import { Middleware } from '@parametric-portal/server/middleware';
import { RateLimit } from '@parametric-portal/server/rate-limit';
import { Effect, Layer, Option } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const withDbError = Effect.catchAll((e: unknown) => Effect.fail(HttpError.internal('Database operation failed', e)));

// --- [LAYERS] ----------------------------------------------------------------

const MfaSecretsRepositoryLive = Layer.effect(
    MfaSecretsRepository,
    Effect.gen(function* () {
        const db = yield* DatabaseService;
        const metrics = yield* MetricsService;
        return {
            byUser: (userId: Parameters<typeof db.mfaSecrets.byUser>[0]) => db.mfaSecrets.byUser(userId).pipe(Effect.provideService(MetricsService, metrics), withDbError),
            deleteByUser: (userId: string) => db.mfaSecrets.softDelete(userId).pipe(Effect.provideService(MetricsService, metrics), withDbError),
            upsert: (data: Parameters<typeof db.mfaSecrets.upsert>[0]) => db.mfaSecrets.upsert(data).pipe(Effect.provideService(MetricsService, metrics), withDbError),
        };
    }),
).pipe(Layer.provide(MetricsService.Default));
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
                RateLimit.apply('mfa', Effect.gen(function* () {
                    const session = yield* Middleware.Session;
                    const userOpt = yield* db.users.findById(session.userId).pipe(withDbError);
                    const user = yield* Option.match(userOpt, { onNone: () => Effect.fail(HttpError.notFound('user', session.userId)), onSome: Effect.succeed });
                    const result = yield* mfa.enroll(user.id, user.email);
                    yield* Audit.log(db.audit, 'MfaSecret', session.userId, 'enroll');
                    return result;
                })),
            )
            .handle('verify', ({ payload }) =>
                RateLimit.apply('mfa', Effect.gen(function* () {
                    const session = yield* Middleware.Session;
                    const result = yield* db.withTransaction(
                        Effect.zipLeft(mfa.verify(session.userId, payload.code), db.sessions.verify(session.sessionId).pipe(withDbError)),
                    ).pipe(withDbError);
                    yield* Audit.log(db.audit, 'MfaSecret', session.userId, 'verify');
                    return result;
                })),
            )
            .handle('disable', () =>
                Effect.gen(function* () {
                    const session = yield* Middleware.Session;
                    yield* Middleware.requireMfaVerified;
                    const result = yield* mfa.disable(session.userId);
                    yield* Audit.log(db.audit, 'MfaSecret', session.userId, 'disable');
                    return result;
                }),
            )
            .handle('recover', ({ payload }) =>
                RateLimit.apply('mfa', Effect.gen(function* () {
                    const session = yield* Middleware.Session;
                    const result = yield* db.withTransaction(
                        Effect.zipLeft(mfa.useRecoveryCode(session.userId, payload.code.toUpperCase()), db.sessions.verify(session.sessionId).pipe(withDbError)),
                    ).pipe(withDbError);
                    return result;
                })),
            );
    }),
).pipe(Layer.provide(MfaService.Default), Layer.provide(MfaSecretsRepositoryLive));

// --- [EXPORT] ----------------------------------------------------------------

export { MfaLive };
