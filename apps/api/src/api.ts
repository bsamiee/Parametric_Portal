import {
    createApi,
    createGroup,
    createHealthGroup,
    HttpApiEndpoint,
    PaginationQuerySchema,
} from '@parametric-portal/server/api';
import { OAuthError, UnauthorizedError } from '@parametric-portal/server/errors';
import { SessionAuth } from '@parametric-portal/server/middleware';
import { OAuthProviderSchema, UserIdSchema } from '@parametric-portal/types/database';
import { Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const OAuthStartResponseSchema = S.Struct({ url: S.String });

const SessionResponseSchema = S.Struct({
    accessToken: S.String,
    expiresAt: S.DateTimeUtc,
    refreshToken: S.String,
});

const UserResponseSchema = S.Struct({
    email: S.String,
    id: UserIdSchema,
});

const AssetListItemSchema = S.Struct({
    id: S.String,
    prompt: S.String,
});

const PaginatedAssetListSchema = S.Struct({
    data: S.Array(AssetListItemSchema),
    limit: S.Int,
    offset: S.Int,
    total: S.Int,
});

const AssetGeneratedSchema = S.Struct({
    id: S.String,
    svg: S.String,
});

// --- [GROUPS] ----------------------------------------------------------------

const AuthGroup = createGroup('auth', { prefix: '/auth' })
    .add(
        HttpApiEndpoint.get('oauthStart', '/oauth/:provider')
            .setPath(S.Struct({ provider: OAuthProviderSchema }))
            .addSuccess(OAuthStartResponseSchema)
            .addError(OAuthError, { status: 400 }),
    )
    .add(
        HttpApiEndpoint.get('oauthCallback', '/oauth/:provider/callback')
            .setPath(S.Struct({ provider: OAuthProviderSchema }))
            .setUrlParams(S.Struct({ code: S.String, state: S.String }))
            .addSuccess(SessionResponseSchema)
            .addError(OAuthError, { status: 400 }),
    )
    .add(
        HttpApiEndpoint.post('refresh', '/refresh')
            .setPayload(S.Struct({ refreshToken: S.String }))
            .addSuccess(SessionResponseSchema)
            .addError(UnauthorizedError, { status: 401 }),
    )
    .add(
        HttpApiEndpoint.post('logout', '/logout')
            .middleware(SessionAuth)
            .addSuccess(S.Struct({ success: S.Boolean })),
    )
    .add(HttpApiEndpoint.get('me', '/me').middleware(SessionAuth).addSuccess(UserResponseSchema));

const IconsGroup = createGroup('icons', { prefix: '/icons' })
    .add(
        HttpApiEndpoint.get('list', '/')
            .middleware(SessionAuth)
            .setUrlParams(PaginationQuerySchema)
            .addSuccess(PaginatedAssetListSchema),
    )
    .add(
        HttpApiEndpoint.post('generate', '/')
            .middleware(SessionAuth)
            .setPayload(S.Struct({ prompt: S.NonEmptyTrimmedString }))
            .addSuccess(AssetGeneratedSchema),
    );

const HealthGroup = createHealthGroup();

// --- [API] -------------------------------------------------------------------

const AppApi = createApi('ParametricPortalApi', {
    description: 'Parametric Portal API',
    prefix: '/api',
    version: '1.0.0',
})
    .add(AuthGroup)
    .add(IconsGroup)
    .add(HealthGroup);

// --- [EXPORT] ----------------------------------------------------------------

export { AppApi, AuthGroup, HealthGroup, IconsGroup };
