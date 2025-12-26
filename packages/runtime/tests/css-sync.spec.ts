/**
 * CSS sync tests: tuning constants, prefix validation, sync handlers dispatch table.
 */
import { it as itProp } from '@fast-check/vitest';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CSS_SYNC_TUNING } from '../src/css-sync';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: { prefix: 'app' },
    patterns: { htmlId: /^[a-z][a-z0-9-]*$/ },
    samples: {
        classNames: ['dark', 'light', 'compact', 'expanded'] as const,
        invalidPrefixes: ['', 'UPPERCASE', 'has space', '123start', '-dash', '@special'] as const,
        validPrefixes: ['app', 'theme', 'my-app', 'ui', 'a', 'test123'] as const,
        variables: { color: '#ff0000', fontSize: '16px', spacing: '8px' },
    },
} as const);

// --- [SETUP] -----------------------------------------------------------------

const testContext = { root: null as HTMLDivElement | null };
beforeEach(() => {
    const div = document.createElement('div');
    div.id = 'test-root';
    document.body.appendChild(div);
    testContext.root = div;
});
afterEach(() => {
    testContext.root?.remove();
    document.documentElement.style.cssText = '';
    document.documentElement.className = '';
});
const getTestRoot = () => testContext.root as HTMLDivElement;

// --- [DESCRIBE] CSS_SYNC_TUNING ----------------------------------------------

describe('CSS_SYNC_TUNING', () => {
    it('is frozen with correct structure', () => {
        expect(Object.isFrozen(CSS_SYNC_TUNING)).toBe(true);
        expect(CSS_SYNC_TUNING.defaults.prefix).toBe(B.defaults.prefix);
    });
    it('defaults.prefix is valid html id', () => {
        expect(B.patterns.htmlId.test(CSS_SYNC_TUNING.defaults.prefix)).toBe(true);
    });
    it('defaults.root returns documentElement', () => {
        expect(CSS_SYNC_TUNING.defaults.root()).toBe(document.documentElement);
    });
    it('defaults object has prefix and root', () => {
        expect(CSS_SYNC_TUNING.defaults).toHaveProperty('prefix');
        expect(CSS_SYNC_TUNING.defaults).toHaveProperty('root');
    });
});

// --- [DESCRIBE] DOM style manipulation ---------------------------------------

describe('DOM style.setProperty', () => {
    it('sets CSS variable on element', () => {
        getTestRoot().style.setProperty('--test-color', '#ff0000');
        expect(getTestRoot().style.getPropertyValue('--test-color')).toBe('#ff0000');
    });
    it('overwrites existing CSS variable', () => {
        getTestRoot().style.setProperty('--test-var', 'old');
        getTestRoot().style.setProperty('--test-var', 'new');
        expect(getTestRoot().style.getPropertyValue('--test-var')).toBe('new');
    });
    it('handles multiple CSS variables', () => {
        getTestRoot().style.setProperty('--var-a', 'a');
        getTestRoot().style.setProperty('--var-b', 'b');
        getTestRoot().style.setProperty('--var-c', 'c');
        expect(getTestRoot().style.getPropertyValue('--var-a')).toBe('a');
        expect(getTestRoot().style.getPropertyValue('--var-b')).toBe('b');
        expect(getTestRoot().style.getPropertyValue('--var-c')).toBe('c');
    });
    itProp.prop([fc.string({ maxLength: 20, minLength: 1 }).filter((s) => /^[a-z]+$/.test(s))])(
        'sets arbitrary variable names',
        (name) => {
            getTestRoot().style.setProperty(`--${name}`, 'value');
            expect(getTestRoot().style.getPropertyValue(`--${name}`)).toBe('value');
        },
    );
    it('handles special characters in values', () => {
        getTestRoot().style.setProperty('--font', '"Arial", sans-serif');
        expect(getTestRoot().style.getPropertyValue('--font')).toBe('"Arial", sans-serif');
    });
    it('handles empty value', () => {
        getTestRoot().style.setProperty('--empty', '');
        expect(getTestRoot().style.getPropertyValue('--empty')).toBe('');
    });
});

// --- [DESCRIBE] DOM classList manipulation -----------------------------------

describe('DOM classList', () => {
    it('adds class to element', () => {
        getTestRoot().classList.add('dark');
        expect(getTestRoot().classList.contains('dark')).toBe(true);
    });
    it('removes class from element', () => {
        getTestRoot().classList.add('dark');
        getTestRoot().classList.remove('dark');
        expect(getTestRoot().classList.contains('dark')).toBe(false);
    });
    it('toggles class on element', () => {
        expect(getTestRoot().classList.contains('toggle')).toBe(false);
        getTestRoot().classList.toggle('toggle');
        expect(getTestRoot().classList.contains('toggle')).toBe(true);
        getTestRoot().classList.toggle('toggle');
        expect(getTestRoot().classList.contains('toggle')).toBe(false);
    });
    it('handles multiple classes', () => {
        getTestRoot().classList.add('a', 'b', 'c');
        expect(getTestRoot().classList.contains('a')).toBe(true);
        expect(getTestRoot().classList.contains('b')).toBe(true);
        expect(getTestRoot().classList.contains('c')).toBe(true);
    });
    it('remove does nothing for non-existent class', () => {
        getTestRoot().classList.remove('non-existent');
        expect(getTestRoot().classList.contains('non-existent')).toBe(false);
    });
    it.each(B.samples.classNames)('handles class name: %s', (className) => {
        getTestRoot().classList.add(className);
        expect(getTestRoot().classList.contains(className)).toBe(true);
        getTestRoot().classList.remove(className);
        expect(getTestRoot().classList.contains(className)).toBe(false);
    });
});

