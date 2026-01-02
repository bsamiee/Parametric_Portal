/** Domain primitives: branded IDs, enums, entity classes for auth/users/assets. */
import { DateTime, Duration, Option, Schema as S } from 'effect';
import { Url, Uuidv7 } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type ApiKeyId = S.Schema.Type<typeof ApiKeyId>
type AssetId = S.Schema.Type<typeof AssetId>
type OAuthAccountId = S.Schema.Type<typeof OAuthAccountId>
type RefreshTokenId = S.Schema.Type<typeof RefreshTokenId>
type SessionId = S.Schema.Type<typeof SessionId>
type UserId = S.Schema.Type<typeof UserId>
type AiProvider = S.Schema.Type<typeof AiProvider>
type OAuthProvider = S.Schema.Type<typeof OAuthProvider>
type Role = S.Schema.Type<typeof Role>
type AssetType = S.Schema.Type<typeof AssetType>

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	durations: {
		refreshBuffer: Duration.minutes(5),
		refreshToken: Duration.days(30),
		session: Duration.days(7),
		tokenRefreshBuffer: Duration.minutes(1),
	},
	roleLevels: {
		admin: 3,
		guest: 0,
		member: 2,
		owner: 4,
		viewer: 1,
	},
} as const);

// --- [SCHEMA] ----------------------------------------------------------------

const id = <T extends string>(brand: T) => Uuidv7.schema.pipe(S.brand(brand));
const ApiKeyId = id('ApiKeyId');
const AssetId = id('AssetId');
const OAuthAccountId = id('OAuthAccountId');
const RefreshTokenId = id('RefreshTokenId');
const SessionId = id('SessionId');
const UserId = id('UserId');
const AiProvider = S.Literal('anthropic', 'openai', 'gemini');
const OAuthProvider = S.Literal('google', 'github', 'microsoft');
const Role = S.Literal('owner', 'admin', 'member', 'viewer', 'guest');
const AssetType = S.Literal('icon', 'image', 'document');
const ApiResponse = <A, I, R>(data: S.Schema<A, I, R>) => S.Struct({ data, success: S.Literal(true) });
const OAuthProviderConfig = S.Struct({
	clientId: S.NonEmptyTrimmedString,
	clientSecret: S.Redacted(S.String),
	redirectUri: Url.schema,
	scopes: S.Array(S.String),
});

// --- [CLASSES] ---------------------------------------------------------------

class AuthContext extends S.Class<AuthContext>('AuthContext')({
	sessionId: SessionId,
	userId: UserId,
}) {
	static readonly Tokens = S.Struct({ accessToken: S.String, expiresAt: S.DateTimeUtc });
	static readonly fromSession = (s: { readonly id: SessionId; readonly userId: UserId }) =>
		new AuthContext({ sessionId: s.id, userId: s.userId });
}
class OAuthResult extends S.Class<OAuthResult>('OAuthResult')({
	accessToken: S.String,
	email: S.OptionFromSelf(S.String),
	expiresAt: S.OptionFromSelf(S.DateFromSelf),
	providerAccountId: S.String,
	refreshToken: S.OptionFromSelf(S.String),
}) {
	get toNullableFields() {
		return {
			accessToken: this.accessToken,
			expiresAt: Option.getOrNull(this.expiresAt),
			providerAccountId: this.providerAccountId,
			refreshToken: Option.getOrNull(this.refreshToken),
		};
	}
	static readonly fromProvider = (
		tokens: { readonly accessToken: string; readonly expiresAt?: Date | undefined; readonly refreshToken?: string | undefined },
		user: { readonly providerAccountId: string; readonly email?: string | null | undefined },
	) =>
		new OAuthResult({
			accessToken: tokens.accessToken,
			email: Option.fromNullable(user.email),
			expiresAt: Option.fromNullable(tokens.expiresAt),
			providerAccountId: user.providerAccountId,
			refreshToken: Option.fromNullable(tokens.refreshToken),
		});
}
class User extends S.Class<User>('User')({
	email: S.NonEmptyTrimmedString,
	id: UserId,
	role: Role,
}) {
	static readonly Response = S.Struct({ email: S.NonEmptyTrimmedString, id: UserId });
	static readonly toResponse = (u: { readonly email: string; readonly id: UserId }) =>
		({ email: u.email, id: u.id }) as S.Schema.Type<typeof User.Response>;
	get response(): S.Schema.Type<typeof User.Response> { return User.toResponse(this); }
	get emailDomain(): string { return UserUtils.emailDomain(this.email); }
	hasMinRole(min: Role): boolean { return UserUtils.hasMinRole(this.role, min); }
	get canManage(): boolean { return UserUtils.canManage(this.role); }
}
class ApiKey extends S.Class<ApiKey>('ApiKey')({
	createdAt: S.DateFromSelf,
	id: ApiKeyId,
	lastUsedAt: S.OptionFromSelf(S.DateFromSelf),
	name: S.NonEmptyTrimmedString,
	provider: AiProvider,
}) {
	static readonly CreateRequest = S.Struct({
		key: S.NonEmptyTrimmedString,
		name: S.NonEmptyTrimmedString,
		provider: AiProvider,
	});
	static readonly toResponse = (k: {
		readonly createdAt: DateTime.Utc;
		readonly id: ApiKeyId;
		readonly lastUsedAt: Option.Option<DateTime.Utc>;
		readonly name: string;
		readonly provider: AiProvider;
	}) =>
		new ApiKey({
			createdAt: DateTime.toDateUtc(k.createdAt),
			id: k.id,
			lastUsedAt: Option.map(k.lastUsedAt, DateTime.toDateUtc),
			name: k.name,
			provider: k.provider,
		});
}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const UserUtils = Object.freeze({
	canManage: (role: Role): boolean => B.roleLevels[role] >= B.roleLevels.admin,
	emailDomain: (email: string): string => email.split('@')[1] ?? '',
	hasMinRole: (role: Role, min: Role): boolean => B.roleLevels[role] >= B.roleLevels[min],
} as const);

// --- [EXPORT] ----------------------------------------------------------------

export {
	AiProvider,
	ApiKey,
	ApiKeyId,
	ApiResponse,
	AssetId,
	AssetType,
	AuthContext,
	B,
	OAuthAccountId,
	OAuthProvider,
	OAuthProviderConfig,
	OAuthResult,
	RefreshTokenId,
	Role,
	SessionId,
	User,
	UserId,
	UserUtils,
};
