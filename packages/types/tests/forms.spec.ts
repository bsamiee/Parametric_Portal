/**
 * Validate form state and validation via property-based testing.
 */
import { it } from '@fast-check/vitest';
import { Effect, Schema as S } from 'effect';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import { createForm, FORM_TUNING } from '../src/forms.ts';

// --- [TYPES] -----------------------------------------------------------------

type TestFormData = {
    readonly email: string;
    readonly name: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const loadApi = () => Effect.runSync(createForm<TestFormData>());

const arbitraryFieldName = fc.string({ maxLength: 20, minLength: 1 });
const arbitraryFieldValue = fc.oneof(fc.string(), fc.integer(), fc.boolean());

// --- [TESTS] -----------------------------------------------------------------

describe('forms package', () => {
    describe('api surface', () => {
        it('returns frozen api object', () => {
            const api = loadApi();
            expect(Object.isFrozen(api)).toBe(true);
            expect(api.createField).toBeDefined();
            expect(api.validateField).toBeDefined();
            expect(api.setFieldValue).toBeDefined();
            expect(api.touchField).toBeDefined();
            expect(api.error).toBeDefined();
            expect(api.success).toBeDefined();
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
            const api = loadApi();
            const field = api.createField(name, value);
            expect(field.name).toBe(name);
            expect(field.value).toBe(value);
            expect(field.initialValue).toBe(value);
            expect(field.state).toBe('pristine');
            expect(field.errors).toEqual([]);
        });
    });

    describe('validation result creation', () => {
        it.prop([arbitraryFieldName])('creates success result', (name) => {
            const api = loadApi();
            const result = api.success(name as never);
            expect(result._tag).toBe(FORM_TUNING.tags.success);
            expect(result.field).toBe(name);
            expect(api.isSuccess(result)).toBe(true);
            expect(api.isError(result)).toBe(false);
        });

        it.prop([arbitraryFieldName, fc.string(), fc.string()])('creates error result', (name, rule, message) => {
            const api = loadApi();
            const result = api.error(name as never, rule, message);
            expect(result._tag).toBe(FORM_TUNING.tags.error);
            expect(result.field).toBe(name);
            expect(result.rule).toBe(rule);
            expect(result.message).toBe(message);
            expect(api.isError(result)).toBe(true);
            expect(api.isSuccess(result)).toBe(false);
        });
    });

    describe('field validation', () => {
        it('validates field against schema - success', () => {
            const api = loadApi();
            const field = api.createField('email', 'test@example.com');
            const schema = S.String;
            const result = Effect.runSync(api.validateField(field, schema));
            expect(api.isSuccess(result)).toBe(true);
        });

        it('validates field against schema - failure', () => {
            const api = loadApi();
            const field = api.createField('email', '');
            const schema = S.NonEmptyString;
            const result = Effect.runSync(api.validateField(field, schema));
            expect(api.isError(result)).toBe(true);
        });
    });

    describe('form state management', () => {
        it('creates initial form state', () => {
            const api = loadApi();
            const nameField = api.createField('name', 'John');
            const emailField = api.createField('email', 'john@example.com');
            const formState = {
                _tag: 'FormState' as const,
                fields: { email: emailField, name: nameField },
                isSubmitting: false,
                isValid: true,
                submitCount: 0,
            };
            expect(formState.fields.name.value).toBe('John');
            expect(formState.fields.email.value).toBe('john@example.com');
        });

        it.prop([fc.string()])('sets field value to dirty', (newValue) => {
            const api = loadApi();
            const nameField = api.createField('name', 'John');
            const emailField = api.createField('email', 'john@example.com');
            const formState = {
                _tag: 'FormState' as const,
                fields: { email: emailField, name: nameField },
                isSubmitting: false,
                isValid: true,
                submitCount: 0,
            };
            const updated = api.setFieldValue(formState, 'name', newValue);
            expect(updated.fields.name.value).toBe(newValue);
            expect(updated.fields.name.state).toBe('dirty');
        });

        it('touches pristine field', () => {
            const api = loadApi();
            const nameField = api.createField('name', 'John');
            const emailField = api.createField('email', 'john@example.com');
            const formState = {
                _tag: 'FormState' as const,
                fields: { email: emailField, name: nameField },
                isSubmitting: false,
                isValid: true,
                submitCount: 0,
            };
            const updated = api.touchField(formState, 'name');
            expect(updated.fields.name.state).toBe('touched');
        });

        it('preserves dirty state on touch', () => {
            const api = loadApi();
            const dirtyField = { ...api.createField('name', 'John'), state: 'dirty' as const };
            const emailField = api.createField('email', 'john@example.com');
            const formState = {
                _tag: 'FormState' as const,
                fields: { email: emailField, name: dirtyField },
                isSubmitting: false,
                isValid: true,
                submitCount: 0,
            };
            const updated = api.touchField(formState, 'name');
            expect(updated.fields.name.state).toBe('dirty');
        });
    });

    describe('fold handler', () => {
        it.prop([arbitraryFieldName])('folds success to value', (name) => {
            const api = loadApi();
            const result = api.success(name as never);
            const folded = api.fold(result, {
                onError: () => 'error',
                onSuccess: (field) => `success:${field}`,
            });
            expect(folded).toBe(`success:${name}`);
        });

        it.prop([arbitraryFieldName, fc.string(), fc.string()])('folds error to value', (name, rule, message) => {
            const api = loadApi();
            const result = api.error(name as never, rule, message);
            const folded = api.fold(result, {
                onError: (err) => `error:${err.rule}`,
                onSuccess: () => 'success',
            });
            expect(folded).toBe(`error:${rule}`);
        });
    });

    describe('form validation', () => {
        it('checks form validity with no errors', () => {
            const api = loadApi();
            const nameField = api.createField('name', 'John');
            const emailField = api.createField('email', 'john@example.com');
            const formState = {
                _tag: 'FormState' as const,
                fields: { email: emailField, name: nameField },
                isSubmitting: false,
                isValid: true,
                submitCount: 0,
            };
            expect(api.isFormValid(formState)).toBe(true);
        });

        it('checks form validity with errors', () => {
            const api = loadApi();
            const nameError = api.error('name' as never, 'required', 'Name is required');
            const nameField = { ...api.createField('name', ''), errors: [nameError] };
            const emailField = api.createField('email', 'john@example.com');
            const formState = {
                _tag: 'FormState' as const,
                fields: { email: emailField, name: nameField },
                isSubmitting: false,
                isValid: false,
                submitCount: 0,
            };
            expect(api.isFormValid(formState)).toBe(false);
        });

        it('retrieves field errors', () => {
            const api = loadApi();
            const nameError = api.error('name' as never, 'required', 'Name is required');
            const nameField = { ...api.createField('name', ''), errors: [nameError] };
            const emailField = api.createField('email', 'john@example.com');
            const formState = {
                _tag: 'FormState' as const,
                fields: { email: emailField, name: nameField },
                isSubmitting: false,
                isValid: false,
                submitCount: 0,
            };
            const errors = api.getFieldErrors(formState, 'name');
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toBe('Name is required');
        });
    });
});
