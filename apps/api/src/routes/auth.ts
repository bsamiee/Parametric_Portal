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
import { type DateTime, Duration, Effect, Match, Option, Redacted } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const requireInteractive = Middleware.requireInteractiveSession;

// --- [FUNCTIONS] -------------------------------------------------------------

const requireOption = <A, E>(option: Option.Option<A>, onNone: () => E): Effect.Effect<A, E> => Option.match(option, { onNone: () => Effect.fail(onNone()), onSome: Effect.succeed });
const logoutResponse = () => HttpServerResponse.json({ success: true }).pipe(Effect.flatMap(Context.Request.cookie.clear('refresh')));
const oauthErr = (provider: Context.OAuthProvider) => (reason: string) => HttpError.OAuth.of(provider, reason);
const verifyCsrf = (request: HttpServerRequest.HttpServerRequest) =>
	requireOption(
		Option.filter(Headers.get(request.headers, Context.Request.config.csrf.header), (value) => value === Context.Request.config.csrf.expectedValue),
		() => HttpError.Auth.of('Missing or invalid CSRF header'),
	).pipe(Effect.asVoid);
const _requireMutationContext = Effect.gen(function* () {
	yield* requireInteractive;
	const request = yield* HttpServerRequest.HttpServerRequest;
	yield* verifyCsrf(request);
	yield* Middleware.requireMfaVerified;
});
const authResponse = (token: string, expiresAt: DateTime.Utc, refresh: string, mfaPending: boolean, clearOAuth = false) =>
	HttpServerResponse.json({ accessToken: token, expiresAt, mfaPending }).pipe(
		Effect.flatMap((response) => clearOAuth ? Context.Request.cookie.clear('oauth')(response) : Effect.succeed(response)),
		Effect.flatMap(Context.Request.cookie.set('refresh', refresh)),
	);
const handleOAuthStart = (auth: Auth.Service, provider: Context.OAuthProvider) =>
	Resilience.run('oauth.start', auth.oauthStart(provider), { circuit: 'oauth', timeout: Duration.seconds(15) }).pipe(
		Effect.catchTag('CircuitError', (error) => Effect.fail(HttpError.OAuth.of(provider, 'Service temporarily unavailable', error))),
		Effect.catchTag('TimeoutError', (error) => Effect.fail(HttpError.OAuth.of(provider, 'Request timed out', error))),
		Effect.catchTag('BulkheadError', (error) => Effect.fail(HttpError.OAuth.of(provider, 'Service at capacity', error))),
		Effect.flatMap((result) => Match.value(result).pipe(
			Match.tag('Initiate', (initiate) => HttpServerResponse.json({ url: initiate.authUrl }).pipe(
				Effect.flatMap(Context.Request.cookie.set('oauth', initiate.cookie)),
				Effect.mapError(() => HttpError.OAuth.of(provider, 'Response build failed')),
			)),
			Match.orElse(() => Effect.fail(HttpError.OAuth.of(provider, 'Unexpected response type'))),
		)),
		Telemetry.span('auth.oauth.start', { kind: 'server', metrics: false, 'oauth.provider': provider }),
	);
const handleOAuthCallback = (auth: Auth.Service, provider: Context.OAuthProvider, code: string, state: string) =>
	Effect.gen(function* () {
		const error = oauthErr(provider);
		const request = yield* HttpServerRequest.HttpServerRequest;
		const stateCookie = yield* Context.Request.cookie.get('oauth', request, () => error('Missing OAuth state cookie'));
		const result = yield* Resilience.run('oauth.callback', auth.oauthCallback(provider, code, state, stateCookie), { circuit: 'oauth', timeout: Duration.seconds(15) }).pipe(
			Effect.catchTag('CircuitError', (circuitError) => Effect.fail(HttpError.OAuth.of(provider, 'Service temporarily unavailable', circuitError))),
			Effect.catchTag('TimeoutError', (timeoutError) => Effect.fail(HttpError.OAuth.of(provider, 'Request timed out', timeoutError))),
			Effect.catchTag('BulkheadError', (bulkheadError) => Effect.fail(HttpError.OAuth.of(provider, 'Service at capacity', bulkheadError))),
		);
		return yield* authResponse(result.accessToken, result.expiresAt, result.refreshToken, result.mfaPending, true).pipe(Effect.mapError(() => error('Response build failed')));
	}).pipe(Telemetry.span('auth.oauth.callback', { kind: 'server', metrics: false, 'oauth.provider': provider }),);
