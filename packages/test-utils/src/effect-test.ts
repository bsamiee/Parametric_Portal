/** Effect testing utilities: TestContext, TestClock, layer builders, and Vitest matchers. */
import {
    type Context,
    Effect,
    Either,
    Exit,
    Fiber,
    Layer,
    Option,
    Schema,
    TestClock,
    TestContext,
    TestServices,
} from 'effect';
import type { DurationInput } from 'effect/Duration';
import type { TestConfig } from 'effect/TestConfig';
import { expect } from 'vitest';

// --- [TYPES] -----------------------------------------------------------------

type MatcherKind = 'failure' | 'left' | 'none' | 'right' | 'some' | 'success';
type MatcherResult = { message: () => string; pass: boolean };
type MatcherSpec = {
    readonly check: boolean;
    readonly value: unknown;
    readonly format: string;
    readonly negFormat: string;
};

interface TestClockOptions {
    readonly initialTime?: number;
}
interface RunTestOptions {
    readonly layer?: Layer.Layer<never, never, never>;
    readonly testConfig?: Partial<TestConfig>;
}
interface TestResult<A, E> {
    readonly error: E | undefined;
    readonly exit: Exit.Exit<A, E>;
    readonly isFailure: boolean;
    readonly isSuccess: boolean;
    readonly value: A | undefined;
}
interface EffectMatchers<R = unknown> {
    toBeFailure: (expected?: unknown) => R;
    toBeLeft: (expected?: unknown) => R;
    toBeNone: () => R;
    toBeRight: (expected?: unknown) => R;
    toBeSome: (expected?: unknown) => R;
    toBeSuccess: (expected?: unknown) => R;
    toDecodeAs: <T>(schema: Schema.Schema<T>, expected?: T) => R;
}

declare module 'vitest' {
    // biome-ignore lint/suspicious/noExplicitAny: Vitest Matchers interface uses T = any
    interface Matchers<T = any> extends EffectMatchers<T> {}
}

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    format: (kind: 'Failure' | 'Left' | 'None' | 'Right' | 'Some' | 'Success', v: unknown): string =>
        kind === 'None' ? 'None' : `${kind}(${JSON.stringify(v)})`,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const makeTestResult = <A, E>(exit: Exit.Exit<A, E>): TestResult<A, E> => {
    const isSuccess = Exit.isSuccess(exit);
    const isFailure = Exit.isFailure(exit);
    return {
        error: isFailure && exit.cause._tag === 'Fail' ? exit.cause.error : undefined,
        exit,
        isFailure,
        isSuccess,
        value: isSuccess ? exit.value : undefined,
    };
};
const makeTestConfigLayer = (config?: Partial<TestConfig>): Layer.Layer<TestServices.TestServices> =>
    config === undefined
        ? TestContext.TestContext
        : Layer.merge(
              TestContext.TestContext,
              TestServices.testConfigLayer({
                  repeats: config.repeats ?? 1,
                  retries: config.retries ?? 0,
                  samples: config.samples ?? 100,
                  shrinks: config.shrinks ?? 1000,
              }),
          );

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
    left: (r: Either.Either<unknown, unknown>) => ({
        check: Either.isLeft(r),
        value: Either.isLeft(r) ? r.left : undefined,
    }),
    none: (r: Option.Option<unknown>) => ({ check: Option.isNone(r), value: undefined }),
    right: (r: Either.Either<unknown, unknown>) => ({
        check: Either.isRight(r),
        value: Either.isRight(r) ? r.right : undefined,
    }),
    some: (r: Option.Option<unknown>) => ({ check: Option.isSome(r), value: Option.getOrNull(r) }),
    success: (r: Exit.Exit<unknown, unknown>) => ({
        check: Exit.isSuccess(r),
        value: Exit.isSuccess(r) ? r.value : undefined,
    }),
} as const satisfies Record<MatcherKind, (r: never) => { check: boolean; value: unknown }>;

// --- [ENTRY_POINT] -----------------------------------------------------------

