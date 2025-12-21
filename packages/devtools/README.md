# [H1][DEVTOOLS]
>**Dictum:** *Effect-integrated debugging infrastructure captures errors before React hydration.*

<br>

React 19 debugging toolkit with Effect logger pipelines, console interception, performance metrics, and pre-hydration error overlay.

---
## [1][INSTALLATION]
>**Dictum:** *Single dependency enables full debugging infrastructure.*

<br>

```bash
pnpm add @parametric-portal/devtools
```

---
## [2][QUICK_START]
>**Dictum:** *Bootstrap pipeline initializes logging before module loading.*

<br>

```typescript
import { createLoggerLayer } from '@parametric-portal/devtools/logger';
import { createMain, initWhenReady } from '@parametric-portal/devtools/bootstrap';
import { installGlobalHandlers } from '@parametric-portal/devtools/handlers';
import { renderDebugOverlay } from '@parametric-portal/devtools/overlay';

const { layer: loggerLayer, logs } = createLoggerLayer({ logLevel: 'Debug' });

const { init } = createMain({
    appModule: () => import('./app'),
    appName: 'MyApp',
    isDev: import.meta.env.DEV,
    loggerLayer,
    onError: (error, ctx) => renderDebugOverlay({ error, logs, env: 'dev', startTime }),
    onFatal: (error) => renderDebugOverlay({ error, logs, env: 'dev', startTime }),
    startTime: performance.now(),
});

installGlobalHandlers({ loggerLayer, onError: renderDebugOverlay });
initWhenReady(init, loggerLayer);
```

---
## [3][BOOTSTRAP]
>**Dictum:** *Effect pipelines sequence module loading with structured logging.*

<br>

### [3.1][FACTORY]

```typescript
import { createBootstrap, createMain, initWhenReady } from '@parametric-portal/devtools/bootstrap';
import { BOOTSTRAP_TUNING } from '@parametric-portal/devtools/bootstrap';

const { bootstrap } = createBootstrap({
    appModule: () => import('./app'),
    cssModule: () => import('./main.css'),
    isDev: true,
    loggerLayer,
    onError,
    rootId: 'root',
    verifyDelayMs: 100,
});

Effect.runFork(bootstrap());
```

---
### [3.2][API_MEMBERS]

| [INDEX] | [MEMBER]          | [TYPE]                                    | [PURPOSE]                |
| :-----: | ----------------- | ----------------------------------------- | ------------------------ |
|   [1]   | `createBootstrap` | `(config) => { bootstrap: Effect<void> }` | Module loading pipeline  |
|   [2]   | `createMain`      | `(config) => { init, main }`              | Full init orchestration  |
|   [3]   | `initWhenReady`   | `(init, loggerLayer) => void`             | DOMContentLoaded handler |
|   [4]   | `loadModule`      | `(name, loader) => Effect<T>`             | Logged module import     |
|   [5]   | `loadCss`         | `(loader) => Effect<void>`                | Logged CSS import        |
|   [6]   | `verifyRender`    | `(root, delayMs) => Effect<void>`         | Post-render verification |

---
## [4][LOGGER]
>**Dictum:** *Accumulating logger captures entries for error overlay display.*

<br>

### [4.1][FACTORY]

```typescript
import { createLoggerLayer, installDevTools } from '@parametric-portal/devtools/logger';
import { LOGGER_TUNING } from '@parametric-portal/devtools/logger';

const { layer, logs } = createLoggerLayer({ logLevel: 'Debug', maxLogs: 200 });

// Install global devtools (window.appGetLogs, window.appLogTest, etc.)
installDevTools({ env: 'development', loggerLayer: layer, logs, renderDebug, startTime });
```

---
### [4.2][API_MEMBERS]

| [INDEX] | [MEMBER]                   | [TYPE]                                 | [PURPOSE]                |
| :-----: | -------------------------- | -------------------------------------- | ------------------------ |
|   [1]   | `createLoggerLayer`        | `(config?) => LoggerLayerResult`       | Combined logger + buffer |
|   [2]   | `createAccumulatingLogger` | `(config) => AccumulatingLoggerResult` | Buffer-only logger       |
|   [3]   | `createCombinedLogger`     | `(config) => CombinedLoggerResult`     | Pretty + accumulating    |
|   [4]   | `installDevTools`          | `(config) => DevToolsGlobal`           | Global debug functions   |
|   [5]   | `createHmrHandler`         | `(logs, layer) => () => void`          | Vite HMR log clear       |
|   [6]   | `getLogs`                  | `(logs) => ReadonlyArray<LogEntry>`    | Copy log buffer          |
|   [7]   | `getLogsFormatted`         | `(logs) => string`                     | Format as text           |
|   [8]   | `getLogsJson`              | `(logs) => string`                     | Format as JSON           |
|   [9]   | `clearLogs`                | `(logs) => void`                       | Clear buffer             |

