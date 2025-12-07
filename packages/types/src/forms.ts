/**
 * Define form validation types via Effect Schema: FieldState, ValidationError, FormField, FormState with declarative rule composition.
 */
import { Schema as S } from '@effect/schema';
import type { ParseError } from '@effect/schema/ParseResult';
import { Effect, Option, pipe } from 'effect';
import { match, P } from 'ts-pattern';

// --- [TYPES] -----------------------------------------------------------------

type FieldName = S.Schema.Type<typeof FieldNameSchema>;

type ValidationError = {
    readonly _tag: 'ValidationError';
    readonly field: FieldName;
    readonly message: string;
    readonly rule: string;
};

type ValidationSuccess = {
    readonly _tag: 'ValidationSuccess';
    readonly field: FieldName;
};

type ValidationResult = ValidationError | ValidationSuccess;

type FieldState = 'pristine' | 'touched' | 'dirty';

type FormField<T> = {
    readonly errors: ReadonlyArray<ValidationError>;
    readonly initialValue: T;
    readonly name: FieldName;
    readonly state: FieldState;
    readonly value: T;
};

type FormState<T extends Record<string, unknown>> = {
    readonly _tag: 'FormState';
    readonly fields: { readonly [K in keyof T]: FormField<T[K]> };
    readonly isSubmitting: boolean;
    readonly isValid: boolean;
    readonly submitCount: number;
};

type FormConfig = {
    readonly validateOnBlur?: boolean;
    readonly validateOnChange?: boolean;
};

type FormApi<T extends Record<string, unknown>> = {
    readonly createField: <V>(name: string, initialValue: V) => FormField<V>;
    readonly error: (field: FieldName, rule: string, message: string) => ValidationError;
    readonly fold: <R>(result: ValidationResult, handlers: FoldHandlers<R>) => R;
    readonly getFieldErrors: (state: FormState<T>, name: keyof T) => ReadonlyArray<ValidationError>;
    readonly isError: (result: ValidationResult) => result is ValidationError;
    readonly isFormValid: (state: FormState<T>) => boolean;
    readonly isSuccess: (result: ValidationResult) => result is ValidationSuccess;
    readonly match: typeof match;
    readonly Option: typeof Option;
    readonly P: typeof P;
    readonly schemas: typeof schemas;
    readonly setFieldValue: <K extends keyof T>(state: FormState<T>, name: K, value: T[K]) => FormState<T>;
    readonly success: (field: FieldName) => ValidationSuccess;
    readonly tags: typeof B.tags;
    readonly touchField: <K extends keyof T>(state: FormState<T>, name: K) => FormState<T>;
    readonly validateField: <V>(
        field: FormField<V>,
        schema: S.Schema<V>,
    ) => Effect.Effect<ValidationResult, never, never>;
};

type FoldHandlers<R> = {
    readonly onError: (error: ValidationError) => R;
    readonly onSuccess: (field: FieldName) => R;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: { validateOnBlur: true, validateOnChange: false },
    states: {
        dirty: 'dirty',
        pristine: 'pristine',
        touched: 'touched',
    },
    tags: {
        error: 'ValidationError',
        formState: 'FormState',
        success: 'ValidationSuccess',
    },
} as const);

// --- [SCHEMA] ----------------------------------------------------------------

const FieldNameSchema = pipe(S.String, S.nonEmptyString(), S.brand('FieldName'));

const FieldStateSchema = S.Union(S.Literal('pristine'), S.Literal('touched'), S.Literal('dirty'));

const ValidationErrorSchema = S.Struct({
    _tag: S.Literal('ValidationError'),
    field: FieldNameSchema,
    message: S.String,
    rule: S.String,
});

const ValidationSuccessSchema = S.Struct({
    _tag: S.Literal('ValidationSuccess'),
    field: FieldNameSchema,
});

const ValidationResultSchema = S.Union(ValidationErrorSchema, ValidationSuccessSchema);

const FormFieldSchema = <A extends S.Schema.Any>(valueSchema: A) =>
    S.Struct({
        errors: S.Array(ValidationErrorSchema),
        initialValue: valueSchema,
        name: FieldNameSchema,
        state: FieldStateSchema,
        value: valueSchema,
    });

