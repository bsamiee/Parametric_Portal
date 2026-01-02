/**
 * Browser telemetry layer factory for OTLP trace export.
 * Apps compose this layer to enable Effect span export to API proxy.
 */

import { Otlp } from '@effect/opentelemetry';
import { Layer } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type BrowserTelemetryConfig = {
    readonly apiUrl: string;
    readonly enabled: boolean;
    readonly serviceName: string;
};

// --- [FACTORIES] -------------------------------------------------------------

const createBrowserTelemetryLayer = (config: BrowserTelemetryConfig) =>
    config.enabled
        ? Otlp.layer({
              baseUrl: `${config.apiUrl}/v1`,
              resource: { serviceName: config.serviceName },
          })
        : Layer.empty;

// --- [EXPORT] ----------------------------------------------------------------

export { createBrowserTelemetryLayer };
export type { BrowserTelemetryConfig };
