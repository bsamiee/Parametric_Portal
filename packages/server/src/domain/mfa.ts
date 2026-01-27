/**
 * Implement TOTP-based MFA with recovery codes.
 * Uses DatabaseService directly; otplib for TOTP, crypto for secure hashing.
 */
import { DatabaseService } from '@parametric-portal/database/repos';
import { randomBytes } from 'node:crypto';
import { Clock, Effect, Encoding, Option, Stream } from 'effect';
import { customAlphabet } from 'nanoid';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { Context } from '../context.ts';
import { HttpError } from '../errors.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Crypto } from '../security/crypto.ts';
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
	eff.pipe(Effect.mapError((e) => HttpError.Internal.of(msg, e)));
const _findValidBackupCodeIndex = (codes: readonly string[], code: string) =>
	Stream.fromIterable(codes).pipe(
		Stream.zipWithIndex,
		Stream.mapEffect(([saltedHash, index]) => {
			const idx = saltedHash.indexOf('$');
			return idx > 0 && idx < saltedHash.length - 1
				? Crypto.token.hash(`${saltedHash.slice(0, idx)}${code.toUpperCase()}`).pipe(
						Effect.flatMap((actualHash) => Crypto.token.compare(actualHash, saltedHash.slice(idx + 1))),
						Effect.map((valid) => ({ index, valid })),
					)
				: Effect.succeed({ index, valid: false });
		}),
		Stream.runFold(-1, (found, r) => r.valid && found === -1 ? r.index : found),
	);

// --- [SERVICES] --------------------------------------------------------------

