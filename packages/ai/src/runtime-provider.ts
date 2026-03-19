import { AiError as AiSdkError, type Telemetry as AiTelemetry, type Response } from '@effect/ai';
import { FetchHttpClient } from '@effect/platform';
import * as HttpClient from '@effect/platform/HttpClient';
import * as HttpClientRequest from '@effect/platform/HttpClientRequest';
import * as FileSystem from '@effect/platform/FileSystem';
import { Client } from '@parametric-portal/database/client';
import { DatabaseService, PersistenceService } from '@parametric-portal/database/repos';
import { Config, Data, Effect, FiberRef, Match, Option, Ref, Redacted, Schema as S, type Stream } from 'effect';
import { identity } from 'effect/Function';
import { AiRegistry } from './registry.ts';

// --- [ERRORS] ----------------------------------------------------------------

class AiError extends Data.TaggedError('AiError')<{
    readonly cause:     unknown;
    readonly operation: string;
    readonly reason:    'budget_exceeded' | 'policy_denied' | 'rate_exceeded' | 'request_tokens_exceeded' | 'unknown';
}> {
    override get message() { return `AiError[${this.operation}/${this.reason}]: ${String(this.cause)}`; }
    static readonly from = (operation: string) => Match.type<unknown>().pipe(
        Match.withReturnType<AiSdkError.AiError | AiError>(),
        Match.when(AiSdkError.isAiError, identity),
        Match.when(Match.instanceOf(AiError), identity),
        Match.orElse((cause) => new AiError({ cause, operation, reason: 'unknown' })),
    );
}

// --- [TYPES] -----------------------------------------------------------------

type _Budget = { readonly dailyTokens: number; readonly rateCount: number };

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
const _BudgetSchema = S.Struct({ dailyTokens: S.Number, rateCount: S.Number });
const _EMPTY_BUDGET = { dailyTokens: 0, rateCount: 0 } as const satisfies _Budget;
const _budgetDate = () => new Date().toISOString().slice(0, 10);

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
        client_id: input.client.clientId, client_secret: input.client.clientSecret,
        grant_type: 'refresh_token', refresh_token: input.refreshToken,
    });
const _applySessionOverride = (settings: AiRegistry.Settings, sessionOverride: AiRegistry.SessionOverride): AiRegistry.Settings =>
    Option.fromNullable(sessionOverride.language).pipe(Option.match({
        onNone: () => settings,
        onSome: (language) => ({
            ...settings,
            language: {
                ...settings.language,
                fallback: [...language.fallback],
                primary:  { ...language.primary },
            },
        }),
    }));
const _resolveApiSecret = (provider: 'anthropic' | 'openai') =>
    Config.redacted(AiRegistry.providers[provider].credential.configKeys.secret).pipe(
        Effect.map((secret) => ({ kind: 'api-secret' as const, secret })),
    );
