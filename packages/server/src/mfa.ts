/**
 * MFA Service: TOTP-based multi-factor authentication with recovery codes.
 * Uses otplib for TOTP generation/verification, crypto for secure hashing.
 * Repository is injected via MfaSecretsRepository tag to avoid circular deps.
 */
import type { MfaSecret, MfaSecretInsert, UserId } from '@parametric-portal/types/schema';
import { Effect, Metric, Option } from 'effect';
import { generateSecret, generateURI, verify as verifyToken } from 'otplib';
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
    backupCodeCount: 10,
    backupCodeLength: 8,
    epochTolerance: [30, 0] as [number, number],
    issuer: 'Parametric Portal',
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const generateBackupCodes = (count: number = B.backupCodeCount): readonly string[] =>
    Array.from({ length: count }, () => {
        const bytes = crypto.getRandomValues(new Uint8Array(B.backupCodeLength));
        return Array.from(bytes)
            .map((b) => (b % 36).toString(36))
            .join('')
            .toUpperCase()
            .slice(0, B.backupCodeLength);
    });
const hashBackupCode = (code: string): Effect.Effect<string, InstanceType<typeof HttpError.Internal>, MetricsService> =>
    Crypto.Token.hash(code.toUpperCase());
const generateQrDataUrl = (secret: string, email: string): string =>
    generateURI({ issuer: B.issuer, label: email, secret });

// --- [CLASSES] ---------------------------------------------------------------

/** Tag for MFA secrets repository - provided by database layer */
class MfaSecretsRepository extends Effect.Tag('server/MfaSecretsRepository')<MfaSecretsRepository, MfaSecretsRepo>() {}
class MfaService extends Effect.Service<MfaService>()('server/MfaService', {
    dependencies: [MetricsService.Default],
    effect: Effect.gen(function* () {
        const metrics = yield* MetricsService;
        const enroll = (userId: UserId, email: string) =>
            Effect.gen(function* () {
                const repo = yield* MfaSecretsRepository;
                yield* repo.findByUserId(userId).pipe(
                    Effect.filterOrFail(
                        (opt) => Option.isNone(opt) || opt.value.enabledAt === null,
                        () => new HttpError.Conflict({ message: 'MFA already enabled', resource: 'mfa' }),
                    ),
                );
                const secret = generateSecret();
                const secretEncrypted = Buffer.from((yield* Crypto.Key.encrypt(secret)).toBytes());
                const backupCodes = generateBackupCodes();
                const backupCodesHash = yield* Effect.all(backupCodes.map(hashBackupCode), { concurrency: 'unbounded' });
                yield* repo.upsert({ backupCodesHash: [...backupCodesHash], enabledAt: null, secretEncrypted, userId });
                yield* Metric.increment(metrics.mfa.enrollments);
                return { backupCodes, qrDataUrl: generateQrDataUrl(secret, email), secret };
            }).pipe(Effect.provideService(MetricsService, metrics));
        /** Verify a TOTP code and enable MFA if not already enabled. Uses epochTolerance for clock drift handling (±30 seconds per step). */
        const verify = (userId: UserId, code: string) =>
            Effect.gen(function* () {
                const repo = yield* MfaSecretsRepository;
                const mfa = yield* repo.findByUserId(userId).pipe(
                    Effect.flatMap(Option.match({
                        onNone: () => Effect.fail(new HttpError.Auth({ reason: 'MFA not enrolled' })),
                        onSome: Effect.succeed,
                    })),
                );
                const decrypted = yield* EncryptedKey.decryptBytes(mfa.secretEncrypted);
                const result = yield* Effect.promise(() => verifyToken({ epochTolerance: B.epochTolerance, secret: decrypted, token: code }));
                yield* Effect.annotateCurrentSpan('mfa.success', result.valid);
                yield* result.valid ? Effect.annotateCurrentSpan('mfa.delta', result.delta) : Effect.void;
                yield* Metric.increment(metrics.mfa.verifications);
                yield* result.valid ? Effect.void : Effect.fail(new HttpError.Auth({ reason: 'Invalid MFA code' }));
                yield* mfa.enabledAt === null
                    ? repo.upsert({ backupCodesHash: [...mfa.backupCodesHash], enabledAt: new Date(), secretEncrypted: mfa.secretEncrypted, userId })
                    : Effect.void;
                return { success: true as const };
            }).pipe(Effect.provideService(MetricsService, metrics));
        const useRecoveryCode = (userId: UserId, code: string) =>
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
                const codeIndex = mfa.backupCodesHash.indexOf(codeHash);
                const valid = codeIndex !== -1;
                yield* Metric.increment(metrics.mfa.recoveryUsed);
                yield* Effect.annotateCurrentSpan('mfa.recovery.success', valid);
                yield* valid ? Effect.void : Effect.fail(new HttpError.Auth({ reason: 'Invalid recovery code' }));
                const updatedCodes = mfa.backupCodesHash.filter((_, i) => i !== codeIndex);
                yield* repo.upsert({ backupCodesHash: updatedCodes, enabledAt: mfa.enabledAt, secretEncrypted: mfa.secretEncrypted, userId });
                return { remainingCodes: updatedCodes.length, success: true as const };
            }).pipe(Effect.provideService(MetricsService, metrics));
        const disable = (userId: UserId) =>
            Effect.gen(function* () {
                const repo = yield* MfaSecretsRepository;
                yield* repo.findByUserId(userId).pipe(
                    Effect.filterOrFail(Option.isSome, () => new HttpError.NotFound({ resource: 'mfa' })),
                );
                yield* repo.delete(userId);
                yield* Metric.increment(metrics.mfa.disabled);
                return { success: true as const };
            }).pipe(Effect.provideService(MetricsService, metrics));
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
