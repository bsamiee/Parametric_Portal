/**
 * Form hooks bridging Effect Schema validation with React 19 useActionState.
 */

import { Schema as S } from '@effect/schema';
import { ASYNC_TUNING, type AsyncState, mkFailure, mkSuccess } from '@parametric-portal/types/async';
import { Effect, Fiber, pipe } from 'effect';
import { useActionState, useCallback, useRef, useState } from 'react';
import type { RuntimeApi } from './runtime.ts';

// --- [LOCAL_TYPES] -----------------------------------------------------------
// Form types defined locally since @parametric-portal/types/forms is not exported

// biome-ignore lint/style/useNamingConvention: _brand is standard Effect branded type convention
type FieldName = string & { readonly _brand: 'FieldName' };

type FieldState = 'pristine' | 'touched' | 'dirty';

type ValidationError = {
    // biome-ignore lint/style/useNamingConvention: _tag is standard discriminated union convention
    readonly _tag: 'ValidationError';
    readonly field: FieldName;
    readonly message: string;
    readonly rule: string;
};

type ValidationSuccess = {
    // biome-ignore lint/style/useNamingConvention: _tag is standard discriminated union convention
    readonly _tag: 'ValidationSuccess';
    readonly field: FieldName;
};

type ValidationResult = ValidationError | ValidationSuccess;

type FormField<T> = {
    readonly errors: ReadonlyArray<ValidationError>;
    readonly initialValue: T;
    readonly name: FieldName;
    readonly state: FieldState;
    readonly value: T;
};

type ActionStateResult<S, I> = readonly [S, (input: I) => void, boolean];

// --- [TYPES] -----------------------------------------------------------------

type FormFieldState<V> = {
    readonly field: FormField<V>;
    readonly setTouched: () => void;
    readonly setValue: (value: V) => void;
    readonly validate: () => Effect.Effect<ValidationResult, never, never>;
};

type FormHooksApi<R> = {
    readonly useActionStateEffect: <A, E, I>(
        action: (input: I) => Effect.Effect<A, E, R>,
        initialState: AsyncState<A, E>,
    ) => ActionStateResult<AsyncState<A, E>, I>;
    readonly useFormField: <V>(name: string, initialValue: V, schema: S.Schema<V>) => FormFieldState<V>;
};

type FormHooksConfig = {
    readonly timestampProvider?: () => number;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        timestamp: ASYNC_TUNING.timestamp,
    },
    states: {
        dirty: 'dirty' as FieldState,
        pristine: 'pristine' as FieldState,
        touched: 'touched' as FieldState,
    },
    tags: {
        error: 'ValidationError',
        success: 'ValidationSuccess',
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const mkFieldName = (name: string): FieldName => name as FieldName;

const mkField = <V>(name: string, initialValue: V): FormField<V> => ({
    errors: [],
    initialValue,
    name: mkFieldName(name),
    state: B.states.pristine,
    value: initialValue,
});

const mkValidationError = (field: FieldName, rule: string, message: string): ValidationError => ({
    _tag: B.tags.error,
    field,
    message,
    rule,
});

const mkValidationSuccess = (field: FieldName): ValidationResult => ({
    _tag: B.tags.success,
    field,
});

const validateWithSchema = <V>(
    field: FormField<V>,
    schema: S.Schema<V>,
): Effect.Effect<ValidationResult, never, never> =>
    pipe(
        Effect.try(() => S.decodeUnknownSync(schema)(field.value)),
        Effect.map(() => mkValidationSuccess(field.name)),
        Effect.catchAll((error: unknown) =>
            Effect.succeed(
                mkValidationError(field.name, 'schema', error instanceof Error ? error.message : 'Validation failed'),
            ),
        ),
    );

const updateFieldValue = <V>(field: FormField<V>, value: V): FormField<V> => ({
    ...field,
    state: value === field.initialValue ? B.states.pristine : B.states.dirty,
    value,
});

const updateFieldTouched = <V>(field: FormField<V>): FormField<V> => ({
    ...field,
    state: field.state === B.states.pristine ? B.states.touched : field.state,
});

const onValidationComplete =
    <V>(setField: React.Dispatch<React.SetStateAction<FormField<V>>>) =>
    (result: ValidationResult) =>
        Effect.sync(() => setField((prev: FormField<V>) => updateFieldErrors(prev, result)));

const updateFieldErrors = <V>(field: FormField<V>, result: ValidationResult): FormField<V> => ({
    ...field,
    errors: result._tag === B.tags.error ? [result] : [],
});

// --- [ENTRY_POINT] -----------------------------------------------------------

const createFormHooks = <R, E>(runtimeApi: RuntimeApi<R, E>, config: FormHooksConfig = {}): FormHooksApi<R> => {
    const { useRuntime } = runtimeApi;
    const ts = config.timestampProvider ?? B.defaults.timestamp;

    const useFormField = <V>(name: string, initialValue: V, schema: S.Schema<V>): FormFieldState<V> => {
        const [field, setField] = useState<FormField<V>>(() => mkField(name, initialValue));

        const setValue = useCallback((value: V) => setField((prev: FormField<V>) => updateFieldValue(prev, value)), []);

        const setTouched = useCallback(() => setField((prev: FormField<V>) => updateFieldTouched(prev)), []);

        const validate = useCallback(
            () => pipe(validateWithSchema(field, schema), Effect.tap(onValidationComplete(setField))),
            [field, schema],
        );

        return { field, setTouched, setValue, validate };
    };

    const useActionStateEffect = <A, Err, I>(
        action: (input: I) => Effect.Effect<A, Err, R>,
        initialState: AsyncState<A, Err>,
    ): ActionStateResult<AsyncState<A, Err>, I> => {
        const runtime = useRuntime();
        const fiberRef = useRef<Fiber.RuntimeFiber<A, Err> | null>(null);

        const actionFn = useCallback(
            async (_prevState: AsyncState<A, Err>, input: I): Promise<AsyncState<A, Err>> => {
                fiberRef.current !== null && (await runtime.runPromise(Fiber.interrupt(fiberRef.current)));

                const eff = action(input).pipe(
                    Effect.map((data) => mkSuccess(data, ts)),
                    Effect.catchAll((error: Err) => Effect.succeed(mkFailure(error, ts))),
                );

                return runtime.runPromise(eff);
            },
            [runtime, action],
        );

        return useActionState(actionFn, initialState);
    };

    return Object.freeze({
        useActionStateEffect,
        useFormField,
    });
};

// --- [EXPORT] ----------------------------------------------------------------

export type { FormFieldState, FormHooksApi, FormHooksConfig };
export { B as FORM_HOOKS_TUNING, createFormHooks };
