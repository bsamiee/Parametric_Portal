#!/usr/bin/env tsx
/**
 * Report generator: fetches data, formats tables, outputs to summary/comment/issue.
 * Uses fn.report, fn.rowsCount, call, mutate from schema.ts.
 */
import { type Ctx, call, createCtx, fn, type Issue, mutate, type RunParams } from './schema.ts';

// --- Types -------------------------------------------------------------------

type ContentSpec = { readonly kind: string } & Record<string, unknown>;
type ContentConfig = {
    readonly src: { readonly source: 'fetch'; readonly op: string; readonly args?: ReadonlyArray<unknown> };
    readonly fmt: { readonly format: 'table'; readonly title: string; readonly headers: ReadonlyArray<string> };
    readonly out: {
        readonly output: 'summary' | 'comment' | 'issue';
        readonly marker?: string;
        readonly pattern?: string;
        readonly labels?: ReadonlyArray<string>;
        readonly title?: string;
    };
    readonly filters?: ReadonlyArray<{ readonly label: string; readonly display?: string }>;
    readonly row?: 'count' | 'list';
};

// --- Constants ---------------------------------------------------------------

const reportSpecs: Record<string, ContentConfig> = Object.freeze({
    aging: {
        filters: [
            { display: 'Critical', label: 'critical' },
            { display: 'Stale', label: 'stale' },
        ],
        fmt: { format: 'table', headers: ['Category', 'Count'], title: 'Issue Aging Report' },
        out: { output: 'summary' },
        row: 'count',
        src: { args: ['open'], op: 'issue.list', source: 'fetch' },
    },
} as const);

// --- Pure Functions ----------------------------------------------------------

type SourceFn = (ctx: Ctx, cfg: ContentConfig, spec: ContentSpec, p: RunParams) => Promise<unknown>;
const dataSources: Record<string, SourceFn> = {
    fetch: async (ctx, cfg) => call(ctx, cfg.src.op, ...(cfg.src.args ?? [])),
    params: async (_, __, spec) => spec,
    payload: async (_, __, ___, params) => params.context.payload,
};

// --- Dispatch Tables ---------------------------------------------------------

const buildRows = (cfg: ContentConfig, data: unknown): ReadonlyArray<ReadonlyArray<string>> => {
    const builders: Record<string, () => ReadonlyArray<ReadonlyArray<string>>> = {
        count: () => fn.rowsCount(data as ReadonlyArray<Issue>, cfg.filters ?? []),
        list: () => (data as ReadonlyArray<Record<string, unknown>>).map((r) => Object.values(r).map(String)),
    };
    return builders[cfg.row ?? 'list']();
};

// --- Pure Functions ----------------------------------------------------------

const outputHandlers = {
    comment: async (ctx: Ctx, _: RunParams, body: string, cfg: ContentConfig, number: number): Promise<void> => {
        await mutate(ctx, {
            body,
            marker: cfg.out.marker ?? '',
            n: number,
            t: 'comment',
        });
    },
    issue: async (ctx: Ctx, _: RunParams, body: string, cfg: ContentConfig): Promise<void> => {
        await mutate(ctx, {
            body,
            label: cfg.out.labels?.[0] ?? '',
            labels: [...(cfg.out.labels ?? [])],
            pattern: cfg.out.pattern ?? '',
            t: 'issue',
            title: cfg.out.title ?? cfg.fmt.title,
        });
    },
    summary: async (_: Ctx, params: RunParams, body: string): Promise<void> => {
        params.core.summary.addRaw(body).write();
    },
} as const;

// --- Dispatch Tables ---------------------------------------------------------

const contentFormatters = {
    body: (_cfg: ContentConfig, spec: ContentSpec): string => fn.body([], spec as Record<string, string>),
    table: (cfg: ContentConfig, data: unknown, now: Date): string => {
        const rows = buildRows(cfg, data);
        return fn.report(cfg.fmt.title, cfg.fmt.headers, rows, { footer: fn.timestamp(now) });
    },
} as const;

// --- Entry Point -------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: ContentSpec }): Promise<void> => {
    const ctx = createCtx(params);
    const cfg = reportSpecs[params.spec.kind as keyof typeof reportSpecs];
    const now = new Date();
    const data = await dataSources[cfg.src.source](ctx, cfg, params.spec, params);
    const body =
        cfg.fmt.format === 'table' ? contentFormatters.table(cfg, data, now) : contentFormatters.body(cfg, params.spec);
    await outputHandlers[cfg.out.output](ctx, params, body, cfg, (params.spec as { number?: number }).number ?? 0);
    params.core.info(`${params.spec.kind} report generated`);
};

// --- Export ------------------------------------------------------------------

export { run };
