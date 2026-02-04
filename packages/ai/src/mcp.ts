import { McpServer } from '@effect/ai';
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
        readonly toolkits?: ReadonlyArray<Parameters<typeof McpServer.toolkit>[0]> | undefined;
        readonly layers?: ReadonlyArray<Layer.Layer<never, never, unknown>> | undefined;
    }) => {
        const base = transportLayer(input.transport);
        const toolkitLayers = Option.fromNullable(input.toolkits).pipe(
            Option.map((toolkits) => toolkits.map((tk) => McpServer.toolkit(tk))),
            Option.getOrElse(() => []),
        );
        const extraLayers = Option.fromNullable(input.layers).pipe(Option.getOrElse(() => []));
        const layers = A.appendAll(toolkitLayers, extraLayers);
        return Match.value(layers).pipe(
            Match.when(A.isNonEmptyReadonlyArray, (rest) =>
                Layer.mergeAll(
                    base,
                    ...(rest as [Layer.Layer<never, never, unknown>, ...Layer.Layer<never, never, unknown>[]]),
                ),
            ),
            Match.orElse(() => base),
        );
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
