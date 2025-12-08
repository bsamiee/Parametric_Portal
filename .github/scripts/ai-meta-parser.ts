#!/usr/bin/env tsx
/**
 * AI metadata parser: extracts and validates machine-readable YAML from issue bodies.
 * Uses B.labels.categories from schema.ts, no duplication.
 */
import { B } from './schema.ts';

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

const META_PATTERN = /<!--\s*ai-meta\s*\n([\s\S]*?)\n\s*-->/;

const stripPrefix = (label: string): string => label.replace(/^(kind|phase|status|priority):/, '');

const VALID_SETS = Object.freeze({
    agent: B.labels.categories.agent,
    kind: B.labels.categories.kind.map(stripPrefix),
    phase: B.labels.categories.phase.map(stripPrefix),
    status: B.labels.categories.status.map(stripPrefix),
} as const);

// --- Pure Functions ----------------------------------------------------------

const extractYaml = (body: string): string | null => META_PATTERN.exec(body)?.[1]?.trim() ?? null;

const parseValue = (raw: string): string | number | boolean =>
    /^\d+$/.test(raw) ? parseInt(raw, 10) : raw === 'true' ? true : raw === 'false' ? false : raw;

const parseYaml = (yaml: string): Record<string, unknown> =>
    Object.fromEntries(
        yaml
            .split('\n')
            .filter((line) => line.trim() && !line.trim().startsWith('#'))
            .map((line) => line.split(':'))
            .filter(([_key, val]) => val)
            .map(([key, val]) => [key.trim(), parseValue(val.trim())]),
    );

const validateField = <K extends keyof typeof VALID_SETS>(
    key: K,
    value: unknown,
): value is (typeof VALID_SETS)[K][number] =>
    typeof value === 'string' && (VALID_SETS[key] as ReadonlyArray<string>).includes(value);

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

const validate = (obj: Record<string, unknown>): ParseResult =>
    ((errors) =>
        errors.length > 0
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
              })(Object.values(validators).map((validator) => validator(obj)).filter(Boolean) as ReadonlyArray<string>);

// --- Entry Point -------------------------------------------------------------

const parse = (body: string | null): ParseResult =>
    !body
        ? { error: 'Empty body', success: false }
        : ((yaml) => (!yaml ? { error: 'No ai-meta block found', success: false } : validate(parseYaml(yaml))))(
              extractYaml(body),
          );

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