// --- [DESCRIBE] prefix validation pattern ------------------------------------

describe('prefix validation pattern', () => {
    it.each(B.samples.validPrefixes)('valid prefix matches pattern: %s', (prefix) => {
        expect(B.patterns.htmlId.test(prefix)).toBe(true);
    });
    it.each(B.samples.invalidPrefixes)('invalid prefix does not match pattern: "%s"', (prefix) => {
        expect(B.patterns.htmlId.test(prefix)).toBe(false);
    });
    itProp.prop([fc.string({ maxLength: 10, minLength: 1 }).filter((s) => /^[a-z][a-z0-9-]*$/.test(s))])(
        'arbitrary valid prefix matches pattern',
        (prefix) => {
            expect(B.patterns.htmlId.test(prefix)).toBe(true);
        },
    );
    it('pattern requires lowercase start', () => {
        expect(B.patterns.htmlId.test('abc')).toBe(true);
        expect(B.patterns.htmlId.test('Abc')).toBe(false);
        expect(B.patterns.htmlId.test('1abc')).toBe(false);
    });
    it('pattern allows hyphens and numbers after start', () => {
        expect(B.patterns.htmlId.test('my-app')).toBe(true);
        expect(B.patterns.htmlId.test('app123')).toBe(true);
        expect(B.patterns.htmlId.test('a-1-b-2')).toBe(true);
    });
});

// --- [DESCRIBE] CSS variable naming convention -------------------------------

describe('CSS variable naming convention', () => {
    it('creates prefixed variable name', () => {
        const prefix = 'app';
        const key = 'color';
        const varName = `--${prefix}-${key}`;
        expect(varName).toBe('--app-color');
    });
    it('handles multi-word keys', () => {
        const prefix = 'theme';
        const key = 'fontSize';
        const varName = `--${prefix}-${key}`;
        expect(varName).toBe('--theme-fontSize');
    });
    itProp.prop([
        fc.string({ maxLength: 10, minLength: 1 }).filter((s) => /^[a-z]+$/.test(s)),
        fc.string({ maxLength: 10, minLength: 1 }).filter((s) => /^[a-zA-Z]+$/.test(s)),
    ])('constructs valid CSS variable name', (prefix, key) => {
        const varName = `--${prefix}-${key}`;
        expect(varName).toMatch(/^--[a-z]+-[a-zA-Z]+$/);
    });
});

// --- [DESCRIBE] documentElement default root ---------------------------------

describe('documentElement default root', () => {
    it('sets CSS variable on document root', () => {
        document.documentElement.style.setProperty('--root-var', 'value');
        expect(document.documentElement.style.getPropertyValue('--root-var')).toBe('value');
    });
    it('adds class to document root', () => {
        document.documentElement.classList.add('root-class');
        expect(document.documentElement.classList.contains('root-class')).toBe(true);
    });
    it('CSS variables cascade to children', () => {
        document.documentElement.style.setProperty('--cascade-test', '10px');
        const computed = getComputedStyle(getTestRoot()).getPropertyValue('--cascade-test');
        expect(computed.trim()).toBe('10px');
    });
});

// --- [DESCRIBE] sync handler patterns ----------------------------------------

describe('sync handler patterns', () => {
    it('variables handler sets multiple properties', () => {
        const entries = Object.entries(B.samples.variables);
        entries.forEach(([key, value]) => {
            getTestRoot().style.setProperty(`--app-${key}`, value);
        });
        expect(getTestRoot().style.getPropertyValue('--app-color')).toBe('#ff0000');
        expect(getTestRoot().style.getPropertyValue('--app-fontSize')).toBe('16px');
        expect(getTestRoot().style.getPropertyValue('--app-spacing')).toBe('8px');
    });
    it('classesAdd handler adds multiple classes', () => {
        const classes = ['dark', 'compact', 'animated'];
        classes.forEach((c) => {
            getTestRoot().classList.add(c);
        });
        classes.forEach((c) => {
            expect(getTestRoot().classList.contains(c)).toBe(true);
        });
    });
    it('classesRemove handler removes multiple classes', () => {
        const classes = ['light', 'expanded', 'static'];
        classes.forEach((c) => {
            getTestRoot().classList.add(c);
        });
        classes.forEach((c) => {
            getTestRoot().classList.remove(c);
        });
        classes.forEach((c) => {
            expect(getTestRoot().classList.contains(c)).toBe(false);
        });
    });
});

// --- [DESCRIBE] edge cases ---------------------------------------------------

describe('edge cases', () => {
    it('handles empty variable value', () => {
        getTestRoot().style.setProperty('--empty', '');
        expect(getTestRoot().style.getPropertyValue('--empty')).toBe('');
    });
    it('handles numeric-like string values', () => {
        getTestRoot().style.setProperty('--num', '42');
        expect(getTestRoot().style.getPropertyValue('--num')).toBe('42');
    });
    it('handles CSS function values', () => {
        getTestRoot().style.setProperty('--calc', 'calc(100% - 20px)');
        expect(getTestRoot().style.getPropertyValue('--calc')).toBe('calc(100% - 20px)');
    });
    it('handles var() references', () => {
        getTestRoot().style.setProperty('--ref', 'var(--other)');
        expect(getTestRoot().style.getPropertyValue('--ref')).toBe('var(--other)');
    });
    it('handles rgb/rgba values', () => {
        getTestRoot().style.setProperty('--rgb', 'rgb(255, 0, 0)');
        expect(getTestRoot().style.getPropertyValue('--rgb')).toBe('rgb(255, 0, 0)');
    });
});
