/** models.ts tests: schema validation, Model variant behavior (Generated/Sensitive/FieldOption), defaults. */
import { it } from '@effect/vitest';
import { assertNone } from '@effect/vitest/utils';
import {
    ApiKey, App, AppSettingsDefaults, AppSettingsSchema, AuditOperationSchema,
    FeatureFlagsSchema, JobStatusSchema, MfaSecret, OAuthProviderSchema,
    OauthAccount, PreferencesSchema, RoleSchema, Session, User,
} from '@parametric-portal/database/models';
import { Effect, Either, FastCheck as fc, Option, Schema as S } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _ROLES = ['owner', 'admin', 'member', 'viewer', 'guest'] as const;
const _OAUTH = ['apple', 'github', 'google', 'microsoft'] as const;
const _JOB_STATUSES = ['queued', 'processing', 'complete', 'failed', 'cancelled'] as const;
const _AUDIT_OPS = [
    'create', 'update', 'delete', 'read', 'list', 'status', 'login', 'refresh', 'revoke', 'revokeByIp', 'verify', 'verifyMfa', 'register', 'enroll', 'disable', 'sign', 'upload',
    'stream_upload', 'copy', 'remove', 'abort_multipart', 'export', 'import', 'validate', 'cancel', 'replay', 'auth_failure', 'permission_denied', 'purge-sessions', 'purge-api-keys',
    'purge-assets', 'purge-event-journal', 'purge-job-dlq', 'purge-kv-store', 'purge-mfa-secrets', 'purge-oauth-accounts', 'archive', 'purge-tenant',
] as const;
const _FLAG_DEFAULTS = {
    enableAiSearch: 0, enableApiKeys: 100, enableAuditLog: 100, enableExport: 0,
    enableMfa: 0, enableNotifications: 100, enableOAuth: 0, enableRealtime: 100, enableWebhooks: 0,
} as const;
const _roleSet = new Set<string>(_ROLES);
const _oauthSet = new Set<string>(_OAUTH);
const _FROZEN = Reflect.construct(globalThis.Date, [0]);
const _UUID = '00000000-0000-0000-0000-000000000001';
const _GENERATED_INSERT = [
    [Session, ['id']], [User, ['id', 'preferences']], [ApiKey, ['id']], [MfaSecret, ['id']], [OauthAccount, ['id']],
] as ReadonlyArray<readonly [{ fields: Record<string, unknown>; insert: { fields: Record<string, unknown> } }, readonly string[]]>;
const _SENSITIVE_JSON = [
    [Session, ['tokenAccess', 'tokenRefresh']], [ApiKey, ['encrypted', 'hash']], [MfaSecret, ['encrypted', 'backups']], [OauthAccount, ['tokenPayload']],
] as ReadonlyArray<readonly [{ json: { fields: Record<string, unknown> } }, readonly string[]]>;

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect.prop('P1: literal roundtrip acceptance + rejection', {
    invalid: fc.string({ minLength: 1 }).filter((value) => !_roleSet.has(value) && !_oauthSet.has(value)),
    oauth: OAuthProviderSchema,
    role: RoleSchema,
}, ({ invalid, oauth, role }) => Effect.sync(() => {
    expect(S.decodeSync(RoleSchema)(role)).toBe(role);
    expect(S.decodeSync(OAuthProviderSchema)(oauth)).toBe(oauth);
    expect(() => S.decodeSync(RoleSchema)(invalid as never)).toThrow();
    expect(() => S.decodeSync(OAuthProviderSchema)(invalid as never)).toThrow();
}));
it.effect.prop('P2: feature flags boundary', {
    value: fc.integer({ max: 150, min: -50 }),
}, ({ value }) => Effect.sync(() => {
    const result = S.decodeUnknownEither(FeatureFlagsSchema)({ enableAiSearch: value });
    const inBounds = value >= 0 && value <= 100 && Number.isInteger(value);
    expect(Either.isRight(result)).toBe(inBounds);
    Either.match(result, { onLeft: () => {}, onRight: (right) => { expect(right.enableAiSearch).toBe(value); } });
}));

// --- [EDGE_CASES] ------------------------------------------------------------

