import { _TransitionCommand } from '@parametric-portal/server/infra/handlers/tenant-lifecycle';
import { Either, Schema as S } from 'effect';
import { describe, expect, it } from 'vitest';

// --- [TESTS] -----------------------------------------------------------------

describe('TransitionCommand schema validation', () => {
    it('provision decodes valid namespace correctly', () => {
        const input = { _tag: 'provision', name: 'My App', namespace: 'my-app-123', settings: {} };
        const result = S.decodeUnknownSync(_TransitionCommand)(input);
        expect(result._tag).toBe('provision');
        expect(result.namespace).toBe('my-app-123');
        expect(result.name).toBe('My App');
    });

    it('provision rejects namespace with special characters', () => {
        const input = { _tag: 'provision', name: 'My App', namespace: 'my_app@123' };
        expect(() => S.decodeUnknownSync(_TransitionCommand)(input)).toThrow();
    });

    it('provision rejects namespace that is too short', () => {
        const input = { _tag: 'provision', name: 'My App', namespace: 'a' };
        expect(() => S.decodeUnknownSync(_TransitionCommand)(input)).toThrow();
    });

    it('provision rejects namespace starting with hyphen', () => {
        const input = { _tag: 'provision', name: 'My App', namespace: '-invalid' };
        expect(() => S.decodeUnknownSync(_TransitionCommand)(input)).toThrow();
    });

    it('provision rejects namespace ending with hyphen', () => {
        const input = { _tag: 'provision', name: 'My App', namespace: 'invalid-' };
        expect(() => S.decodeUnknownSync(_TransitionCommand)(input)).toThrow();
    });

    it('suspend validates UUID format on tenantId field', () => {
        const validInput = { _tag: 'suspend', tenantId: '123e4567-e89b-12d3-a456-426614174000' };
        const result = S.decodeUnknownSync(_TransitionCommand)(validInput);
        expect(result._tag).toBe('suspend');
        expect(result.tenantId).toBe('123e4567-e89b-12d3-a456-426614174000');

        const invalidInput = { _tag: 'suspend', tenantId: 'not-a-uuid' };
        expect(() => S.decodeUnknownSync(_TransitionCommand)(invalidInput)).toThrow();
    });

    it('resume validates UUID format on tenantId field', () => {
        const validInput = { _tag: 'resume', tenantId: '123e4567-e89b-12d3-a456-426614174000' };
        const result = S.decodeUnknownSync(_TransitionCommand)(validInput);
        expect(result._tag).toBe('resume');
        expect(result.tenantId).toBe('123e4567-e89b-12d3-a456-426614174000');

        const invalidInput = { _tag: 'resume', tenantId: 'not-a-uuid' };
        expect(() => S.decodeUnknownSync(_TransitionCommand)(invalidInput)).toThrow();
    });

    it('archive validates UUID format on tenantId field', () => {
        const validInput = { _tag: 'archive', tenantId: '123e4567-e89b-12d3-a456-426614174000' };
        const result = S.decodeUnknownSync(_TransitionCommand)(validInput);
        expect(result._tag).toBe('archive');
        expect(result.tenantId).toBe('123e4567-e89b-12d3-a456-426614174000');

        const invalidInput = { _tag: 'archive', tenantId: 'not-a-uuid' };
        expect(() => S.decodeUnknownSync(_TransitionCommand)(invalidInput)).toThrow();
    });

    it('purge validates UUID format on tenantId field', () => {
        const validInput = { _tag: 'purge', tenantId: '123e4567-e89b-12d3-a456-426614174000' };
        const result = S.decodeUnknownSync(_TransitionCommand)(validInput);
        expect(result._tag).toBe('purge');
        expect(result.tenantId).toBe('123e4567-e89b-12d3-a456-426614174000');

        const invalidInput = { _tag: 'purge', tenantId: 'not-a-uuid' };
        expect(() => S.decodeUnknownSync(_TransitionCommand)(invalidInput)).toThrow();
    });

    it('rejects unknown _tag values', () => {
        const input = { _tag: 'unknown-command', tenantId: '123e4567-e89b-12d3-a456-426614174000' };
        expect(() => S.decodeUnknownSync(_TransitionCommand)(input)).toThrow();
    });

    it('provision rejects empty name', () => {
        const input = { _tag: 'provision', name: '', namespace: 'valid-namespace' };
        expect(() => S.decodeUnknownSync(_TransitionCommand)(input)).toThrow();
    });

    it('provision rejects name with leading/trailing whitespace', () => {
        const input = { _tag: 'provision', name: '  My App  ', namespace: 'my-app' };
        expect(() => S.decodeUnknownSync(_TransitionCommand)(input)).toThrow();
    });
});

describe('Transition matrix documentation', () => {
    it('verifies 5 command tags exist', () => {
        const commands = [
            { _tag: 'provision', name: 'Test', namespace: 'test-app' },
            { _tag: 'suspend', tenantId: '123e4567-e89b-12d3-a456-426614174000' },
            { _tag: 'resume', tenantId: '123e4567-e89b-12d3-a456-426614174000' },
            { _tag: 'archive', tenantId: '123e4567-e89b-12d3-a456-426614174000' },
            { _tag: 'purge', tenantId: '123e4567-e89b-12d3-a456-426614174000' },
        ];

        const tags = commands.map((command) => {
            const result = S.decodeUnknownEither(_TransitionCommand)(command);
            return Either.match(result, {
                onLeft: () => null,
                onRight: (decoded) => decoded._tag,
            });
        });

        expect(tags).toEqual(['provision', 'suspend', 'resume', 'archive', 'purge']);
    });

    it('provision has structurally different shape from lifecycle commands', () => {
        const provisionInput = { _tag: 'provision', name: 'Test', namespace: 'test-app' };
        const provision = S.decodeUnknownSync(_TransitionCommand)(provisionInput);

        expect('namespace' in provision).toBe(true);
        expect('name' in provision).toBe(true);
        expect('tenantId' in provision).toBe(false);
    });

    it('lifecycle commands share consistent structure with tenantId field', () => {
        const lifecycleCommands = ['suspend', 'resume', 'archive', 'purge'];
        const uuid = '123e4567-e89b-12d3-a456-426614174000';

        lifecycleCommands.forEach((tag) => {
            const input = { _tag: tag, tenantId: uuid };
            const result = S.decodeUnknownSync(_TransitionCommand)(input);

            expect(result._tag).toBe(tag);
            expect('tenantId' in result).toBe(true);
            expect(result.tenantId).toBe(uuid);
            expect('namespace' in result).toBe(false);
            expect('name' in result).toBe(false);
        });
    });
});
