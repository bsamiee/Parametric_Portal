import { AiError as AiSdkError, type Telemetry as AiTelemetry, type Response } from '@effect/ai';
import { FetchHttpClient, FileSystem, HttpClient, HttpClientRequest } from '@effect/platform';
import { SqlClient } from '@effect/sql';
import { Client } from '@parametric-portal/database/client';
import { DatabaseService, PersistenceService } from '@parametric-portal/database/repos';
import { Config, Data, Effect, FiberRef, HashMap, Match, Option, Redacted, Ref, Schema as S } from 'effect';
import { identity } from 'effect/Function';
import { AiRegistry } from './registry.ts';

// --- [ERRORS] ----------------------------------------------------------------

class AiError extends Data.TaggedError('AiError')<{
    readonly cause:     unknown;
    readonly operation: string;
    readonly reason:    'budget_exceeded' | 'missing_selection' | 'policy_denied' | 'rate_exceeded' | 'request_tokens_exceeded' | 'unknown';
}> {
    override get message() { return `AiError[${this.operation}/${this.reason}]: ${String(this.cause)}`; }
    static readonly from = (operation: string) => Match.type<unknown>().pipe(
        Match.withReturnType<AiSdkError.AiError | AiError>(),
        Match.when(AiSdkError.isAiError, identity),
        Match.when(Match.instanceOf(AiError), identity),
        Match.orElse((cause) => new AiError({ cause, operation, reason: 'unknown' })),
    );
}

// --- [SCHEMA] ----------------------------------------------------------------

const _GeminiDesktopClientSchema = S.parseJson(S.Struct({
    installed: S.Struct({
        auth_uri:      S.String,
        client_id:     S.NonEmptyTrimmedString,
        client_secret: S.NonEmptyTrimmedString,
        project_id:    S.NonEmptyTrimmedString,
        token_uri:     S.String,
    }),
}));
const _GeminiTokenResponse = S.Struct({
    access_token:  S.NonEmptyTrimmedString,
    expires_in:    S.Int.pipe(S.greaterThan(0)),
    refresh_token: S.optional(S.NonEmptyTrimmedString),
});
const _GeminiSessionSchema = S.Struct({
    accessToken:  S.NonEmptyTrimmedString,
    expiresAt:    S.String,
    refreshToken: S.NonEmptyTrimmedString,
});
const _DailyUsageSchema = S.Struct({ tokens: S.Int.pipe(S.greaterThanOrEqualTo(0)) });
const _MinuteUsageSchema = S.Struct({ requests: S.Int.pipe(S.greaterThanOrEqualTo(0)) });

// --- [FUNCTIONS] -------------------------------------------------------------

const _tokenRequest = (tokenUri: string, params: Record<string, string>) =>
    HttpClientRequest.post(tokenUri).pipe(
        HttpClientRequest.bodyUrlParams(params),
        HttpClientRequest.setHeader('content-type', 'application/x-www-form-urlencoded'),
        HttpClient.execute,
        Effect.flatMap((response) => response.json),
        Effect.scoped,
        Effect.provide(FetchHttpClient.layer),
        Effect.flatMap(S.decodeUnknown(_GeminiTokenResponse)),
        Effect.map((decoded) => ({
            accessToken:  decoded.access_token,
            expiresAt:    new Date(Date.now() + decoded.expires_in * 1_000).toISOString(),
            refreshToken: decoded.refresh_token,
        })),
    );
const _decodeGeminiClient = (raw: unknown) => S.decodeUnknown(_GeminiDesktopClientSchema)(raw).pipe(
    Effect.map(({ installed }) => ({
        authUri:      installed.auth_uri,
        clientId:     installed.client_id,
        clientSecret: installed.client_secret,
        projectId:    installed.project_id,
        tokenUri:     installed.token_uri,
    })),
);
type _GeminiDesktopClient = Effect.Effect.Success<ReturnType<typeof _decodeGeminiClient>>;
const _refreshGeminiAccessToken = (input: { readonly client: _GeminiDesktopClient; readonly refreshToken: string }) =>
    _tokenRequest(input.client.tokenUri, {
        client_id: input.client.clientId,
        client_secret: input.client.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
    });