const _resolveGeminiCredential = Effect.gen(function* () {
    const metadata = AiRegistry.providers.gemini.credential;
    const [accessToken, clientPath, refreshToken, tokenExpiry] = yield* Effect.all([
        Config.redacted(metadata.configKeys.accessToken).pipe(Config.option),
        Config.string(metadata.configKeys.clientPath),
        Config.redacted(metadata.configKeys.refreshToken).pipe(Config.option),
        Config.string(metadata.configKeys.expiry).pipe(Config.option),
    ]);
    const client = yield* FileSystem.FileSystem.pipe(
        Effect.flatMap((fs) => fs.readFileString(clientPath)),
        Effect.mapError((cause) => new AiError({ cause, operation: 'ai.provider.credentials.gemini.client', reason: 'unknown' })),
        Effect.flatMap(_decodeGeminiClient),
        Effect.mapError(AiError.from('ai.provider.credentials.gemini.client')));
    const reusableAccessToken = Option.flatMap(accessToken, (token) =>
        tokenExpiry.pipe(Option.filter((value) => {
            const expiresAt = Date.parse(value);
            return Number.isFinite(expiresAt) && expiresAt > Date.now() + metadata.tokenExpiryBufferMs;
        }), Option.as(token)));
    const _persistRefresh = (next: { readonly accessToken: string; readonly expiresAt: string; readonly refreshToken?: string | undefined }, fallbackRefresh: string) =>
        FiberRef.get(AiRegistry.OnTokenRefreshRef).pipe(Effect.flatMap(Option.match({
            onNone: () => Effect.void,
            onSome: (persist) => persist({ accessToken: next.accessToken, expiresAt: next.expiresAt, refreshToken: next.refreshToken ?? fallbackRefresh }).pipe(
                Effect.catchAll((error) => Effect.logWarning('ai.provider.credentials.gemini.persist_failed', { error }))),
        })));
    const resolvedAccessToken = yield* Option.isSome(reusableAccessToken)
        ? Effect.succeed(reusableAccessToken.value)
        : Option.isSome(refreshToken)
            ? _refreshGeminiAccessToken({ client, refreshToken: Redacted.value(refreshToken.value) }).pipe(
                Effect.tap((next) => _persistRefresh(next, Redacted.value(refreshToken.value))),
                Effect.map((next) => Redacted.make(next.accessToken)),
                Effect.mapError(AiError.from('ai.provider.credentials.gemini.refresh')))
            : Option.isSome(accessToken)
                ? Option.match(tokenExpiry, {
                    onNone: () => Effect.succeed(accessToken.value),
                    onSome: (value) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now() + metadata.tokenExpiryBufferMs
                        ? Effect.fail(new AiError({ cause: { clientPath, expired: value, provider: 'gemini', refreshTokenAvailable: false }, operation: 'ai.provider.credentials.gemini.expired', reason: 'unknown' }))
                        : Effect.succeed(accessToken.value),
                })
                : Effect.fail(new AiError({ cause: { clientPath, provider: 'gemini' }, operation: 'ai.provider.credentials.gemini', reason: 'unknown' }));
    return { accessToken: resolvedAccessToken, kind: 'oauth-desktop' as const, projectId: client.projectId } satisfies AiRegistry.Credential<'gemini'>;
});
const _credentialResolvers = {
    anthropic: _resolveApiSecret('anthropic'),
    gemini:    _resolveGeminiCredential,
    openai:    _resolveApiSecret('openai'),
} as const;

// --- [SERVICES] --------------------------------------------------------------

class AiRuntimeProvider extends Effect.Service<AiRuntimeProvider>()('ai/RuntimeProvider', {
    effect: Effect.gen(function* () {
        const budgetFallback = yield* Ref.make(new Map<string, _Budget>());
        const settingsCache = yield* Ref.make(new Map<string, { cachedAt: number; settings: AiRegistry.Settings }>());
        const _SETTINGS_TTL_MS = 30_000;
        const _resolveAppSettingsUncached = (tenantId: string): Effect.Effect<AiRegistry.Settings, unknown> =>
            Effect.serviceOption(DatabaseService).pipe(
                Effect.flatMap(Option.match({
                    onNone: () => AiRegistry.decodeAppSettings({}),
                    onSome: (database) =>
                        database.apps.one([{ field: 'id', value: tenantId }]).pipe(
                            Effect.flatMap(Option.match({
                                onNone: () => AiRegistry.decodeAppSettings({}),
                                onSome: (app) => AiRegistry.decodeAppSettings(app.settings ?? {}),
                            })),
                        ),
                })),
            );
        const resolveAppSettings = (tenantId: string): Effect.Effect<AiRegistry.Settings, unknown> =>
            Ref.get(settingsCache).pipe(Effect.flatMap((cache) => {
                const entry = cache.get(tenantId);
                return entry !== undefined && Date.now() - entry.cachedAt < _SETTINGS_TTL_MS
                    ? Effect.succeed(entry.settings)
                    : _resolveAppSettingsUncached(tenantId).pipe(Effect.tap((settings) =>
                        Ref.update(settingsCache, (m) => new Map(m).set(tenantId, { cachedAt: Date.now(), settings }))));
            }));
        return {
            annotate:            (attrs: AiTelemetry.GenAITelemetryAttributeOptions) => Effect.annotateCurrentSpan(attrs as Record<string, unknown>),
            observeEmbedding:    (labels: Record<string, string>, count: number) => Effect.logInfo('ai.embedding').pipe(Effect.annotateLogs({ ...labels, count })),
            observeError:        (op: string, labels: Record<string, string>, err: unknown) => Effect.logError('ai.error').pipe(Effect.annotateLogs({ ...labels, error: String(err), operation: op })),
            observeFallback:     (op: string, provider: string, tenantId: string) => Effect.logWarning('ai.fallback').pipe(Effect.annotateLogs({ operation: op, provider, tenantId })),
            observePolicyDenied: (op: string, tenantId: string) => Effect.logWarning('ai.policy.denied').pipe(Effect.annotateLogs({ operation: op, tenantId })),
            observeRequest:      (op: string, labels: Record<string, string>) => Effect.logInfo('ai.request').pipe(Effect.annotateLogs({ ...labels, operation: op })),
            observeTokens:       (labels: Record<string, string>, usage: Response.Usage) => Effect.logInfo('ai.tokens').pipe(Effect.annotateLogs({ ...labels, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens })),
            readBudget:          (tenantId: string) => Effect.serviceOption(PersistenceService).pipe(
                Effect.flatMap(Option.match({
                    onNone: () => Ref.get(budgetFallback).pipe(Effect.map((m) => m.get(tenantId) ?? _EMPTY_BUDGET)),
                    onSome: (p) => p.kv.getJson(`ai:budget:${tenantId}:${_budgetDate()}`, _BudgetSchema).pipe(
                        Effect.map(Option.getOrElse(() => _EMPTY_BUDGET)),
                        Effect.catchAll(() => Effect.succeed(_EMPTY_BUDGET))),
                }))),
            resolveCredential:   (provider: AiRegistry.Provider) =>
                (_credentialResolvers[provider] as Effect.Effect<AiRegistry.Credential, unknown>).pipe(Effect.mapError(AiError.from(`ai.provider.credentials.${provider}`))),
            resolveSettings:     (tenantId: string): Effect.Effect<AiRegistry.Settings, unknown> =>
                Effect.all([resolveAppSettings(tenantId), FiberRef.get(AiRegistry.SessionOverrideRef)]).pipe(
                    Effect.map(([settings, override]) => Option.match(override, { onNone: () => structuredClone(settings), onSome: (o) => _applySessionOverride(settings, o) })),
                    Effect.mapError(AiError.from('ai.provider.settings')),
                ),
            resolveTenantId:     Client.tenant.current,
            trackEffect:         <A, E, R>(_op: string, _labels: Record<string, string>, e: Effect.Effect<A, E, R>) => e,
            trackStream:         <A, E, R>(_op: string, _labels: Record<string, string>, s: Stream.Stream<A, E, R>) => s,
            writeBudget:         (tenantId: string, budget: _Budget) => Effect.serviceOption(PersistenceService).pipe(
                Effect.flatMap(Option.match({
                    onNone: () => Ref.update(budgetFallback, (m) => new Map(m).set(tenantId, budget)),
                    onSome: (p) => p.kv.setJson(`ai:budget:${tenantId}:${_budgetDate()}`, budget, _BudgetSchema).pipe(
                        Effect.catchAll(() => Ref.update(budgetFallback, (m) => new Map(m).set(tenantId, budget)))),
                }))),
        };
    }),
}) {}

