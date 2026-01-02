/**
 * HTTP API contract shared between server and client.
 * ParametricApi definition enables type-safe HttpApiClient derivation.
 */
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from '@effect/platform';
import { ApiKey, AssetId, AuthContext, OAuthProvider, User } from '@parametric-portal/types/database';
import { IconRequest, IconResponse } from '@parametric-portal/types/icons';
import { pipe, Schema as S } from 'effect';
import { AuthError, InternalError, NotFound, OAuthError, ServiceUnavailable } from './domain-errors.ts';
import { Middleware } from './middleware.ts';

// --- [CLASSES] ---------------------------------------------------------------

class Pagination extends S.Class<Pagination>('Pagination')({
    limit: pipe(S.Int, S.between(1, 100)),
    offset: pipe(S.Int, S.nonNegative()),
}) {
    static readonly Query = S.Struct({
        limit: S.optionalWith(HttpApiSchema.param('limit', S.NumberFromString.pipe(S.int(), S.between(1, 100))), {
            default: () => 20,
        }),
        offset: S.optionalWith(HttpApiSchema.param('offset', S.NumberFromString.pipe(S.int(), S.nonNegative())), {
            default: () => 0,
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
            .addSuccess(S.Struct({ url: S.String }))
            .addError(OAuthError, { status: 400 }),
    )
    .add(
        HttpApiEndpoint.get('oauthCallback', '/oauth/:provider/callback')
            .setPath(S.Struct({ provider: OAuthProvider }))
            .setUrlParams(S.Struct({ code: S.String, state: S.String }))
            .addSuccess(AuthContext.Tokens)
            .addError(OAuthError, { status: 400 })
            .addError(InternalError, { status: 500 }),
    )
    .add(
        HttpApiEndpoint.post('refresh', '/refresh')
            .addSuccess(AuthContext.Tokens)
            .addError(AuthError, { status: 401 }),
    )
    .add(
        HttpApiEndpoint.post('logout', '/logout')
            .middleware(Middleware.Auth)
            .addSuccess(S.Struct({ success: S.Literal(true) }))
            .addError(InternalError, { status: 500 }),
    )
    .add(
        HttpApiEndpoint.get('me', '/me')
            .middleware(Middleware.Auth)
            .addSuccess(User.Response)
            .addError(NotFound, { status: 404 })
            .addError(InternalError, { status: 500 }),
    )
    .add(
        HttpApiEndpoint.get('listApiKeys', '/apikeys')
            .middleware(Middleware.Auth)
            .addSuccess(S.Struct({ data: S.Array(ApiKey) }))
            .addError(InternalError, { status: 500 }),
    )
    .add(
        HttpApiEndpoint.post('createApiKey', '/apikeys')
            .middleware(Middleware.Auth)
            .setPayload(ApiKey.CreateRequest)
            .addSuccess(ApiKey)
            .addError(InternalError, { status: 500 }),
    )
    .add(
        HttpApiEndpoint.del('deleteApiKey', '/apikeys/:id')
            .middleware(Middleware.Auth)
            .setPath(S.Struct({ id: S.typeSchema(ApiKey.fields.id) }))
            .addSuccess(S.Struct({ success: S.Literal(true) }))
            .addError(NotFound, { status: 404 })
            .addError(InternalError, { status: 500 }),
    );
const IconsGroup = HttpApiGroup.make('icons')
    .prefix('/icons')
    .add(
        HttpApiEndpoint.get('list', '/')
            .middleware(Middleware.Auth)
            .setUrlParams(Pagination.Query)
            .addSuccess(Pagination.Response(S.Struct({ id: AssetId })))
            .addError(InternalError, { status: 500 }),
    )
    .add(
        HttpApiEndpoint.post('generate', '/')
            .middleware(Middleware.Auth)
            .setPayload(IconRequest)
            .addSuccess(IconResponse)
            .addError(InternalError, { status: 500 }),
    );
const HealthGroup = HttpApiGroup.make('health')
    .prefix('/health')
    .add(HttpApiEndpoint.get('liveness', '/liveness').addSuccess(S.Struct({ status: S.Literal('ok') })))
    .add(
        HttpApiEndpoint.get('readiness', '/readiness')
            .addSuccess(S.Struct({ checks: S.Struct({ database: S.Boolean }), status: S.Literal('ok') }))
            .addError(ServiceUnavailable, { status: 503 }),
    );
const MetricsGroup = HttpApiGroup.make('metrics')
    .prefix('/metrics')
    .add(HttpApiEndpoint.get('list', '/').addSuccess(S.String));
const TelemetryGroup = HttpApiGroup.make('telemetry')
    .prefix('/v1')
    .add(HttpApiEndpoint.post('ingestTraces', '/traces').addSuccess(S.Void));

// --- [API] -------------------------------------------------------------------

const ParametricApi = HttpApi.make('ParametricApi')
    .add(AuthGroup)
    .add(IconsGroup)
    .add(HealthGroup)
    .add(MetricsGroup)
    .add(TelemetryGroup)
    .prefix('/api')
    .annotate(OpenApi.Title, 'Parametric Portal API');

// --- [EXPORT] ----------------------------------------------------------------

// Re-export internal symbols for declaration emit compatibility
export type { TagTypeId } from 'effect/Context';
export type { TypeId } from '@effect/platform/HttpApiMiddleware';
export {
    AuthGroup,
    HealthGroup,
    IconsGroup,
    MetricsGroup,
    Pagination,
    ParametricApi,
    TelemetryGroup,
};