const handleRefresh = (auth: Auth.Service, audit: typeof AuditService.Service) =>
	Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest;
		yield* verifyCsrf(request);
		const refreshIn = yield* Context.Request.cookie.get('refresh', request, () => HttpError.Auth.of('Missing refresh token cookie'));
		const tenantId = yield* Context.Request.currentTenantId;
		const hashIn = yield* Crypto.hmac(tenantId, refreshIn).pipe(Effect.mapError((error) => HttpError.Auth.of('Token hashing failed', error)));
		const { accessToken, expiresAt, mfaPending, refreshToken, userId } = yield* auth.refresh(hashIn);
		yield* audit.log('Auth.refresh', { subjectId: userId });
		return yield* authResponse(accessToken, expiresAt, refreshToken, mfaPending).pipe(Effect.mapError((error) => HttpError.Auth.of('Response build failed', error)));
	}).pipe(Telemetry.span('auth.refresh', { kind: 'server', metrics: false }));
const handleLogout = (auth: Auth.Service) =>
	Effect.gen(function* () {
		yield* requireInteractive;
		const request = yield* HttpServerRequest.HttpServerRequest;
		yield* verifyCsrf(request);
		const session = yield* Context.Request.sessionOrFail;
		yield* auth.revoke(session.id, 'logout');
		return yield* logoutResponse().pipe(Effect.mapError((error) => HttpError.Internal.of('Response build failed', error)));
	}).pipe(Telemetry.span('auth.logout', { kind: 'server', metrics: false }));
const handleMe = (repositories: DatabaseService.Type, audit: typeof AuditService.Service) =>
	Effect.gen(function* () {
		yield* requireInteractive;
		yield* Middleware.requireMfaVerified;
		const { userId } = yield* Context.Request.sessionOrFail;
		const user = yield* repositories.users.one([{ field: 'id', value: userId }]).pipe(
			Effect.mapError((error) => HttpError.Internal.of('User lookup failed', error)),
			Effect.flatMap(Option.match({ onNone: () => Effect.fail(HttpError.NotFound.of('user', userId)), onSome: Effect.succeed })),
		);
		yield* audit.log('User.read', { subjectId: userId });
		return user;
	}).pipe(Telemetry.span('auth.me', { kind: 'server', metrics: false }));
const handleMfaStatus = (auth: Auth.Service, audit: typeof AuditService.Service) =>
	Effect.gen(function* () {
		yield* requireInteractive;
		const { userId } = yield* Context.Request.sessionOrFail;
		const status = yield* auth.mfaStatus(userId);
		yield* audit.log('MfaSecret.status', { subjectId: userId });
		return status;
	}).pipe(Telemetry.span('auth.mfa.status', { kind: 'server', metrics: false }));
const handleMfaEnroll = (auth: Auth.Service, repositories: DatabaseService.Type) =>
	CacheService.rateLimit('mfa', Effect.gen(function* () {
		yield* requireInteractive;
		const session = yield* Context.Request.sessionOrFail;
		const userOption = yield* repositories.users.one([{ field: 'id', value: session.userId }]).pipe(Effect.mapError((error) => HttpError.Internal.of('User lookup failed', error)));
		const user = yield* Option.match(userOption, { onNone: () => Effect.fail(HttpError.NotFound.of('user', session.userId)), onSome: Effect.succeed });
		return yield* auth.mfaEnroll(user.id, user.email);
	}).pipe(Telemetry.span('auth.mfa.enroll', { kind: 'server', metrics: false })));
