/**
 * Define form state management and validation with immutable field state.
 * Effect-based validation with Match dispatch for validation results.
 */
import { Effect, Match, pipe, Schema as S } from 'effect';
import type { ParseError } from 'effect/ParseResult';

// --- [TYPES] -----------------------------------------------------------------

type FieldName = S.Schema.Type<typeof FieldNameSchema>;
type FieldState = S.Schema.Type<typeof FieldStateSchema>;
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
type AsyncValidationState =
    | { readonly _tag: 'Idle' }
    | { readonly _tag: 'Validating'; readonly startedAt: number }
    | { readonly _tag: 'Valid'; readonly timestamp: number }
    | { readonly _tag: 'Invalid'; readonly errors: ReadonlyArray<ValidationError>; readonly timestamp: number };
type ValidationRule<T, E = unknown> = {
    readonly tag: 'schema' | 'async' | 'custom' | 'crossField';
    readonly validate: (value: T) => Effect.Effect<void, E, never>;
    readonly message: (error: E) => string;
};
type CrossFieldValidator = {
    readonly dependsOn: ReadonlyArray<FieldName>;
    readonly validate: (
        formValues: Readonly<Record<string, unknown>>,
    ) => Effect.Effect<ReadonlyArray<ValidationError>, never, never>;
};
type FieldArray<T> = FormField<ReadonlyArray<T>> & {
    readonly items: ReadonlyArray<FormField<T>>;
    readonly itemErrors: Readonly<Record<number, ReadonlyArray<ValidationError>>>;
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
    asyncTags: { idle: 'Idle', invalid: 'Invalid', valid: 'Valid', validating: 'Validating' } as const,
    defaults: { validateOnBlur: true, validateOnChange: false },
    states: { dirty: 'dirty', pristine: 'pristine', touched: 'touched' },
    tags: { error: 'ValidationError', success: 'ValidationSuccess' },
} as const);

// --- [SCHEMA] ----------------------------------------------------------------

const FieldNameSchema = pipe(S.NonEmptyTrimmedString, S.brand('FieldName'));
const FieldStateSchema = S.Literal(B.states.pristine, B.states.touched, B.states.dirty);
const ValidationSuccessSchema = S.Struct({ _tag: S.Literal(B.tags.success), field: FieldNameSchema });
const ValidationErrorSchema = S.Struct({
    _tag: S.Literal(B.tags.error),
    field: FieldNameSchema,
    message: S.String,
    rule: S.String,
});
const ValidationResultSchema = S.Union(ValidationSuccessSchema, ValidationErrorSchema);
const FormFieldSchema = S.Struct({
    errors: S.Array(ValidationErrorSchema),
    initialValue: S.Unknown,
    name: FieldNameSchema,
    state: FieldStateSchema,
    value: S.Unknown,
});
const FormStateSchema = S.Struct({
    fields: S.Record({ key: S.String, value: FormFieldSchema }),
    isSubmitting: S.Boolean,
    submitCount: pipe(S.Number, S.int(), S.nonNegative()),
});

// --- [DISPATCH_TABLES] -------------------------------------------------------

