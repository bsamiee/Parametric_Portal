import { McpServer, type Toolkit } from '@effect/ai';
import { Array as A, Layer, Match, Option } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
    transport: { http: 'http', httpRouter: 'http-router', stdio: 'stdio' },
} as const;

// --- [ENTRY_POINT] -----------------------------------------------------------

const Mcp = (() => {
    const transportLayer = (
        input:
            | {
                  readonly _tag: typeof _CONFIG.transport.stdio;
                  readonly options: Parameters<typeof McpServer.layerStdio>[0];
              }
            | {
                  readonly _tag: typeof _CONFIG.transport.http;
                  readonly options: Parameters<typeof McpServer.layerHttp>[0];
              }
            | {
                  readonly _tag: typeof _CONFIG.transport.httpRouter;
                  readonly options: Parameters<typeof McpServer.layerHttpRouter>[0];
              },
    ) =>
        Match.value(input._tag).pipe(
            Match.when(_CONFIG.transport.stdio, () => McpServer.layerStdio(input.options)),
            Match.when(_CONFIG.transport.http, () => McpServer.layerHttp(input.options)),
            Match.when(_CONFIG.transport.httpRouter, () => McpServer.layerHttpRouter(input.options)),
            Match.exhaustive,
        );
    const layer = (input: {
        readonly transport:
            | {
                  readonly _tag: typeof _CONFIG.transport.stdio;
                  readonly options: Parameters<typeof McpServer.layerStdio>[0];
              }
            | {
                  readonly _tag: typeof _CONFIG.transport.http;
                  readonly options: Parameters<typeof McpServer.layerHttp>[0];
              }
            | {
                  readonly _tag: typeof _CONFIG.transport.httpRouter;
                  readonly options: Parameters<typeof McpServer.layerHttpRouter>[0];
              };
        readonly toolkits?: ReadonlyArray<Toolkit.Toolkit> | undefined;
        readonly layers?: ReadonlyArray<Layer.Layer<never, never, unknown>> | undefined;
    }) => {
        const base = transportLayer(input.transport);
        const toolkitLayers = Option.fromNullable(input.toolkits).pipe(
            Option.map((toolkits) => toolkits.map(McpServer.toolkit)),
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

// --- [EXPORT] ----------------------------------------------------------------

export { Mcp };
