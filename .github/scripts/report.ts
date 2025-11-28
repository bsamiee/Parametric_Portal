#!/usr/bin/env tsx
/**
 * Config-driven report generator with source→format→output pipeline.
 * Dispatches to row builders (count, list) and output targets (summary, comment, issue).
 */

import {
    type ContentConfig,
    type ContentSpec,
    type Ctx,
    call,
    createCtx,
    fn,
    type Issue,
    mutate,
    type RunParams,
    type U,
} from './schema.ts';

// --- Content Config (report-specific) ---------------------------------------

const CONTENT = Object.freeze({
    aging: {
        filters: [
            { l: 'Critical', s: { cat: 'priority', kind: 'label' } },
            { l: 'Stale', s: { cat: 'lifecycle', idx: 1, kind: 'label' } },
        ],
        fmt: { f: 'table', h: ['Category', 'Count'], t: 'Issue Aging Report' },
        out: { o: 'summary' },
        row: 'count',
        src: { a: ['open'], op: 'issue.list', s: 'fetch' },
    },
} as const);

// --- Source Dispatch --------------------------------------------------------

type FetchSrc = Extract<U<'source'>, { s: 'fetch' }>;

const sources = {
    fetch: async (ctx: Ctx, cfg: ContentConfig): Promise<unknown> =>
        call(ctx, (cfg.src as FetchSrc).op, ...((cfg.src as FetchSrc).a ?? [])),
    params: async (_: Ctx, __: ContentConfig, spec: ContentSpec): Promise<unknown> => Promise.resolve(spec),
    payload: async (_: Ctx, __: ContentConfig, ___: ContentSpec, p: RunParams): Promise<unknown> =>
        Promise.resolve(p.context.payload),
} as const;

// --- Row Builders -----------------------------------------------------------

type LabelFilter = Extract<U<'filter'>, { kind: 'label' }>;

const buildRows = (cfg: ContentConfig, data: unknown): ReadonlyArray<ReadonlyArray<string>> => {
    const builders: Record<string, () => ReadonlyArray<ReadonlyArray<string>>> = {
        count: () =>
            fn.rowsCount(data as ReadonlyArray<Issue>, cfg.filters as ReadonlyArray<{ l: string; s: LabelFilter }>),
        list: () => fn.rowsList(data as ReadonlyArray<Record<string, unknown>>),
    };
    return builders[cfg.row ?? 'list']();
};

// --- Output Dispatch --------------------------------------------------------

type CommentOut = Extract<U<'output'>, { o: 'comment' }>;
type IssueOut = Extract<U<'output'>, { o: 'issue' }>;
type TableFmt = Extract<U<'format'>, { f: 'table' }>;

const outputs = {
    comment: async (ctx: Ctx, _: RunParams, body: string, cfg: ContentConfig, n: number): Promise<void> => {
        await mutate(ctx, {
            body,
            marker: (cfg.out as CommentOut).m,
            n,
            t: 'comment',
        });
    },
    issue: async (ctx: Ctx, _: RunParams, body: string, cfg: ContentConfig): Promise<void> => {
        const out = cfg.out as IssueOut;
        const fmt = cfg.fmt as TableFmt;
        await mutate(ctx, {
            body,
            label: out.l[0],
            labels: [...out.l],
            pattern: out.p,
            t: 'issue',
            title: out.t ?? fmt.t,
        });
    },
    summary: async (_: Ctx, p: RunParams, body: string): Promise<void> => {
        p.core.summary.addRaw(body).write();
    },
} as const;

// --- Format Dispatch --------------------------------------------------------

type BodyFmt = Extract<U<'format'>, { f: 'body' }>;

const formatters = {
    body: (cfg: ContentConfig, spec: ContentSpec): string =>
        fn.body((cfg.fmt as BodyFmt).b, spec as Record<string, string>),
    table: (cfg: ContentConfig, data: unknown, now: Date): string => {
        const rows = buildRows(cfg, data);
        const fmt = cfg.fmt as TableFmt;
        return fn.report(fmt.t, fmt.h, rows, { footer: fn.timestamp(now) });
    },
} as const;

// --- Entry Point ------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: ContentSpec }): Promise<void> => {
    const ctx = createCtx(params);
    const cfg = CONTENT[params.spec.kind as keyof typeof CONTENT] as unknown as ContentConfig;
    const now = new Date();
    const data = await sources[cfg.src.s](ctx, cfg, params.spec, params);
    const body = cfg.fmt.f === 'table' ? formatters.table(cfg, data, now) : formatters.body(cfg, params.spec);
    await outputs[cfg.out.o](ctx, params, body, cfg, (params.spec as { n?: number }).n ?? 0);
    params.core.info(`${params.spec.kind} report generated`);
};

// --- Export -----------------------------------------------------------------

export { run };
