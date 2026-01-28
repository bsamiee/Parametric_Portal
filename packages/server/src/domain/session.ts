/**
 * Session lifecycle: creation, rotation, revocation, MFA-verified state.
 * Delegates TOTP/backup verification to MfaService; owns session.verifiedAt transitions.
 *
 * CACHING: MFA enabled state cached in MfaService to reduce per-request DB lookups.
 * Session lookup requires touch() on each access for activity tracking, so not cached.
 */
import { DatabaseService } from '@parametric-portal/database/repos';
import { type Hex64, Timestamp } from '@parametric-portal/types/types';
import type { SqlError } from '@effect/sql/SqlError';
import { Duration, Effect, Option } from 'effect';
import { Context } from '../context.ts';
import { HttpError } from '../errors.ts';
import { AuditService } from '../observe/audit.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { Crypto } from '../security/crypto.ts';
import { MfaService } from './mfa.ts';

// --- [SERVICES] --------------------------------------------------------------

class SessionService extends Effect.Service<SessionService>()('server/SessionService', {
	effect: Effect.gen(function* () {
		const db = yield* DatabaseService;
		const mfa = yield* MfaService;
		const metrics = yield* MetricsService;
		const audit = yield* AuditService;
		const create = (userId: string, mfaPending: boolean, withTx: <A, E, R>(eff: Effect.Effect<A, E, R>) => Effect.Effect<A, E | SqlError, R> = db.withTransaction) => // Does NOT emit metrics - caller is responsible for login metrics with proper tags.
			Telemetry.span(Effect.gen(function* () {
				const [ctx, session, refresh] = yield* Effect.all([
					Context.Request.current,
					Crypto.pair,
					Crypto.pair,
				]);
				const sessionExpiresAt = Timestamp.expiresAtDate(Duration.toMillis(Context.Request.config.durations.session));
				const verifiedAt = mfaPending ? Option.none<Date>() : Option.some(new Date());
				yield* withTx(Effect.all([
					db.sessions.insert({
						deletedAt: Option.none(),
						expiresAt: sessionExpiresAt,
						hash: session.hash,
						ipAddress: ctx.ipAddress,
						updatedAt: undefined,
						userAgent: ctx.userAgent,
						userId,
						verifiedAt,
					}),
					db.refreshTokens.insert({
						deletedAt: Option.none(),
						expiresAt: Timestamp.expiresAtDate(Duration.toMillis(Context.Request.config.durations.refresh)),
						hash: refresh.hash,
						sessionId: Option.none(),
						userId,
					}),
				], { discard: true }));
				return { mfaPending, refreshToken: refresh.token, sessionExpiresAt, sessionToken: session.token };
			}), 'session.create');
		const login = (userId: string, opts?: { isNewUser?: boolean; provider?: string }) =>	// Create session for login flow. Checks MFA internally, emits auth.logins metric with tags.
			Telemetry.span(Effect.gen(function* () {
				const mfaPending = yield* mfa.isEnabled(userId);	// Fail-closed: MFA status must be known
				const result = yield* create(userId, mfaPending);
				yield* Effect.all([
					Effect.when(
						MetricsService.inc(metrics.auth.logins, MetricsService.label({
							isNewUser: String(opts?.isNewUser ?? false),
							provider: opts?.provider,
						}), 1),
						() => opts?.provider !== undefined,
					),
					audit.log('Session.login', { details: { isNewUser: opts?.isNewUser ?? false, mfaPending, provider: opts?.provider }, subjectId: userId }),
				], { discard: true });
				return result;
			}), 'session.login');
		const refresh = (hash: Hex64) =>			// Rotate tokens: validate refresh hash, check current MFA state, revoke old, create new (atomic). Emits auth.refreshes metric.
			Telemetry.span(Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const refreshed = yield* db.withTransaction(Effect.gen(function* () {
					const token = yield* db.refreshTokens.byHashForUpdate(hash).pipe(
						Effect.flatMap(Option.match({
							onNone: () => Effect.fail(HttpError.Auth.of('Invalid refresh token')),
							onSome: Effect.succeed,
						})),
					);
					yield* db.users.one([{ field: 'id', value: token.userId }]).pipe(
						Effect.flatMap(Option.match({
							onNone: () => Effect.fail(HttpError.Auth.of('User no longer exists')),
							onSome: () => Effect.void,
						})),
					);
					const mfaPending = yield* mfa.isEnabled(token.userId);	// Fail-closed: MFA status must be known
					yield* db.refreshTokens.softDelete(token.id);
					const result = yield* create(token.userId, mfaPending, (eff) => eff);
					return { mfaPending, result, userId: token.userId };
				}));
				yield* Effect.all([
					MetricsService.inc(metrics.auth.refreshes, MetricsService.label({ tenant: ctx.tenantId }), 1),
					audit.log('Session.refresh', { details: { mfaPending: refreshed.mfaPending }, subjectId: refreshed.userId }),
				], { discard: true });
				return { ...refreshed.result, userId: refreshed.userId };
			}).pipe(Effect.mapError((e) => e instanceof HttpError.Auth ? e : HttpError.Auth.of('Token refresh failed', e))), 'session.refresh');
		const revoke = (sessionId: string) =>	// Revoke single session. Emits auth.logouts metric.
			Telemetry.span(Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				yield* db.sessions.softDelete(sessionId);
				yield* Effect.all([
					MetricsService.inc(metrics.auth.logouts, MetricsService.label({ tenant: ctx.tenantId }), 1),
					audit.log('Session.revoke', { subjectId: sessionId }),
				], { discard: true });
			}).pipe(Effect.mapError((e) => HttpError.Internal.of('Session revocation failed', e))), 'session.revoke');
		const revokeAll = (userId: string) =>	// Revoke all sessions and refresh tokens for user atomically. Emits auth.logouts metric.
			Telemetry.span(Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				yield* db.withTransaction(Effect.all([
					db.sessions.softDeleteByUser(userId),
					db.refreshTokens.softDeleteByUser(userId),
				], { discard: true }));
				yield* Effect.all([
					MetricsService.inc(metrics.auth.logouts, MetricsService.label({ bulk: 'true', tenant: ctx.tenantId }), 1),
					audit.log('Session.revokeAll', { details: { bulk: true }, subjectId: userId }),
				], { discard: true });
			}).pipe(Effect.mapError((e) => HttpError.Internal.of('Bulk session revocation failed', e))), 'session.revokeAll');
		// Verify TOTP code and mark session as verified. Delegates verification to MfaService (which handles mfa.verifications metric).
		const verifyMfa = (sessionId: string, userId: string, code: string) =>
			mfa.verify(userId, code).pipe(
				Effect.tap(() => db.sessions.verify(sessionId).pipe(
					Effect.mapError((e) => HttpError.Internal.of('Session verification update failed', e)),
				)),
				Effect.tap(() => audit.log('Session.verifyMfa', { details: { userId }, subjectId: sessionId })),
				Effect.map(() => ({ success: true as const, verifiedAt: new Date() })),
				Telemetry.span('session.verifyMfa'),
			);
		const recoverMfa = (sessionId: string, userId: string, code: string) =>	// Use backup code and mark session as verified. Delegates verification to MfaService (which handles mfa.recoveryUsed metric).
			mfa.useRecoveryCode(userId, code).pipe(
				Effect.tap(() => db.sessions.verify(sessionId).pipe(
					Effect.mapError((e) => HttpError.Internal.of('Session verification update failed', e)),
				)),
				Effect.tap(() => audit.log('Session.recoverMfa', { details: { userId }, subjectId: sessionId })),
				Effect.map((result) => ({ ...result, verifiedAt: new Date() })),
				Telemetry.span('session.recoverMfa'),
			);
		const lookup = (hash: Hex64) =>	// Lookup session by token hash. For middleware authentication. Touches session activity, checks MFA state (cached), fails silently on errors.
			db.sessions.byHash(hash).pipe(
				Effect.flatMap(Option.match({
					onNone: () => Effect.succeed(Option.none<Context.Request.Session>()),
					onSome: (s) => db.sessions.touch(s.id).pipe(
						Effect.catchAll((err) => Effect.logWarning('Session activity update failed', { error: String(err), sessionId: s.id })),
						Effect.andThen(mfa.isEnabled(s.userId)),
						Effect.map((mfaEnabled) => Option.some({ id: s.id, mfaEnabled, userId: s.userId, verifiedAt: s.verifiedAt })),
					),
				})),
				Effect.catchAll((e) => Effect.logError('Session lookup failed', { error: String(e) }).pipe(Effect.as(Option.none()))),
			);
		return { create, login, lookup, recoverMfa, refresh, revoke, revokeAll, verifyMfa };
	}),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { SessionService };
