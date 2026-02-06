import { McpServer, Toolkit } from '@effect/ai';
import { Array as A, Layer, Match, Option } from 'effect';

// --- [ENTRY_POINT] -----------------------------------------------------------

const Mcp = (() => {
    const transportLayer = (input: Mcp.Transport) =>
        Match.type<Mcp.Transport>().pipe(
            Match.tag('stdio', ({ options }) => McpServer.layerStdio(options)),
            Match.tag('http', ({ options }) => McpServer.layerHttp(options)),
            Match.tag('http-router', ({ options }) => McpServer.layerHttpRouter(options)),
            Match.exhaustive,
        )(input);
    const layer = (input: {
        readonly transport: Mcp.Transport;
        readonly toolkits?:
            | Parameters<typeof McpServer.toolkit>[0]
            | ReadonlyArray<Parameters<typeof McpServer.toolkit>[0]>
            | undefined;
        readonly layers?:
            | Layer.Layer<never, never, unknown>
            | ReadonlyArray<Layer.Layer<never, never, unknown>>
            | undefined;
    }) => {
        const base = transportLayer(input.transport);
        const toolkitLayers: ReadonlyArray<Layer.Layer<never, never, unknown>> = Option.fromNullable(
            input.toolkits,
        ).pipe(
            Option.map((toolkits) => (Array.isArray(toolkits) ? toolkits : [toolkits])),
            Option.filter(A.isNonEmptyReadonlyArray),
            Option.map((toolkits) => [McpServer.toolkit(Toolkit.merge(...toolkits))]),
            Option.getOrElse((): ReadonlyArray<Layer.Layer<never, never, unknown>> => []),
        );
        const extraLayers: ReadonlyArray<Layer.Layer<never, never, unknown>> = Option.fromNullable(
            input.layers,
        ).pipe(
            Option.map((layers) => (Array.isArray(layers) ? layers : [layers])),
            Option.getOrElse((): ReadonlyArray<Layer.Layer<never, never, unknown>> => []),
        );
        const layers: ReadonlyArray<Layer.Layer<never, never, unknown>> = A.appendAll(
            toolkitLayers,
            extraLayers,
        );
        return A.reduce(layers, base, (acc, layer) => Layer.merge(acc, layer));
    };
    return { layer } as const;
})();

// --- [NAMESPACE] -------------------------------------------------------------

namespace Mcp {
    export type Transport =
        | { readonly _tag: 'stdio'; readonly options: Parameters<typeof McpServer.layerStdio>[0] }
        | { readonly _tag: 'http'; readonly options: Parameters<typeof McpServer.layerHttp>[0] }
        | { readonly _tag: 'http-router'; readonly options: Parameters<typeof McpServer.layerHttpRouter>[0] };
}

// --- [EXPORT] ----------------------------------------------------------------

export { Mcp };
