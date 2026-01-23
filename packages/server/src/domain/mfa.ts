/**
 * Implement TOTP-based MFA with recovery codes.
 * Uses DatabaseService directly; otplib for TOTP, crypto for secure hashing.
 */
import { DatabaseService } from '@parametric-portal/database/repos';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Effect, Metric, Option } from 'effect';
import { customAlphabet } from 'nanoid';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { Crypto } from '../security/crypto.ts';
import { HttpError } from '../errors.ts';
import { MetricsService } from '../infra/metrics.ts';
import { ReplayGuardService } from '../security/totp-replay.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _config = {
	backup: { alphabet: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', count: 10, length: 8 },
	issuer: process.env['APP_NAME'] ?? 'Parametric Portal',
	salt: { length: 16 },
	totp: { algorithm: 'sha256' as const, digits: 6 as const, periodSec: 30, window: [1, 1] as [number, number] },
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const _dbErr = (msg: string) => <A, E, R>(eff: Effect.Effect<A, E, R>): Effect.Effect<A, HttpError.Internal, R> =>
	eff.pipe(Effect.mapError((e) => HttpError.internal(msg, e)));
const _hashBackupCode = (code: string, salt: string) =>
	Crypto.token.hash(`${salt}${code.toUpperCase()}`).pipe(Effect.map((hash) => `${salt}$${hash}`));
const _verifyBackupCode = (code: string, saltedHash: string) =>
	Effect.gen(function* () {
		const [salt, expectedHash] = saltedHash.split('$');
		const actualHash = yield* Crypto.token.hash(`${salt}${code.toUpperCase()}`);
		const expectedBuf = Buffer.from(expectedHash ?? '', 'hex');
		const actualBuf = Buffer.from(actualHash, 'hex');
		return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
	});
const _findValidBackupCodeIndex = (codes: readonly string[], code: string) =>
	Effect.gen(function* () {
		const results = yield* Effect.all(
			codes.map((hash, index) => Effect.map(_verifyBackupCode(code, hash), (valid) => ({ index, valid }))),
			{ concurrency: 'unbounded' },
		);
		return results.find((result) => result.valid)?.index ?? -1;
	});

// --- [SERVICES] --------------------------------------------------------------

class MfaService extends Effect.Service<MfaService>()('server/MfaService', {
	dependencies: [DatabaseService.Default, MetricsService.Default, ReplayGuardService.Default],
	effect: Effect.gen(function* () {
		const db = yield* DatabaseService;
		const metrics = yield* MetricsService;
		const _getMfaOrFail = (userId: string) =>
			_dbErr(`MFA lookup failed for user ${userId}`)(db.mfaSecrets.byUser(userId)).pipe(
				Effect.flatMap(Option.match({
					onNone: () => Effect.fail(HttpError.auth('MFA not enrolled')),
					onSome: Effect.succeed,
				})),
			);
		const enroll = (userId: string, email: string) =>
			Effect.gen(function* () {
				const existing = yield* _dbErr('MFA enrollment check failed')(db.mfaSecrets.byUser(userId));
				yield* Option.match(existing, { onNone: () => Effect.void, onSome: (e) => Option.isNone(e.enabledAt) ? Effect.void : Effect.fail(HttpError.conflict('mfa', 'MFA already enabled')) });
				const secret = yield* Effect.try({ catch: () => HttpError.internal('TOTP secret generation failed'), try: generateSecret });
				const encrypted = yield* Crypto.encrypt(secret);
				const backupCodes = Array.from({ length: _config.backup.count }, customAlphabet(_config.backup.alphabet, _config.backup.length));
				const salt = randomBytes(_config.salt.length).toString('hex');
				const backupHashes = yield* Effect.all(backupCodes.map((backupCode) => _hashBackupCode(backupCode, salt)), { concurrency: 'unbounded' });
				yield* _dbErr('MFA upsert failed')(db.mfaSecrets.upsert({ backupHashes: [...backupHashes], deletedAt: Option.none<Date>(), enabledAt: Option.none<Date>(), encrypted: Buffer.from(encrypted), updatedAt: undefined, userId }));
				yield* Metric.increment(metrics.mfa.enrollments);
				return { backupCodes, qrDataUrl: generateURI({ algorithm: _config.totp.algorithm, digits: _config.totp.digits, issuer: _config.issuer, label: email, period: _config.totp.periodSec, secret }), secret };
			}).pipe(Effect.withSpan('mfa.enroll'));
		const verify = (userId: string, code: string) =>
			Effect.gen(function* () {
				const replayGuard = yield* ReplayGuardService;
				yield* replayGuard.checkLockout(userId);
				const mfa = yield* _getMfaOrFail(userId);
				const timeStep = Math.floor(Date.now() / (_config.totp.periodSec * 1000));
				const { value: secret } = yield* Crypto.decrypt(mfa.encrypted);
				const result = yield* Effect.try({
					catch: () => HttpError.auth('TOTP verification failed'),
					try: () => verifySync({ algorithm: _config.totp.algorithm, digits: _config.totp.digits, epochTolerance: _config.totp.window, period: _config.totp.periodSec, secret, token: code }),
				});
				const delta = result.valid && 'delta' in result ? result.delta : 0;
				yield* Effect.all([Effect.annotateCurrentSpan('mfa.success', result.valid), delta === 0 ? Effect.void : Effect.annotateCurrentSpan('mfa.delta', delta), Metric.increment(metrics.mfa.verifications)], { discard: true });
				yield* result.valid ? Effect.void : Effect.zipRight(replayGuard.recordFailure(userId), Effect.fail(HttpError.auth('Invalid MFA code')));
				const { alreadyUsed } = yield* replayGuard.checkAndMark(userId, timeStep + delta, code);
				yield* alreadyUsed ? Effect.zipRight(replayGuard.recordFailure(userId), Effect.fail(HttpError.auth('TOTP code already used'))) : Effect.void;
				yield* replayGuard.recordSuccess(userId);
				yield* mfa.enabledAt === null
					? _dbErr('MFA enable failed')(db.mfaSecrets.upsert({ backupHashes: [...mfa.backupHashes], deletedAt: Option.none<Date>(), enabledAt: Option.some(new Date()), encrypted: mfa.encrypted, updatedAt: undefined, userId }))
					: Effect.void;
				return { success: true };
			}).pipe(Effect.withSpan('mfa.verify'));
		const useRecoveryCode = (userId: string, code: string) =>
			Effect.gen(function* () {
				const mfa = yield* _getMfaOrFail(userId);
				yield* mfa.enabledAt === null ? Effect.fail(HttpError.auth('MFA not enabled')) : Effect.void;
				const codeIndex = yield* _findValidBackupCodeIndex(mfa.backupHashes, code);
				yield* Effect.all([Metric.increment(metrics.mfa.recoveryUsed), Effect.annotateCurrentSpan('mfa.recovery.success', codeIndex !== -1)], { discard: true });
				yield* codeIndex === -1 ? Effect.fail(HttpError.auth('Invalid recovery code')) : Effect.void;
				const updatedCodes = mfa.backupHashes.filter((_, index) => index !== codeIndex);
				yield* _dbErr('Recovery code update failed')(db.mfaSecrets.upsert({ backupHashes: updatedCodes, deletedAt: Option.none<Date>(), enabledAt: mfa.enabledAt, encrypted: mfa.encrypted, updatedAt: undefined, userId }));
				return { remainingCodes: updatedCodes.length, success: true };
			}).pipe(Effect.withSpan('mfa.useRecoveryCode'));
		const disable = (userId: string) =>
			Effect.gen(function* () {
				const opt = yield* _dbErr('MFA status check failed')(db.mfaSecrets.byUser(userId));
				yield* Option.isSome(opt) ? Effect.void : Effect.fail(HttpError.notFound('mfa'));
				yield* Effect.mapError(db.mfaSecrets.softDelete(userId) as Effect.Effect<unknown, unknown>, (e) => HttpError.internal('MFA soft delete failed', e));
				yield* Metric.increment(metrics.mfa.disabled);
				return { success: true };
			}).pipe(Effect.withSpan('mfa.disable'));
		const isEnabled = (userId: string) =>
			db.mfaSecrets.byUser(userId).pipe(
				Effect.mapError((e) => HttpError.internal('MFA status check failed', e)),
				Effect.map((opt) => Option.isSome(opt) ? opt.value.enabledAt !== null : false),
			);
		const getStatus = (userId: string) =>
			db.mfaSecrets.byUser(userId).pipe(
				Effect.mapError((e) => HttpError.internal('MFA status check failed', e)),
				Effect.map((opt) => Option.isSome(opt)
					? ({ enabled: opt.value.enabledAt !== null, enrolled: true, remainingBackupCodes: opt.value.backupHashes.length } as const)
					: ({ enabled: false, enrolled: false } as const)),
			);
		return { disable, enroll, getStatus, isEnabled, useRecoveryCode, verify };
	}),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { MfaService };
