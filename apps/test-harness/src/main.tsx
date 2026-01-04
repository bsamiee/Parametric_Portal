/**
 * Test harness entry point using @parametric-portal/devtools session factory.
 * All logging, error handling, and bootstrap logic delegated to devtools package.
 */
import { createMain, initWhenReady } from '@parametric-portal/devtools/bootstrap';
import { createDevSession } from '@parametric-portal/devtools/session';

// --- [ENTRY_POINT] -----------------------------------------------------------

const session = createDevSession({
    app: 'test-harness',
    env: import.meta.env,
});
const { init } = createMain({
    appModule: () => import('./app.tsx'),
    appName: 'test-harness',
    appVersion: '0.0.1',
    cssModule: () => import('./main.css'),
    isDev: import.meta.env.DEV,
    loggerLayer: session.layer,
    onError: session.renderDebug,
    onFatal: session.fatal,
    startTime: session.startTime,
});
initWhenReady(init, session.layer);
import.meta.hot?.dispose(session.dispose);
