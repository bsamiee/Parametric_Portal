import { McpServer } from '@effect/ai';
import { Array as A, Data, Layer, Match } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type _Transport = Data.TaggedEnum<{
    readonly Stdio:      { readonly options: Parameters<typeof McpServer.layerStdio>[0]      };
    readonly Http:       { readonly options: Parameters<typeof McpServer.layerHttp>[0]       };
    readonly HttpRouter: { readonly options: Parameters<typeof McpServer.layerHttpRouter>[0] };
}>;

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Mcp = {
    ...Data.taggedEnum<_Transport>(),
    layer: (input: {
        readonly transport: _Transport;
        readonly toolkits?: Parameters<typeof McpServer.toolkit>[0] | ReadonlyArray<Parameters<typeof McpServer.toolkit>[0]>;
        readonly layers?:   Layer.Layer<never, never, unknown> | ReadonlyArray<Layer.Layer<never, never, unknown>>;
    }) =>
        A.reduce(
            A.appendAll(
                A.ensure(input.toolkits ?? []).map((t): Layer.Layer<never, never, unknown> => McpServer.toolkit(t)),
                A.ensure(input.layers ?? []),
            ),
            Match.valueTags(input.transport, {
                Http:       ({ options }) => McpServer.layerHttp(options),
                HttpRouter: ({ options }) => McpServer.layerHttpRouter(options),
                Stdio:      ({ options }) => McpServer.layerStdio(options),
            }),
            (acc, layer) => Layer.merge(acc, layer),
        )
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Mcp {
    export type Transport = Parameters<typeof Mcp.layer>[0]['transport'];
}

// --- [EXPORT] ----------------------------------------------------------------

export { Mcp };
