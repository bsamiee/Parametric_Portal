/**
 * Auth group handlers for OAuth flows, session management, MFA, and API keys.
 *
 * [SECURITY_DESIGN] Token Storage Architecture:
 * - Access tokens: Returned in JSON body for SPA consumption via Authorization header.
 *   Trade-off: XSS can extract tokens, but enables stateless API authentication and
 *   cross-origin requests. Mitigated by short expiry (7 days) and refresh rotation.
 * - Refresh tokens: HttpOnly cookie only (never in response body). XSS-immune, used
 *   solely for silent token refresh. 30-day expiry with automatic rotation.
 * - Session tokens: Server-side only (hash stored in DB). Never exposed to client.
 */
import { Headers, HttpApiBuilder, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { Auth } from '@parametric-portal/server/domain/auth';
import { HttpError } from '@parametric-portal/server/errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { Crypto } from '@parametric-portal/server/security/crypto';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Resilience } from '@parametric-portal/server/utils/resilience';
import { constant, flow } from 'effect/Function';
import { Array as Arr, Duration, Effect, Match, Option, Predicate, Redacted, Struct } from 'effect';

// --- [FUNCTIONS] -------------------------------------------------------------

const _csrf = HttpServerRequest.HttpServerRequest.pipe(
	Effect.flatMap((request) =>
		Option.match(
			Option.filter(Headers.get(request.headers, Context.Request.config.csrf.header), (value) => value === Context.Request.config.csrf.expectedValue),
			{ onNone: () => Effect.fail(HttpError.Auth.of('Missing or invalid CSRF header')), onSome: () => Effect.void },
		),
	),
);
const _handleApiKeyOperation = (operation: 'create' | 'rotate', repositories: DatabaseService.Type, audit: typeof AuditService.Service, input: { expiresAt?: Date; id?: string; name?: string }) =>
	Effect.gen(function* () {
		yield* _csrf;
		const [{ userId }, metrics, tenantId] = yield* Effect.all([Context.Request.sessionOrFail, MetricsService, Context.Request.currentTenantId]);
		const pair = yield* Crypto.pair.pipe(Effect.mapError((error) => HttpError.Internal.of('Key generation failed', error)));
		const token = Redacted.value(pair.token);
		const [hash, encrypted] = yield* Effect.all([
			Crypto.hmac(tenantId, token).pipe(Effect.mapError((error) => HttpError.Internal.of('Key hashing failed', error))),
			Crypto.encrypt(token).pipe(Effect.mapError((error) => HttpError.Internal.of('Key encryption failed', error))),
		]);
		const record = yield* operation === 'create'
			? repositories.apiKeys.insert({
				deletedAt: Option.none(), encrypted: Buffer.from(encrypted), expiresAt: Option.fromNullable(input.expiresAt), hash,
				lastUsedAt: Option.none(), name: input.name ?? '', updatedAt: undefined, userId,
			}).pipe(Effect.mapError((error) => HttpError.Internal.of('API key insert failed', error)))
			: Effect.gen(function* () {
				const keyOption = yield* repositories.apiKeys.one([{ field: 'id', value: input.id as string }]).pipe(Effect.mapError((error) => HttpError.Internal.of('API key lookup failed', error)));
				yield* Option.match(keyOption.pipe(Option.filter((apiKey) => apiKey.userId === userId)), {
					onNone: () => Effect.fail(HttpError.NotFound.of('apikey', input.id as string)),
					onSome: Effect.succeed,
				});
				return yield* repositories.apiKeys.set(input.id as string, { encrypted: Buffer.from(encrypted), hash }).pipe(Effect.mapError((error) => HttpError.Internal.of('API key rotation failed', error)));
			});
		const auditEntry = {
			create: { details: { name: record.name }, label: 'ApiKey.create' as const, subjectId: record.id },
			rotate: { details: { keyId: input.id as string, name: record.name }, label: 'ApiKey.update' as const, subjectId: userId },
		}[operation];
		yield* Effect.all([
			MetricsService.inc(metrics.auth.apiKeys, MetricsService.label({ operation })),
			audit.log(auditEntry.label, { details: auditEntry.details, subjectId: auditEntry.subjectId }),
		], { discard: true });
		return { ...record, apiKey: Redacted.value(pair.token) };
	}).pipe(Telemetry.span(`auth.apiKeys.${operation}`));

// --- [LAYERS] ----------------------------------------------------------------

const AuthLive = HttpApiBuilder.group(ParametricApi, 'auth', (handlers) =>
	Effect.gen(function* () {
		const [repositories, auth, audit] = yield* Effect.all([DatabaseService, Auth.Service, AuditService]);
		return handlers
			// OAuth
			.handleRaw('oauthStart', ({ path: { provider } }) =>
				CacheService.rateLimit('auth', Middleware.feature('enableOAuth').pipe(Effect.andThen(Resilience.run('oauth.start', auth.oauth.start(provider), { circuit: 'oauth', timeout: Duration.seconds(15) })),
					Effect.catchTags({
						BulkheadError: constant(Effect.fail(HttpError.OAuth.of(provider, 'Service at capacity'))),
						CircuitError: constant(Effect.fail(HttpError.OAuth.of(provider, 'Service temporarily unavailable'))),
						TimeoutError: constant(Effect.fail(HttpError.OAuth.of(provider, 'Request timed out'))),
					}),
					Effect.filterOrFail(
						(result): result is Extract<typeof result, { readonly _tag: 'Initiate' }> => result._tag === 'Initiate',
						constant(HttpError.OAuth.of(provider, 'Unexpected response type')),
					),
					Effect.flatMap((initiate) => HttpServerResponse.json({ url: initiate.authUrl }).pipe(
						Effect.flatMap(Context.Request.cookie.set('oauth', initiate.cookie)),
						Effect.mapError(constant(HttpError.OAuth.of(provider, 'Response build failed'))),
					)),
					Telemetry.span('auth.oauth.start', { 'oauth.provider': provider }),
				)))
			.handleRaw('oauthCallback', ({ path: { provider }, urlParams: { code, state } }) =>
				CacheService.rateLimit('auth', Effect.gen(function* () {
					yield* Middleware.feature('enableOAuth');
					const request = yield* HttpServerRequest.HttpServerRequest;
					const stateCookie = yield* Context.Request.cookie.get('oauth', request, constant(HttpError.OAuth.of(provider, 'Missing OAuth state cookie')));
					const result = yield* Resilience.run('oauth.callback', auth.oauth.callback(provider, code, state, stateCookie), { circuit: 'oauth', timeout: Duration.seconds(15) }).pipe(
						Effect.catchTags({
							BulkheadError: constant(Effect.fail(HttpError.OAuth.of(provider, 'Service at capacity'))),
							CircuitError: constant(Effect.fail(HttpError.OAuth.of(provider, 'Service temporarily unavailable'))),
							TimeoutError: constant(Effect.fail(HttpError.OAuth.of(provider, 'Request timed out'))),
						}),
					);
					return yield* HttpServerResponse.json({ accessToken: result.accessToken, expiresAt: result.expiresAt, mfaPending: result.mfaPending }).pipe(
						Effect.flatMap(Context.Request.cookie.clear('oauth')),
						Effect.flatMap(Context.Request.cookie.set('refresh', result.refreshToken)),
						Effect.mapError(constant(HttpError.OAuth.of(provider, 'Response build failed'))),
					);
				}).pipe(Telemetry.span('auth.oauth.callback', { 'oauth.provider': provider }))))
			// Session
			.handleRaw('refresh', () =>
				CacheService.rateLimit('auth', Effect.gen(function* () {
					yield* _csrf;
					const request = yield* HttpServerRequest.HttpServerRequest;
					const refreshIn = yield* Context.Request.cookie.get('refresh', request, constant(HttpError.Auth.of('Missing refresh token cookie')));
					const tenantId = yield* Context.Request.currentTenantId;
					const hashIn = yield* Crypto.hmac(tenantId, refreshIn).pipe(Effect.mapError(constant(HttpError.Auth.of('Token hashing failed'))));
					const { accessToken, expiresAt, mfaPending, refreshToken, userId } = yield* auth.session.refresh(hashIn);
					yield* audit.log('Auth.refresh', { subjectId: userId });
					return yield* HttpServerResponse.json({ accessToken, expiresAt, mfaPending }).pipe(
						Effect.flatMap(Context.Request.cookie.set('refresh', refreshToken)),
						Effect.mapError(constant(HttpError.Auth.of('Response build failed'))),
					);
				}).pipe(Telemetry.span('auth.refresh'))))
			.handleRaw('logout', () =>
				Middleware.guarded('auth', 'logout', 'api', Effect.gen(function* () {
					yield* _csrf;
					const session = yield* Context.Request.sessionOrFail;
					yield* auth.session.revoke(session.id, 'logout');
					return yield* HttpServerResponse.json({ success: true }).pipe(
						Effect.flatMap(Context.Request.cookie.clear('refresh')),
						Effect.mapError(constant(HttpError.Internal.of('Response build failed'))),
					);
				}).pipe(Telemetry.span('auth.logout'))))
			.handle('me', () =>
				Middleware.guarded('auth', 'me', 'api', Effect.gen(function* () {
					const { userId } = yield* Context.Request.sessionOrFail;
					const user = yield* repositories.users.one([{ field: 'id', value: userId }]).pipe(
						Effect.mapError(constant(HttpError.Internal.of('User lookup failed'))),
						Effect.flatMap(Option.match({ onNone: constant(Effect.fail(HttpError.NotFound.of('user', userId))), onSome: Effect.succeed })),
					);
					yield* audit.log('User.read', { subjectId: userId });
					return user;
				}).pipe(Telemetry.span('auth.me'))))
			// MFA
			.handle('mfaStatus', () =>
				Effect.gen(function* () {
					yield* Middleware.feature('enableMfa');
					yield* Middleware.permission('auth', 'mfaStatus');
					const { userId } = yield* Context.Request.sessionOrFail;
					const status = yield* auth.mfa.status(userId);
					yield* audit.log('MfaSecret.status', { subjectId: userId });
					return status;
				}).pipe(Telemetry.span('auth.mfa.status')))
			.handle('mfaEnroll', () =>
				CacheService.rateLimit('mfa', Effect.gen(function* () {
					yield* Middleware.feature('enableMfa');
					yield* Middleware.permission('auth', 'mfaEnroll');
					const session = yield* Context.Request.sessionOrFail;
					const userOption = yield* repositories.users.one([{ field: 'id', value: session.userId }]).pipe(Effect.mapError(constant(HttpError.Internal.of('User lookup failed'))));
					const user = yield* Option.match(userOption, { onNone: constant(Effect.fail(HttpError.NotFound.of('user', session.userId))), onSome: Effect.succeed });
					return yield* auth.mfa.enroll(user.id, user.email);
				}).pipe(Telemetry.span('auth.mfa.enroll'))))
			.handle('mfaVerify', ({ payload }) =>
				CacheService.rateLimit('mfa', Effect.gen(function* () {
					yield* Middleware.feature('enableMfa');
					yield* Middleware.permission('auth', 'mfaVerify');
					const session = yield* Context.Request.sessionOrFail;
					return yield* auth.mfa.verify(session.id, payload.code, 'totp');
				}).pipe(Telemetry.span('auth.mfa.verify'))))
			.handle('mfaDisable', () =>
				Effect.gen(function* () {
					yield* Middleware.feature('enableMfa');
					yield* Middleware.permission('auth', 'mfaDisable');
					const { userId } = yield* Context.Request.sessionOrFail;
					yield* auth.mfa.disable(userId);
					return { success: true as const };
				}).pipe(Telemetry.span('auth.mfa.disable')))
			.handle('mfaRecover', ({ payload }) =>
				CacheService.rateLimit('mfa', Middleware.feature('enableMfa').pipe(
					Effect.andThen(Middleware.permission('auth', 'mfaRecover')),
					Effect.andThen(Context.Request.sessionOrFail),
					Effect.flatMap((session) => auth.mfa.verify(session.id, payload.code.toUpperCase(), 'backup')),
					Effect.filterOrFail(
						(value): value is { readonly remainingCodes: number; readonly success: true } => 'remainingCodes' in value,
						constant(HttpError.Internal.of('MFA recovery response invalid')),
					),
					Telemetry.span('auth.mfa.recover'),
				)))
			// API keys
			.handle('listApiKeys', () =>
				Middleware.guarded('auth', 'listApiKeys', 'api', Effect.gen(function* () {
					yield* Middleware.feature('enableApiKeys');
					const { userId } = yield* Context.Request.sessionOrFail;
					const keys = yield* repositories.apiKeys.byUser(userId).pipe(Effect.mapError(constant(HttpError.Internal.of('API key list failed'))));
					yield* audit.log('ApiKey.list', { details: { count: keys.length }, subjectId: userId });
					return { data: keys };
				}).pipe(Telemetry.span('auth.apiKeys.list'))))
			.handle('createApiKey', ({ payload }) =>
				Middleware.guarded('auth', 'createApiKey', 'mutation', Middleware.feature('enableApiKeys').pipe(Effect.andThen(_handleApiKeyOperation('create', repositories, audit, payload))) as Effect.Effect<
					Effect.Effect.Success<ReturnType<typeof _handleApiKeyOperation>>,
					Exclude<Effect.Effect.Error<ReturnType<typeof _handleApiKeyOperation>>, HttpError.NotFound>,
					Effect.Effect.Context<ReturnType<typeof _handleApiKeyOperation>>
				>))
			.handle('deleteApiKey', ({ path: { id } }) =>
				Middleware.guarded('auth', 'deleteApiKey', 'mutation', Middleware.feature('enableApiKeys').pipe(
					Effect.andThen(_csrf),
					Effect.andThen(Effect.Do),
					Effect.bind('session', constant(Context.Request.sessionOrFail)),
					Effect.bind('metrics', constant(MetricsService)),
					Effect.bind('key', constant(repositories.apiKeys.one([{ field: 'id', value: id }]).pipe(
						Effect.mapError(constant(HttpError.Internal.of('API key lookup failed'))),
						Effect.flatMap(Option.match({ onNone: constant(Effect.fail(HttpError.NotFound.of('apikey', id))), onSome: Effect.succeed })),
					))),
					Effect.filterOrFail(
						({ key, session }) => key.userId === session.userId,
						constant(HttpError.NotFound.of('apikey', id)),
					),
					Effect.tap(constant(repositories.apiKeys.softDelete(id).pipe(Effect.mapError(constant(HttpError.Internal.of('API key revocation failed')))))),
					Effect.tap(({ session, metrics, key }) => Effect.all([
						audit.log('ApiKey.revoke', { details: { keyId: id, name: key.name }, subjectId: session.userId }),
						MetricsService.inc(metrics.auth.apiKeys, MetricsService.label({ operation: 'delete' })),
					], { discard: true })),
					Effect.as({ success: true } as const),
					Telemetry.span('auth.apiKeys.delete'),
				)))
			.handle('rotateApiKey', ({ path: { id } }) =>
				Middleware.guarded('auth', 'rotateApiKey', 'mutation', Middleware.feature('enableApiKeys').pipe(Effect.andThen(_handleApiKeyOperation('rotate', repositories, audit, { id })))))
			// OAuth account linking
			.handle('linkProvider', ({ path: { provider }, payload: { externalId } }) =>
				Middleware.guarded('auth', 'linkProvider', 'mutation', Middleware.feature('enableOAuth').pipe(
					Effect.andThen(_csrf),
					Effect.andThen(Effect.Do),
					Effect.bind('session', constant(Context.Request.sessionOrFail)),
					Effect.bind('existing', ({ session }) => repositories.oauthAccounts.byUser(session.userId).pipe(
						Effect.mapError(constant(HttpError.Internal.of('OAuth account lookup failed'))),
					)),
					Effect.filterOrFail(
						flow(
							Struct.get('existing'),
							Predicate.not(Arr.some(Predicate.and(
								flow(Struct.get('provider'), (p: string) => p === provider),
								flow(Struct.get('deletedAt'), Option.isNone),
							))),
						),
						constant(HttpError.Conflict.of('oauth_account', `Provider ${provider} is already linked`)),
					),
					Effect.bind('externalAccount', constant(repositories.oauthAccounts.byExternal(provider, externalId).pipe(
						Effect.mapError(constant(HttpError.Internal.of('OAuth account conflict check failed'))),
					))),
					Effect.let('linkAction', ({ externalAccount, session }) => {
						const account = Option.getOrNull(externalAccount);
						return {
							accountId: account?.id ?? '',
							canRestore: account !== null && account.userId === session.userId && Option.isSome(account.deletedAt),
							isNone: account === null,
							session,
						};
					}),
					Effect.tap(({ linkAction }) => Match.value(linkAction).pipe(
						Match.when({ isNone: true }, constant(repositories.oauthAccounts.insert({
							deletedAt: Option.none(),
							externalId,
							provider,
							tokenPayload: new Uint8Array(0),
							updatedAt: undefined,
							userId: linkAction.session.userId,
						}).pipe(Effect.mapError(constant(HttpError.Internal.of('OAuth account link failed'))), Effect.asVoid))),
						Match.when({ canRestore: true }, constant(repositories.oauthAccounts.restore(linkAction.accountId).pipe(
							Effect.mapError(constant(HttpError.Internal.of('OAuth account restore failed'))),
							Effect.asVoid,
						))),
						Match.orElse(constant(Effect.fail(HttpError.Conflict.of('oauth_account', 'External ID is already linked to another account')))),
					)),
					Effect.tap(({ session }) => audit.log('OauthAccount.create', { details: { externalId, provider }, subjectId: session.userId })),
					Effect.as({ success: true as const }),
					Telemetry.span('auth.link.provider', { 'oauth.provider': provider }),
				)))
			.handle('unlinkProvider', ({ path: { provider } }) =>
				Middleware.guarded('auth', 'unlinkProvider', 'mutation', Middleware.feature('enableOAuth').pipe(
					Effect.andThen(_csrf),
					Effect.andThen(Effect.Do),
					Effect.bind('session', constant(Context.Request.sessionOrFail)),
					Effect.bind('accounts', ({ session }) => repositories.oauthAccounts.byUser(session.userId).pipe(
						Effect.mapError(constant(HttpError.Internal.of('OAuth account lookup failed'))),
					)),
					Effect.let('activeAccounts', ({ accounts }) => Arr.filter(accounts, flow(Struct.get('deletedAt'), Option.isNone))),
					Effect.let('matchProvider', constant(flow(Struct.get('provider') as (a: { provider: string }) => string, (p: string) => p === provider))),
					Effect.bind('target', ({ activeAccounts, matchProvider }) => Option.match(
						Arr.findFirst(activeAccounts, matchProvider),
						{ onNone: constant(Effect.fail(HttpError.NotFound.of('oauth_account', provider))), onSome: Effect.succeed },
					)),
					Effect.filterOrFail(
						({ activeAccounts }) => activeAccounts.length > 1,
						constant(HttpError.Conflict.of('oauth_account', 'Cannot unlink the last authentication method')),
					),
					Effect.tap(({ target }) => repositories.oauthAccounts.softDelete(target.id).pipe(Effect.mapError(constant(HttpError.Internal.of('OAuth account unlink failed'))))),
					Effect.tap(({ session }) => audit.log('OauthAccount.delete', { details: { provider }, subjectId: session.userId })),
					Effect.as({ success: true as const }),
					Telemetry.span('auth.unlink.provider', { 'oauth.provider': provider }),
				)));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AuthLive };
