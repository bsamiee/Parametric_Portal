// --- [ESLINT_SONAR_CONFIG] ---------------------------------------------------
// SonarJS rules that Biome does not cover. Run alongside Biome for complete
// static analysis coverage. Biome handles: cognitive complexity, formatting,
// most correctness/style rules. This config targets code smell detection.
// -----------------------------------------------------------------------------

import tsparser from '@typescript-eslint/parser';
import sonarjs from 'eslint-plugin-sonarjs';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    files: ['**/*.ts', '**/*.tsx'],
    ignorePatterns: [
        '**/node_modules/**',
        '**/dist/**',
        '**/coverage/**',
        '**/*.d.ts',
        '**/*.spec.ts',
        '**/*.test.ts',
        '**/*.bench.ts',
        '**/test-results/**',
        '**/.nx/**',
    ],
});

// --- [EXPORT] ----------------------------------------------------------------

export default [
    {
        ignores: B.ignorePatterns,
    },
    {
        files: B.files,
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
        },
        plugins: {
            sonarjs,
        },
        rules: {
            // --- [DISABLED_RULES] ------------------------------------------------
            // Rules that Biome already handles or conflict with project style

            // Biome has noExcessiveCognitiveComplexity
            'sonarjs/cognitive-complexity': 'off',
            // --- [BUG_DETECTION] -------------------------------------------------
            // Rules detecting logical errors and potential bugs

            // All branches in conditional have identical implementation
            'sonarjs/no-all-duplicated-branches': 'error',

            // Disabled: project uses ternaries, not nested if statements
            'sonarjs/no-collapsible-if': 'off',

            // Collection size compared incorrectly (arr.length < 0)
            'sonarjs/no-collection-size-mischeck': 'error',

            // --- [CODE_SMELL_DETECTION] ------------------------------------------
            // Rules detecting maintainability issues

            // String literals duplicated more than threshold times
            'sonarjs/no-duplicate-string': ['error', { threshold: 3 }],

            // Collection elements overwritten unconditionally
            'sonarjs/no-element-overwrite': 'error',

            // Same condition used in if-else-if chain
            'sonarjs/no-identical-conditions': 'error',

            // Identical expressions on both sides of binary operator
            'sonarjs/no-identical-expressions': 'error',

            // Functions with identical implementations (copy-paste)
            'sonarjs/no-identical-functions': 'error',

            // Inverted boolean checks that reduce readability
            'sonarjs/no-inverted-boolean-check': 'error',

            // Nested switch statements
            'sonarjs/no-nested-switch': 'error',

            // Nested template literals
            'sonarjs/no-nested-template-literals': 'error',

            // Biome handles via noUselessElse
            'sonarjs/no-redundant-boolean': 'off',

            // Useless return/continue/break statements
            'sonarjs/no-redundant-jump': 'error',

            // Disabled: project uses dispatch tables, not switch statements
            'sonarjs/no-small-switch': 'off',

            // Collection written but never read
            'sonarjs/no-unused-collection': 'error',

            // Variables declared then immediately returned
            'sonarjs/prefer-immediate-return': 'error',

            // Boolean returns wrapped in if-then-else
            'sonarjs/prefer-single-boolean-return': 'error',
        },
    },
];