class MfaService extends Effect.Service<MfaService>()('server/MfaService', {
	effect: Effect.gen(function* () {
		const db = yield* DatabaseService;
		const metrics = yield* MetricsService;
		const replayGuard = yield* ReplayGuardService;
		const _getMfaOrFail = (userId: string) =>
			_dbErr(`MFA lookup failed for user ${userId}`)(db.mfaSecrets.byUser(userId)).pipe(
				Effect.flatMap(Option.match({
					onNone: () => Effect.fail(HttpError.Auth.of('MFA not enrolled')),
					onSome: Effect.succeed,
				})),
			);
		const enroll = (userId: string, email: string) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const existing = yield* _dbErr('MFA enrollment check failed')(db.mfaSecrets.byUser(userId));
				yield* Option.match(existing, { onNone: () => Effect.void, onSome: (e) => Option.isNone(e.enabledAt) ? Effect.void : Effect.fail(HttpError.Conflict.of('mfa', 'MFA already enabled')) });
				const secret = yield* Effect.try({ catch: () => HttpError.Internal.of('TOTP secret generation failed'), try: generateSecret });
				const encrypted = yield* Crypto.encrypt(secret).pipe(
					Effect.catchTag('CryptoEncryptError', (e) => Effect.fail(HttpError.Internal.of('TOTP secret encryption failed', e))),
				);
				const backupCodes = yield* Effect.try({
					catch: () => HttpError.Internal.of('Backup code generation failed'),
					try: () => Array.from({ length: _config.backup.count }, customAlphabet(_config.backup.alphabet, _config.backup.length)),
				});
				const saltBytes = yield* Effect.sync(() => randomBytes(_config.salt.length));
				const salt = Encoding.encodeHex(saltBytes);
				const hashEffects = backupCodes.map((backupCode) => Crypto.token.hash(`${salt}${backupCode.toUpperCase()}`));
				const hashes = yield* Effect.all(hashEffects, { concurrency: 'unbounded' });
				const backupHashes = hashes.map((hash) => `${salt}$${hash}`);
				yield* _dbErr('MFA upsert failed')(db.mfaSecrets.upsert({ backupHashes: [...backupHashes], deletedAt: Option.none<Date>(), enabledAt: Option.none<Date>(), encrypted: Buffer.from(encrypted), updatedAt: undefined, userId }));
				yield* MetricsService.inc(metrics.mfa.enrollments, MetricsService.label({ tenant: ctx.tenantId }), 1);
				return { backupCodes, qrDataUrl: generateURI({ algorithm: _config.totp.algorithm, digits: _config.totp.digits, issuer: _config.issuer, label: email, period: _config.totp.periodSec, secret }), secret };
			}).pipe(Effect.withSpan('mfa.enroll'));
		const verify = (userId: string, code: string) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				yield* replayGuard.checkLockout(userId);
				const mfa = yield* _getMfaOrFail(userId);
				const now = yield* Clock.currentTimeMillis;
				const timeStep = Math.floor(now / (_config.totp.periodSec * 1000));
				const secret = yield* Crypto.decrypt(mfa.encrypted).pipe(
					Effect.catchTag('CryptoDecryptError', (e) => Effect.fail(HttpError.Internal.of('TOTP secret decryption failed', e))),
				);
				const result = yield* Effect.try({
					catch: () => HttpError.Auth.of('TOTP verification failed'),
					try: () => verifySync({ algorithm: _config.totp.algorithm, digits: _config.totp.digits, epochTolerance: _config.totp.window, period: _config.totp.periodSec, secret, token: code }),
				});
				const delta = result.valid && 'delta' in result ? result.delta : 0;
				yield* Effect.all([Effect.annotateCurrentSpan('mfa.success', result.valid), delta === 0 ? Effect.void : Effect.annotateCurrentSpan('mfa.delta', delta), MetricsService.inc(metrics.mfa.verifications, MetricsService.label({ tenant: ctx.tenantId }), 1)], { discard: true });
				yield* result.valid ? Effect.void : Effect.zipRight(replayGuard.recordFailure(userId), Effect.fail(HttpError.Auth.of('Invalid MFA code')));
				const { alreadyUsed } = yield* replayGuard.checkAndMark(userId, timeStep + delta, code);
				yield* alreadyUsed ? Effect.zipRight(replayGuard.recordFailure(userId), Effect.fail(HttpError.Auth.of('TOTP code already used'))) : Effect.void;
				yield* replayGuard.recordSuccess(userId);
				yield* Option.isNone(mfa.enabledAt)
					? _dbErr('MFA enable failed')(db.mfaSecrets.upsert({ backupHashes: [...mfa.backupHashes], deletedAt: Option.none<Date>(), enabledAt: Option.some(new Date()), encrypted: mfa.encrypted, updatedAt: undefined, userId }))
					: Effect.void;
				return { success: true };
			}).pipe(Effect.withSpan('mfa.verify'));
		const useRecoveryCode = (userId: string, code: string) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				yield* replayGuard.checkLockout(userId);
				const mfa = yield* _getMfaOrFail(userId);
				yield* Option.isNone(mfa.enabledAt) ? Effect.fail(HttpError.Auth.of('MFA not enabled')) : Effect.void;
				const codeIndex = yield* _findValidBackupCodeIndex(mfa.backupHashes, code);
				yield* Effect.all([MetricsService.inc(metrics.mfa.recoveryUsed, MetricsService.label({ tenant: ctx.tenantId }), 1), Effect.annotateCurrentSpan('mfa.recovery.success', codeIndex !== -1)], { discard: true });
				yield* codeIndex === -1 ? Effect.zipRight(replayGuard.recordFailure(userId), Effect.fail(HttpError.Auth.of('Invalid recovery code'))) : Effect.void;
				yield* replayGuard.recordSuccess(userId);
				const updatedCodes = mfa.backupHashes.filter((_, index) => index !== codeIndex);
				yield* _dbErr('Recovery code update failed')(db.mfaSecrets.upsert({ backupHashes: updatedCodes, deletedAt: Option.none<Date>(), enabledAt: mfa.enabledAt, encrypted: mfa.encrypted, updatedAt: undefined, userId }));
				return { remainingCodes: updatedCodes.length, success: true };
			}).pipe(Effect.withSpan('mfa.useRecoveryCode'));
		const disable = (userId: string) =>
			Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const opt = yield* _dbErr('MFA status check failed')(db.mfaSecrets.byUser(userId));
				yield* Option.isSome(opt) ? Effect.void : Effect.fail(HttpError.NotFound.of('mfa'));
				yield* _dbErr('MFA soft delete failed')(db.mfaSecrets.softDelete(userId));
				yield* MetricsService.inc(metrics.mfa.disabled, MetricsService.label({ tenant: ctx.tenantId }), 1);
				return { success: true };
			}).pipe(Effect.withSpan('mfa.disable'));
		const isEnabled = (userId: string) =>
			db.mfaSecrets.byUser(userId).pipe(
				Effect.mapError((e) => HttpError.Internal.of('MFA status check failed', e)),
				Effect.map((opt) => Option.isSome(opt) ? Option.isSome(opt.value.enabledAt) : false),
			);
		const getStatus = (userId: string) =>
			db.mfaSecrets.byUser(userId).pipe(
				Effect.mapError((e) => HttpError.Internal.of('MFA status check failed', e)),
				Effect.map((opt) => Option.isSome(opt)
					? ({ enabled: Option.isSome(opt.value.enabledAt), enrolled: true, remainingBackupCodes: opt.value.backupHashes.length } as const)
					: ({ enabled: false, enrolled: false } as const)),
			);
		return { disable, enroll, getStatus, isEnabled, useRecoveryCode, verify };
	}),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { MfaService };
