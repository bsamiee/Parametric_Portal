#!/usr/bin/env tsx
/**
 * AI metadata parser: extracts and validates machine-readable YAML from issue bodies.
 * Uses B.labels.categories, fn utilities from schema.ts.
 */

// --- Types -------------------------------------------------------------------

type AiMeta = {
    readonly kind: 'project' | 'task' | 'spike' | 'refactor';
    readonly project_id?: string;
    readonly phase?: string;
    readonly status?: string;
    readonly agent?: 'claude' | 'copilot' | 'gemini' | 'codex' | 'human';
    readonly effort?: number;
};

type ParseResult =
    | { readonly success: true; readonly meta: AiMeta }
    | { readonly success: false; readonly error: string };

// --- Constants ---------------------------------------------------------------

const B = Object.freeze({
    pattern: /<!--\s*ai-meta\s*\n([\s\S]*?)\n\s*-->/,
    validKinds: ['project', 'task', 'spike', 'refactor'] as const,
    validPhases: ['0-foundation', '1-planning', '2-impl-core', '3-impl-extensions', '4-hardening', '5-release'] as const,
    validStatuses: ['triage', 'implement', 'in-progress', 'review', 'blocked', 'done', 'idea', 'planning'] as const,
    validAgents: ['claude', 'copilot', 'gemini', 'codex', 'human'] as const,
} as const);

// --- Pure Functions ----------------------------------------------------------

const extractYaml = (body: string): string | null => {
    const match = B.pattern.exec(body);
    return match?.[1]?.trim() ?? null;
};

const parseYaml = (yaml: string): Record<string, unknown> => {
    const lines = yaml.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'));
    const obj: Record<string, unknown> = {};

    lines.forEach((line) => {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) return;

        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();

        if (!value) {
            obj[key] = undefined;
            return;
        }

        // Parse numbers
        if (/^\d+$/.test(value)) {
            obj[key] = parseInt(value, 10);
            return;
        }

        // Parse booleans
        if (value === 'true') {
            obj[key] = true;
            return;
        }
        if (value === 'false') {
            obj[key] = false;
            return;
        }

        // Default: string
        obj[key] = value;
    });

    return obj;
};

const validate = (obj: Record<string, unknown>): ParseResult => {
    const kind = obj.kind as string | undefined;

    if (!kind) {
        return { error: 'Missing required field: kind', success: false };
    }

    if (!(B.validKinds as ReadonlyArray<string>).includes(kind)) {
        return { error: `Invalid kind: ${kind}. Must be one of: ${B.validKinds.join(', ')}`, success: false };
    }

    const meta: AiMeta = {
        kind: kind as AiMeta['kind'],
    };

    if (obj.project_id && typeof obj.project_id === 'string') {
        meta.project_id = obj.project_id;
    }

    if (obj.phase) {
        const phase = obj.phase as string;
        if (!(B.validPhases as ReadonlyArray<string>).includes(phase)) {
            return { error: `Invalid phase: ${phase}. Must be one of: ${B.validPhases.join(', ')}`, success: false };
        }
        meta.phase = phase;
    }

    if (obj.status) {
        const status = obj.status as string;
        if (!(B.validStatuses as ReadonlyArray<string>).includes(status)) {
            return { error: `Invalid status: ${status}. Must be one of: ${B.validStatuses.join(', ')}`, success: false };
        }
        meta.status = status;
    }

    if (obj.agent) {
        const agent = obj.agent as string;
        if (!(B.validAgents as ReadonlyArray<string>).includes(agent)) {
            return { error: `Invalid agent: ${agent}. Must be one of: ${B.validAgents.join(', ')}`, success: false };
        }
        meta.agent = agent as AiMeta['agent'];
    }

    if (obj.effort) {
        const effort = obj.effort;
        if (typeof effort !== 'number' || effort < 0) {
            return { error: `Invalid effort: ${effort}. Must be a positive number`, success: false };
        }
        meta.effort = effort;
    }

    return { meta, success: true };
};

// --- Entry Point -------------------------------------------------------------

const parse = (body: string | null): ParseResult => {
    if (!body) {
        return { error: 'Empty body', success: false };
    }

    const yaml = extractYaml(body);
    if (!yaml) {
        return { error: 'No ai-meta block found', success: false };
    }

    const obj = parseYaml(yaml);
    return validate(obj);
};

const toLabels = (meta: AiMeta): ReadonlyArray<string> => {
    const labels: Array<string> = [];

    labels.push(`kind:${meta.kind}`);

    if (meta.phase) {
        labels.push(`phase:${meta.phase}`);
    }

    if (meta.status) {
        labels.push(`status:${meta.status}`);
    }

    if (meta.agent && meta.agent !== 'human') {
        labels.push(meta.agent);
    }

    return labels;
};

// --- Export ------------------------------------------------------------------

export { parse, toLabels };
export type { AiMeta, ParseResult };
