/**
 * Session lifecycle: creation, rotation, revocation, MFA-verified state.
 * Delegates TOTP/backup verification to MfaService; owns session.verifiedAt transitions.
 * Includes MFA status cache (5min TTL) to reduce per-request DB lookups.
 */
import { DatabaseService } from '@parametric-portal/database/repos';
import { type Hex64, Timestamp } from '@parametric-portal/types/types';
import { Cache, Duration, Effect, Option } from 'effect';
import { Context } from '../context.ts';
import { HttpError } from '../errors.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Crypto } from '../security/crypto.ts';
import { MfaService } from './mfa.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _mfaCacheConfig = { capacity: 5000, ttl: Duration.minutes(5) } as const;

// --- [SERVICES] --------------------------------------------------------------

class SessionService extends Effect.Service<SessionService>()('server/SessionService', {
	effect: Effect.gen(function* () {
		const db = yield* DatabaseService;
		const mfa = yield* MfaService;
		const metrics = yield* MetricsService;
		const mfaEnabledCache = yield* Cache.make({
			capacity: _mfaCacheConfig.capacity,
			lookup: (userId: string) => mfa.isEnabled(userId).pipe(Effect.catchAll(() => Effect.succeed(false))),
			timeToLive: _mfaCacheConfig.ttl,
		});
		const create = (userId: string, mfaPending: boolean) => // Does NOT emit metrics - caller is responsible for login metrics with proper tags.
			Effect.gen(function* () {
				const [ctx, session, refresh] = yield* Effect.all([
					Context.Request.current,
					Crypto.token.pair,
					Crypto.token.pair,
				]);
				const sessionExpiresAt = Timestamp.expiresAtDate(Duration.toMillis(Context.Request.config.durations.session));
				const verifiedAt = mfaPending ? Option.none<Date>() : Option.some(new Date());
				yield* db.withTransaction(Effect.all([
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
			}).pipe(Effect.withSpan('session.create'));
		const createForLogin = (userId: string, opts?: { isNewUser?: boolean; provider?: string }) =>	// Create session for login flow. Checks MFA internally, emits auth.logins metric with tags.
			Effect.gen(function* () {
				const mfaPending = yield* mfa.isEnabled(userId).pipe(Effect.catchAll(() => Effect.succeed(false)));
				const result = yield* create(userId, mfaPending);
				yield* Effect.when(					// Only emit login metrics when provider is specified (OAuth/password flows, not token refresh)
					Effect.suspend(() => MetricsService.inc(metrics.auth.logins, MetricsService.label({
						isNewUser: String(opts?.isNewUser ?? false),
						provider: opts?.provider, 	// undefined is filtered by MetricsService.label
					}), 1)),
					() => opts?.provider !== undefined,
				);
				return result;
			}).pipe(Effect.withSpan('session.createForLogin'));
		const refresh = (hash: Hex64) =>			// Rotate tokens: validate refresh hash, check current MFA state, create new session, revoke old. Emits auth.refreshes metric.
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const tokenOpt = yield* db.refreshTokens.byHashForUpdate(hash);
				const token = yield* Option.match(tokenOpt, {
					onNone: () => Effect.fail(HttpError.Auth.of('Invalid refresh token')),
					onSome: Effect.succeed,
				});
				// Verify user still exists and is not deleted/banned
				const userOpt = yield* db.users.one([{ field: 'id', value: token.userId }]).pipe(Effect.catchAll(() => Effect.succeed(Option.none())));
				yield* Option.match(userOpt, {
					onNone: () => Effect.fail(HttpError.Auth.of('User no longer exists')),
					onSome: Effect.succeed,
				});
				// Check current MFA state - user might have enabled MFA since last login
				const mfaPending = yield* mfa.isEnabled(token.userId).pipe(Effect.catchAll(() => Effect.succeed(false)));
				const result = yield* create(token.userId, mfaPending);
				yield* db.refreshTokens.softDelete(token.id);
				yield* MetricsService.inc(metrics.auth.refreshes, MetricsService.label({ tenant: ctx.tenantId }), 1);
				return { ...result, userId: token.userId };
			}).pipe(
				Effect.mapError((e) => e instanceof HttpError.Auth ? e : HttpError.Auth.of('Token lookup failed', e)),
				Effect.withSpan('session.refresh'),
			);
		const revoke = (sessionId: string) =>	// Revoke single session. Emits auth.logouts metric.
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				yield* db.sessions.softDelete(sessionId);
				yield* MetricsService.inc(metrics.auth.logouts, MetricsService.label({ tenant: ctx.tenantId }), 1);
			}).pipe(
				Effect.mapError((e) => HttpError.Internal.of('Session revocation failed', e)),
				Effect.withSpan('session.revoke'),
			);
		const revokeAll = (userId: string) =>	// Revoke all sessions and refresh tokens for user. No metrics (bulk operation).
			Effect.all([
				db.sessions.softDeleteByUser(userId),
				db.refreshTokens.softDeleteByUser(userId),
			], { discard: true }).pipe(
				Effect.mapError((e) => HttpError.Internal.of('Bulk session revocation failed', e)),
				Effect.withSpan('session.revokeAll'),
			);
		// Verify TOTP code and mark session as verified. Delegates verification to MfaService (which handles mfa.verifications metric).
		// Invalidates MFA cache since verify() might enable MFA on first successful verification.
		const verifyMfa = (sessionId: string, userId: string, code: string) =>
			mfa.verify(userId, code).pipe(
				Effect.tap(() => mfaEnabledCache.invalidate(userId)),
				Effect.tap(() => db.sessions.verify(sessionId).pipe(
					Effect.mapError((e) => HttpError.Internal.of('Session verification update failed', e)),
				)),
				Effect.map(() => ({ success: true as const, verifiedAt: new Date() })),
				Effect.withSpan('session.verifyMfa'),
			);
		const recoverMfa = (sessionId: string, userId: string, code: string) =>	// Use backup code and mark session as verified. Delegates verification to MfaService (which handles mfa.recoveryUsed metric).
			mfa.useRecoveryCode(userId, code).pipe(
				Effect.tap(() => db.sessions.verify(sessionId).pipe(
					Effect.mapError((e) => HttpError.Internal.of('Session verification update failed', e)),
				)),
				Effect.map((result) => ({ ...result, verifiedAt: new Date() })),
				Effect.withSpan('session.recoverMfa'),
			);
		const lookup = (hash: Hex64) =>	// Lookup session by token hash. For middleware authentication. Touches session activity, checks MFA state (cached), fails silently on errors.
			db.sessions.byHash(hash).pipe(
				Effect.flatMap(Option.match({
					onNone: () => Effect.succeed(Option.none<Context.Request.Session>()),
					onSome: (s) => db.sessions.touch(s.id).pipe(
						Effect.catchAll((err) => Effect.logWarning('Session activity update failed', { error: String(err), sessionId: s.id })),
						Effect.andThen(mfaEnabledCache.get(s.userId)),
						Effect.map((mfaEnabled) => Option.some({ id: s.id, mfaEnabled, userId: s.userId, verifiedAt: s.verifiedAt })),
					),
				})),
				Effect.catchAll((e) => Effect.logError('Session lookup failed', { error: String(e) }).pipe(Effect.as(Option.none()))),
			);
		const invalidateMfaCache = (userId: string) => mfaEnabledCache.invalidate(userId);	// Invalidate MFA cache when status changes (called from MfaService on enable/disable)
		return { create, createForLogin, invalidateMfaCache, lookup, recoverMfa, refresh, revoke, revokeAll, verifyMfa };
	}),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { SessionService };
