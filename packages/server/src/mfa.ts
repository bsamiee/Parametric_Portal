/**
 * Implement TOTP-based MFA with recovery codes.
 * Repository injected via tag; otplib for TOTP, crypto for secure hashing.
 */
import type { MfaSecret } from '@parametric-portal/database/models';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Effect, Metric, Option } from 'effect';
import { customAlphabet } from 'nanoid';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { Crypto, EncryptedKey } from './crypto.ts';
import { HttpError } from './http-errors.ts';
import { MetricsService } from './metrics.ts';
import { TotpReplayGuard } from './totp-replay.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const MfaTuning = {
    backup: { alphabet: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', count: 10, length: 8 },
    issuer: process.env['APP_NAME'] ?? 'Parametric Portal',
    salt: { length: 16 },
    totp: { algorithm: 'sha256' as const, digits: 6 as const, periodSec: 30, window: [1, 1] as [number, number] },
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const hashBackupCode = (code: string, salt: string) =>
    Effect.gen(function* () {
        const hash = yield* Crypto.Token.hash(`${salt}${code.toUpperCase()}`);
        return `${salt}$${hash}`;
    });
const verifyBackupCode = (code: string, saltedHash: string) =>
    Effect.gen(function* () {
        const [salt, expectedHash] = saltedHash.split('$');
        const actualHash = yield* Crypto.Token.hash(`${salt}${code.toUpperCase()}`);
        const expectedBuf = Buffer.from(expectedHash ?? '', 'hex');
        const actualBuf = Buffer.from(actualHash, 'hex');
        return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
    });
const findValidBackupCodeIndex = (codes: readonly string[], code: string) =>
    Effect.gen(function* () {
        const results = yield* Effect.all(
            codes.map((hash, index) => Effect.map(verifyBackupCode(code, hash), (valid) => ({ index, valid }))),
            { concurrency: 'unbounded' },
        );
        return results.find((result) => result.valid)?.index ?? -1;
    });

// --- [SERVICES] --------------------------------------------------------------

class MfaSecretsRepository extends Effect.Tag('server/MfaSecretsRepository')<
    MfaSecretsRepository,
    {
        readonly deleteByUser: (userId: string) => Effect.Effect<void, HttpError.Internal>;
        readonly byUser: (userId: string) => Effect.Effect<Option.Option<MfaSecret>, HttpError.Internal>;
        readonly upsert: (data: typeof MfaSecret.insert.Type) => Effect.Effect<MfaSecret, HttpError.Internal>;
    }
>() {}
class MfaService extends Effect.Service<MfaService>()('server/MfaService', {
    dependencies: [MetricsService.Default, TotpReplayGuard.Default],
    effect: Effect.gen(function* () {
        const metrics = yield* MetricsService;
        const getMfaOrFail = (userId: string) =>
            Effect.flatMap(MfaSecretsRepository, (repo) =>
                Effect.flatMap(repo.byUser(userId), Option.match({
                    onNone: () => Effect.fail(HttpError.auth('MFA not enrolled')),
                    onSome: Effect.succeed,
                })),
            );
        const enroll = (userId: string, email: string) =>
            Effect.gen(function* () {
                const repo = yield* MfaSecretsRepository;
                const existing = yield* repo.byUser(userId);
                yield* Option.match(existing, { onNone: () => Effect.void, onSome: (e) => e.enabledAt === null ? Effect.void : Effect.fail(HttpError.conflict('mfa', 'MFA already enabled')) });
                const secret = yield* Effect.try({ catch: () => HttpError.internal('TOTP secret generation failed'), try: generateSecret });
                const encrypted = yield* Crypto.Key.encrypt(secret);
                const backupCodes = Array.from({ length: MfaTuning.backup.count }, customAlphabet(MfaTuning.backup.alphabet, MfaTuning.backup.length));
                const salt = randomBytes(MfaTuning.salt.length).toString('hex');
                const backupHashes = yield* Effect.all(backupCodes.map((backupCode) => hashBackupCode(backupCode, salt)), { concurrency: 'unbounded' });
                yield* repo.upsert({ backupHashes: [...backupHashes], deletedAt: Option.none(), enabledAt: Option.none(), encrypted: Buffer.from(encrypted.toBytes()), updatedAt: undefined, userId });
                yield* Metric.increment(metrics.mfa.enrollments);
                return { backupCodes, qrDataUrl: generateURI({ algorithm: MfaTuning.totp.algorithm, digits: MfaTuning.totp.digits, issuer: MfaTuning.issuer, label: email, period: MfaTuning.totp.periodSec, secret }), secret };
            }).pipe(Effect.withSpan('mfa.enroll'));
        const verify = (userId: string, code: string) =>
            Effect.gen(function* () {
                const repo = yield* MfaSecretsRepository;
                const replayGuard = yield* TotpReplayGuard;
                yield* replayGuard.checkLockout(userId);
                const mfa = yield* getMfaOrFail(userId);
                const timeStep = Math.floor(Date.now() / (MfaTuning.totp.periodSec * 1000));
                const decrypted = yield* EncryptedKey.decryptBytes(mfa.encrypted);
                const result = yield* Effect.try({
                    catch: () => HttpError.auth('TOTP verification failed'),
                    try: () => verifySync({ algorithm: MfaTuning.totp.algorithm, digits: MfaTuning.totp.digits, epochTolerance: MfaTuning.totp.window, period: MfaTuning.totp.periodSec, secret: decrypted, token: code }),
                });
                const delta = result.valid && 'delta' in result ? result.delta : 0;
                yield* Effect.all([Effect.annotateCurrentSpan('mfa.success', result.valid), delta === 0 ? Effect.void : Effect.annotateCurrentSpan('mfa.delta', delta), Metric.increment(metrics.mfa.verifications)], { discard: true });
                yield* result.valid ? Effect.void : Effect.zipRight(replayGuard.recordFailure(userId), Effect.fail(HttpError.auth('Invalid MFA code')));
                const { alreadyUsed } = yield* replayGuard.checkAndMark(userId, timeStep + delta, code);
                yield* alreadyUsed ? Effect.zipRight(replayGuard.recordFailure(userId), Effect.fail(HttpError.auth('TOTP code already used'))) : Effect.void;
                yield* replayGuard.recordSuccess(userId);
                yield* mfa.enabledAt === null
                    ? repo.upsert({ backupHashes: [...mfa.backupHashes], deletedAt: Option.none(), enabledAt: Option.some(new Date()), encrypted: mfa.encrypted, updatedAt: undefined, userId })
                    : Effect.void;
                return { success: true as const };
            }).pipe(Effect.withSpan('mfa.verify'));
        const useRecoveryCode = (userId: string, code: string) =>
            Effect.gen(function* () {
                const repo = yield* MfaSecretsRepository;
                const mfa = yield* getMfaOrFail(userId);
                yield* mfa.enabledAt === null ? Effect.fail(HttpError.auth('MFA not enabled')) : Effect.void;
                const codeIndex = yield* findValidBackupCodeIndex(mfa.backupHashes, code);
                yield* Effect.all([Metric.increment(metrics.mfa.recoveryUsed), Effect.annotateCurrentSpan('mfa.recovery.success', codeIndex !== -1)], { discard: true });
                yield* codeIndex === -1 ? Effect.fail(HttpError.auth('Invalid recovery code')) : Effect.void;
                const updatedCodes = mfa.backupHashes.filter((_, index) => index !== codeIndex);
                yield* repo.upsert({ backupHashes: updatedCodes, deletedAt: Option.none(), enabledAt: mfa.enabledAt, encrypted: mfa.encrypted, updatedAt: undefined, userId });
                return { remainingCodes: updatedCodes.length, success: true as const };
            }).pipe(Effect.withSpan('mfa.useRecoveryCode'));
        const disable = (userId: string) =>
            Effect.gen(function* () {
                const repo = yield* MfaSecretsRepository;
                yield* Effect.flatMap(repo.byUser(userId), Option.match({
                    onNone: () => Effect.fail(HttpError.notFound('mfa')),
                    onSome: () => Effect.void,
                }));
                yield* repo.deleteByUser(userId);
                yield* Metric.increment(metrics.mfa.disabled);
                return { success: true as const };
            }).pipe(Effect.withSpan('mfa.disable'));
        const isEnabled = (userId: string) =>
            Effect.flatMap(MfaSecretsRepository, (repo) =>
                Effect.map(repo.byUser(userId), Option.match({ onNone: () => false, onSome: (secret) => secret.enabledAt !== null })),
            );
        const getStatus = (userId: string) =>
            Effect.flatMap(MfaSecretsRepository, (repo) =>
                Effect.map(repo.byUser(userId), Option.match({
                    onNone: () => ({ enabled: false as const, enrolled: false as const }),
                    onSome: (secret) => ({ enabled: secret.enabledAt !== null, enrolled: true as const, remainingBackupCodes: secret.backupHashes.length }),
                })),
            );
        return { disable, enroll, getStatus, isEnabled, useRecoveryCode, verify };
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { MfaSecretsRepository, MfaService };
