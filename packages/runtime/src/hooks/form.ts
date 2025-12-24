// Bridge Effect Schema validation with React 19 useActionState.
// useFormField: sync validation | useActionStateEffect: async Effect actions
import { type AsyncState, async } from '@parametric-portal/types/async';
import {
    type FieldName,
    FORM_TUNING,
    type FormField,
    forms,
    type ValidationResult,
} from '@parametric-portal/types/forms';
import { Effect, Fiber, type Schema as S } from 'effect';
import { useActionState, useCallback, useRef, useState } from 'react';
import { useRuntime } from '../runtime';

// --- [TYPES] -----------------------------------------------------------------

type ActionStateResult<St, I> = readonly [St, (input: I) => void, boolean];
type FormFieldState<V> = {
    readonly field: FormField<V>;
    readonly setTouched: () => void;
    readonly setValue: (value: V) => void;
    readonly validate: () => ValidationResult;
};

// --- [CONSTANTS] -------------------------------------------------------------

const asyncApi = async();
const formsApi = forms();
const B = Object.freeze({
    states: FORM_TUNING.states,
    tags: FORM_TUNING.tags,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const mkFieldName = (name: string): FieldName => name as FieldName;
const validateWithSchema = <V>(field: FormField<V>, schema: S.Schema<V>): ValidationResult =>
    Effect.runSync(formsApi.validateField(field, schema));
const updateFieldValue = <V>(field: FormField<V>, value: V): FormField<V> =>
    value === field.initialValue
        ? { ...formsApi.Field.setValue(field, value), state: B.states.pristine }
        : formsApi.Field.setValue(field, value);

// --- [HOOKS] -----------------------------------------------------------------

const useFormField = <V>(name: string, initialValue: V, schema: S.Schema<V>): FormFieldState<V> => {
    const [field, setField] = useState<FormField<V>>(() => formsApi.Field.create(mkFieldName(name), initialValue));
    const setValue = useCallback((value: V) => setField((prev: FormField<V>) => updateFieldValue(prev, value)), []);
    const setTouched = useCallback(() => setField((prev: FormField<V>) => formsApi.Field.touch(prev)), []);
    const validate = useCallback(() => {
        const result = validateWithSchema(field, schema);
        setField((prev: FormField<V>) => formsApi.Field.setErrors(prev, result._tag === B.tags.error ? [result] : []));
        return result;
    }, [field, schema]);
    return { field, setTouched, setValue, validate };
};

const useActionStateEffect = <A, E, I, R>(
    action: (input: I) => Effect.Effect<A, E, R>,
    initialState: AsyncState<A, E>,
): ActionStateResult<AsyncState<A, E>, I> => {
    const runtime = useRuntime<R, never>();
    const fiberRef = useRef<Fiber.RuntimeFiber<A, E> | null>(null);
    const actionFn = useCallback(
        async (_prevState: AsyncState<A, E>, input: I): Promise<AsyncState<A, E>> => {
            fiberRef.current !== null && (await runtime.runPromise(Fiber.interrupt(fiberRef.current)));
            const eff = action(input).pipe(
                Effect.map((data) => asyncApi.success<A, E>(data)),
                Effect.catchAll((error: E) => Effect.succeed(asyncApi.failure<A, E>(error))),
            );
            return runtime.runPromise(eff);
        },
        [runtime, action],
    );
    return useActionState(actionFn, initialState);
};

// --- [EXPORT] ----------------------------------------------------------------

export type { ActionStateResult, FormFieldState };
export { B as FORM_TUNING, useActionStateEffect, useFormField };
