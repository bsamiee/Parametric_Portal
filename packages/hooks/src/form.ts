/**
 * Bridge Effect Schema validation with React 19 useActionState.
 * useFormField: synchronous validation (no runtime required)
 * useActionStateEffect: async action with Effect (requires runtime)
 */

import { ASYNC_TUNING, type AsyncState, mkFailure, mkSuccess } from '@parametric-portal/types/async';
import {
    createField,
    type FieldName,
    FORM_TUNING,
    type FormField,
    setFieldErrors,
    setFieldValue,
    touchField,
    type ValidationResult,
    validateField,
} from '@parametric-portal/types/forms';
import { Effect, Fiber, type Schema as S } from 'effect';
import { useActionState, useCallback, useRef, useState } from 'react';
import type { RuntimeApi } from './runtime';

// --- [TYPES] -----------------------------------------------------------------

type ActionStateResult<S, I> = readonly [S, (input: I) => void, boolean];

type FormFieldState<V> = {
    readonly field: FormField<V>;
    readonly setTouched: () => void;
    readonly setValue: (value: V) => void;
    readonly validate: () => ValidationResult;
};

type ActionStateHooksApi<R> = {
    readonly useActionStateEffect: <A, E, I>(
        action: (input: I) => Effect.Effect<A, E, R>,
        initialState: AsyncState<A, E>,
    ) => ActionStateResult<AsyncState<A, E>, I>;
};

type ActionStateConfig = {
    readonly timestampProvider?: () => number;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        timestamp: ASYNC_TUNING.timestamp,
    },
    states: FORM_TUNING.states,
    tags: FORM_TUNING.tags,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const mkFieldName = (name: string): FieldName => name;

const validateWithSchema = <V>(field: FormField<V>, schema: S.Schema<V>): ValidationResult =>
    Effect.runSync(validateField(field, schema));

const updateFieldValue = <V>(field: FormField<V>, value: V): FormField<V> =>
    value === field.initialValue
        ? { ...setFieldValue(field, value), state: B.states.pristine }
        : setFieldValue(field, value);

// --- [ENTRY_POINT] -----------------------------------------------------------

/**
 * Standalone form field hook (no runtime required - validation is synchronous)
 */
const useFormField = <V>(name: string, initialValue: V, schema: S.Schema<V>): FormFieldState<V> => {
    const [field, setField] = useState<FormField<V>>(() => createField(mkFieldName(name), initialValue));

    const setValue = useCallback((value: V) => setField((prev: FormField<V>) => updateFieldValue(prev, value)), []);

    const setTouched = useCallback(() => setField((prev: FormField<V>) => touchField(prev)), []);

    const validate = useCallback(() => {
        const result = validateWithSchema(field, schema);
        setField((prev: FormField<V>) => setFieldErrors(prev, result._tag === B.tags.error ? [result] : []));
        return result;
    }, [field, schema]);

    return { field, setTouched, setValue, validate };
};

/**
 * Factory for runtime-dependent action state hook
 */
const createActionStateHooks = <R, E>(
    runtimeApi: RuntimeApi<R, E>,
    config: ActionStateConfig = {},
): ActionStateHooksApi<R> => {
    const { useRuntime } = runtimeApi;
    const ts = config.timestampProvider ?? B.defaults.timestamp;

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
                    Effect.map((data) => mkSuccess<A, Err>(data, ts)),
                    Effect.catchAll((error: Err) => Effect.succeed(mkFailure<A, Err>(error, ts))),
                );

                return runtime.runPromise(eff);
            },
            [runtime, action],
        );

        return useActionState(actionFn, initialState);
    };

    return Object.freeze({ useActionStateEffect });
};

// --- [EXPORT] ----------------------------------------------------------------

export type { ActionStateConfig, ActionStateHooksApi, FormFieldState };
export { B as FORM_HOOKS_TUNING, createActionStateHooks, useFormField };