const handleMfaVerify = (auth: Auth.Service, code: string) =>
	CacheService.rateLimit('mfa', Effect.gen(function* () {
		yield* requireInteractive;
		const session = yield* Context.Request.sessionOrFail;
		return yield* auth.mfaVerify(session.id, code);
	}).pipe(Telemetry.span('auth.mfa.verify', { kind: 'server', metrics: false })));
const handleMfaDisable = (auth: Auth.Service) =>
	Effect.gen(function* () {
		yield* requireInteractive;
		yield* Middleware.requireMfaVerified;
		const { userId } = yield* Context.Request.sessionOrFail;
		yield* auth.mfaDisable(userId);
		return { success: true as const };
	}).pipe(Telemetry.span('auth.mfa.disable', { kind: 'server', metrics: false }));
const handleMfaRecover = (auth: Auth.Service, code: string) =>
	CacheService.rateLimit('mfa', Effect.gen(function* () {
		yield* requireInteractive;
		const session = yield* Context.Request.sessionOrFail;
		return yield* auth.mfaRecover(session.id, code.toUpperCase());
	}).pipe(Telemetry.span('auth.mfa.recover', { kind: 'server', metrics: false })));
const handleListApiKeys = (repositories: DatabaseService.Type, audit: typeof AuditService.Service) =>
	Effect.gen(function* () {
		yield* requireInteractive;
		yield* Middleware.requireMfaVerified;
		const { userId } = yield* Context.Request.sessionOrFail;
		const keys = yield* repositories.apiKeys.byUser(userId).pipe(Effect.mapError((error) => HttpError.Internal.of('API key list failed', error)));
		yield* audit.log('ApiKey.list', { details: { count: keys.length }, subjectId: userId });
		return { data: keys };
	}).pipe(Telemetry.span('auth.apiKeys.list', { kind: 'server', metrics: false }));
const _handleApiKeyOperation = (operation: 'create' | 'rotate', repositories: DatabaseService.Type, audit: typeof AuditService.Service, input: { expiresAt?: Date; id?: string; name?: string }) =>
	Effect.gen(function* () {
		yield* _requireMutationContext;
		const [{ userId }, metrics] = yield* Effect.all([Context.Request.sessionOrFail, MetricsService]);
		const pair = yield* Crypto.pair.pipe(Effect.mapError((error) => HttpError.Internal.of('Key generation failed', error)));
		const encrypted = yield* Crypto.encrypt(Redacted.value(pair.token)).pipe(Effect.catchAll((error) => Effect.fail(HttpError.Internal.of('Key encryption failed', error))));
		const record = yield* operation === 'create'
			? repositories.apiKeys.insert({
				deletedAt: Option.none(), encrypted: Buffer.from(encrypted), expiresAt: Option.fromNullable(input.expiresAt), hash: pair.hash,
				lastUsedAt: Option.none(), name: input.name as string, updatedAt: undefined, userId,
			}).pipe(Effect.mapError((error) => HttpError.Internal.of('API key insert failed', error)))
			: Effect.gen(function* () {
				const keyOption = yield* repositories.apiKeys.one([{ field: 'id', value: input.id as string }]).pipe(Effect.mapError((error) => HttpError.Internal.of('API key lookup failed', error)));
				yield* requireOption(keyOption.pipe(Option.filter((apiKey) => apiKey.userId === userId)), () => HttpError.NotFound.of('apikey', input.id as string));
				return yield* repositories.apiKeys.set(input.id as string, { encrypted: Buffer.from(encrypted), hash: pair.hash }).pipe(Effect.mapError((error) => HttpError.Internal.of('API key rotation failed', error)));
			});
		const auditLabel = operation === 'create' ? 'ApiKey.create' as const : 'ApiKey.rotate' as const;
		const auditDetails = operation === 'create'
			? { name: record.name }
			: { keyId: input.id as string, name: record.name };
		const auditSubjectId = operation === 'create' ? record.id : userId;
		yield* Effect.all([
			MetricsService.inc(metrics.auth.apiKeys, MetricsService.label({ operation })),
			audit.log(auditLabel, { details: auditDetails, subjectId: auditSubjectId }),
		], { discard: true });
		return { ...record, apiKey: Redacted.value(pair.token) };
	}).pipe(Telemetry.span(`auth.apiKeys.${operation}`, { kind: 'server', metrics: false }));
