/**
 * MFA Service: TOTP-based multi-factor authentication with recovery codes.
 * Uses otplib for TOTP generation/verification, crypto for secure hashing.
 * Repository is injected via MfaSecretsRepository tag to avoid circular deps.
 */
import type { MfaSecret, MfaSecretInsert, UserId } from '@parametric-portal/types/schema';
import { timingSafeEqual } from 'node:crypto';
import { Effect, Metric, Option } from 'effect';
import { customAlphabet } from 'nanoid';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { Crypto, EncryptedKey } from './crypto.ts';
import { HttpError } from './http-errors.ts';
import { MetricsService } from './metrics.ts';

// --- [TYPES] -----------------------------------------------------------------

type MfaSecretsRepo = {
    readonly delete: (userId: UserId) => Effect.Effect<void, InstanceType<typeof HttpError.Internal>, never>;
    readonly findByUserId: (userId: UserId) => Effect.Effect<Option.Option<MfaSecret>, InstanceType<typeof HttpError.Internal>, never>;
    readonly upsert: (data: MfaSecretInsert) => Effect.Effect<MfaSecret, InstanceType<typeof HttpError.Internal>, never>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    backupCodeAlphabet: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    backupCodeCount: 10,
    backupCodeLength: 8,
    issuer: process.env['APP_NAME'] ?? 'Parametric Portal',
    totp: { algorithm: 'sha1', digits: 6, period: 30 } as const,
    totpWindow: [1, 1] as [number, number],
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const generateBackupCode = customAlphabet(B.backupCodeAlphabet, B.backupCodeLength);
const generateBackupCodes = (count: number = B.backupCodeCount): readonly string[] => Array.from({ length: count }, generateBackupCode);
const hashBackupCode = (code: string): Effect.Effect<string, InstanceType<typeof HttpError.Internal>, MetricsService> => Crypto.Token.hash(code.toUpperCase());
const generateOtpAuthUri = (secret: string, email: string): string => generateURI({ issuer: B.issuer, label: email, secret });
const findBackupCodeIndex = (codes: readonly string[], targetHash: string): number => {
    const targetBuf = Buffer.from(targetHash, 'hex');
    return codes.findIndex((code) => {
        const codeBuf = Buffer.from(code, 'hex');
        return codeBuf.length === targetBuf.length && timingSafeEqual(codeBuf, targetBuf);
    });
};

// --- [CLASSES] ---------------------------------------------------------------

/** Tag for MFA secrets repository - provided by database layer */
class MfaSecretsRepository extends Effect.Tag('server/MfaSecretsRepository')<MfaSecretsRepository, MfaSecretsRepo>() {}
class MfaService extends Effect.Service<MfaService>()('server/MfaService', {
    dependencies: [MetricsService.Default],
    effect: Effect.gen(function* () {
        const metrics = yield* MetricsService;
        // Re-enrollment while pending (enabledAt === null) is allowed and will replace
        // the previous secret and backup codes. This is intentional to allow users to
        // restart enrollment if they lose access to the authenticator before verifying.
        const enroll = Effect.fn('mfa.enroll')((userId: UserId, email: string) =>
            Effect.gen(function* () {
                const repo = yield* MfaSecretsRepository;
                yield* repo.findByUserId(userId).pipe(
                    Effect.filterOrFail(
                        (opt) => Option.isNone(opt) || opt.value.enabledAt === null,
                        () => new HttpError.Conflict({ message: 'MFA already enabled', resource: 'mfa' }),
                    ),
                );
                const secret = yield* Effect.try({
                    catch: () => new HttpError.Internal({ message: 'TOTP secret generation failed' }),
                    try: () => generateSecret(),
                });
                const secretEncrypted = Buffer.from((yield* Crypto.Key.encrypt(secret)).toBytes());
                const backupCodes = generateBackupCodes();
                const backupCodesHash = yield* Effect.all(backupCodes.map(hashBackupCode), { concurrency: 'unbounded' });
                yield* repo.upsert({ backupCodesHash: [...backupCodesHash], enabledAt: null, secretEncrypted, userId });
                yield* Metric.increment(metrics.mfa.enrollments);
                return { backupCodes, qrDataUrl: generateOtpAuthUri(secret, email), secret };
            }).pipe(Effect.provideService(MetricsService, metrics)),
        );
        const verify = Effect.fn('mfa.verify')((userId: UserId, code: string) =>
            Effect.gen(function* () {
                const repo = yield* MfaSecretsRepository;
                const mfa = yield* repo.findByUserId(userId).pipe(
                    Effect.flatMap(Option.match({
                        onNone: () => Effect.fail(new HttpError.Auth({ reason: 'MFA not enrolled' })),
                        onSome: Effect.succeed,
                    })),
                );
                const decrypted = yield* EncryptedKey.decryptBytes(mfa.secretEncrypted);
                const result = yield* Effect.try({
                    catch: () => new HttpError.Auth({ reason: 'TOTP verification failed' }),
                    try: () => verifySync({
                        algorithm: B.totp.algorithm,
                        digits: B.totp.digits,
                        epochTolerance: B.totpWindow,
                        period: B.totp.period,
                        secret: decrypted,
                        token: code,
                    }),
                });
                yield* Effect.annotateCurrentSpan('mfa.success', result.valid);
                yield* result.valid ? Effect.annotateCurrentSpan('mfa.delta', result.delta) : Effect.void;
                yield* Metric.increment(metrics.mfa.verifications);
                yield* result.valid ? Effect.void : Effect.fail(new HttpError.Auth({ reason: 'Invalid MFA code' }));
                // Enable MFA on first successful verification. Note: concurrent requests during
                // enrollment could theoretically both succeed before enabledAt is set. This is
                // acceptable since both use the same valid TOTP code within its time window.
                // For stricter replay prevention, consider tracking used codes per time step.
                yield* mfa.enabledAt === null
                    ? repo.upsert({ backupCodesHash: [...mfa.backupCodesHash], enabledAt: new Date(), secretEncrypted: mfa.secretEncrypted, userId })
                    : Effect.void;
                return { success: true as const };
            }).pipe(Effect.provideService(MetricsService, metrics)),
        );
        const useRecoveryCode = Effect.fn('mfa.useRecoveryCode')((userId: UserId, code: string) =>
            Effect.gen(function* () {
                const repo = yield* MfaSecretsRepository;
                const mfa = yield* repo.findByUserId(userId).pipe(
                    Effect.flatMap(Option.match({
                        onNone: () => Effect.fail(new HttpError.Auth({ reason: 'MFA not enrolled' })),
                        onSome: Effect.succeed,
                    })),
                    Effect.filterOrFail((m) => m.enabledAt !== null, () => new HttpError.Auth({ reason: 'MFA not enabled' })),
                );
                const codeHash = yield* hashBackupCode(code);
                const codeIndex = findBackupCodeIndex(mfa.backupCodesHash, codeHash);
                const valid = codeIndex !== -1;
                yield* Metric.increment(metrics.mfa.recoveryUsed);
                yield* Effect.annotateCurrentSpan('mfa.recovery.success', valid);
                yield* valid ? Effect.void : Effect.fail(new HttpError.Auth({ reason: 'Invalid recovery code' }));
                const updatedCodes = mfa.backupCodesHash.filter((_, i) => i !== codeIndex);
                yield* repo.upsert({ backupCodesHash: updatedCodes, enabledAt: mfa.enabledAt, secretEncrypted: mfa.secretEncrypted, userId });
                return { remainingCodes: updatedCodes.length, success: true as const };
            }).pipe(Effect.provideService(MetricsService, metrics)),
        );
        const disable = Effect.fn('mfa.disable')((userId: UserId) =>
            Effect.gen(function* () {
                const repo = yield* MfaSecretsRepository;
                yield* repo.findByUserId(userId).pipe(
                    Effect.filterOrFail(Option.isSome, () => new HttpError.NotFound({ resource: 'mfa' })),
                );
                yield* repo.delete(userId);
                yield* Metric.increment(metrics.mfa.disabled);
                return { success: true as const };
            }).pipe(Effect.provideService(MetricsService, metrics)),
        );
        const isEnabled = (userId: UserId) =>
            MfaSecretsRepository.pipe(
                Effect.flatMap((repo) => repo.findByUserId(userId)),
                Effect.map(Option.match({ onNone: () => false, onSome: (m) => m.enabledAt !== null })),
            );
        const getStatus = (userId: UserId) =>
            MfaSecretsRepository.pipe(
                Effect.flatMap((repo) => repo.findByUserId(userId)),
                Effect.map(Option.match({
                    onNone: () => ({ enabled: false as const, enrolled: false as const }),
                    onSome: (m) => ({
                        enabled: m.enabledAt !== null,
                        enrolled: true as const,
                        remainingBackupCodes: m.backupCodesHash.length,
                    }),
                })),
            );
        return { disable, enroll, getStatus, isEnabled, useRecoveryCode, verify };
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { B as MFA_TUNING, MfaSecretsRepository, MfaService };
export type { MfaSecretsRepo };