const _resolveGeminiCredential = (options?: {
    readonly persistRefresh?: ((data: typeof _GeminiSessionSchema.Type) => Effect.Effect<void, unknown, never>) | undefined;
    readonly persistedSession?: Effect.Effect<Option.Option<typeof _GeminiSessionSchema.Type>, unknown, never>;
}) => Effect.gen(function* () {
    const metadata = AiRegistry.providers.gemini.credential;
    const [accessToken, clientPath, refreshToken, tokenExpiry, persistedSession] = yield* Effect.all([
        Config.redacted(metadata.configKeys.accessToken).pipe(Config.option),
        Config.string(metadata.configKeys.clientPath),
        Config.redacted(metadata.configKeys.refreshToken).pipe(Config.option),
        Config.string(metadata.configKeys.expiry).pipe(Config.option),
        options?.persistedSession ?? Effect.succeed(Option.none<typeof _GeminiSessionSchema.Type>()),
    ]);
    const client = yield* FileSystem.FileSystem.pipe(
        Effect.flatMap((fs) => fs.readFileString(clientPath)),
        Effect.mapError((cause) => new AiError({ cause, operation: 'ai.provider.credentials.gemini.client', reason: 'unknown' })),
        Effect.flatMap(_decodeGeminiClient),
        Effect.mapError(AiError.from('ai.provider.credentials.gemini.client')));
    const configuredAccessToken = Option.orElse(accessToken, () => Option.map(persistedSession, (session) => Redacted.make(session.accessToken)));
    const configuredRefreshToken = Option.orElse(refreshToken, () => Option.map(persistedSession, (session) => Redacted.make(session.refreshToken)));
    const configuredTokenExpiry = Option.orElse(tokenExpiry, () => Option.map(persistedSession, (session) => session.expiresAt));
    const reusableAccessToken = Option.flatMap(configuredAccessToken, (token) =>
        configuredTokenExpiry.pipe(Option.filter((value) => {
            const expiresAt = Date.parse(value);
            return Number.isFinite(expiresAt) && expiresAt > Date.now() + metadata.tokenExpiryBufferMs;
        }), Option.as(token)));
    const _persistRefresh = (next: { readonly accessToken: string; readonly expiresAt: string; readonly refreshToken?: string | undefined }, fallbackRefresh: string) =>
        Effect.all([
            FiberRef.get(AiRegistry.OnTokenRefreshRef).pipe(Effect.flatMap(Option.match({
                onNone: () => Effect.void,
                onSome: (persist) => persist({ accessToken: next.accessToken, expiresAt: next.expiresAt, refreshToken: next.refreshToken ?? fallbackRefresh }).pipe(
                    Effect.catchAll((error) => Effect.logWarning('ai.provider.credentials.gemini.persist_failed', { error }))),
            }))),
            Option.fromNullable(options?.persistRefresh).pipe(Option.match({
                onNone: () => Effect.void,
                onSome: (persist) => persist({
                    accessToken:  next.accessToken,
                    expiresAt:    next.expiresAt,
                    refreshToken: next.refreshToken ?? fallbackRefresh,
                }).pipe(Effect.catchAll((error) => Effect.logWarning('ai.provider.credentials.gemini.persist_local_failed', { error }))),
            })),
        ], { discard: true });
    const resolvedAccessToken = yield* Option.isSome(reusableAccessToken)
        ? Effect.succeed(reusableAccessToken.value)
        : Option.isSome(configuredRefreshToken)
            ? _refreshGeminiAccessToken({ client, refreshToken: Redacted.value(configuredRefreshToken.value) }).pipe(
                Effect.tap((next) => _persistRefresh(next, Redacted.value(configuredRefreshToken.value))),
                Effect.map((next) => Redacted.make(next.accessToken)),
                Effect.mapError(AiError.from('ai.provider.credentials.gemini.refresh')))
            : Option.isSome(configuredAccessToken)
                ? Option.match(configuredTokenExpiry, {
                    onNone: () => Effect.succeed(configuredAccessToken.value),
                    onSome: (value) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now() + metadata.tokenExpiryBufferMs
                        ? Effect.fail(new AiError({ cause: { clientPath, expired: value, provider: 'gemini', refreshTokenAvailable: false }, operation: 'ai.provider.credentials.gemini.expired', reason: 'unknown' }))
                        : Effect.succeed(configuredAccessToken.value),
                })
                : Effect.fail(new AiError({ cause: { clientPath, provider: 'gemini' }, operation: 'ai.provider.credentials.gemini', reason: 'unknown' }));
    return { accessToken: resolvedAccessToken, kind: 'oauth-desktop' as const, projectId: client.projectId } satisfies AiRegistry.Credential<'gemini'>;
});
const _openAiCredential = Config.redacted(AiRegistry.providers.openai.credential.configKeys.secret).pipe(
    Effect.map((secret) => ({ kind: 'api-secret' as const, secret })),
);

