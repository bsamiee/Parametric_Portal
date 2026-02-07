import type { Plugin } from 'vite';
import { Client } from './client.ts';
import { Domain } from './domain.ts';
import { ReactTools } from './react.ts';
import { Relay } from './relay.ts';

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const _vite = (input: unknown = {}): Array<Plugin> => {
    const config = Domain.normalizeVite(input);
    const virtualPlugin: Plugin = {
        apply: 'serve',
        load: (id) =>
            id === Domain._CONFIG.vite.virtualModule.resolvedId
                ? `export const __DEV__ = true;\nexport const __APP__ = '${config.app}';`
                : undefined,
        name: 'parametric-devtools-virtual',
        resolveId: (id) =>
            id === Domain._CONFIG.vite.virtualModule.id ? Domain._CONFIG.vite.virtualModule.resolvedId : undefined,
    };
    return [virtualPlugin];
};

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const Devtools = {
    bootstrap: { create: ReactTools.createBootstrap, whenReady: ReactTools.whenReady },
    Error: Domain.Error,
    react: { Boundary: ReactTools.Boundary, Provider: ReactTools.Provider, use: ReactTools.use },
    relay: { http: Relay.http, run: Relay.run },
    Schema: Domain.Schema,
    session: Client.session,
    sessionEffect: Client.make,
    vite: _vite,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Devtools {
    export type BootstrapConfig = Parameters<typeof ReactTools.createBootstrap>[0];
    export type Context = typeof Domain.Schema.Context.Type;
    export type LogEntry = typeof Domain.Schema.LogEntry.Type;
    export type RelayConfig = typeof Domain.Schema.RelayConfig.Type;
    export type RelayEnvelope = typeof Domain.Schema.RelayEnvelope.Type;
    export type Session = ReturnType<typeof Client.session>;
    export type SessionConfig = typeof Domain.Schema.SessionConfig.Type;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Devtools };