---
### [4.3][GLOBAL_DEVTOOLS]

Installed on `globalThis` via `installDevTools`:

| [INDEX] | [MEMBER]         | [TYPE]         | [PURPOSE]             |
| :-----: | ---------------- | -------------- | --------------------- |
|   [1]   | `appDebug`       | object         | Debug state snapshot  |
|   [2]   | `appGetLogs`     | `() => string` | Formatted log dump    |
|   [3]   | `appGetLogsJson` | `() => string` | JSON log dump         |
|   [4]   | `appLogTest`     | `() => void`   | Test all log levels   |
|   [5]   | `appRenderDebug` | `() => void`   | Manual overlay render |

---
## [5][CONSOLE]
>**Dictum:** *Console interception routes native calls through Effect pipeline.*

<br>

### [5.1][FACTORY]

```typescript
import { interceptConsole } from '@parametric-portal/devtools/console';
import { CONSOLE_TUNING } from '@parametric-portal/devtools/console';

const { restore } = interceptConsole({
    loggerLayer,
    logs,
    methods: ['log', 'info', 'warn', 'error', 'debug'],
});

// Later: restore original console
restore();
```

---
### [5.2][API_MEMBERS]

| [INDEX] | [MEMBER]           | [TYPE]                                          | [PURPOSE]            |
| :-----: | ------------------ | ----------------------------------------------- | -------------------- |
|   [1]   | `interceptConsole` | `(config) => { restore: () => void }`           | Install interceptors |
|   [2]   | `createLogEntry`   | `(method, args) => Omit<LogEntry, 'timestamp'>` | Format console call  |
|   [3]   | `formatArgs`       | `(args) => string`                              | Stringify arguments  |

---
## [6][HANDLERS]
>**Dictum:** *Global handlers capture uncaught errors before React hydration.*

<br>

### [6.1][FACTORY]

```typescript
import { installGlobalHandlers } from '@parametric-portal/devtools/handlers';
import { HANDLERS_TUNING } from '@parametric-portal/devtools/handlers';

const { uninstall } = installGlobalHandlers({
    loggerLayer,
    onError: (error, context) => renderDebugOverlay({ error, logs, env, startTime, context }),
});
```

---
### [6.2][API_MEMBERS]

| [INDEX] | [MEMBER]                | [TYPE]                                  | [PURPOSE]                |
| :-----: | ----------------------- | --------------------------------------- | ------------------------ |
|   [1]   | `installGlobalHandlers` | `(config) => { uninstall: () => void }` | Install onerror handlers |

---
## [7][PERFORMANCE]
>**Dictum:** *PerformanceObserver API captures Core Web Vitals metrics.*

<br>

### [7.1][FACTORY]

```typescript
import { observePerformance, getMetricSummary } from '@parametric-portal/devtools/performance';
import { PERFORMANCE_TUNING } from '@parametric-portal/devtools/performance';

const { disconnect, isSupported } = observePerformance({
    loggerLayer,
    logs,
    entryTypes: ['longtask', 'layout-shift', 'first-input', 'largest-contentful-paint'],
});

const metrics = getMetricSummary(logs);
// { cls: 0.1, fid: 50, lcp: 2500, longTasks: 3 }
```

---
### [7.2][API_MEMBERS]

| [INDEX] | [MEMBER]             | [TYPE]                                               | [PURPOSE]              |
| :-----: | -------------------- | ---------------------------------------------------- | ---------------------- |
|   [1]   | `observePerformance` | `(config) => { disconnect, isSupported }`            | Start observer         |
|   [2]   | `getMetricSummary`   | `(logs) => MetricSummary`                            | Extract CWV metrics    |
|   [3]   | `isSupported`        | `() => boolean`                                      | Check API availability |
|   [4]   | `getSupportedTypes`  | `(requested) => ReadonlyArray<PerformanceEntryType>` | Filter supported types |
|   [5]   | `formatEntryMessage` | `(entry) => string`                                  | Format perf entry      |

