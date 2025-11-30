#!/usr/bin/env tsx
/**
 * Config-driven report generator with source→format→output pipeline.
 * Dispatches to row builders (count, list) and output targets (summary, comment, issue).
 */

import { type Ctx, call, createCtx, fn, type Issue, type LabelCat, mutate, type RunParams } from './schema.ts';

// --- Types ------------------------------------------------------------------

type ContentSpec = { readonly kind: string } & Record<string, unknown>;
type ContentConfig = {
    readonly src: { readonly s: 'fetch'; readonly op: string; readonly a?: ReadonlyArray<unknown> };
    readonly fmt: { readonly f: 'table'; readonly t: string; readonly h: ReadonlyArray<string> };
    readonly out: {
        readonly o: 'summary' | 'comment' | 'issue';
        readonly m?: string;
        readonly p?: string;
        readonly l?: ReadonlyArray<string>;
        readonly t?: string;
    };
    readonly filters?: ReadonlyArray<{ readonly l: string; readonly cat: LabelCat; readonly idx?: number }>;
    readonly row?: 'count' | 'list';
};

// --- Config -----------------------------------------------------------------

const CONTENT: Record<string, ContentConfig> = Object.freeze({
    aging: {
        filters: [
            { cat: 'priority', l: 'Critical' },
            { cat: 'lifecycle', idx: 1, l: 'Stale' },
        ],
        fmt: { f: 'table', h: ['Category', 'Count'], t: 'Issue Aging Report' },
        out: { o: 'summary' },
        row: 'count',
        src: { a: ['open'], op: 'issue.list', s: 'fetch' },
    },
} as const);

// --- Sources ----------------------------------------------------------------

type SourceFn = (ctx: Ctx, cfg: ContentConfig, spec: ContentSpec, p: RunParams) => Promise<unknown>;

const sources: Record<string, SourceFn> = {
    fetch: async (ctx, cfg) => call(ctx, cfg.src.op, ...(cfg.src.a ?? [])),
    params: async (_, __, spec) => Promise.resolve(spec),
    payload: async (_, __, ___, p) => Promise.resolve(p.context.payload),
};

// --- Builders ---------------------------------------------------------------

const buildRows = (cfg: ContentConfig, data: unknown): ReadonlyArray<ReadonlyArray<string>> => {
    const builders: Record<string, () => ReadonlyArray<ReadonlyArray<string>>> = {
        count: () => fn.rowsCount(data as ReadonlyArray<Issue>, cfg.filters ?? []),
        list: () => (data as ReadonlyArray<Record<string, unknown>>).map((r) => Object.values(r).map(String)),
    };
    return builders[cfg.row ?? 'list']();
};

// --- Outputs ----------------------------------------------------------------

const outputs = {
    comment: async (ctx: Ctx, _: RunParams, body: string, cfg: ContentConfig, n: number): Promise<void> => {
        await mutate(ctx, {
            body,
            marker: cfg.out.m ?? '',
            n,
            t: 'comment',
        });
    },
    issue: async (ctx: Ctx, _: RunParams, body: string, cfg: ContentConfig): Promise<void> => {
        await mutate(ctx, {
            body,
            label: cfg.out.l?.[0] ?? '',
            labels: [...(cfg.out.l ?? [])],
            pattern: cfg.out.p ?? '',
            t: 'issue',
            title: cfg.out.t ?? cfg.fmt.t,
        });
    },
    summary: async (_: Ctx, p: RunParams, body: string): Promise<void> => {
        p.core.summary.addRaw(body).write();
    },
} as const;

// --- Formatters -------------------------------------------------------------

const formatters = {
    body: (_cfg: ContentConfig, spec: ContentSpec): string => fn.body([], spec as Record<string, string>),
    table: (cfg: ContentConfig, data: unknown, now: Date): string => {
        const rows = buildRows(cfg, data);
        return fn.report(cfg.fmt.t, cfg.fmt.h, rows, { footer: fn.timestamp(now) });
    },
} as const;

// --- Entry Point ------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: ContentSpec }): Promise<void> => {
    const ctx = createCtx(params);
    const cfg = CONTENT[params.spec.kind as keyof typeof CONTENT];
    const now = new Date();
    const data = await sources[cfg.src.s](ctx, cfg, params.spec, params);
    const body = cfg.fmt.f === 'table' ? formatters.table(cfg, data, now) : formatters.body(cfg, params.spec);
    await outputs[cfg.out.o](ctx, params, body, cfg, (params.spec as { n?: number }).n ?? 0);
    params.core.info(`${params.spec.kind} report generated`);
};

// --- Export -----------------------------------------------------------------

export { run };
