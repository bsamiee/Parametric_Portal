/**
 * Render debug overlay for pre-hydration errors via React component or imperative HTML.
 */
import { Option, pipe } from 'effect';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import type { LogEntry, LogLevelKey, OverlayConfig } from './types.ts';
import { formatDuration, formatLogEntry } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type DebugOverlayProps = {
    readonly context?: Readonly<Record<string, unknown>> | undefined;
    readonly env: string;
    readonly error: Error;
    readonly logs: ReadonlyArray<LogEntry>;
    readonly startTime: number;
};

type OverlayContextValue = {
    readonly hide: () => void;
    readonly show: (props: DebugOverlayProps) => void;
    readonly visible: boolean;
};

type DebugOverlayProviderProps = {
    readonly children: ReactNode;
    readonly config?: OverlayConfig;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    colors: {
        bg: 'oklch(0.12 0.02 260)',
        errorBorder: 'oklch(0.55 0.25 25)',
        errorColor: 'oklch(0.70 0.20 25)',
        infoBorder: 'oklch(0.50 0.20 260)',
        infoColor: 'oklch(0.75 0.15 260)',
        preBg: 'oklch(0.15 0.02 260)',
        successColor: 'oklch(0.70 0.20 145)',
        text: '#fff',
        textMuted: 'oklch(0.70 0.02 260)',
        warnColor: 'oklch(0.75 0.20 85)',
    },
    font: {
        mono: 'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", monospace',
    },
    layout: {
        accentBorder: '4px',
        borderRadius: '8px',
        cardMinWidth: '200px',
        fontSize: { h1: '1.5rem', h2: '1rem', label: '0.75rem', logEntry: '0.8rem', stackTrace: '0.85rem' },
        fontWeight: { bold: 600 },
        lineHeight: 1.6,
        logMaxHeight: '400px',
        maxWidth: '900px',
        padding: '2rem',
        spacing: { lg: '1.5rem', md: '1rem', sm: '0.5rem', xs: '0.25rem' },
    },
    levelColors: {
        Debug: 'oklch(0.70 0.02 260)',
        Error: 'oklch(0.70 0.20 25)',
        Fatal: 'oklch(0.55 0.25 25)',
        Info: 'oklch(0.75 0.15 260)',
        Warning: 'oklch(0.75 0.20 85)',
    } satisfies Record<LogLevelKey, string>,
    text: {
        emptyLogs: 'No logs captured',
        noStack: 'No stack trace available',
        title: 'Application Failed to Load',
    },
} as const);

// --- [DISPATCH_TABLES] -------------------------------------------------------

const getLevelColor = (level: LogLevelKey): string => B.levelColors[level];

const mergeColors = (override?: OverlayConfig['colors']): Record<keyof typeof B.colors, string> => ({
    ...B.colors,
    ...override,
});

// --- [CONTEXT] ---------------------------------------------------------------

const OverlayContext = createContext<OverlayContextValue | null>(null);

// --- [COMPONENTS] ------------------------------------------------------------