const handleCreateApiKey = (repositories: DatabaseService.Type, audit: typeof AuditService.Service, input: { expiresAt?: Date; name: string }) =>
	_handleApiKeyOperation('create', repositories, audit, input) as Effect.Effect<
		Effect.Effect.Success<ReturnType<typeof _handleApiKeyOperation>>,
		Exclude<Effect.Effect.Error<ReturnType<typeof _handleApiKeyOperation>>, HttpError.NotFound>,
		Effect.Effect.Context<ReturnType<typeof _handleApiKeyOperation>>
	>;
const handleDeleteApiKey = (repositories: DatabaseService.Type, audit: typeof AuditService.Service, id: string) =>
	Effect.gen(function* () {
		yield* _requireMutationContext;
		const [{ userId }, metrics] = yield* Effect.all([Context.Request.sessionOrFail, MetricsService]);
		const keyOption = yield* repositories.apiKeys.one([{ field: 'id', value: id }]).pipe(Effect.mapError((error) => HttpError.Internal.of('API key lookup failed', error)));
		const key = yield* requireOption(keyOption.pipe(Option.filter((apiKey) => apiKey.userId === userId)), () => HttpError.NotFound.of('apikey', id));
		yield* repositories.apiKeys.softDelete(id).pipe(Effect.mapError((error) => HttpError.Internal.of('API key revocation failed', error)));
		yield* Effect.all([
			audit.log('ApiKey.revoke', { details: { keyId: id, name: key.name }, subjectId: userId }),
			MetricsService.inc(metrics.auth.apiKeys, MetricsService.label({ operation: 'delete' })),
		], { discard: true });
		return { success: true } as const;
	}).pipe(Telemetry.span('auth.apiKeys.delete', { kind: 'server', metrics: false }));
const handleLinkProvider = (repositories: DatabaseService.Type, audit: typeof AuditService.Service, provider: Context.OAuthProvider, externalId: string) =>
	Effect.gen(function* () {
		yield* _requireMutationContext;
		const { userId } = yield* Context.Request.sessionOrFail;
		const existing = yield* repositories.oauthAccounts.byUser(userId).pipe(Effect.mapError((error) => HttpError.Internal.of('OAuth account lookup failed', error)));
		yield* existing.some((account) => account.provider === provider && Option.isNone(account.deletedAt))
			? Effect.fail(HttpError.Conflict.of('oauth_account', `Provider ${provider} is already linked`))
			: Effect.void;
		const conflicting = yield* repositories.oauthAccounts.byExternal(provider, externalId).pipe(Effect.mapError((error) => HttpError.Internal.of('OAuth account conflict check failed', error)));
		yield* Option.isSome(conflicting)
			? Effect.fail(HttpError.Conflict.of('oauth_account', `External ID is already linked to another account`))
			: Effect.void;
		yield* repositories.oauthAccounts.upsert({
			accessEncrypted: new Uint8Array(0),
			deletedAt: Option.none(),
			expiresAt: Option.none(),
			externalId,
			provider,
			refreshEncrypted: Option.none(),
			scope: Option.none(),
			updatedAt: undefined,
			userId,
		}).pipe(Effect.mapError((error) => HttpError.Internal.of('OAuth account link failed', error)));
		yield* audit.log('OauthAccount.link', { details: { externalId, provider }, subjectId: userId });
		return { success: true as const };
	}).pipe(Telemetry.span('auth.link.provider', { kind: 'server', metrics: false, 'oauth.provider': provider }));
