#!/usr/bin/env tsx
/**
 * Report Script - Universal Content Generation
 * Orchestrates reports via config-driven STO (Source → Transform → Output) architecture
 *
 * @module report
 */

import {
    B,
    type ContentConfig,
    type ContentSpec,
    type Ctx,
    call,
    createCtx,
    fn,
    type Issue,
    mutate,
    type Pkg,
    type RunParams,
    type Sizes,
    type U,
} from './schema.ts';

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

const buildRows = (cfg: ContentConfig, data: unknown, spec: ContentSpec): ReadonlyArray<ReadonlyArray<string>> => {
    const T = B.thresholds.bundleKb * 1024;
    const bundleRow = (c: Pkg, p: Pkg): ReadonlyArray<string> => [
        `${fn.status(c.gzip - p.gzip, T)} ${c.name}`,
        fn.size(c.raw),
        fn.size(c.gzip),
        fn.size(c.brotli),
        fn.diff(c.gzip, p.gzip),
    ];
    const builders: Record<string, () => ReadonlyArray<ReadonlyArray<string>>> = {
        count: () =>
            fn.rowsCount(
                data as ReadonlyArray<Issue>,
                (cfg.filters as ReadonlyArray<{ l: string; s: LabelFilter }>).map(({ l, s }) => ({ l, s })),
            ),
        diff: () =>
            fn.rowsDiff(
                (spec as unknown as { pr: Sizes }).pr.packages,
                (spec as unknown as { base: Sizes }).base.packages,
                bundleRow,
                cfg.default as Pkg,
            ),
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
            marker: B.gen.marker((cfg.out as CommentOut).m),
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
    table: (cfg: ContentConfig, data: unknown, now: Date, spec: ContentSpec): string =>
        ((rows) =>
            ((fmt) =>
                ((marker) =>
                    fn.report(fmt.t, fmt.h, rows, {
                        footer:
                            fmt.w && rows.some((r) => r[0]?.includes(B.gen.status.warn)) && marker
                                ? `${marker}\n\n${B.gen.alert('warning', fmt.w)}`
                                : (marker ?? fn.timestamp(now)),
                    }))(cfg.out.o === 'comment' ? B.gen.marker((cfg.out as CommentOut).m) : undefined))(
                cfg.fmt as TableFmt,
            ))(buildRows(cfg, data, spec)),
} as const;

// --- Entry Point ------------------------------------------------------------

const run = async (params: RunParams & { readonly spec: ContentSpec }): Promise<void> => {
    const ctx = createCtx(params);
    const cfg = B.content[params.spec.kind as keyof typeof B.content] as unknown as ContentConfig;
    const now = new Date();
    const data = await sources[cfg.src.s](ctx, cfg, params.spec, params);
    const body =
        cfg.fmt.f === 'table' ? formatters.table(cfg, data, now, params.spec) : formatters.body(cfg, params.spec);
    await outputs[cfg.out.o](ctx, params, body, cfg, (params.spec as { n?: number }).n ?? 0);
    params.core.info(`${params.spec.kind} report generated`);
};

// --- Export -----------------------------------------------------------------

export { run };
