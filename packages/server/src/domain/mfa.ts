/**
 * Implement TOTP-based MFA with recovery codes.
 * Uses DatabaseService directly; otplib for TOTP, crypto for secure hashing.
 */
import { DatabaseService } from '@parametric-portal/database/repos';
import { randomBytes } from 'node:crypto';
import { Clock, Effect, Encoding, Option } from 'effect';
import { customAlphabet } from 'nanoid';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { Context } from '../context.ts';
import { HttpError } from '../errors.ts';
import { AuditService } from '../observe/audit.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { Crypto } from '../security/crypto.ts';
import { ReplayGuardService } from '../security/totp-replay.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _config = {
	backup: { alphabet: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', count: 10, length: 8 },
	issuer: process.env['APP_NAME'] ?? 'Parametric Portal',
	salt: { length: 16 },
	totp: { algorithm: 'sha256' as const, digits: 6 as const, periodSec: 30, window: [1, 1] as [number, number] },
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _matchBackup = (codes: readonly string[], code: string): Effect.Effect<Option.Option<number>> => {
	const normalizedCode = code.toUpperCase();
	return Effect.iterate({ found: Option.none<number>(), index: 0 }, {
		body: ({ index }) => {
			const entry = codes[index] ?? '';
			const sep = entry.indexOf('$');
			const parsed = Option.liftPredicate({ hash: entry.slice(sep + 1), salt: entry.slice(0, sep) }, () => sep > 0 && sep < entry.length - 1);
			const { hash: storedHash, salt } = Option.getOrElse(parsed, () => ({ hash: '', salt: '' }));
			return Crypto.hash(`${salt}${normalizedCode}`).pipe(
				Effect.flatMap((computed) => Crypto.compare(computed, storedHash)),
				Effect.map((isMatch) => ({ found: Option.liftPredicate(index, () => isMatch && Option.isSome(parsed)), index: index + 1 })),
			);
		},
		while: ({ found, index }) => Option.isNone(found) && index < codes.length,
	}).pipe(Effect.map(({ found }) => found));
};

// --- [SERVICES] --------------------------------------------------------------

class MfaService extends Effect.Service<MfaService>()('server/MfaService', {
	effect: Effect.gen(function* () {
		const db = yield* DatabaseService;
		const metrics = yield* MetricsService;
		const audit = yield* AuditService;
		const replayGuard = yield* ReplayGuardService;
		const _getMfaOrFail = (userId: string) =>
			db.mfaSecrets.byUser(userId).pipe(
				Effect.mapError((e) => HttpError.Internal.of(`MFA lookup failed for user ${userId}`, e)),
				Effect.flatMap((opt) => Option.isSome(opt) ? Effect.succeed(opt.value) : Effect.fail(HttpError.Auth.of('MFA not enrolled'))),
			);
		const enroll = (userId: string, email: string) =>
			Telemetry.span(Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const existing = yield* db.mfaSecrets.byUser(userId).pipe(Effect.mapError((e) => HttpError.Internal.of('MFA enrollment check failed', e)));
				yield* Effect.when(Effect.fail(HttpError.Conflict.of('mfa', 'MFA already enabled')), () => Option.isSome(existing) && Option.isSome(existing.value.enabledAt));
				const secret = yield* Effect.sync(generateSecret);
				const encrypted = yield* Crypto.encrypt(secret).pipe(
					Effect.catchTag('CryptoError', (e) => Effect.fail(HttpError.Internal.of('TOTP secret encryption failed', e))),
				);
				const generateCode = customAlphabet(_config.backup.alphabet, _config.backup.length);
				const backupCodes = Array.from({ length: _config.backup.count }, generateCode);
				const salt = Encoding.encodeHex(randomBytes(_config.salt.length));
				const hashes = yield* Effect.forEach(backupCodes, (code) => Crypto.hash(`${salt}${code.toUpperCase()}`), { concurrency: 'unbounded' });
				const backupHashes = hashes.map((hash) => `${salt}$${hash}`);
				yield* Effect.suspend(() => db.mfaSecrets.upsert({ backupHashes, encrypted, userId })).pipe(Effect.asVoid, Effect.catchAll((e) => Effect.fail(HttpError.Internal.of('MFA upsert failed', e))));
				yield* Effect.all([
					MetricsService.inc(metrics.mfa.enrollments, MetricsService.label({ tenant: ctx.tenantId }), 1),
					audit.log('MfaSecret.enroll', { details: { backupCodesGenerated: _config.backup.count }, subjectId: userId }),
				], { discard: true });
				return { backupCodes, qrDataUrl: generateURI({ algorithm: _config.totp.algorithm, digits: _config.totp.digits, issuer: _config.issuer, label: email, period: _config.totp.periodSec, secret }), secret };
			}), 'mfa.enroll');
		const verify = (userId: string, code: string) =>
			Telemetry.span(Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				yield* replayGuard.checkLockout(userId);
				const mfa = yield* _getMfaOrFail(userId);
				const now = yield* Clock.currentTimeMillis;
				const timeStep = Math.floor(now / (_config.totp.periodSec * 1000));
				const secret = yield* Crypto.decrypt(mfa.encrypted).pipe(
					Effect.catchTag('CryptoError', (e) => Effect.fail(HttpError.Internal.of('TOTP secret decryption failed', e))),
				);
				const result = yield* Effect.try({
					catch: () => HttpError.Auth.of('TOTP verification failed'),
					try: () => verifySync({ algorithm: _config.totp.algorithm, digits: _config.totp.digits, epochTolerance: _config.totp.window, period: _config.totp.periodSec, secret, token: code }),
				});
				const delta = result.valid ? (result.delta ?? 0) : 0;
				yield* Effect.all([
					Effect.annotateCurrentSpan('mfa.success', result.valid),
					Effect.when(Effect.annotateCurrentSpan('mfa.delta', delta), () => delta !== 0),
					MetricsService.inc(metrics.mfa.verifications, MetricsService.label({ tenant: ctx.tenantId }), 1),
					audit.log('MfaSecret.verify', { details: { success: result.valid }, subjectId: userId }),
				], { discard: true });
				yield* Effect.when(replayGuard.recordFailure(userId).pipe(Effect.andThen(Effect.fail(HttpError.Auth.of('Invalid MFA code')))), () => !result.valid);
				const { alreadyUsed } = yield* replayGuard.checkAndMark(userId, timeStep + delta, code);
				yield* Effect.when(replayGuard.recordFailure(userId).pipe(Effect.andThen(Effect.fail(HttpError.Auth.of('TOTP code already used')))), () => alreadyUsed);
				yield* replayGuard.recordSuccess(userId);
				yield* Effect.when(Effect.suspend(() => db.mfaSecrets.upsert({ backupHashes: mfa.backupHashes, enabledAt: Option.some(new Date()), encrypted: mfa.encrypted, userId })).pipe(Effect.asVoid, Effect.catchAll((e) => Effect.fail(HttpError.Internal.of('MFA enable failed', e)))), () => Option.isNone(mfa.enabledAt));
				return { success: true };
			}), 'mfa.verify');
		const useRecoveryCode = (userId: string, code: string) =>
			Telemetry.span(Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				yield* replayGuard.checkLockout(userId);
				const mfa = yield* _getMfaOrFail(userId);
				yield* Effect.unless(Effect.fail(HttpError.Auth.of('MFA not enabled')), () => Option.isSome(mfa.enabledAt));
				const codeIndexOpt = yield* _matchBackup(mfa.backupHashes, code);
				const isValid = Option.isSome(codeIndexOpt);
				yield* Effect.all([
					MetricsService.inc(metrics.mfa.recoveryUsed, MetricsService.label({ tenant: ctx.tenantId }), 1),
					Effect.annotateCurrentSpan('mfa.recovery.success', isValid),
					audit.log('MfaSecret.useRecoveryCode', { details: { success: isValid }, subjectId: userId }),
				], { discard: true });
				yield* Effect.when(replayGuard.recordFailure(userId).pipe(Effect.andThen(Effect.fail(HttpError.Auth.of('Invalid recovery code')))), () => !isValid);
				yield* replayGuard.recordSuccess(userId);
				const updatedCodes = Option.match(codeIndexOpt, { onNone: () => mfa.backupHashes, onSome: (i) => mfa.backupHashes.filter((_, idx) => idx !== i) }); // NOSONAR S3358
				yield* Effect.suspend(() => db.mfaSecrets.upsert({ backupHashes: updatedCodes, enabledAt: mfa.enabledAt, encrypted: mfa.encrypted, userId })).pipe(Effect.asVoid, Effect.catchAll((e) => Effect.fail(HttpError.Internal.of('Recovery code update failed', e))));
				return { remainingCodes: updatedCodes.length, success: true };
			}), 'mfa.useRecoveryCode');
		const disable = (userId: string) =>
			Telemetry.span(Effect.gen(function* () {
				const ctx = yield* Context.Request.current;
				const opt = yield* db.mfaSecrets.byUser(userId).pipe(Effect.mapError((e) => HttpError.Internal.of('MFA status check failed', e)));
				yield* Effect.when(Effect.fail(HttpError.NotFound.of('mfa')), () => Option.isNone(opt));
				yield* db.mfaSecrets.softDelete(userId).pipe(Effect.mapError((e) => HttpError.Internal.of('MFA soft delete failed', e)));
				yield* Effect.all([
					MetricsService.inc(metrics.mfa.disabled, MetricsService.label({ tenant: ctx.tenantId }), 1),
					audit.log('MfaSecret.disable', { subjectId: userId }),
				], { discard: true });
				return { success: true };
			}), 'mfa.disable');
		const isEnabled = (userId: string) =>
			db.mfaSecrets.byUser(userId).pipe(
				Effect.mapError((e) => HttpError.Internal.of('MFA status check failed', e)),
				Effect.map((opt) => opt.pipe(Option.flatMap((v) => v.enabledAt), Option.isSome)),
			);
		const getStatus = (userId: string) =>
			db.mfaSecrets.byUser(userId).pipe(
				Effect.mapError((e) => HttpError.Internal.of('MFA status check failed', e)),
				Effect.map(Option.match({
					onNone: () => ({ enabled: false, enrolled: false }) as const,
					onSome: (v) => ({ enabled: Option.isSome(v.enabledAt), enrolled: true, remainingBackupCodes: v.backupHashes.length }) as const,
				})),
			);
		return { disable, enroll, getStatus, isEnabled, useRecoveryCode, verify };
	}),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { MfaService };
