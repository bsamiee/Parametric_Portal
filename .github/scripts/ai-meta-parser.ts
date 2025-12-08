#!/usr/bin/env tsx
/**
 * AI metadata parser: extracts and validates machine-readable YAML from issue bodies.
 * Uses B.labels.categories from schema.ts, no duplication.
 */
import { B as B_schema } from './schema.ts';

// --- Types -------------------------------------------------------------------

type AiMeta = {
    readonly kind: string;
    readonly project_id?: string;
    readonly phase?: string;
    readonly status?: string;
    readonly agent?: string;
    readonly effort?: number;
};

type ParseResult =
    | { readonly success: true; readonly meta: AiMeta }
    | { readonly success: false; readonly error: string };

// --- Constants ---------------------------------------------------------------

const LABEL_AXES = Object.keys(B_schema.labels.invariants.maxPerAxis) as ReadonlyArray<string>;

const stripPrefix = (label: string): string =>
    label.replace(new RegExp(`^(${LABEL_AXES.join('|')}):`, ''), '');

const B = Object.freeze({
    metaPattern: /<!--\s*ai-meta\s*\n([\s\S]*?)\n\s*-->/,
    validSets: {
        agent: B_schema.labels.categories.agent,
        kind: B_schema.labels.categories.kind.map(stripPrefix),
        phase: B_schema.labels.categories.phase.map(stripPrefix),
        status: B_schema.labels.categories.status.map(stripPrefix),
    } as const,
} as const);

// --- Pure Functions ----------------------------------------------------------

const extractYaml = (body: string): string | null => B.metaPattern.exec(body)?.[1]?.trim() ?? null;

const parseValue = (raw: string): string | number | boolean =>
    /^\d+$/.test(raw) ? parseInt(raw, 10) : raw === 'true' ? true : raw === 'false' ? false : raw;

const parseYaml = (yaml: string): Record<string, unknown> =>
    Object.fromEntries(
        yaml
            .split('\n')
            .filter((line) => line.trim() && !line.trim().startsWith('#'))
            .map((line) => {
                const colonIndex = line.indexOf(':');
                return colonIndex === -1
                    ? []
                    : [line.slice(0, colonIndex).trim(), line.slice(colonIndex + 1).trim()];
            })
            .filter(([key, val]) => key && val)
            .map(([key, val]) => [key, parseValue(val as string)]),
    );

const validateField = <K extends keyof typeof B.validSets>(
    key: K,
    value: unknown,
): value is (typeof B.validSets)[K][number] =>
    typeof value === 'string' && (B.validSets[key] as ReadonlyArray<string>).includes(value);

const validateEffort = (value: unknown): value is number => typeof value === 'number' && value > 0;

// --- Dispatch Tables ---------------------------------------------------------

type ValidationError = string;
type Validator = (obj: Record<string, unknown>) => ValidationError | null;

const validators: Record<keyof AiMeta, Validator> = {
    agent: (obj) =>
        obj.agent && !validateField('agent', obj.agent)
            ? `Invalid agent: ${obj.agent}. Must be one of: ${VALID_SETS.agent.join(', ')}`
            : null,
    effort: (obj) =>
        obj.effort && !validateEffort(obj.effort) ? `Invalid effort: ${obj.effort}. Must be a positive number` : null,
    kind: (obj) =>
        !obj.kind
            ? 'Missing required field: kind'
            : !validateField('kind', obj.kind)
              ? `Invalid kind: ${obj.kind}. Must be one of: ${VALID_SETS.kind.join(', ')}`
              : null,
    phase: (obj) =>
        obj.phase && !validateField('phase', obj.phase)
            ? `Invalid phase: ${obj.phase}. Must be one of: ${VALID_SETS.phase.join(', ')}`
            : null,
    project_id: () => null,
    status: (obj) =>
        obj.status && !validateField('status', obj.status)
            ? `Invalid status: ${obj.status}. Must be one of: ${VALID_SETS.status.join(', ')}`
            : null,
};

const validate = (obj: Record<string, unknown>): ParseResult => {
    const errors = Object.values(validators)
        .map((validator) => validator(obj))
        .filter(Boolean) as ReadonlyArray<string>;
    
    return errors.length > 0
        ? { error: errors[0], success: false }
        : {
              meta: {
                  agent: obj.agent as string | undefined,
                  effort: obj.effort as number | undefined,
                  kind: obj.kind as string,
                  phase: obj.phase as string | undefined,
                  project_id: obj.project_id as string | undefined,
                  status: obj.status as string | undefined,
              },
              success: true,
          };
};

// --- Entry Point -------------------------------------------------------------

const parse = (body: string | null): ParseResult => {
    if (!body) return { error: 'Empty body', success: false };
    
    const yaml = extractYaml(body);
    if (!yaml) return { error: 'No ai-meta block found', success: false };
    
    return validate(parseYaml(yaml));
};

const toLabels = (meta: AiMeta): ReadonlyArray<string> =>
    [
        `kind:${meta.kind}`,
        meta.phase ? `phase:${meta.phase}` : null,
        meta.status ? `status:${meta.status}` : null,
        meta.agent && meta.agent !== 'human' ? meta.agent : null,
    ].filter((label): label is string => label !== null);

// --- Export ------------------------------------------------------------------

export { parse, toLabels };
export type { AiMeta, ParseResult };
