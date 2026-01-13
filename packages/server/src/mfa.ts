/**
 * MFA Service: TOTP-based multi-factor authentication with recovery codes.
 * Uses otplib for TOTP generation/verification, crypto for secure hashing.
 * Repository is injected via MfaSecretsRepository tag to avoid circular deps.
 */
import type { MfaSecret, MfaSecretInsert, UserId } from '@parametric-portal/types/schema';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Effect, Metric, Option, pipe } from 'effect';
import { customAlphabet } from 'nanoid';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { Crypto, EncryptedKey } from './crypto.ts';
import { HttpError } from './http-errors.ts';
import { MetricsService } from './metrics.ts';
import { TotpReplayGuard } from './totp-replay.ts';

// --- [TYPES] -----------------------------------------------------------------

type MfaSecretsRepo = {
    readonly delete: (userId: UserId) => Effect.Effect<void, InstanceType<typeof HttpError.Internal>, never>;
    readonly findByUserId: (userId: UserId) => Effect.Effect<Option.Option<MfaSecret>, InstanceType<typeof HttpError.Internal>, never>;
    readonly upsert: (data: MfaSecretInsert) => Effect.Effect<MfaSecret, InstanceType<typeof HttpError.Internal>, never>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    backup: { alphabet: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', count: 10, length: 8 },
    issuer: process.env['APP_NAME'] ?? 'Parametric Portal',
    salt: { length: 16 },
    totp: { algorithm: 'sha256' as const, digits: 6 as const, periodSec: 30, window: [1, 1] as [number, number] },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const generateBackupCode = customAlphabet(B.backup.alphabet, B.backup.length);
const generateBackupCodes = (): readonly string[] => Array.from({ length: B.backup.count }, generateBackupCode);
const generateSalt = (): string => randomBytes(B.salt.length).toString('hex');
const generateOtpAuthUri = (secret: string, email: string): string => generateURI({ algorithm: B.totp.algorithm, digits: B.totp.digits, issuer: B.issuer, label: email, period: B.totp.periodSec, secret });
const currentTimeStep = (): number => Math.floor(Date.now() / (B.totp.periodSec * 1000));
const hashBackupCodeWithSalt = (code: string, salt: string) => pipe(Crypto.Token.hash(`${salt}${code.toUpperCase()}`), Effect.map((hash) => `${salt}$${hash}`));
const verifyBackupCode = (code: string, saltedHash: string) => {
    const [salt, expectedHash] = saltedHash.split('$');
    return pipe(
        Crypto.Token.hash(`${salt}${code.toUpperCase()}`),
        Effect.map((actualHash) => {
            const expectedBuf = Buffer.from(expectedHash ?? '', 'hex');
            const actualBuf = Buffer.from(actualHash, 'hex');
            return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
        }),
    );
};
const findValidBackupCodeIndex = (codes: readonly string[], code: string) =>
    pipe(
        Effect.all(codes.map((hash, idx) => pipe(verifyBackupCode(code, hash), Effect.map((valid) => ({ idx, valid })))), { concurrency: 'unbounded' }),
        Effect.map((results) => results.find((r) => r.valid)?.idx ?? -1),
    );

// --- [CLASSES] ---------------------------------------------------------------

class MfaSecretsRepository extends Effect.Tag('server/MfaSecretsRepository')<MfaSecretsRepository, MfaSecretsRepo>() {}
class MfaService extends Effect.Service<MfaService>()('server/MfaService', {
    dependencies: [MetricsService.Default, TotpReplayGuard.Default],
    effect: Effect.gen(function* () {
        const metrics = yield* MetricsService;
        const getMfaOrFail = (userId: UserId) =>
            pipe(
                MfaSecretsRepository,
                Effect.flatMap((repo) => repo.findByUserId(userId)),
                Effect.flatMap(Option.match({ onNone: () => Effect.fail(new HttpError.Auth({ reason: 'MFA not enrolled' })), onSome: Effect.succeed })),
            );
        const getMfaEnabledOrFail = (userId: UserId) => pipe(getMfaOrFail(userId), Effect.filterOrFail((m) => m.enabledAt !== null, () => new HttpError.Auth({ reason: 'MFA not enabled' })));
        const enroll = (userId: UserId, email: string) =>
            pipe(
                MfaSecretsRepository,
                Effect.flatMap((repo) =>
                    pipe(
                        repo.findByUserId(userId),
                        Effect.filterOrFail((opt) => Option.isNone(opt) || opt.value.enabledAt === null, () => new HttpError.Conflict({ message: 'MFA already enabled', resource: 'mfa' })),
                        Effect.andThen(Effect.try({ catch: () => new HttpError.Internal({ message: 'TOTP secret generation failed' }), try: generateSecret })),
                        Effect.flatMap((secret) =>
                            pipe(
                                Crypto.Key.encrypt(secret),
                                Effect.map((encrypted) => ({ backupCodes: generateBackupCodes(), salt: generateSalt(), secret, secretEncrypted: Buffer.from(encrypted.toBytes()) })),
                                Effect.flatMap(({ backupCodes, salt, secret, secretEncrypted }) =>
                                    pipe(
                                        Effect.all(backupCodes.map((code) => hashBackupCodeWithSalt(code, salt)), { concurrency: 'unbounded' }),
                                        Effect.flatMap((backupCodesHash) => repo.upsert({ backupCodesHash: [...backupCodesHash], enabledAt: null, secretEncrypted, userId })),
                                        Effect.tap(() => Metric.increment(metrics.mfa.enrollments)),
                                        Effect.as({ backupCodes, qrDataUrl: generateOtpAuthUri(secret, email), secret }),
                                    ),
                                ),
                            ),
                        ),
                    ),
                ),
                Effect.withSpan('mfa.enroll'),
            );
        const verify = (userId: UserId, code: string) =>
            pipe(
                Effect.all({ mfa: getMfaOrFail(userId), replayGuard: TotpReplayGuard, repo: MfaSecretsRepository, timeStep: Effect.sync(currentTimeStep) }),
                Effect.flatMap(({ mfa, repo, replayGuard, timeStep }) =>
                    pipe(
                        EncryptedKey.decryptBytes(mfa.secretEncrypted),
                        Effect.flatMap((decrypted) =>
                            Effect.try({
                                catch: () => new HttpError.Auth({ reason: 'TOTP verification failed' }),
                                try: () => verifySync({ algorithm: B.totp.algorithm, digits: B.totp.digits, epochTolerance: B.totp.window, period: B.totp.periodSec, secret: decrypted, token: code }),
                            }),
                        ),
                        Effect.tap((result) => Effect.all([
                            Effect.annotateCurrentSpan('mfa.success', result.valid),
                            result.valid && 'delta' in result ? Effect.annotateCurrentSpan('mfa.delta', result.delta) : Effect.void,
                            Metric.increment(metrics.mfa.verifications),
                        ], { discard: true })),
                        Effect.filterOrFail((r) => r.valid, () => new HttpError.Auth({ reason: 'Invalid MFA code' })),
                        Effect.flatMap((result) => replayGuard.checkAndMark(userId, timeStep + (result.delta ?? 0), code)),
                        Effect.filterOrFail(({ alreadyUsed }) => !alreadyUsed, () => new HttpError.Auth({ reason: 'TOTP code already used' })),
                        Effect.tap(() => Effect.when(
                            pipe(repo.upsert({ backupCodesHash: [...mfa.backupCodesHash], enabledAt: new Date(), secretEncrypted: mfa.secretEncrypted, userId }), Effect.asVoid),
                            () => mfa.enabledAt === null,
                        )),
                        Effect.as({ success: true as const }),
                    ),
                ),
                Effect.withSpan('mfa.verify'),
            );
        const useRecoveryCode = (userId: UserId, code: string) =>
            pipe(
                Effect.all({ mfa: getMfaEnabledOrFail(userId), repo: MfaSecretsRepository }),
                Effect.flatMap(({ mfa, repo }) =>
                    pipe(
                        findValidBackupCodeIndex(mfa.backupCodesHash, code),
                        Effect.tap((codeIndex) => Effect.all([Metric.increment(metrics.mfa.recoveryUsed), Effect.annotateCurrentSpan('mfa.recovery.success', codeIndex !== -1)], { discard: true })),
                        Effect.filterOrFail((codeIndex) => codeIndex !== -1, () => new HttpError.Auth({ reason: 'Invalid recovery code' })),
                        Effect.map((codeIndex) => mfa.backupCodesHash.filter((_, i) => i !== codeIndex)),
                        Effect.flatMap((updatedCodes) =>
                            pipe(
                                repo.upsert({ backupCodesHash: updatedCodes, enabledAt: mfa.enabledAt, secretEncrypted: mfa.secretEncrypted, userId }),
                                Effect.as({ remainingCodes: updatedCodes.length, success: true as const }),
                            ),
                        ),
                    ),
                ),
                Effect.withSpan('mfa.useRecoveryCode'),
            );
        const disable = (userId: UserId) =>
            pipe(
                Effect.all({ repo: MfaSecretsRepository }),
                Effect.flatMap(({ repo }) =>
                    pipe(
                        repo.findByUserId(userId),
                        Effect.filterOrFail(Option.isSome, () => new HttpError.NotFound({ resource: 'mfa' })),
                        Effect.andThen(repo.delete(userId)),
                        Effect.tap(() => Metric.increment(metrics.mfa.disabled)),
                        Effect.as({ success: true as const }),
                    ),
                ),
                Effect.withSpan('mfa.disable'),
            );
        const isEnabled = (userId: UserId) =>
            pipe(
                MfaSecretsRepository,
                Effect.flatMap((repo) => repo.findByUserId(userId)),
                Effect.map(Option.match({ onNone: () => false, onSome: (m) => m.enabledAt !== null })),
            );
        const getStatus = (userId: UserId) =>
            pipe(
                MfaSecretsRepository,
                Effect.flatMap((repo) => repo.findByUserId(userId)),
                Effect.map(Option.match({
                    onNone: () => ({ enabled: false as const, enrolled: false as const }),
                    onSome: (m) => ({ enabled: m.enabledAt !== null, enrolled: true as const, remainingBackupCodes: m.backupCodesHash.length }),
                })),
            );
        return { disable, enroll, getStatus, isEnabled, useRecoveryCode, verify };
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { MfaSecretsRepository, MfaService };
