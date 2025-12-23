import {
    createApi,
    createGroup,
    createHealthGroup,
    HttpApiEndpoint,
    PaginationQuerySchema,
} from '@parametric-portal/server/api';
import { InternalError, NotFoundError, OAuthError, UnauthorizedError } from '@parametric-portal/server/errors';
import { SessionAuth } from '@parametric-portal/server/middleware';
import {
    AiProviderSchema,
    ApiKeyIdSchema,
    ApiKeyListItemSchema,
    AssetListItemSchema,
    LogoutResponseSchema,
    OAuthProviderSchema,
    OAuthStartResponseSchema,
    SessionResponseSchema,
    UserResponseSchema,
} from '@parametric-portal/types/database';
import { Schema as S } from 'effect';
import { GenerateRequestSchema, GenerateResponseSchema } from './contracts/icons.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const PaginatedAssetListSchema = S.Struct({
    data: S.Array(AssetListItemSchema),
    limit: S.Int,
    offset: S.Int,
    total: S.Int,
});

const CreateApiKeyRequestSchema = S.Struct({
    key: S.NonEmptyTrimmedString,
    name: S.NonEmptyTrimmedString,
    provider: AiProviderSchema,
});
const CreateApiKeyResponseSchema = S.Struct({ id: ApiKeyIdSchema });
const ListApiKeysResponseSchema = S.Struct({ data: S.Array(ApiKeyListItemSchema) });
const DeleteApiKeyResponseSchema = S.Struct({ success: S.Boolean });

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
            .addSuccess(SessionResponseSchema)
            .addError(UnauthorizedError, { status: 401 }),
    )
    .add(
        HttpApiEndpoint.post('logout', '/logout')
            .middleware(SessionAuth)
            .addSuccess(LogoutResponseSchema)
            .addError(InternalError, { status: 500 }),
    )
    .add(
        HttpApiEndpoint.get('me', '/me')
            .middleware(SessionAuth)
            .addSuccess(UserResponseSchema)
            .addError(NotFoundError, { status: 404 })
            .addError(InternalError, { status: 500 }),
    )
    .add(
        HttpApiEndpoint.get('listApiKeys', '/apikeys')
            .middleware(SessionAuth)
            .addSuccess(ListApiKeysResponseSchema)
            .addError(InternalError, { status: 500 }),
    )
    .add(
        HttpApiEndpoint.post('createApiKey', '/apikeys')
            .middleware(SessionAuth)
            .setPayload(CreateApiKeyRequestSchema)
            .addSuccess(CreateApiKeyResponseSchema)
            .addError(InternalError, { status: 500 }),
    )
    .add(
        HttpApiEndpoint.del('deleteApiKey', '/apikeys/:id')
            .middleware(SessionAuth)
            .setPath(S.Struct({ id: ApiKeyIdSchema }))
            .addSuccess(DeleteApiKeyResponseSchema)
            .addError(NotFoundError, { status: 404 })
            .addError(InternalError, { status: 500 }),
    );

const IconsGroup = createGroup('icons', { prefix: '/icons' })
    .add(
        HttpApiEndpoint.get('list', '/')
            .middleware(SessionAuth)
            .setUrlParams(PaginationQuerySchema)
            .addSuccess(PaginatedAssetListSchema)
            .addError(InternalError, { status: 500 }),
    )
    .add(
        HttpApiEndpoint.post('generate', '/')
            .middleware(SessionAuth)
            .setPayload(GenerateRequestSchema)
            .addSuccess(GenerateResponseSchema)
            .addError(InternalError, { status: 500 }),
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

export {
    AppApi,
    AuthGroup,
    CreateApiKeyRequestSchema,
    CreateApiKeyResponseSchema,
    DeleteApiKeyResponseSchema,
    HealthGroup,
    IconsGroup,
    ListApiKeysResponseSchema,
};