// --- [OBJECTS] ---------------------------------------------------------------

const GeminiOAuth = {
    decodeGeminiClient:              _decodeGeminiClient,
    exchangeGeminiAuthorizationCode: (input: { readonly client: _GeminiDesktopClient; readonly code: string; readonly codeVerifier: string; readonly redirectUri: string }) =>
        _tokenRequest(input.client.tokenUri, {
            client_id: input.client.clientId, client_secret: input.client.clientSecret,
            code: input.code, code_verifier: input.codeVerifier,
            grant_type: 'authorization_code', redirect_uri: input.redirectUri,
        }),
    geminiAuthorizationUrl: (input: { readonly client: _GeminiDesktopClient; readonly codeChallenge: string; readonly redirectUri: string; readonly state: string }) =>
        new URL(`${input.client.authUri}?${new URLSearchParams({
            access_type: 'offline', client_id: input.client.clientId,
            code_challenge: input.codeChallenge, code_challenge_method: 'S256',
            prompt: 'consent', redirect_uri: input.redirectUri,
            response_type: 'code', scope: AiRegistry.providers.gemini.credential.scopes.join(' '),
            state: input.state,
        })}`),
    refreshGeminiAccessToken: _refreshGeminiAccessToken,
} as const;
const SessionOverride = {
    apply: _applySessionOverride,
    decodeFromInput: (input: { readonly fallback: ReadonlyArray<string>; readonly primary: string }) =>
        Match.value(input.primary.trim() === '' && input.fallback.length === 0).pipe(
            Match.when(true, () => Effect.succeed(Option.none<AiRegistry.SessionOverride>())),
            Match.orElse(() => Effect.gen(function* () {
                const primary = yield* AiRegistry.decodeLanguageRefText(input.primary);
                const fallback = yield* Effect.forEach(input.fallback, (value) => AiRegistry.decodeLanguageRefText(value));
                return Option.some({ language: { fallback, primary } } satisfies AiRegistry.SessionOverride);
            })),
        ),
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { AiError, AiRuntimeProvider, GeminiOAuth, SessionOverride };