// --- [SERVICES] --------------------------------------------------------------

class AiRuntimeProvider extends Effect.Service<AiRuntimeProvider>()('ai/RuntimeProvider', {
    effect: Effect.gen(function* () {
        const database = yield* DatabaseService;
        const persistence = yield* PersistenceService;
        const sql = yield* SqlClient.SqlClient;
        const settingsCache = yield* Ref.make(HashMap.empty<string, { readonly cachedAt: number; readonly settings: AiRegistry.Settings }>());
        const _SETTINGS_TTL_MS = 30_000;
        const _dailyKey = (tenantId: string, now: Date) => `ai:usage:daily:${tenantId}:${now.toISOString().slice(0, 10)}`;
        const _geminiSessionKey = (tenantId: string) => `ai:credentials:gemini:${tenantId}`;
        const _minuteKey = (tenantId: string, now: Date) => `ai:usage:minute:${tenantId}:${now.toISOString().slice(0, 16)}`;
        const _minuteExpiry = (now: Date) => new Date(now.getTime() + 2 * 60 * 60 * 1_000);
        const _dailyExpiry = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2, 0, 0, 0, 0));
        const _readSettingsRecord = (tenantId: string, reason: AiError['reason']) =>
            database.apps.readSettings(tenantId).pipe(Effect.flatMap(Option.match({
                onNone: () => Effect.fail(new AiError({
                    cause:     { tenantId },
                    operation: 'ai.provider.settings.read',
                    reason,
                })),
                onSome: Effect.succeed,
            })));
        const _resolveAppSettingsUncached = (tenantId: string): Effect.Effect<AiRegistry.Settings, unknown> =>
            _readSettingsRecord(tenantId, 'missing_selection').pipe(Effect.flatMap(({ settings }) =>
                Option.fromNullable(settings.ai).pipe(
                    Option.filter((value) => Object.keys(value).length > 0),
                    Option.match({
                        onNone: () => Effect.fail(new AiError({
                            cause:     { tenantId },
                            operation: 'ai.provider.settings.read',
                            reason:    'missing_selection',
                        })),
                        onSome: (ai) => AiRegistry.decodeAppSettings({ ai }),
                    }),
                ),
            ));
        const resolveAppSettings = (tenantId: string): Effect.Effect<AiRegistry.Settings, unknown> =>
            Ref.get(settingsCache).pipe(Effect.flatMap((cache) => HashMap.get(cache, tenantId).pipe(
                Option.filter((entry) => Date.now() - entry.cachedAt < _SETTINGS_TTL_MS),
                Option.match({
                    onNone: () => _resolveAppSettingsUncached(tenantId).pipe(
                        Effect.tap((settings) => Ref.update(settingsCache, (state) => HashMap.set(state, tenantId, { cachedAt: Date.now(), settings }))),
                    ),
                    onSome: ({ settings }) => Effect.succeed(settings),
                }),
            )));
        const _readUsage = (tenantId: string, now = new Date()) =>
            Effect.all([
                persistence.kv.getJson(_dailyKey(tenantId, now), _DailyUsageSchema),
                persistence.kv.getJson(_minuteKey(tenantId, now), _MinuteUsageSchema),
            ]).pipe(
                Effect.map(([daily, minute]) => ({
                    dailyTokens:    Option.match(daily, { onNone: () => 0, onSome: (value) => value.tokens }),
                    minuteRequests: Option.match(minute, { onNone: () => 0, onSome: (value) => value.requests }),
                })),
            );
        const _incrementUsage = (tenantId: string, delta: { readonly requests?: number | undefined; readonly tokens?: number | undefined }, now = new Date()) =>
            Effect.all([
                sql`
                    INSERT INTO kv_store (key, value, expires_at)
                    VALUES (
                        ${_dailyKey(tenantId, now)},
                        jsonb_build_object('tokens', ${delta.tokens ?? 0})::text,
                        ${_dailyExpiry(now)}
                    )
                    ON CONFLICT (key) DO UPDATE
                    SET value = jsonb_build_object(
                            'tokens',
                            COALESCE((kv_store.value::jsonb->>'tokens')::int, 0) + ${delta.tokens ?? 0}
                        )::text,
                        expires_at = GREATEST(COALESCE(kv_store.expires_at, '-infinity'::timestamptz), EXCLUDED.expires_at),
                        updated_at = clock_timestamp()`,
                sql`
                    INSERT INTO kv_store (key, value, expires_at)
                    VALUES (
                        ${_minuteKey(tenantId, now)},
                        jsonb_build_object('requests', ${delta.requests ?? 0})::text,
                        ${_minuteExpiry(now)}
                    )
                    ON CONFLICT (key) DO UPDATE
                    SET value = jsonb_build_object(
                            'requests',
                            COALESCE((kv_store.value::jsonb->>'requests')::int, 0) + ${delta.requests ?? 0}
                        )::text,
                        expires_at = GREATEST(COALESCE(kv_store.expires_at, '-infinity'::timestamptz), EXCLUDED.expires_at),
                        updated_at = clock_timestamp()`,
            ], { discard: true }).pipe(Effect.asVoid);
        const _persistSettings = (tenantId: string, settings: AiRegistry.Settings) =>
            _readSettingsRecord(tenantId, 'unknown').pipe(
                Effect.flatMap(({ settings: appSettings }) => database.apps.updateSettings(tenantId, {
                    ...appSettings,
                    ai: AiRegistry.persistable(settings) as typeof appSettings.ai,
                })),
                Effect.zipRight(Ref.update(settingsCache, (state) => HashMap.set(state, tenantId, { cachedAt: Date.now(), settings }))),
                Effect.as(settings),
            );
        const _invalidateSettings = (tenantId: string) =>
            Ref.update(settingsCache, (state) => HashMap.remove(state, tenantId));
        const _resolveCredential = <P extends AiRegistry.Provider>(provider: P, tenantId?: string): Effect.Effect<AiRegistry.Credential<P>, unknown> =>
            (provider === 'gemini'
                ? _resolveGeminiCredential({
                    persistedSession: tenantId === undefined
                        ? Effect.succeed(Option.none<typeof _GeminiSessionSchema.Type>())
                        : persistence.kv.getJson(_geminiSessionKey(tenantId), _GeminiSessionSchema),
                    persistRefresh: tenantId === undefined
                        ? undefined
                        : (session) => persistence.kv.setJson(_geminiSessionKey(tenantId), session, _GeminiSessionSchema).pipe(Effect.asVoid),
                }) as Effect.Effect<AiRegistry.Credential<P>, unknown>
                : _openAiCredential as Effect.Effect<AiRegistry.Credential<P>, unknown>).pipe(
                Effect.mapError(AiError.from(`ai.provider.credentials.${provider}`)),
            );
        const _validateSettings = (settings: AiRegistry.Settings) =>
            _resolveCredential(settings.provider).pipe(
                Effect.flatMap((credential) => AiRegistry.validateSelection(settings, { [settings.provider]: credential } as AiRegistry.Credentials)),
                Effect.mapError(AiError.from('ai.provider.settings.validate')),
            );
        return {
            annotate:            (attrs: AiTelemetry.GenAITelemetryAttributeOptions) => Effect.annotateCurrentSpan(attrs as Record<string, unknown>),
            incrementUsage:      _incrementUsage,
            invalidateSettings:  _invalidateSettings,
            listModels:          (provider: AiRegistry.Provider) =>
                _resolveCredential(provider).pipe(
                    Effect.flatMap((credential) => AiRegistry.listLanguageModels(provider, { [provider]: credential } as AiRegistry.Credentials)),
                    Effect.mapError(AiError.from(`ai.provider.models.${provider}`)),
                ),
            observeEmbedding:    (labels: Record<string, string>, count: number) => Effect.logInfo('ai.embedding').pipe(Effect.annotateLogs({ ...labels, count })),
            observeError:        (op: string, labels: Record<string, string>, err: unknown) => Effect.logError('ai.error').pipe(Effect.annotateLogs({ ...labels, error: String(err), operation: op })),
            observePolicyDenied: (op: string, tenantId: string) => Effect.logWarning('ai.policy.denied').pipe(Effect.annotateLogs({ operation: op, tenantId })),
            observeRequest:      (op: string, labels: Record<string, string>) => Effect.logInfo('ai.request').pipe(Effect.annotateLogs({ ...labels, operation: op })),
            observeTokens:       (labels: Record<string, string>, usage: Response.Usage) => Effect.logInfo('ai.tokens').pipe(Effect.annotateLogs({ ...labels, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens })),
            persistSettings:     _persistSettings,
            readUsage:           _readUsage,
            resolveCredential:   _resolveCredential,
            resolveSettings:     (tenantId: string): Effect.Effect<AiRegistry.Settings, unknown> =>
                resolveAppSettings(tenantId).pipe(
                    Effect.map((settings) => structuredClone(settings)),
                    Effect.mapError(AiError.from('ai.provider.settings')),
                ),
            resolveTenantId:     Client.tenant.current,
            validateSettings:    _validateSettings,
        };
    }),
}) {}

