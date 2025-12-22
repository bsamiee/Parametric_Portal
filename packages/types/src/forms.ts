/**
 * Form state management and validation.
 * Grounding: Immutable field state with Effect-based validation.
 */
import { Effect, Match, pipe, Schema as S } from 'effect';
import type { ParseError } from 'effect/ParseResult';

// --- [TYPES] -----------------------------------------------------------------

type FieldName = S.Schema.Type<typeof S.NonEmptyTrimmedString>;
type FieldState = 'pristine' | 'touched' | 'dirty';
type FormConfig = { readonly validateOnBlur?: boolean; readonly validateOnChange?: boolean };
type FormField<T = unknown> = {
    readonly errors: ReadonlyArray<ValidationError>;
    readonly initialValue: T;
    readonly name: FieldName;
    readonly state: FieldState;
    readonly value: T;
};
type FormState = {
    readonly fields: Readonly<Record<string, FormField>>;
    readonly isSubmitting: boolean;
    readonly submitCount: number;
};
type ValidationResult = ValidationSuccess | ValidationError;
type ValidationSuccess = { readonly _tag: 'ValidationSuccess'; readonly field: FieldName };
type ValidationError = {
    readonly _tag: 'ValidationError';
    readonly field: FieldName;
    readonly message: string;
    readonly rule: string;
};
type ValidationFold<R> = {
    readonly ValidationError: (error: ValidationError) => R;
    readonly ValidationSuccess: (field: FieldName) => R;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: { validateOnBlur: true, validateOnChange: false },
    states: { dirty: 'dirty', pristine: 'pristine', touched: 'touched' },
    tags: { error: 'ValidationError', success: 'ValidationSuccess' },
} as const);

// --- [SCHEMA] ----------------------------------------------------------------

const FieldStateSchema = S.Literal(B.states.pristine, B.states.touched, B.states.dirty);
const ValidationSuccessSchema = S.Struct({ _tag: S.Literal(B.tags.success), field: S.NonEmptyTrimmedString });
const ValidationErrorSchema = S.Struct({
    _tag: S.Literal(B.tags.error),
    field: S.NonEmptyTrimmedString,
    message: S.String,
    rule: S.String,
});
const ValidationResultSchema = S.Union(ValidationSuccessSchema, ValidationErrorSchema);
const FormFieldSchema = S.Struct({
    errors: S.Array(ValidationErrorSchema),
    initialValue: S.Unknown,
    name: S.NonEmptyTrimmedString,
    state: FieldStateSchema,
    value: S.Unknown,
});
const FormStateSchema = S.Struct({
    fields: S.Record({ key: S.String, value: FormFieldSchema }),
    isSubmitting: S.Boolean,
    submitCount: pipe(S.Number, S.int(), S.nonNegative()),
});

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const validationSuccess = (field: FieldName): ValidationSuccess => ({ _tag: B.tags.success, field });
const validationError = (field: FieldName, rule: string, message: string): ValidationError => ({
    _tag: B.tags.error,
    field,
    message,
    rule,
});
const createField = <T>(name: FieldName, initialValue: T): FormField<T> => ({
    errors: [],
    initialValue,
    name,
    state: B.states.pristine,
    value: initialValue,
});
const createFormState = (fields: Record<string, FormField>): FormState => ({
    fields,
    isSubmitting: false,
    submitCount: 0,
});
const touchTransitions = {
    [B.states.dirty]: B.states.dirty,
    [B.states.pristine]: B.states.touched,
    [B.states.touched]: B.states.touched,
} as const satisfies Record<FieldState, FieldState>;
const touchField = <T>(field: FormField<T>): FormField<T> => ({
    ...field,
    state: touchTransitions[field.state],
});
const setFieldValue = <T>(field: FormField<T>, value: T): FormField<T> => ({
    ...field,
    state: B.states.dirty,
    value,
});
const setFieldErrors = <T>(field: FormField<T>, errors: ReadonlyArray<ValidationError>): FormField<T> => ({
    ...field,
    errors,
});
const resetField = <T>(field: FormField<T>): FormField<T> => ({
    ...field,
    errors: [],
    state: B.states.pristine,
    value: field.initialValue,
});
const hasFieldErrors = <T>(field: FormField<T>): boolean => field.errors.length > 0;
const isFormValid = (form: FormState): boolean => Object.values(form.fields).every((f) => f.errors.length === 0);
const getField = <T>(form: FormState, name: string): FormField<T> => form.fields[name] as FormField<T>;
const updateField = <T>(form: FormState, name: string, updater: (f: FormField<T>) => FormField<T>): FormState => ({
    ...form,
    fields: { ...form.fields, [name]: updater(getField(form, name)) },
});
const setSubmitting = (form: FormState, isSubmitting: boolean): FormState => ({
    ...form,
    isSubmitting,
    submitCount: isSubmitting ? form.submitCount + 1 : form.submitCount,
});
const resetForm = (form: FormState): FormState => ({
    fields: Object.fromEntries(Object.entries(form.fields).map(([k, v]) => [k, resetField(v)])),
    isSubmitting: false,
    submitCount: 0,
});

// --- [DISPATCH_TABLES] -------------------------------------------------------

const fold = <R>(result: ValidationResult, handlers: ValidationFold<R>): R =>
    Match.value(result).pipe(
        Match.tag(B.tags.success, (r) => handlers.ValidationSuccess(r.field)),
        Match.tag(B.tags.error, (r) => handlers.ValidationError(r)),
        Match.exhaustive,
    ) as R;

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const validateField = <T>(field: FormField<T>, schema: S.Schema<T>): Effect.Effect<ValidationResult, never, never> =>
    pipe(
        S.decode(schema)(field.value),
        Effect.map(() => validationSuccess(field.name)),
        Effect.catchAll((error: ParseError) => Effect.succeed(validationError(field.name, 'schema', error.message))),
    );

// --- [ENTRY_POINT] -----------------------------------------------------------

const createForms = (config: FormConfig = B.defaults) =>
    Object.freeze({
        config,
        createField,
        createFormState,
        fold,
        getField,
        hasFieldErrors,
        isFormValid,
        resetField,
        resetForm,
        schema: {
            field: FormFieldSchema,
            fieldState: FieldStateSchema,
            result: ValidationResultSchema,
            state: FormStateSchema,
        },
        setFieldErrors,
        setFieldValue,
        setSubmitting,
        touchField,
        updateField,
        validateField,
        validationError,
        validationSuccess,
    });

// --- [EXPORT] ----------------------------------------------------------------

export {
    B as FORM_TUNING,
    createField,
    createForms,
    createFormState,
    FieldStateSchema,
    fold,
    FormFieldSchema,
    FormStateSchema,
    getField,
    hasFieldErrors,
    isFormValid,
    resetField,
    resetForm,
    setFieldErrors,
    setFieldValue,
    setSubmitting,
    touchField,
    updateField,
    validateField,
    validationError,
    ValidationErrorSchema,
    ValidationResultSchema,
    validationSuccess,
    ValidationSuccessSchema,
};
export type {
    FieldName,
    FieldState,
    FormConfig,
    FormField,
    FormState,
    ValidationError,
    ValidationFold,
    ValidationResult,
    ValidationSuccess,
};