---
### [7.3][METRICS]

| [INDEX] | [METRIC]    | [SOURCE]                   | [DESCRIPTION]            |
| :-----: | ----------- | -------------------------- | ------------------------ |
|   [1]   | `cls`       | `layout-shift`             | Cumulative Layout Shift  |
|   [2]   | `fid`       | `first-input`              | First Input Delay        |
|   [3]   | `lcp`       | `largest-contentful-paint` | Largest Contentful Paint |
|   [4]   | `longTasks` | `longtask`                 | Tasks >50ms count        |

---
## [8][BOUNDARY]
>**Dictum:** *React 19 error callbacks integrate with Effect logging.*

<br>

### [8.1][FACTORY]

```typescript
import { createRootErrorOptions, EffectErrorBoundary } from '@parametric-portal/devtools/boundary';
import { BOUNDARY_TUNING } from '@parametric-portal/devtools/boundary';

// React 19 createRoot options
const rootOptions = createRootErrorOptions({ loggerLayer, onError });
const root = createRoot(container, rootOptions);

// Component-level boundary
<EffectErrorBoundary loggerLayer={loggerLayer} onError={onError} fallback={<ErrorFallback />}>
    <App />
</EffectErrorBoundary>
```

---
### [8.2][API_MEMBERS]

| [INDEX] | [MEMBER]                 | [TYPE]                    | [PURPOSE]               |
| :-----: | ------------------------ | ------------------------- | ----------------------- |
|   [1]   | `createRootErrorOptions` | `(config) => RootOptions` | React 19 root callbacks |
|   [2]   | `EffectErrorBoundary`    | `Component`               | Logged error boundary   |

---
### [8.3][ROOT_OPTIONS]

| [INDEX] | [CALLBACK]           | [LOG_LEVEL] | [PURPOSE]           |
| :-----: | -------------------- | ----------- | ------------------- |
|   [1]   | `onCaughtError`      | Error       | Boundary-caught     |
|   [2]   | `onRecoverableError` | Warning     | Hydration mismatch  |
|   [3]   | `onUncaughtError`    | Fatal       | Unhandled + overlay |

---
## [9][OVERLAY]
>**Dictum:** *Pre-hydration overlay renders errors before React mounts.*

<br>

### [9.1][FACTORY]

```typescript
import { renderDebugOverlay, DebugOverlayProvider, useDebugOverlay } from '@parametric-portal/devtools/overlay';
import { OVERLAY_TUNING } from '@parametric-portal/devtools/overlay';

// Imperative (pre-React)
renderDebugOverlay({ error, env: 'development', logs, startTime, context });

// Declarative (post-React)
<DebugOverlayProvider>
    <App />
</DebugOverlayProvider>

// Hook access
const { show, hide, visible } = useDebugOverlay();
```

---
### [9.2][API_MEMBERS]

| [INDEX] | [MEMBER]               | [TYPE]                       | [PURPOSE]              |
| :-----: | ---------------------- | ---------------------------- | ---------------------- |
|   [1]   | `renderDebugOverlay`   | `(props) => void`            | Imperative HTML render |
|   [2]   | `DebugOverlay`         | `Component`                  | React overlay          |
|   [3]   | `DebugOverlayProvider` | `Component`                  | Context provider       |
|   [4]   | `useDebugOverlay`      | `() => OverlayContextValue`  | Access show/hide       |
|   [5]   | `getLevelColor`        | `(level) => string`          | OKLCH level color      |
|   [6]   | `mergeColors`          | `(override?) => ColorConfig` | Merge theme colors     |

---
## [10][ENV]
>**Dictum:** *Schema validation ensures type-safe environment access.*

<br>

### [10.1][FACTORY]

```typescript
import { createEnv, createEnvSync } from '@parametric-portal/devtools/env';
import { ENV_TUNING } from '@parametric-portal/devtools/env';

const env = createEnvSync(import.meta.env);
// { MODE, DEV, PROD, BASE_URL, VITE_DEVTOOLS_LOG_LEVEL, ... }

const envEffect = createEnv(import.meta.env);
```

---
### [10.2][ENV_KEYS]