const handleUnlinkProvider = (repositories: DatabaseService.Type, audit: typeof AuditService.Service, provider: Context.OAuthProvider) =>
	Effect.gen(function* () {
		yield* _requireMutationContext;
		const { userId } = yield* Context.Request.sessionOrFail;
		const accounts = yield* repositories.oauthAccounts.byUser(userId).pipe(Effect.mapError((error) => HttpError.Internal.of('OAuth account lookup failed', error)));
		const activeAccounts = accounts.filter((account) => Option.isNone(account.deletedAt));
		const target = yield* requireOption(
			Option.fromNullable(activeAccounts.find((account) => account.provider === provider)),
			() => HttpError.NotFound.of('oauth_account', provider),
		);
		yield* activeAccounts.length <= 1
			? Effect.fail(HttpError.Conflict.of('oauth_account', 'Cannot unlink the last authentication method'))
			: Effect.void;
		yield* repositories.oauthAccounts.softDelete(target.id).pipe(Effect.mapError((error) => HttpError.Internal.of('OAuth account unlink failed', error)));
		yield* audit.log('OauthAccount.unlink', { details: { provider }, subjectId: userId });
		return { success: true as const };
	}).pipe(Telemetry.span('auth.unlink.provider', { kind: 'server', metrics: false, 'oauth.provider': provider }));
const handleRotateApiKey = (repositories: DatabaseService.Type, audit: typeof AuditService.Service, id: string) => _handleApiKeyOperation('rotate', repositories, audit, { id });

// --- [LAYERS] ----------------------------------------------------------------

const AuthLive = HttpApiBuilder.group(ParametricApi, 'auth', (handlers) =>
	Effect.gen(function* () {
		const [repositories, auth, audit] = yield* Effect.all([DatabaseService, Auth.Service, AuditService]);
		return handlers
			// OAuth
			.handleRaw('oauthStart', ({ path: { provider } }) => CacheService.rateLimit('auth', handleOAuthStart(auth, provider)))
			.handleRaw('oauthCallback', ({ path: { provider }, urlParams: { code, state } }) => CacheService.rateLimit('auth', handleOAuthCallback(auth, provider, code, state)))
			// Session
			.handleRaw('refresh', () => CacheService.rateLimit('auth', handleRefresh(auth, audit)))
			.handleRaw('logout', () => CacheService.rateLimit('api', handleLogout(auth)))
			.handle('me', () => CacheService.rateLimit('api', handleMe(repositories, audit)))
			// MFA
			.handle('mfaStatus', () => handleMfaStatus(auth, audit))
			.handle('mfaEnroll', () => handleMfaEnroll(auth, repositories))
			.handle('mfaVerify', ({ payload }) => handleMfaVerify(auth, payload.code))
			.handle('mfaDisable', () => handleMfaDisable(auth))
			.handle('mfaRecover', ({ payload }) => handleMfaRecover(auth, payload.code))
			// API keys
			.handle('listApiKeys', () => CacheService.rateLimit('api', handleListApiKeys(repositories, audit)))
			.handle('createApiKey', ({ payload }) => CacheService.rateLimit('mutation', handleCreateApiKey(repositories, audit, payload)))
			.handle('deleteApiKey', ({ path: { id } }) => CacheService.rateLimit('mutation', handleDeleteApiKey(repositories, audit, id)))
			.handle('rotateApiKey', ({ path: { id } }) => CacheService.rateLimit('mutation', handleRotateApiKey(repositories, audit, id)))
			// OAuth account linking
			.handle('linkProvider', ({ path: { provider }, payload: { externalId } }) => CacheService.rateLimit('mutation', handleLinkProvider(repositories, audit, provider, externalId)))
			.handle('unlinkProvider', ({ path: { provider } }) => CacheService.rateLimit('mutation', handleUnlinkProvider(repositories, audit, provider)));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AuthLive };
