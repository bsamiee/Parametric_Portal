#!/usr/bin/env tsx
/**
 * AI metadata parser: extracts and validates machine-readable YAML from issue bodies.
 * Uses B.labels.groups from schema.ts for validation.
 */
import { B } from './schema.ts';

// --- Types -------------------------------------------------------------------

type AiMeta = {
    readonly type: string;
    readonly project?: string;
    readonly phase?: string;
    readonly state?: string;
    readonly agent?: string;
    readonly effort?: number;
};

type ParseResult =
    | { readonly success: true; readonly meta: AiMeta }
    | { readonly success: false; readonly error: string };

// --- Constants ---------------------------------------------------------------

const META_PATTERN = /<!--\s*ai-meta\s*\n([\s\S]*?)\n\s*-->/;

const VALID_SETS = Object.freeze({
    agent: B.labels.groups.agent,
    phase: B.labels.groups.phase,
    state: B.labels.groups.status,
    type: ['task', 'project'] as const,
});

// --- Pure Functions ----------------------------------------------------------

const extractYaml = (body: string): string | null => META_PATTERN.exec(body)?.[1]?.trim() ?? null;

const boolMap = Object.freeze({ false: false, true: true } as const);

const parseNumber = (raw: string): number | null => (/^\d+$/.test(raw) ? Number.parseInt(raw, 10) : null);

const parseValue = (raw: string): string | number | boolean => {
    const asBool = (boolMap as Record<string, boolean>)[raw];
    if (asBool !== undefined) {
        return asBool;
    }
    const asNum = parseNumber(raw);
    return asNum ?? raw;
};

const parseYaml = (yaml: string): Record<string, unknown> =>
    Object.fromEntries(
        yaml
            .split('\n')
            .filter((line) => line.trim() && !line.trim().startsWith('#'))
            .map((line) => {
                const colonIndex = line.indexOf(':');
                return colonIndex === -1 ? [] : [line.slice(0, colonIndex).trim(), line.slice(colonIndex + 1).trim()];
            })
            .filter(([key, val]) => key && val)
            .map(([key, val]) => [key, parseValue(val as string)]),
    );

const validateField = <K extends keyof typeof VALID_SETS>(
    key: K,
    value: unknown,
): value is (typeof VALID_SETS)[K][number] =>
    typeof value === 'string' && (VALID_SETS[key] as ReadonlyArray<string>).includes(value);

const validateEffort = (value: unknown): value is number => typeof value === 'number' && value > 0;

// --- Dispatch Tables ---------------------------------------------------------

type Validator = (obj: Record<string, unknown>) => string | null;

const validators: Record<keyof AiMeta, Validator> = {
    agent: (obj) =>
        obj.agent && !validateField('agent', obj.agent)
            ? `Invalid agent: ${obj.agent}. Must be one of: ${VALID_SETS.agent.join(', ')}`
            : null,
    effort: (obj) =>
        obj.effort && !validateEffort(obj.effort) ? `Invalid effort: ${obj.effort}. Must be a positive number` : null,
    phase: (obj) =>
        obj.phase && !validateField('phase', obj.phase)
            ? `Invalid phase: ${obj.phase}. Must be one of: ${VALID_SETS.phase.join(', ')}`
            : null,
    project: () => null,
    state: (obj) =>
        obj.state && !validateField('state', obj.state)
            ? `Invalid state: ${obj.state}. Must be one of: ${VALID_SETS.state.join(', ')}`
            : null,
    type: (obj) => {
        if (!obj.type) {
            return 'Missing required field: type';
        }
        const isValid = validateField('type', obj.type);
        return isValid ? null : `Invalid type: ${obj.type}. Must be one of: ${VALID_SETS.type.join(', ')}`;
    },
};

const validate = (obj: Record<string, unknown>): ParseResult => {
    const errors = Object.values(validators)
        .map((validator) => validator(obj))
        .filter(Boolean) as ReadonlyArray<string>;

    const meta = {
        agent: obj.agent as string | undefined,
        effort: obj.effort as number | undefined,
        phase: obj.phase as string | undefined,
        project: obj.project as string | undefined,
        state: obj.state as string | undefined,
        type: obj.type as string,
    };

    return errors.length > 0 ? { error: errors[0], success: false } : { meta, success: true };
};

// --- Entry Point -------------------------------------------------------------

const parse = (body: string | null): ParseResult => {
    if (!body) {
        return { error: 'Empty body', success: false };
    }
    const yaml = extractYaml(body);
    return yaml ? validate(parseYaml(yaml)) : { error: 'No ai-meta block found', success: false };
};

const toLabels = (meta: AiMeta): ReadonlyArray<string> =>
    [
        meta.type,
        meta.phase ?? null,
        meta.state ?? null,
        meta.agent && meta.agent !== 'human' ? meta.agent : null,
    ].filter((label): label is string => label !== null);

// --- Export ------------------------------------------------------------------

export { parse, toLabels };
export type { AiMeta, ParseResult };