| [INDEX] | [KEY]                        | [TYPE]  | [DEFAULT]     |
| :-----: | ---------------------------- | ------- | ------------- |
|   [1]   | `MODE`                       | string  | 'development' |
|   [2]   | `DEV`                        | boolean | required      |
|   [3]   | `PROD`                       | boolean | required      |
|   [4]   | `BASE_URL`                   | string  | '/'           |
|   [5]   | `VITE_DEVTOOLS_LOG_LEVEL`    | literal | 'Debug'       |
|   [6]   | `VITE_DEVTOOLS_CONSOLE`      | boolean | 'true'        |
|   [7]   | `VITE_DEVTOOLS_PERFORMANCE`  | boolean | 'true'        |
|   [8]   | `VITE_DEVTOOLS_EXPERIMENTAL` | boolean | 'true'        |

---
## [11][EXPERIMENTAL]
>**Dictum:** *Effect DevTools extension connects via WebSocket layer.*

<br>

### [11.1][FACTORY]

```typescript
import { createDevToolsLayer } from '@parametric-portal/devtools/experimental';
import { EXPERIMENTAL_TUNING } from '@parametric-portal/devtools/experimental';

const { layer, isEnabled } = createDevToolsLayer({
    enabled: true,
    url: 'ws://localhost:34437',
});

// Merge with app layer
const AppLayer = Layer.mergeAll(loggerLayer, layer);
```

---
### [11.2][API_MEMBERS]

| [INDEX] | [MEMBER]                    | [TYPE]                                | [PURPOSE]              |
| :-----: | --------------------------- | ------------------------------------- | ---------------------- |
|   [1]   | `createDevToolsLayer`       | `(config?) => DevToolsResult`         | Create WebSocket layer |
|   [2]   | `createDevToolsLayerEffect` | `(config?) => Effect<DevToolsResult>` | Effect-wrapped layer   |

---
## [12][TYPES]
>**Dictum:** *Shared schemas enable cross-module type safety.*

<br>

### [12.1][SCHEMAS]

| [INDEX] | [SCHEMA]               | [PURPOSE]                                  |
| :-----: | ---------------------- | ------------------------------------------ |
|   [1]   | `LogEntrySchema`       | Log buffer entry                           |
|   [2]   | `LogLevelLiteral`      | Debug \| Info \| Warning \| Error \| Fatal |
|   [3]   | `DevToolsConfigSchema` | Full config validation                     |
|   [4]   | `OverlayConfigSchema`  | Overlay theming                            |

---
### [12.2][UTILITIES]

| [INDEX] | [MEMBER]         | [TYPE]                 | [PURPOSE]                 |
| :-----: | ---------------- | ---------------------- | ------------------------- |
|   [1]   | `formatLogEntry` | `(entry) => string`    | Format for display        |
|   [2]   | `formatDuration` | `(ms) => string`       | Human-readable time       |
|   [3]   | `parseLogLevel`  | `(level?) => LogLevel` | String to Effect LogLevel |
|   [4]   | `toError`        | `(value) => Error`     | Normalize to Error        |

---
## [13][MODULE_SUMMARY]
>**Dictum:** *Module catalog enables targeted imports.*

<br>

| [INDEX] | [MODULE]       | [PRIMARY_EXPORT]        | [PURPOSE]                   |
| :-----: | -------------- | ----------------------- | --------------------------- |
|   [1]   | `bootstrap`    | `createMain`            | App initialization pipeline |
|   [2]   | `logger`       | `createLoggerLayer`     | Effect logger + buffer      |
|   [3]   | `console`      | `interceptConsole`      | Console interception        |
|   [4]   | `handlers`     | `installGlobalHandlers` | Global error handlers       |
|   [5]   | `performance`  | `observePerformance`    | Core Web Vitals             |
|   [6]   | `boundary`     | `EffectErrorBoundary`   | React error boundary        |
|   [7]   | `overlay`      | `renderDebugOverlay`    | Pre-hydration error UI      |
|   [8]   | `env`          | `createEnvSync`         | Vite env validation         |
|   [9]   | `experimental` | `createDevToolsLayer`   | Effect DevTools WebSocket   |
|  [10]   | `types`        | `LogEntrySchema`        | Shared schemas              |

---
## [14][REQUIREMENTS]
>**Dictum:** *Peer dependencies enforce compatible runtime.*

<br>

| [INDEX] | [DEPENDENCY]         | [VERSION] |
| :-----: | -------------------- | --------: |
|   [1]   | React                |       19+ |
|   [2]   | effect               |     3.19+ |
|   [3]   | @effect/schema       |     0.75+ |
|   [4]   | @effect/experimental |     0.36+ |
|   [5]   | react-error-boundary |      5.0+ |
