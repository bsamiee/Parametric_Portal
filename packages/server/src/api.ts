/**
 * HTTP API contract shared between server and client.
 * ParametricApi definition enables type-safe HttpApiClient derivation.
 */
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from '@effect/platform';
import { IconRequest, IconResponse } from '@parametric-portal/types/icons';
import { AiProvider, ApiKeyId, AssetId, OAuthProvider, Role, UserId } from '@parametric-portal/types/schema';
import { Email, Url } from '@parametric-portal/types/types';
import { pipe, Schema as S } from 'effect';
import { AuthContext } from './auth.ts';
import { HttpError } from './http-errors.ts';
import { Middleware } from './middleware.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({ pagination: { defaultLimit: 20, defaultOffset: 0, maxLimit: 100, minLimit: 1 } } as const);

// --- [SCHEMA] ----------------------------------------------------------------

const UserResponse = S.Struct({ createdAt: S.DateFromSelf, email: Email.schema, id: UserId.schema, role: Role });
const UpdateRoleRequest = S.Struct({ role: Role });
const MfaVerifyRequest = S.Struct({ code: S.String.pipe(S.pattern(/^\d{6}$/)) });
const MfaVerifyResponse = S.Struct({ success: S.Literal(true) });
const MfaRecoverRequest = S.Struct({ code: S.NonEmptyTrimmedString });
const MfaRecoverResponse = S.Struct({ remainingCodes: S.Int, success: S.Literal(true) });
const MfaDisableResponse = S.Struct({ success: S.Literal(true) });
const MfaEnrollResponse = S.Struct({
    backupCodes: S.Array(S.String),
    qrDataUrl: S.String,
    secret: S.String,
});
const MfaStatusResponse = S.Union(
    S.Struct({ enabled: S.Literal(false), enrolled: S.Literal(false) }),
    S.Struct({ enabled: S.Boolean, enrolled: S.Literal(true), remainingBackupCodes: S.Int }),
);
const ApiKeyResponse = S.Struct({
    createdAt: S.DateFromSelf,
    id: ApiKeyId.schema,
    name: S.NonEmptyTrimmedString,
    provider: AiProvider,
});
const ApiKeyCreateRequest = S.Struct({
    key: S.NonEmptyTrimmedString,
    name: S.NonEmptyTrimmedString,
    provider: AiProvider,
});

// --- [CLASSES] ---------------------------------------------------------------

class Pagination extends S.Class<Pagination>('Pagination')({
    limit: pipe(S.Int, S.between(B.pagination.minLimit, B.pagination.maxLimit)),
    offset: pipe(S.Int, S.nonNegative()),
}) {
    static readonly Query = S.Struct({
        limit: S.optionalWith(HttpApiSchema.param('limit', S.NumberFromString.pipe(S.int(), S.between(B.pagination.minLimit, B.pagination.maxLimit))), {
            default: () => B.pagination.defaultLimit,
        }),
        offset: S.optionalWith(HttpApiSchema.param('offset', S.NumberFromString.pipe(S.int(), S.nonNegative())), {
            default: () => B.pagination.defaultOffset,
        }),
    });
    static readonly Response = <A, I, R>(item: S.Schema<A, I, R>) =>
        S.Struct({ data: S.Array(item), limit: S.Int, offset: S.Int, total: S.Int });
}

// --- [GROUPS] ----------------------------------------------------------------

const AuthGroup = HttpApiGroup.make('auth')
    .prefix('/auth')
    .add(
        HttpApiEndpoint.get('oauthStart', '/oauth/:provider')
            .setPath(S.Struct({ provider: OAuthProvider }))
            .addSuccess(S.Struct({ url: Url.schema }))
            .addError(HttpError.OAuth, { status: 400 })
            .addError(HttpError.RateLimit, { status: 429 }),
    )
    .add(
        HttpApiEndpoint.get('oauthCallback', '/oauth/:provider/callback')
            .setPath(S.Struct({ provider: OAuthProvider }))
            .setUrlParams(S.Struct({ code: S.String, state: S.String }))
            .addSuccess(AuthContext.Tokens)
            .addError(HttpError.OAuth, { status: 400 })
            .addError(HttpError.Internal, { status: 500 })
            .addError(HttpError.RateLimit, { status: 429 }),
    )
    .add(
        HttpApiEndpoint.post('refresh', '/refresh')
            .addSuccess(AuthContext.Tokens)
            .addError(HttpError.Auth, { status: 401 })
            .addError(HttpError.RateLimit, { status: 429 }),
    )
    .add(
        HttpApiEndpoint.post('logout', '/logout')
            .middleware(Middleware.Auth)
            .addSuccess(S.Struct({ success: S.Literal(true) }))
            .addError(HttpError.Internal, { status: 500 }),
    )
    .add(
        HttpApiEndpoint.get('me', '/me')
            .middleware(Middleware.Auth)
            .addSuccess(UserResponse)
            .addError(HttpError.NotFound, { status: 404 })
            .addError(HttpError.Internal, { status: 500 }),
    )
    .add(
        HttpApiEndpoint.get('listApiKeys', '/apikeys')
            .middleware(Middleware.Auth)
            .addSuccess(S.Struct({ data: S.Array(ApiKeyResponse) }))
            .addError(HttpError.Internal, { status: 500 }),
    )
    .add(
        HttpApiEndpoint.post('createApiKey', '/apikeys')
            .middleware(Middleware.Auth)
            .setPayload(ApiKeyCreateRequest)
            .addSuccess(ApiKeyResponse)
            .addError(HttpError.Internal, { status: 500 }),
    )
    .add(
        HttpApiEndpoint.del('deleteApiKey', '/apikeys/:id')
            .middleware(Middleware.Auth)
            .setPath(S.Struct({ id: ApiKeyId.schema }))
            .addSuccess(S.Struct({ success: S.Literal(true) }))
            .addError(HttpError.NotFound, { status: 404 })
            .addError(HttpError.Internal, { status: 500 }),
    );
