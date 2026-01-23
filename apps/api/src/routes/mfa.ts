/** MFA group handlers for TOTP enrollment, verification, and recovery. */

import { HttpApiBuilder } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { AuditService } from '@parametric-portal/server/domain/audit';
import { MfaService } from '@parametric-portal/server/domain/mfa';
import { SessionService } from '@parametric-portal/server/domain/session';
import { HttpError } from '@parametric-portal/server/errors';
import { RateLimit } from '@parametric-portal/server/infra/rate-limit';
import { Middleware } from '@parametric-portal/server/middleware';
import { Effect, Layer, Option } from 'effect';

// --- [LAYERS] ----------------------------------------------------------------

const MfaLive = HttpApiBuilder.group(ParametricApi, 'mfa', (handlers) =>
	Effect.gen(function* () {
		const mfa = yield* MfaService;
		const session = yield* SessionService;
		const db = yield* DatabaseService;
		const audit = yield* AuditService;

		return handlers
			.handle('status', () =>
				Effect.gen(function* () {
					const { userId } = yield* Middleware.Session;
					return yield* mfa.getStatus(userId);
				}),
			)
			.handle('enroll', () =>
				RateLimit.apply('mfa', Effect.gen(function* () {
					const ctx = yield* Middleware.Session;
					const userOpt = yield* db.users.one([{ field: 'id', value: ctx.userId }]).pipe(Effect.mapError((e) => HttpError.internal('User lookup failed', e)));
					const user = yield* Option.match(userOpt, { onNone: () => Effect.fail(HttpError.notFound('user', ctx.userId)), onSome: Effect.succeed });
					const result = yield* mfa.enroll(user.id, user.email);
					yield* audit.log('MfaSecret', ctx.userId, 'enroll');
					return result;
				})),
			)
			.handle('verify', ({ payload }) =>
				RateLimit.apply('mfa', Effect.gen(function* () {
					const ctx = yield* Middleware.Session;
					// SessionService.verifyMfa delegates to MfaService and updates session.verifiedAt
					const result = yield* session.verifyMfa(ctx.id, ctx.userId, payload.code);
					yield* audit.log('MfaSecret', ctx.userId, 'verify');
					return result;
				})),
			)
			.handle('disable', () =>
				Effect.gen(function* () {
					yield* Middleware.requireMfaVerified;
					const { userId } = yield* Middleware.Session;
					yield* mfa.disable(userId);
					yield* audit.log('MfaSecret', userId, 'disable');
					return { success: true as const };
				}),
			)
			.handle('recover', ({ payload }) =>
				RateLimit.apply('mfa', Effect.gen(function* () {
					const ctx = yield* Middleware.Session;
					// SessionService.recoverMfa delegates to MfaService and updates session.verifiedAt
					const { remainingCodes } = yield* session.recoverMfa(ctx.id, ctx.userId, payload.code.toUpperCase());
					yield* audit.log('MfaSecret', ctx.userId, 'recover');
					return { remainingCodes, success: true as const };
				})),
			);
	}),
).pipe(Layer.provide(Layer.mergeAll(MfaService.Default, SessionService.Default)));

// --- [EXPORT] ----------------------------------------------------------------

export { MfaLive };