const schemas = Object.freeze({
    fieldName: FieldNameSchema,
    fieldState: FieldStateSchema,
    formField: FormFieldSchema,
    validationError: ValidationErrorSchema,
    validationResult: ValidationResultSchema,
    validationSuccess: ValidationSuccessSchema,
} as const);

// --- [PURE_FUNCTIONS] ------------------------------------------------------

const mkFieldName = (name: string): FieldName => name as FieldName;

const mkField = <V>(name: string, initialValue: V): FormField<V> => ({
    errors: [],
    initialValue,
    name: mkFieldName(name),
    state: B.states.pristine,
    value: initialValue,
});

const mkError = (field: FieldName, rule: string, message: string): ValidationError => ({
    _tag: B.tags.error,
    field,
    message,
    rule,
});

const mkSuccess = (field: FieldName): ValidationSuccess => ({
    _tag: B.tags.success,
    field,
});

const updateField = <T extends Record<string, unknown>, K extends keyof T>(
    state: FormState<T>,
    name: K,
    updater: (field: FormField<T[K]>) => FormField<T[K]>,
): FormState<T> => ({
    ...state,
    fields: { ...state.fields, [name]: updater(state.fields[name]) },
});

const computeIsValid = <T extends Record<string, unknown>>(fields: FormState<T>['fields']): boolean =>
    Object.values(fields).every((f) => (f as FormField<unknown>).errors.length === 0);

// --- [DISPATCH_TABLES] -------------------------------------------------------

const foldHandlers = <R>(result: ValidationResult, h: FoldHandlers<R>): R =>
    match(result)
        .with({ _tag: B.tags.success }, (r) => h.onSuccess(r.field))
        .with({ _tag: B.tags.error }, (r) => h.onError(r))
        .exhaustive();

const validateHandlers = <V>(field: FormField<V>, schema: S.Schema<V>): Effect.Effect<ValidationResult, never, never> =>
    pipe(
        S.decode(schema)(field.value),
        Effect.map(() => mkSuccess(field.name)),
        Effect.catchAll((error: ParseError) => Effect.succeed(mkError(field.name, 'schema', error.message))),
    );

// --- [ENTRY_POINT] -----------------------------------------------------------

const createForm = <T extends Record<string, unknown>>(
    config: FormConfig = {},
): Effect.Effect<FormApi<T>, never, never> =>
    pipe(
        Effect.sync(() => ({
            validateOnBlur: config.validateOnBlur ?? B.defaults.validateOnBlur,
            validateOnChange: config.validateOnChange ?? B.defaults.validateOnChange,
        })),
        Effect.map((_cfg) =>
            Object.freeze({
                createField: <V>(name: string, initialValue: V) => mkField(name, initialValue),
                error: mkError,
                fold: <R>(result: ValidationResult, handlers: FoldHandlers<R>) => foldHandlers(result, handlers),
                getFieldErrors: (state: FormState<T>, name: keyof T) => state.fields[name].errors,
                isError: (result: ValidationResult): result is ValidationError => result._tag === B.tags.error,
                isFormValid: (state: FormState<T>) => computeIsValid(state.fields),
                isSuccess: (result: ValidationResult): result is ValidationSuccess => result._tag === B.tags.success,
                match,
                Option,
                P,
                schemas,
                setFieldValue: <K extends keyof T>(state: FormState<T>, name: K, value: T[K]) =>
                    updateField(state, name, (f) => ({ ...f, state: B.states.dirty, value })),
                success: mkSuccess,
                tags: B.tags,
                touchField: <K extends keyof T>(state: FormState<T>, name: K) =>
                    updateField(state, name, (f) => ({
                        ...f,
                        state: f.state === B.states.pristine ? B.states.touched : f.state,
                    })),
                validateField: <V>(field: FormField<V>, schema: S.Schema<V>) => validateHandlers(field, schema),
            } as FormApi<T>),
        ),
    );

// --- [EXPORT] ----------------------------------------------------------------

export { B as FORM_TUNING, createForm };
export type {
    FieldName,
    FieldState,
    FoldHandlers,
    FormApi,
    FormConfig,
    FormField,
    FormState,
    ValidationError,
    ValidationResult,
    ValidationSuccess,
};