const IconsGroup = HttpApiGroup.make('icons')
    .prefix('/icons')
    .add(
        HttpApiEndpoint.get('list', '/')
            .middleware(Middleware.Auth)
            .setUrlParams(Pagination.Query)
            .addSuccess(Pagination.Response(S.Struct({ id: AssetId.schema })))
            .addError(HttpError.Internal, { status: 500 }),
    )
    .add(
        HttpApiEndpoint.post('generate', '/')
            .middleware(Middleware.Auth)
            .setPayload(IconRequest)
            .addSuccess(IconResponse)
            .addError(HttpError.Internal, { status: 500 }),
    );
const HealthGroup = HttpApiGroup.make('health')
    .prefix('/health')
    .add(HttpApiEndpoint.get('liveness', '/liveness').addSuccess(S.Struct({ status: S.Literal('ok') })))
    .add(HttpApiEndpoint.get('readiness', '/readiness')
            .addSuccess(S.Struct({ checks: S.Struct({ database: S.Boolean }), status: S.Literal('ok') }))
            .addError(HttpError.ServiceUnavailable, { status: 503 }),
    );
const TelemetryGroup = HttpApiGroup.make('telemetry')
    .prefix('/v1')
    .add(HttpApiEndpoint.post('ingestTraces', '/traces').addSuccess(S.Void));
const UsersGroup = HttpApiGroup.make('users')
    .prefix('/users')
    .add(
        HttpApiEndpoint.patch('updateRole', '/:id/role')
            .middleware(Middleware.Auth)
            .setPath(S.Struct({ id: UserId.schema }))
            .setPayload(UpdateRoleRequest)
            .addSuccess(UserResponse)
            .addError(HttpError.Auth, { status: 401 })
            .addError(HttpError.Forbidden, { status: 403 })
            .addError(HttpError.NotFound, { status: 404 })
            .addError(HttpError.Internal, { status: 500 }),
    );
const MfaGroup = HttpApiGroup.make('mfa')
    .prefix('/mfa')
    .add(
        HttpApiEndpoint.get('status', '/status')
            .middleware(Middleware.Auth)
            .addSuccess(MfaStatusResponse)
            .addError(HttpError.Internal, { status: 500 }),
    )
    .add(
        HttpApiEndpoint.post('enroll', '/enroll')
            .middleware(Middleware.Auth)
            .addSuccess(MfaEnrollResponse)
            .addError(HttpError.Auth, { status: 401 })
            .addError(HttpError.Conflict, { status: 409 })
            .addError(HttpError.Internal, { status: 500 }),
    )
    .add(
        HttpApiEndpoint.post('verify', '/verify')
            .middleware(Middleware.Auth)
            .setPayload(MfaVerifyRequest)
            .addSuccess(MfaVerifyResponse)
            .addError(HttpError.Auth, { status: 401 })
            .addError(HttpError.Internal, { status: 500 }),
    )
    .add(
        HttpApiEndpoint.del('disable', '/')
            .middleware(Middleware.Auth)
            .addSuccess(MfaDisableResponse)
            .addError(HttpError.Auth, { status: 401 })
            .addError(HttpError.NotFound, { status: 404 })
            .addError(HttpError.Internal, { status: 500 }),
    )
    .add(
        HttpApiEndpoint.post('recover', '/recover')
            .middleware(Middleware.Auth)
            .setPayload(MfaRecoverRequest)
            .addSuccess(MfaRecoverResponse)
            .addError(HttpError.Auth, { status: 401 })
            .addError(HttpError.Internal, { status: 500 }),
    );

// --- [ENTRY_POINT] -----------------------------------------------------------

const ParametricApi = HttpApi.make('ParametricApi')
    .add(AuthGroup)
    .add(IconsGroup)
    .add(HealthGroup)
    .add(MfaGroup)
    .add(TelemetryGroup)
    .add(UsersGroup)
    .prefix('/api')
    .annotate(OpenApi.Title, 'Parametric Portal API');

// --- [EXPORT] ----------------------------------------------------------------

export type { TypeId } from '@effect/platform/HttpApiMiddleware';
// Re-export internal symbols for declaration emit compatibility
export type { TagTypeId } from 'effect/Context';
export {
    ApiKeyCreateRequest,
    ApiKeyResponse,
    B as API_TUNING,
    AuthGroup,
    HealthGroup,
    IconsGroup,
    MfaDisableResponse,
    MfaEnrollResponse,
    MfaGroup,
    MfaRecoverRequest,
    MfaRecoverResponse,
    MfaStatusResponse,
    MfaVerifyRequest,
    MfaVerifyResponse,
    Pagination,
    ParametricApi,
    TelemetryGroup,
    UpdateRoleRequest,
    UserResponse,
    UsersGroup,
};
