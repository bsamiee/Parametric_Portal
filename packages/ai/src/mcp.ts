import { McpServer } from '@effect/ai';
import { Array as A, Layer, Match, Option, pipe } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {transport: { http: 'http', httpRouter: 'http-router', stdio: 'stdio' },} as const;

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Mcp = (() => {
    type Transport =
        | { readonly _tag: typeof _CONFIG.transport.stdio; readonly options: Parameters<typeof McpServer.layerStdio>[0] }
        | { readonly _tag: typeof _CONFIG.transport.http; readonly options: Parameters<typeof McpServer.layerHttp>[0] }
        | { readonly _tag: typeof _CONFIG.transport.httpRouter; readonly options: Parameters<typeof McpServer.layerHttpRouter>[0] };
    const isArray = <A>(value: A | ReadonlyArray<A>): value is ReadonlyArray<A> => Array.isArray(value);
    const normalize = <A>(input: A | ReadonlyArray<A> | undefined): ReadonlyArray<A> =>
        Option.match(Option.fromNullable(input), {
            onNone: () => [],
            onSome: (value) => (isArray(value) ? value : [value]),
        });
    const transport = {
        http: (options: Parameters<typeof McpServer.layerHttp>[0]) => ({ _tag: _CONFIG.transport.http, options }),
        httpRouter: (options: Parameters<typeof McpServer.layerHttpRouter>[0]) => ({ _tag: _CONFIG.transport.httpRouter, options }),
        stdio: (options: Parameters<typeof McpServer.layerStdio>[0]) => ({ _tag: _CONFIG.transport.stdio, options }),
    } as const;
    const transportLayer = (input: Transport) =>
        Match.value(input).pipe(
            Match.tag(_CONFIG.transport.stdio, ({ options }) => McpServer.layerStdio(options)),
            Match.tag(_CONFIG.transport.http, ({ options }) => McpServer.layerHttp(options)),
            Match.tag(_CONFIG.transport.httpRouter, ({ options }) => McpServer.layerHttpRouter(options)),
            Match.exhaustive,
        );
    const layer = (input: {
        readonly transport: Transport;
        readonly toolkits?: Parameters<typeof McpServer.toolkit>[0] | ReadonlyArray<Parameters<typeof McpServer.toolkit>[0]> | undefined;
        readonly layers?: Layer.Layer<never, never, unknown> | ReadonlyArray<Layer.Layer<never, never, unknown>> | undefined;}) => {
        const base = transportLayer(input.transport);
        const toolkitLayers = pipe(
            normalize(input.toolkits),
            A.map((toolkit): Layer.Layer<never, never, unknown> => McpServer.toolkit(toolkit)),
        );
        const extraLayers = normalize(input.layers);
        const layers: ReadonlyArray<Layer.Layer<never, never, unknown>> = A.appendAll(toolkitLayers, extraLayers);
        return A.reduce(layers, base, (acc, layer) => Layer.merge(acc, layer));
    };
    return { layer, transport } as const;
})();

// --- [NAMESPACE] -------------------------------------------------------------

namespace Mcp {
    export type Transport = Parameters<typeof Mcp.layer>[0]['transport'];
}

// --- [EXPORT] ----------------------------------------------------------------

export { Mcp };
