/** Email tests: request schema validation, error classification, provider invariants. */
import { it } from '@effect/vitest';
import { EmailAdapter } from '@parametric-portal/server/infra/email';
import { Effect, FastCheck as fc, Schema as S } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _provider =   fc.constantFrom<'resend' | 'ses' | 'postmark' | 'smtp'>('resend', 'ses', 'postmark', 'smtp');
const _reason =     fc.constantFrom<'MissingConfig' | 'ProviderError'>('MissingConfig', 'ProviderError');
const _statusCode = fc.oneof(fc.constant(undefined), fc.constantFrom(400, 429, 500, 503));
const BASE = { notificationId: '00000000-0000-7000-8000-000000000001', tenantId: '00000000-0000-7000-8000-000000000002', vars: {} } as const;

// --- [ALGEBRAIC] -------------------------------------------------------------

// Why: Request schema roundtrip -- valid inputs decode, empty object rejects (inverse + annihilation).
it.effect.prop('P1: request decode + reject', { notificationId: fc.uuid(), tenantId: fc.uuid() }, ({ notificationId, tenantId }) =>
    Effect.gen(function* () {
        const decoded = yield* S.decodeUnknown(EmailAdapter.Request)({ notificationId, template: 'tpl', tenantId, to: 'a@b.com', vars: {} });
        const rejected = yield* S.decodeUnknown(EmailAdapter.Request)({}).pipe(Effect.flip);
        expect(decoded).toEqual(expect.objectContaining({ notificationId, tenantId }));
        expect(rejected._tag).toBe('ParseError');
    }),
);
// Why: Error classification solely by reason -- retryable XOR terminal, provider/statusCode invariant (complement law).
it.effect.prop('P2: error classification by reason, invariant across provider + statusCode', { provider: _provider, reason: _reason, statusCode: _statusCode }, ({ provider, reason, statusCode }) =>
    Effect.sync(() => {
        const error = EmailAdapter.Error.from(reason, provider, { cause: 'test', statusCode });
        expect(error).toEqual(expect.objectContaining({ _tag: 'EmailError', provider, reason }));
        expect(error.isRetryable).toBe(!error.isTerminal);
        expect(error.isRetryable).toBe(reason === 'ProviderError');
    }),
);

// --- [EDGE_CASES] ------------------------------------------------------------

// Why: NonEmptyTrimmedString rejects empty/whitespace + _props exhaustive coverage.
it.effect('E1: request rejects empty fields + error props exhaustive', () =>
    Effect.gen(function* () {
        const [emptyTpl, spaceTo] = yield* Effect.all([
            S.decodeUnknown(EmailAdapter.Request)({ ...BASE, template: '', to: 'a@b.com' }).pipe(Effect.flip),
            S.decodeUnknown(EmailAdapter.Request)({ ...BASE, template: 'tpl', to: '   ' }).pipe(Effect.flip),
        ]);
        expect(emptyTpl._tag).toBe('ParseError');
        expect(spaceTo._tag).toBe('ParseError');
        expect(EmailAdapter.Error._props).toStrictEqual({
            MissingConfig: { retryable: false, terminal: true },
            ProviderError: { retryable: true, terminal: false },
        });
    }),
);