const touchTransitions = {
    [B.states.dirty]: B.states.dirty,
    [B.states.pristine]: B.states.touched,
    [B.states.touched]: B.states.touched,
} as const satisfies Record<FieldState, FieldState>;
const Field = Object.freeze({
    check: <T>(field: FormField<T>) => ({
        errorCount: field.errors.length,
        hasErrors: field.errors.length > 0,
        isDirty: field.state === B.states.dirty,
        isPristine: field.state === B.states.pristine,
        isTouched: field.state === B.states.touched,
    }),
    create: <T>(name: FieldName, initialValue: T): FormField<T> => ({
        errors: [],
        initialValue,
        name,
        state: B.states.pristine,
        value: initialValue,
    }),
    reset: <T>(field: FormField<T>): FormField<T> => ({
        ...field,
        errors: [],
        state: B.states.pristine,
        value: field.initialValue,
    }),
    setErrors: <T>(field: FormField<T>, errors: ReadonlyArray<ValidationError>): FormField<T> => ({
        ...field,
        errors,
    }),
    setValue: <T>(field: FormField<T>, value: T): FormField<T> => ({
        ...field,
        state: B.states.dirty,
        value,
    }),
    touch: <T>(field: FormField<T>): FormField<T> => ({
        ...field,
        state: touchTransitions[field.state],
    }),
});
const Form = Object.freeze({
    check: (form: FormState) => {
        const fields = Object.values(form.fields);
        const dirtyFields = fields.filter((f) => f.state === B.states.dirty);
        const errorFields = fields.filter((f) => f.errors.length > 0);
        return {
            dirtyCount: dirtyFields.length,
            errorCount: errorFields.reduce((sum, f) => sum + f.errors.length, 0),
            fieldCount: fields.length,
            isSubmitting: form.isSubmitting,
            isValid: errorFields.length === 0,
            submitCount: form.submitCount,
        };
    },
    create: (fields: Record<string, FormField>): FormState => ({
        fields,
        isSubmitting: false,
        submitCount: 0,
    }),
    getField: <T>(form: FormState, name: string): FormField<T> => form.fields[name] as FormField<T>,
    reset: (form: FormState): FormState => ({
        fields: Object.fromEntries(Object.entries(form.fields).map(([k, v]) => [k, Field.reset(v)])),
        isSubmitting: false,
        submitCount: 0,
    }),
    setSubmitting: (form: FormState, isSubmitting: boolean): FormState => ({
        ...form,
        isSubmitting,
        submitCount: isSubmitting ? form.submitCount + 1 : form.submitCount,
    }),
    updateField: <T>(form: FormState, name: string, updater: (f: FormField<T>) => FormField<T>): FormState => ({
        ...form,
        fields: { ...form.fields, [name]: updater(Form.getField(form, name)) },
    }),
});
const Validation = Object.freeze({
    error: (field: FieldName, rule: string, message: string): ValidationError => ({
        _tag: B.tags.error,
        field,
        message,
        rule,
    }),
    success: (field: FieldName): ValidationSuccess => ({ _tag: B.tags.success, field }),
});
const AsyncValidation = Object.freeze({
    idle: (): AsyncValidationState => ({ _tag: B.asyncTags.idle }),
    invalid: (errors: ReadonlyArray<ValidationError>, timestamp: number = Date.now()): AsyncValidationState => ({
        _tag: B.asyncTags.invalid,
        errors,
        timestamp,
    }),
    isIdle: (state: AsyncValidationState): state is Extract<AsyncValidationState, { _tag: 'Idle' }> =>
        state._tag === B.asyncTags.idle,
    isInvalid: (state: AsyncValidationState): state is Extract<AsyncValidationState, { _tag: 'Invalid' }> =>
        state._tag === B.asyncTags.invalid,
    isValid: (state: AsyncValidationState): state is Extract<AsyncValidationState, { _tag: 'Valid' }> =>
        state._tag === B.asyncTags.valid,
    isValidating: (state: AsyncValidationState): state is Extract<AsyncValidationState, { _tag: 'Validating' }> =>
        state._tag === B.asyncTags.validating,
    valid: (timestamp: number = Date.now()): AsyncValidationState => ({ _tag: B.asyncTags.valid, timestamp }),
    validating: (startedAt: number = Date.now()): AsyncValidationState => ({ _tag: B.asyncTags.validating, startedAt }),
});
const FieldArray = Object.freeze({
    create: <T>(name: FieldName, items: ReadonlyArray<FormField<T>>): FieldArray<T> => ({
        errors: [],
        initialValue: items.map((i) => i.value),
        itemErrors: {},
        items,
        name,
        state: B.states.pristine,
        value: items.map((i) => i.value),
    }),
    push: <T>(array: FieldArray<T>, item: FormField<T>): FieldArray<T> => ({
        ...array,
        items: [...array.items, item],
        state: B.states.dirty,
        value: [...array.value, item.value],
    }),
    remove: <T>(array: FieldArray<T>, index: number): FieldArray<T> => ({
        ...array,
        itemErrors: Object.fromEntries(
            Object.entries(array.itemErrors)
                .filter(([k]) => Number(k) !== index)
                .map(([k, v]) => [Number(k) > index ? Number(k) - 1 : Number(k), v]),
        ),
        items: array.items.filter((_, i) => i !== index),
        state: B.states.dirty,
        value: array.value.filter((_, i) => i !== index),
    }),
    setItemErrors: <T>(array: FieldArray<T>, index: number, errors: ReadonlyArray<ValidationError>): FieldArray<T> => ({
        ...array,
        itemErrors: { ...array.itemErrors, [index]: errors },
    }),
    updateItem: <T>(array: FieldArray<T>, index: number, updater: (f: FormField<T>) => FormField<T>): FieldArray<T> => {
        const item = array.items[index];
        const updated = item ? updater(item) : undefined;
        return updated
            ? {
                  ...array,
                  items: array.items.map((it, i) => (i === index ? updated : it)),
                  state: B.states.dirty,
                  value: array.value.map((v, i) => (i === index ? updated.value : v)),
              }
            : array;
    },
});
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
        Effect.map(() => Validation.success(field.name)),
        Effect.catchAll((error: ParseError) => Effect.succeed(Validation.error(field.name, 'schema', error.message))),
    );
const validateFieldWithRules = <T>(
    field: FormField<T>,
    rules: ReadonlyArray<ValidationRule<T, unknown>>,
): Effect.Effect<ReadonlyArray<ValidationError>, never, never> =>
    Effect.all(
        rules.map((rule) =>
            rule.validate(field.value).pipe(
                Effect.map(() => undefined),
                Effect.catchAll((e) => Effect.succeed(Validation.error(field.name, rule.tag, rule.message(e)))),
            ),
        ),
    ).pipe(Effect.map((results) => results.filter((r): r is ValidationError => r !== undefined)));
const validateCrossFields = (
    form: FormState,
    validators: ReadonlyArray<CrossFieldValidator>,
): Effect.Effect<ReadonlyArray<ValidationError>, never, never> => {
    const formValues = Object.fromEntries(Object.entries(form.fields).map(([k, v]) => [k, v.value]));
    return Effect.all(validators.map((v) => v.validate(formValues))).pipe(Effect.map((results) => results.flat()));
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const forms = (config: FormConfig = B.defaults) =>
    Object.freeze({
        AsyncValidation,
        config,
        Field,
        FieldArray,
        Form,
        fold,
        schemas: Object.freeze({
            Field: FormFieldSchema,
            FieldName: FieldNameSchema,
            FieldState: FieldStateSchema,
            FormState: FormStateSchema,
            ValidationError: ValidationErrorSchema,
            ValidationResult: ValidationResultSchema,
            ValidationSuccess: ValidationSuccessSchema,
        }),
        Validation,
        validateCrossFields,
        validateField,
        validateFieldWithRules,
    });
type FormsApi = ReturnType<typeof forms>;

// --- [EXPORT] ----------------------------------------------------------------

export { B as FORM_TUNING, forms };
export type {
    AsyncValidationState,
    CrossFieldValidator,
    FieldArray,
    FieldName,
    FieldState,
    FormConfig,
    FormField,
    FormsApi,
    FormState,
    ValidationError,
    ValidationFold,
    ValidationResult,
    ValidationRule,
    ValidationSuccess,
};
