/**
 * Validate form state and validation via property-based testing.
 */
import { it } from '@fast-check/vitest';
import { Effect, Schema as S } from 'effect';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import {
    createField,
    createFormState,
    createForms,
    type FieldName,
    FORM_TUNING,
    type FormField,
    fold,
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
    validationSuccess,
} from '../src/forms.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const loadApi = () => createForms();
const arbitraryFieldName = fc.string({ maxLength: 20, minLength: 1 }).filter((s) => s.trim().length > 0);
const arbitraryFieldValue = fc.oneof(fc.string(), fc.integer());

// --- [TESTS] -----------------------------------------------------------------

describe('forms package', () => {
    describe('api surface', () => {
        it('returns frozen api object', () => {
            const api = loadApi();
            expect(Object.isFrozen(api)).toBe(true);
            expect(api.createField).toBeDefined();
            expect(api.createFormState).toBeDefined();
            expect(api.validateField).toBeDefined();
            expect(api.setFieldValue).toBeDefined();
            expect(api.touchField).toBeDefined();
            expect(api.fold).toBeDefined();
        });

        it('exposes tuning constants', () => {
            expect(Object.isFrozen(FORM_TUNING)).toBe(true);
            expect(FORM_TUNING.defaults.validateOnBlur).toBe(true);
            expect(FORM_TUNING.defaults.validateOnChange).toBe(false);
            expect(FORM_TUNING.tags.error).toBe('ValidationError');
            expect(FORM_TUNING.tags.success).toBe('ValidationSuccess');
        });
    });

    describe('field creation', () => {
        it.prop([arbitraryFieldName, arbitraryFieldValue])('creates pristine field', (name, value) => {
            const field = createField(name as FieldName, value);
            expect(field.name).toBe(name);
            expect(field.value).toBe(value);
            expect(field.initialValue).toBe(value);
            expect(field.state).toBe('pristine');
            expect(field.errors).toEqual([]);
        });
    });

    describe('validation result creation', () => {
        it.prop([arbitraryFieldName])('creates success result', (name) => {
            const result = validationSuccess(name as FieldName);
            expect(result._tag).toBe('ValidationSuccess');
            expect(result.field).toBe(name);
        });

        it.prop([arbitraryFieldName, fc.string(), fc.string()])('creates error result', (name, rule, message) => {
            const result = validationError(name as FieldName, rule, message);
            expect(result._tag).toBe('ValidationError');
            expect(result.field).toBe(name);
            expect(result.rule).toBe(rule);
            expect(result.message).toBe(message);
        });
    });

    describe('fold', () => {
        it.prop([arbitraryFieldName])('folds success to value', (name) => {
            const result = validationSuccess(name as FieldName);
            const folded = fold(result, {
                ValidationError: () => 'error',
                ValidationSuccess: (field) => `success:${field}`,
            });
            expect(folded).toBe(`success:${name}`);
        });

        it.prop([arbitraryFieldName, fc.string(), fc.string()])('folds error to value', (name, rule, message) => {
            const result = validationError(name as FieldName, rule, message);
            const folded = fold(result, {
                ValidationError: (err) => `error:${err.rule}`,
                ValidationSuccess: () => 'success',
            });
            expect(folded).toBe(`error:${rule}`);
        });
    });

    describe('field state transitions', () => {
        it('touchField transitions pristine to touched', () => {
            const field = createField('test' as FieldName, 'value');
            const touched = touchField(field);
            expect(touched.state).toBe('touched');
        });

        it('touchField preserves touched state', () => {
            const field = { ...createField('test' as FieldName, 'value'), state: 'touched' as const };
            const touched = touchField(field);
            expect(touched.state).toBe('touched');
        });

        it('touchField preserves dirty state', () => {
            const field = { ...createField('test' as FieldName, 'value'), state: 'dirty' as const };
            const touched = touchField(field);
            expect(touched.state).toBe('dirty');
        });

        it.prop([fc.string()])('setFieldValue transitions to dirty', (newValue) => {
            const field = createField('test' as FieldName, 'initial');
            const updated = setFieldValue(field, newValue);
            expect(updated.value).toBe(newValue);
            expect(updated.state).toBe('dirty');
        });
    });

    describe('field error management', () => {
        it('setFieldErrors sets errors on field', () => {
            const field = createField('test' as FieldName, 'value');
            const err = validationError('test' as FieldName, 'required', 'Field required');
            const withErrors = setFieldErrors(field, [err]);
            expect(withErrors.errors).toHaveLength(1);
            expect(withErrors.errors[0]?.message).toBe('Field required');
        });

        it('hasFieldErrors detects field with errors', () => {
            const err = validationError('test' as FieldName, 'required', 'Required');
            const fieldWithErrors = { ...createField('test' as FieldName, ''), errors: [err] };
            expect(hasFieldErrors(fieldWithErrors)).toBe(true);
        });

        it('hasFieldErrors returns false for clean field', () => {
            const field = createField('test' as FieldName, 'value');
            expect(hasFieldErrors(field)).toBe(false);
        });
    });

    describe('field reset', () => {
        it('resetField restores initial value and pristine state', () => {
            const field = createField('test' as FieldName, 'initial');
            const modified = setFieldValue(field, 'changed');
            const err = validationError('test' as FieldName, 'rule', 'msg');
            const withErrors = setFieldErrors(modified, [err]);
            const reset = resetField(withErrors);
            expect(reset.value).toBe('initial');
            expect(reset.state).toBe('pristine');
            expect(reset.errors).toEqual([]);
        });
    });

    describe('form state', () => {
        it('createFormState creates form with fields', () => {
            const nameField = createField('name' as FieldName, 'John');
            const emailField = createField('email' as FieldName, 'john@example.com');
            const form = createFormState({ email: emailField, name: nameField });
            expect(form.fields.name.value).toBe('John');
            expect(form.fields.email.value).toBe('john@example.com');
            expect(form.isSubmitting).toBe(false);
            expect(form.submitCount).toBe(0);
        });

        it('isFormValid returns true when no field has errors', () => {
            const nameField = createField('name' as FieldName, 'John');
            const form = createFormState({ name: nameField });
            expect(isFormValid(form)).toBe(true);
        });

        it('isFormValid returns false when any field has errors', () => {
            const err = validationError('name' as FieldName, 'required', 'Required');
            const nameField = { ...createField('name' as FieldName, ''), errors: [err] };
            const form = createFormState({ name: nameField as FormField });
            expect(isFormValid(form)).toBe(false);
        });

        it('updateField updates specific field in form', () => {
            const nameField = createField('name' as FieldName, 'John');
            const form = createFormState({ name: nameField });
            const updated = updateField(form, 'name', (f) => setFieldValue(f, 'Jane'));
            expect(updated.fields.name.value).toBe('Jane');
        });

        it('setSubmitting increments submit count', () => {
            const form = createFormState({ name: createField('name' as FieldName, 'John') });
            const submitting = setSubmitting(form, true);
            expect(submitting.isSubmitting).toBe(true);
            expect(submitting.submitCount).toBe(1);
        });

        it('resetForm resets all fields', () => {
            const nameField = setFieldValue(createField('name' as FieldName, 'John'), 'Jane');
            const form = { ...createFormState({ name: nameField }), submitCount: 5 };
            const reset = resetForm(form);
            expect(reset.fields.name.value).toBe('John');
            expect(reset.fields.name.state).toBe('pristine');
            expect(reset.submitCount).toBe(0);
        });
    });

    describe('field validation', () => {
        it('validateField succeeds for valid value', () => {
            const field = createField('email' as FieldName, 'test@example.com');
            const schema = S.String;
            const result = Effect.runSync(validateField(field, schema));
            expect(result._tag).toBe('ValidationSuccess');
        });

        it('validateField fails for invalid value', () => {
            const field = createField('email' as FieldName, '');
            const schema = S.NonEmptyString;
            const result = Effect.runSync(validateField(field, schema));
            expect(result._tag).toBe('ValidationError');
        });
    });

    describe('schema', () => {
        it('exposes schemas via factory', () => {
            const api = loadApi();
            expect(api.schema.field).toBeDefined();
            expect(api.schema.fieldState).toBeDefined();
            expect(api.schema.result).toBeDefined();
            expect(api.schema.state).toBeDefined();
        });
    });
});