// --- [OBJECTS] ---------------------------------------------------------------

const GeminiOAuth = {
    decodeGeminiClient:              _decodeGeminiClient,
    exchangeGeminiAuthorizationCode: (input: { readonly client: _GeminiDesktopClient; readonly code: string; readonly codeVerifier: string; readonly redirectUri: string }) =>
        _tokenRequest(input.client.tokenUri, {
            client_id: input.client.clientId,
            client_secret: input.client.clientSecret,
            code: input.code,
            code_verifier: input.codeVerifier,
            grant_type: 'authorization_code',
            redirect_uri: input.redirectUri,
        }),
    geminiAuthorizationUrl: (input: { readonly client: _GeminiDesktopClient; readonly codeChallenge: string; readonly redirectUri: string; readonly state: string }) =>
        new URL(`${input.client.authUri}?${new URLSearchParams({
            access_type: 'offline',
            client_id: input.client.clientId,
            code_challenge: input.codeChallenge,
            code_challenge_method: 'S256',
            prompt: 'consent',
            redirect_uri: input.redirectUri,
            response_type: 'code',
            scope: AiRegistry.providers.gemini.credential.scopes.join(' '),
            state: input.state,
        })}`),
    refreshGeminiAccessToken: _refreshGeminiAccessToken,
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { AiError, AiRuntimeProvider, GeminiOAuth };