const DebugOverlay = ({ context, env, error, logs, startTime }: DebugOverlayProps): ReactNode => {
    const elapsed = formatDuration(performance.now() - startTime);
    const { colors, font, layout, text } = B;

    const contextHtml = context ? (
        <details style={{ marginTop: layout.spacing.md }}>
            <summary style={{ color: colors.infoColor, cursor: 'pointer' }}>Context Data</summary>
            <pre
                style={{
                    background: colors.preBg,
                    borderRadius: layout.borderRadius,
                    marginTop: layout.spacing.sm,
                    overflowX: 'auto',
                    padding: layout.spacing.md,
                }}
            >
                {JSON.stringify(context, null, 2)}
            </pre>
        </details>
    ) : null;

    return (
        <div
            style={{
                background: colors.bg,
                color: colors.text,
                fontFamily: font.mono,
                lineHeight: layout.lineHeight,
                minHeight: '100vh',
                padding: layout.padding,
            }}
        >
            <div style={{ margin: '0 auto', maxWidth: layout.maxWidth }}>
                <h1
                    style={{
                        borderLeft: `${layout.accentBorder} solid ${colors.errorBorder}`,
                        color: colors.errorColor,
                        fontSize: layout.fontSize.h1,
                        margin: `0 0 ${layout.spacing.lg}`,
                        paddingLeft: layout.spacing.md,
                    }}
                >
                    {text.title}
                </h1>

                <div
                    style={{
                        background: colors.preBg,
                        borderLeft: `${layout.accentBorder} solid ${colors.errorBorder}`,
                        borderRadius: `0 ${layout.borderRadius} ${layout.borderRadius} 0`,
                        marginBottom: layout.spacing.lg,
                        padding: layout.spacing.lg,
                    }}
                >
                    <div
                        style={{
                            color: colors.errorColor,
                            fontWeight: layout.fontWeight.bold,
                            marginBottom: layout.spacing.sm,
                        }}
                    >
                        {error.name}
                    </div>
                    <div style={{ color: colors.text, marginBottom: layout.spacing.md }}>{error.message}</div>
                    <pre
                        style={{
                            color: colors.textMuted,
                            fontSize: layout.fontSize.stackTrace,
                            margin: 0,
                            overflowX: 'auto',
                            whiteSpace: 'pre-wrap',
                        }}
                    >
                        {error.stack ?? text.noStack}
                    </pre>
                </div>

                <div
                    style={{
                        display: 'grid',
                        gap: layout.spacing.md,
                        gridTemplateColumns: `repeat(auto-fit, minmax(${layout.cardMinWidth}, 1fr))`,
                        marginBottom: layout.spacing.lg,
                    }}
                >
                    <div
                        style={{
                            background: colors.preBg,
                            borderRadius: layout.borderRadius,
                            padding: layout.spacing.md,
                        }}
                    >
                        <div
                            style={{
                                color: colors.textMuted,
                                fontSize: layout.fontSize.label,
                                marginBottom: layout.spacing.xs,
                                textTransform: 'uppercase',
                            }}
                        >
                            Environment
                        </div>
                        <div style={{ color: colors.infoColor, fontWeight: layout.fontWeight.bold }}>{env}</div>
                    </div>
                    <div
                        style={{
                            background: colors.preBg,
                            borderRadius: layout.borderRadius,
                            padding: layout.spacing.md,
                        }}
                    >
                        <div
                            style={{
                                color: colors.textMuted,
                                fontSize: layout.fontSize.label,
                                marginBottom: layout.spacing.xs,
                                textTransform: 'uppercase',
                            }}
                        >
                            Time Elapsed
                        </div>
                        <div style={{ color: colors.warnColor, fontWeight: layout.fontWeight.bold }}>{elapsed}</div>
                    </div>
                    <div
                        style={{
                            background: colors.preBg,
                            borderRadius: layout.borderRadius,
                            padding: layout.spacing.md,
                        }}
                    >
                        <div
                            style={{
                                color: colors.textMuted,
                                fontSize: layout.fontSize.label,
                                marginBottom: layout.spacing.xs,
                                textTransform: 'uppercase',
                            }}
                        >
                            Log Entries
                        </div>
                        <div style={{ color: colors.successColor, fontWeight: layout.fontWeight.bold }}>
                            {logs.length}
                        </div>
                    </div>
                </div>

                {contextHtml}

                <div style={{ marginTop: layout.spacing.lg }}>
                    <h2
                        style={{
                            color: colors.infoColor,
                            fontSize: layout.fontSize.h2,
                            margin: `0 0 ${layout.spacing.md}`,
                        }}
                    >
                        Debug Log
                    </h2>
                    <div
                        style={{
                            background: colors.preBg,
                            borderRadius: layout.borderRadius,
                            maxHeight: layout.logMaxHeight,
                            overflowY: 'auto',
                            padding: layout.spacing.md,
                        }}
                    >
                        {logs.length === 0 ? (
                            <div style={{ color: colors.textMuted }}>{text.emptyLogs}</div>
                        ) : (
                            logs.map((entry) => (
                                <div
                                    key={`${entry.timestamp.getTime()}-${entry.fiberId}`}
                                    style={{
                                        borderBottom: `1px solid ${colors.bg}`,
                                        color: getLevelColor(entry.level),
                                        fontSize: layout.fontSize.logEntry,
                                        padding: `${layout.spacing.xs} 0`,
                                    }}
                                >
                                    {formatLogEntry(entry)}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

const DebugOverlayProvider = ({ children }: DebugOverlayProviderProps): ReactNode => {
    const [state, setState] = useState<{ props: DebugOverlayProps; visible: boolean }>({
        props: { env: 'unknown', error: new Error('No error'), logs: [], startTime: performance.now() },
        visible: false,
    });

    const hide = useCallback(() => setState((prev) => ({ ...prev, visible: false })), []);
    const show = useCallback((props: DebugOverlayProps) => setState({ props, visible: true }), []);

    const contextValue: OverlayContextValue = useMemo(
        () => ({ hide, show, visible: state.visible }),
        [hide, show, state.visible],
    );

    return (
        <OverlayContext.Provider value={contextValue}>
            {state.visible ? <DebugOverlay {...state.props} /> : children}
        </OverlayContext.Provider>
    );
};

const useDebugOverlay = (): OverlayContextValue =>
    pipe(
        Option.fromNullable(useContext(OverlayContext)),
        Option.getOrThrowWith(() => new Error('useDebugOverlay must be used within DebugOverlayProvider')),
    );

// --- [IMPERATIVE] ------------------------------------------------------------

const renderDebugOverlay = (props: DebugOverlayProps): void => {
    const root = document.getElementById('root');
    const { colors, font, layout, text } = B;
    const elapsed = formatDuration(performance.now() - props.startTime);

    const contextHtml = props.context
        ? `<details style="margin-top:${layout.spacing.md};">
            <summary style="cursor:pointer;color:${colors.infoColor};">Context Data</summary>
            <pre style="background:${colors.preBg};padding:${layout.spacing.md};border-radius:${layout.borderRadius};margin-top:${layout.spacing.sm};overflow-x:auto;">${JSON.stringify(props.context, null, 2)}</pre>
           </details>`
        : '';

    const html = `
        <div style="font-family:${font.mono};padding:${layout.padding};background:${colors.bg};color:${colors.text};min-height:100vh;line-height:${layout.lineHeight};">
            <div style="max-width:${layout.maxWidth};margin:0 auto;">
                <h1 style="color:${colors.errorColor};margin:0 0 ${layout.spacing.lg};font-size:${layout.fontSize.h1};border-left:${layout.accentBorder} solid ${colors.errorBorder};padding-left:${layout.spacing.md};">${text.title}</h1>

                <div style="background:${colors.preBg};border-left:${layout.accentBorder} solid ${colors.errorBorder};padding:${layout.spacing.lg};border-radius:0 ${layout.borderRadius} ${layout.borderRadius} 0;margin-bottom:${layout.spacing.lg};">
                    <div style="color:${colors.errorColor};font-weight:${layout.fontWeight.bold};margin-bottom:${layout.spacing.sm};">${props.error.name}</div>
                    <div style="color:${colors.text};margin-bottom:${layout.spacing.md};">${props.error.message}</div>
                    <pre style="color:${colors.textMuted};font-size:${layout.fontSize.stackTrace};overflow-x:auto;white-space:pre-wrap;margin:0;">${props.error.stack ?? text.noStack}</pre>
                </div>

                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(${layout.cardMinWidth},1fr));gap:${layout.spacing.md};margin-bottom:${layout.spacing.lg};">
                    <div style="background:${colors.preBg};padding:${layout.spacing.md};border-radius:${layout.borderRadius};">
                        <div style="color:${colors.textMuted};font-size:${layout.fontSize.label};text-transform:uppercase;margin-bottom:${layout.spacing.xs};">Environment</div>
                        <div style="color:${colors.infoColor};font-weight:${layout.fontWeight.bold};">${props.env}</div>
                    </div>
                    <div style="background:${colors.preBg};padding:${layout.spacing.md};border-radius:${layout.borderRadius};">
                        <div style="color:${colors.textMuted};font-size:${layout.fontSize.label};text-transform:uppercase;margin-bottom:${layout.spacing.xs};">Time Elapsed</div>
                        <div style="color:${colors.warnColor};font-weight:${layout.fontWeight.bold};">${elapsed}</div>
                    </div>
                    <div style="background:${colors.preBg};padding:${layout.spacing.md};border-radius:${layout.borderRadius};">
                        <div style="color:${colors.textMuted};font-size:${layout.fontSize.label};text-transform:uppercase;margin-bottom:${layout.spacing.xs};">Log Entries</div>
                        <div style="color:${colors.successColor};font-weight:${layout.fontWeight.bold};">${props.logs.length}</div>
                    </div>
                </div>

                ${contextHtml}

                <div style="margin-top:${layout.spacing.lg};">
                    <h2 style="color:${colors.infoColor};margin:0 0 ${layout.spacing.md};font-size:${layout.fontSize.h2};">Debug Log</h2>
                    <div style="background:${colors.preBg};border-radius:${layout.borderRadius};padding:${layout.spacing.md};max-height:${layout.logMaxHeight};overflow-y:auto;">
                        ${props.logs.length === 0 ? `<div style="color:${colors.textMuted};">${text.emptyLogs}</div>` : props.logs.map((entry) => `<div style="color:${getLevelColor(entry.level)};font-size:${layout.fontSize.logEntry};padding:${layout.spacing.xs} 0;border-bottom:1px solid ${colors.bg};">${formatLogEntry(entry)}</div>`).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;

    pipe(
        Option.fromNullable(root),
        Option.map((el) => {
            el.innerHTML = html;
            return el;
        }),
    );
};

// --- [EXPORT] ----------------------------------------------------------------

export type { DebugOverlayProps, DebugOverlayProviderProps, OverlayContextValue };
export {
    B as OVERLAY_TUNING,
    DebugOverlay,
    DebugOverlayProvider,
    getLevelColor,
    mergeColors,
    renderDebugOverlay,
    useDebugOverlay,
};