it.effect('E0: exhaustive literal membership', () => Effect.sync(() => {
    const _cmp = (a: string, b: string) => a.localeCompare(b);
    expect([...RoleSchema.literals].sort(_cmp)).toStrictEqual([..._ROLES].sort(_cmp));
    expect([...OAuthProviderSchema.literals].sort(_cmp)).toStrictEqual([..._OAUTH].sort(_cmp));
    expect([...JobStatusSchema.literals].sort(_cmp)).toStrictEqual([..._JOB_STATUSES].sort(_cmp));
    expect([...AuditOperationSchema.literals].sort(_cmp)).toStrictEqual([..._AUDIT_OPS].sort(_cmp));
    expect(AuditOperationSchema.literals).toHaveLength(38);
}));
it.effect('E1: feature flag defaults', () => Effect.sync(() => {
    expect(S.decodeSync(FeatureFlagsSchema)({})).toStrictEqual(_FLAG_DEFAULTS);
    expect(S.decodeSync(AppSettingsSchema)({}).featureFlags).toStrictEqual(_FLAG_DEFAULTS);
}));
it.effect('E2: settings defaults determinism', () => Effect.sync(() => {
    const decoded = S.decodeSync(AppSettingsSchema)({});
    expect(decoded).toStrictEqual(AppSettingsDefaults);
    expect(decoded.webhooks).toStrictEqual([]);
    expect(decoded.oauthProviders).toStrictEqual([]);
}));
it.effect('E3: Generated fields omitted from insert + Sensitive fields omitted from json', () => Effect.sync(() => {
    _GENERATED_INSERT.forEach(([model, fields]) => {
        fields.forEach((field) => {
            expect(Object.keys(model.insert.fields)).not.toContain(field);
            expect(Object.keys(model.fields)).toContain(field);
        });
    });
    _SENSITIVE_JSON.forEach(([model, fields]) => {
        fields.forEach((field) => { expect(Object.keys(model.json.fields)).not.toContain(field); });
    });
}));
it.effect('E5: FieldOption null/value decoding', () => Effect.sync(() => {
    const prefs = { channels: { email: true, inApp: true, webhook: false }, mutedUntil: null, templates: {} };
    const base = { appId: _UUID, email: 'a@b.c', id: _UUID, preferences: prefs, role: 'admin' as const, status: 'active' as const, updatedAt: _FROZEN };
    assertNone(S.decodeSync(User)({ ...base, deletedAt: null }).deletedAt);
    const withDate = S.decodeSync(User)({ ...base, deletedAt: _FROZEN });
    expect(Option.isSome(withDate.deletedAt)).toBe(true);
    Option.match(withDate.deletedAt, { onNone: () => {}, onSome: (value) => { expect(value).toEqual(_FROZEN); } });
}));
it.effect('E6: webhook + oauth boundary validation', () => Effect.sync(() => {
    const webhook = (secret: string, url: string) => ({ webhooks: [{ active: true, endpoint: { secret, url }, eventTypes: [] }] });
    const provider = (clientId: string) => ({ oauthProviders: [{ clientId, clientSecretEncrypted: 'enc', enabled: true, provider: 'github' }] });
    expect(Either.isLeft(S.decodeUnknownEither(AppSettingsSchema)(webhook('short', 'https://a.com')))).toBe(true);
    expect(Either.isLeft(S.decodeUnknownEither(AppSettingsSchema)(webhook('a'.repeat(32), 'http://insecure.com')))).toBe(true);
    const valid = S.decodeUnknownEither(AppSettingsSchema)(webhook('a'.repeat(32), 'https://example.com'));
    expect(Either.isRight(valid)).toBe(true);
    Either.match(valid, { onLeft: () => {}, onRight: (right) => { expect(right.webhooks[0]?.endpoint.timeout).toBe(5000); } });
    expect(Either.isLeft(S.decodeUnknownEither(AppSettingsSchema)(provider('')))).toBe(true);
    expect(Either.isLeft(S.decodeUnknownEither(AppSettingsSchema)(provider('  ')))).toBe(true);
    expect(Either.isRight(S.decodeUnknownEither(AppSettingsSchema)(provider('valid-id')))).toBe(true);
}));
it.effect('E8: App insert defaults', () => Effect.sync(() => {
    const result = S.decodeUnknownEither(App.insert)({ name: 'Portal', namespace: 'portal', settings: null, updatedAt: _FROZEN });
    expect(Either.isRight(result)).toBe(true);
    Either.match(result, { onLeft: () => {}, onRight: (right) => { expect(right.status).toBe('active'); assertNone(right.settings); } });
}));
it.effect('E9: feature flags non-integer + preferences schema rejection', () => Effect.sync(() => {
    const decodeFlags = (input: object) => S.decodeUnknownEither(FeatureFlagsSchema)(input);
    expect([decodeFlags({ enableMfa: 50.5 }), decodeFlags({ enableMfa: -1 }), decodeFlags({ enableMfa: 101 })].every(Either.isLeft)).toBe(true);
    expect([decodeFlags({ enableMfa: 0 }), decodeFlags({ enableMfa: 100 })].every(Either.isRight)).toBe(true);
    const valid = { channels: { email: true, inApp: false, webhook: true }, mutedUntil: null, templates: {} };
    expect(Either.isRight(S.decodeUnknownEither(PreferencesSchema)(valid))).toBe(true);
    expect(Either.isRight(S.decodeUnknownEither(PreferencesSchema)({ ...valid, mutedUntil: '2025-12-31' }))).toBe(true);
    expect(Either.isLeft(S.decodeUnknownEither(PreferencesSchema)({}))).toBe(true);
    expect(Either.isLeft(S.decodeUnknownEither(PreferencesSchema)({ channels: {}, mutedUntil: null, templates: {} }))).toBe(true);
}));