const EffectTestHarness = Object.freeze({
    adjust: (duration: DurationInput): Effect.Effect<void, never, TestServices.TestServices> =>
        TestClock.adjust(duration),
    currentTime: (): Effect.Effect<number, never, TestServices.TestServices> => TestClock.currentTimeMillis,
    forkAndAdvance: async <A, E>(
        effect: Effect.Effect<A, E, TestServices.TestServices>,
        duration: DurationInput,
    ): Promise<TestResult<A, E>> => {
        const program = Effect.gen(function* () {
            const fiber = yield* Effect.fork(effect);
            yield* TestClock.adjust(duration);
            return yield* Fiber.join(fiber);
        });
        return EffectTestHarness.runTest(program);
    },
    getSleeps: (): Effect.Effect<readonly number[], never, TestServices.TestServices> =>
        Effect.map(TestClock.sleeps(), (chunk) => [...chunk]),
    runTest: async <A, E>(
        effect: Effect.Effect<A, E, TestServices.TestServices>,
        options?: RunTestOptions,
    ): Promise<TestResult<A, E>> => {
        const baseLayer = makeTestConfigLayer(options?.testConfig);
        const finalLayer = options?.layer ? Layer.merge(baseLayer, options.layer) : baseLayer;
        const exit = await Effect.runPromiseExit(Effect.provide(effect, finalLayer));
        return makeTestResult(exit);
    },
    runTestSync: <A, E>(
        effect: Effect.Effect<A, E, TestServices.TestServices>,
        options?: RunTestOptions,
    ): TestResult<A, E> => {
        const baseLayer = makeTestConfigLayer(options?.testConfig);
        const finalLayer = options?.layer ? Layer.merge(baseLayer, options.layer) : baseLayer;
        const exit = Effect.runSyncExit(Effect.provide(effect, finalLayer));
        return makeTestResult(exit);
    },
    setTime: (time: number | Date): Effect.Effect<void, never, TestServices.TestServices> =>
        TestClock.setTime(time instanceof Date ? time.getTime() : time),
    withTestClock: async <A, E>(
        effect: Effect.Effect<A, E, TestServices.TestServices>,
        options?: TestClockOptions,
    ): Promise<TestResult<A, E>> => {
        const withTime = options?.initialTime
            ? Effect.flatMap(TestClock.setTime(options.initialTime), () => effect)
            : effect;
        return EffectTestHarness.runTest(withTime);
    },
});

const TestLayers = Object.freeze({
    Const: <I, S>(tag: Context.Tag<I, S>, value: S): { readonly layer: Layer.Layer<I> } => ({
        layer: Layer.succeed(tag, value),
    }),
    Custom: <I, S>(tag: Context.Tag<I, S>, implementation: S): { readonly layer: Layer.Layer<I> } => ({
        layer: Layer.succeed(tag, implementation),
    }),
    CustomEffect: <I, S, R, E>(
        tag: Context.Tag<I, S>,
        effect: Effect.Effect<S, E, R>,
    ): { readonly layer: Layer.Layer<I, E, R> } => ({
        layer: Layer.effect(tag, effect),
    }),
});

// --- [SERVICES] --------------------------------------------------------------

expect.extend({
    toBeFailure(received: Exit.Exit<unknown, unknown>, expected?: unknown): MatcherResult {
        const { check, value } = extractors.failure(received);
        return matcherResult({ check, format: B.format('Failure', value), negFormat: 'Success', value }, expected);
    },
    toBeLeft(received: Either.Either<unknown, unknown>, expected?: unknown): MatcherResult {
        const { check, value } = extractors.left(received);
        return matcherResult({ check, format: B.format('Left', value), negFormat: 'Right', value }, expected);
    },
    toBeNone(received: Option.Option<unknown>): MatcherResult {
        const { check, value } = extractors.none(received);
        return matcherResult(
            { check, format: 'None', negFormat: B.format('Some', Option.getOrNull(received)), value },
            undefined,
        );
    },
    toBeRight(received: Either.Either<unknown, unknown>, expected?: unknown): MatcherResult {
        const { check, value } = extractors.right(received);
        return matcherResult({ check, format: B.format('Right', value), negFormat: 'Left', value }, expected);
    },
    toBeSome(received: Option.Option<unknown>, expected?: unknown): MatcherResult {
        const { check, value } = extractors.some(received);
        return matcherResult({ check, format: B.format('Some', value), negFormat: 'None', value }, expected);
    },
    toBeSuccess(received: Exit.Exit<unknown, unknown>, expected?: unknown): MatcherResult {
        const { check, value } = extractors.success(received);
        return matcherResult({ check, format: B.format('Success', value), negFormat: 'Failure', value }, expected);
    },
    // biome-ignore lint/suspicious/noExplicitAny: Schema type requires flexibility for unknown inputs
    toDecodeAs(received: unknown, schema: Schema.Schema<any>, expected?: unknown): MatcherResult {
        const result = Schema.decodeUnknownEither(schema)(received);
        const isRight = Either.isRight(result);
        const value = isRight ? result.right : undefined;
        const pass = isRight && (expected === undefined || JSON.stringify(value) === JSON.stringify(expected));
        return {
            message: () =>
                pass
                    ? `expected decode to fail but got Right(${JSON.stringify(value)})`
                    : `expected Right(${JSON.stringify(expected)}) but got ${isRight ? `Right(${JSON.stringify(value)})` : 'Left'}`,
            pass,
        };
    },
});

// --- [EXPORT] ----------------------------------------------------------------

export { EffectTestHarness, TestLayers };
export type { RunTestOptions, TestClockOptions, TestResult };
