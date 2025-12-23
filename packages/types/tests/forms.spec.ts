/**
 * Validate form state and validation via property-based testing.
 */
import { it } from '@fast-check/vitest';
import { Effect, Schema as S } from 'effect';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import {
    createForms,
    Field,
    type FieldName,
    FORM_TUNING,
    Form,
    type FormField,
    fold,
    Validation,
    validateField,
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
            expect(api.Field).toBeDefined();
            expect(api.Form).toBeDefined();
            expect(api.Validation).toBeDefined();
            expect(api.validateField).toBeDefined();
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
            const field = Field.create(name as FieldName, value);
            expect(field.name).toBe(name);
            expect(field.value).toBe(value);
            expect(field.initialValue).toBe(value);
            expect(field.state).toBe('pristine');
            expect(field.errors).toEqual([]);
        });
    });

    describe('validation result creation', () => {
        it.prop([arbitraryFieldName])('creates success result', (name) => {
            const result = Validation.success(name as FieldName);
            expect(result._tag).toBe('ValidationSuccess');
            expect(result.field).toBe(name);
        });

        it.prop([arbitraryFieldName, fc.string(), fc.string()])('creates error result', (name, rule, message) => {
            const result = Validation.error(name as FieldName, rule, message);
            expect(result._tag).toBe('ValidationError');
            expect(result.field).toBe(name);
            expect(result.rule).toBe(rule);
            expect(result.message).toBe(message);
        });
    });

    describe('fold', () => {
        it.prop([arbitraryFieldName])('folds success to value', (name) => {
            const result = Validation.success(name as FieldName);
            const folded = fold(result, {
                ValidationError: () => 'error',
                ValidationSuccess: (field) => `success:${field}`,
            });
            expect(folded).toBe(`success:${name}`);
        });

        it.prop([arbitraryFieldName, fc.string(), fc.string()])('folds error to value', (name, rule, message) => {
            const result = Validation.error(name as FieldName, rule, message);
            const folded = fold(result, {
                ValidationError: (err) => `error:${err.rule}`,
                ValidationSuccess: () => 'success',
            });
            expect(folded).toBe(`error:${rule}`);
        });
    });

    describe('field state transitions', () => {
        it('Field.touch transitions pristine to touched', () => {
            const field = Field.create('test' as FieldName, 'value');
            const touched = Field.touch(field);
            expect(touched.state).toBe('touched');
        });

        it('Field.touch preserves touched state', () => {
            const field = { ...Field.create('test' as FieldName, 'value'), state: 'touched' as const };
            const touched = Field.touch(field);
            expect(touched.state).toBe('touched');
        });

        it('Field.touch preserves dirty state', () => {
            const field = { ...Field.create('test' as FieldName, 'value'), state: 'dirty' as const };
            const touched = Field.touch(field);
            expect(touched.state).toBe('dirty');
        });

        it.prop([fc.string()])('Field.setValue transitions to dirty', (newValue) => {
            const field = Field.create('test' as FieldName, 'initial');
            const updated = Field.setValue(field, newValue);
            expect(updated.value).toBe(newValue);
            expect(updated.state).toBe('dirty');
        });
    });

    describe('field error management', () => {
        it('Field.setErrors sets errors on field', () => {
            const field = Field.create('test' as FieldName, 'value');
            const err = Validation.error('test' as FieldName, 'required', 'Field required');
            const withErrors = Field.setErrors(field, [err]);
            expect(withErrors.errors).toHaveLength(1);
            expect(withErrors.errors[0]?.message).toBe('Field required');
        });

        it('Field.check detects field with errors', () => {
            const err = Validation.error('test' as FieldName, 'required', 'Required');
            const fieldWithErrors = { ...Field.create('test' as FieldName, ''), errors: [err] };
            expect(Field.check(fieldWithErrors).hasErrors).toBe(true);
        });

        it('Field.check returns false for clean field', () => {
            const field = Field.create('test' as FieldName, 'value');
            expect(Field.check(field).hasErrors).toBe(false);
        });
    });

    describe('field reset', () => {
        it('Field.reset restores initial value and pristine state', () => {
            const field = Field.create('test' as FieldName, 'initial');
            const modified = Field.setValue(field, 'changed');
            const err = Validation.error('test' as FieldName, 'rule', 'msg');
            const withErrors = Field.setErrors(modified, [err]);
            const reset = Field.reset(withErrors);
            expect(reset.value).toBe('initial');
            expect(reset.state).toBe('pristine');
            expect(reset.errors).toEqual([]);
        });
    });

    describe('form state', () => {
        it('Form.create creates form with fields', () => {
            const nameField = Field.create('name' as FieldName, 'John');
            const emailField = Field.create('email' as FieldName, 'john@example.com');
            const form = Form.create({ email: emailField, name: nameField });
            expect(form.fields.name.value).toBe('John');
            expect(form.fields.email.value).toBe('john@example.com');
            expect(form.isSubmitting).toBe(false);
            expect(form.submitCount).toBe(0);
        });

        it('Form.check returns isValid true when no field has errors', () => {
            const nameField = Field.create('name' as FieldName, 'John');
            const form = Form.create({ name: nameField });
            expect(Form.check(form).isValid).toBe(true);
        });

        it('Form.check returns isValid false when any field has errors', () => {
            const err = Validation.error('name' as FieldName, 'required', 'Required');
            const nameField = { ...Field.create('name' as FieldName, ''), errors: [err] };
            const form = Form.create({ name: nameField as FormField });
            expect(Form.check(form).isValid).toBe(false);
        });

        it('Form.updateField updates specific field in form', () => {
            const nameField = Field.create('name' as FieldName, 'John');
            const form = Form.create({ name: nameField });
            const updated = Form.updateField(form, 'name', (f) => Field.setValue(f, 'Jane'));
            expect(updated.fields.name.value).toBe('Jane');
        });

        it('Form.setSubmitting increments submit count', () => {
            const form = Form.create({ name: Field.create('name' as FieldName, 'John') });
            const submitting = Form.setSubmitting(form, true);
            expect(submitting.isSubmitting).toBe(true);
            expect(submitting.submitCount).toBe(1);
        });

        it('Form.reset resets all fields', () => {
            const nameField = Field.setValue(Field.create('name' as FieldName, 'John'), 'Jane');
            const form = { ...Form.create({ name: nameField }), submitCount: 5 };
            const reset = Form.reset(form);
            expect(reset.fields.name.value).toBe('John');
            expect(reset.fields.name.state).toBe('pristine');
            expect(reset.submitCount).toBe(0);
        });
    });

    describe('field validation', () => {
        it('validateField succeeds for valid value', () => {
            const field = Field.create('email' as FieldName, 'test@example.com');
            const schema = S.String;
            const result = Effect.runSync(validateField(field, schema));
            expect(result._tag).toBe('ValidationSuccess');
        });

        it('validateField fails for invalid value', () => {
            const field = Field.create('email' as FieldName, '');
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
