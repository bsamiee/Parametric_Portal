/**
 * Effect matchers: Option and Exit assertions for Vitest.
 */
import { Exit, Option } from 'effect';
import { expect } from 'vitest';

// --- [TYPES] -----------------------------------------------------------------

type MatcherResult = { message: () => string; pass: boolean };
type MatcherKind = 'failure' | 'none' | 'some' | 'success';
type MatcherSpec = {
    readonly check: boolean;
    readonly value: unknown;
    readonly format: string;
    readonly negFormat: string;
};

interface EffectMatchers<R = unknown> {
    toBeFailure: (expected?: unknown) => R;
    toBeNone: () => R;
    toBeSome: (expected?: unknown) => R;
    toBeSuccess: (expected?: unknown) => R;
}

declare module 'vitest' {
    // biome-ignore lint/suspicious/noExplicitAny: Vitest Matchers interface uses T = any
    interface Matchers<T = any> extends EffectMatchers<T> {}
}

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    format: (kind: 'Failure' | 'None' | 'Some' | 'Success', v: unknown): string =>
        kind === 'None' ? 'None' : `${kind}(${JSON.stringify(v)})`,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const matcherResult = (spec: MatcherSpec, expected: unknown): MatcherResult => {
    const pass =
        expected === undefined ? spec.check : spec.check && JSON.stringify(spec.value) === JSON.stringify(expected);
    const expectedStr =
        expected === undefined ? spec.format : `${spec.format.split('(')[0]}(${JSON.stringify(expected)})`;
    const actualStr = spec.check ? spec.format : spec.negFormat;
    return {
        message: () => (pass ? `expected not to be ${expectedStr}` : `expected ${expectedStr} but got ${actualStr}`),
        pass,
    };
};

const extractors = {
    failure: (r: Exit.Exit<unknown, unknown>) => ({
        check: Exit.isFailure(r),
        value: Exit.isFailure(r) && r.cause._tag === 'Fail' ? r.cause.error : undefined,
    }),
    none: (r: Option.Option<unknown>) => ({ check: Option.isNone(r), value: undefined }),
    some: (r: Option.Option<unknown>) => ({ check: Option.isSome(r), value: Option.getOrNull(r) }),
    success: (r: Exit.Exit<unknown, unknown>) => ({
        check: Exit.isSuccess(r),
        value: Exit.isSuccess(r) ? r.value : undefined,
    }),
} as const satisfies Record<MatcherKind, (r: never) => { check: boolean; value: unknown }>;

// --- [ENTRY_POINT] -----------------------------------------------------------

expect.extend({
    toBeFailure(received: Exit.Exit<unknown, unknown>, expected?: unknown): MatcherResult {
        const { check, value } = extractors.failure(received);
        return matcherResult({ check, format: B.format('Failure', value), negFormat: 'Success', value }, expected);
    },
    toBeNone(received: Option.Option<unknown>): MatcherResult {
        const { check, value } = extractors.none(received);
        return matcherResult(
            { check, format: 'None', negFormat: B.format('Some', Option.getOrNull(received)), value },
            undefined,
        );
    },
    toBeSome(received: Option.Option<unknown>, expected?: unknown): MatcherResult {
        const { check, value } = extractors.some(received);
        return matcherResult({ check, format: B.format('Some', value), negFormat: 'None', value }, expected);
    },
    toBeSuccess(received: Exit.Exit<unknown, unknown>, expected?: unknown): MatcherResult {
        const { check, value } = extractors.success(received);
        return matcherResult({ check, format: B.format('Success', value), negFormat: 'Failure', value }, expected);
    },
});
