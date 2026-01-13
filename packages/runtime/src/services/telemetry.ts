/**
 * Browser telemetry layer factory for OTLP trace export to API proxy.
 */

import { layer } from '@effect/opentelemetry/Otlp';
import { Layer } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type BrowserTelemetryConfig = {
    readonly apiUrl: string;
    readonly enabled: boolean;
    readonly serviceName: string;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createBrowserTelemetryLayer = (config: BrowserTelemetryConfig) =>
    config.enabled
        ? layer({
              baseUrl: `${config.apiUrl}/v1`,
              resource: { serviceName: config.serviceName },
          })
        : Layer.empty;

// --- [EXPORT] ----------------------------------------------------------------

export { createBrowserTelemetryLayer };
export type { BrowserTelemetryConfig };
