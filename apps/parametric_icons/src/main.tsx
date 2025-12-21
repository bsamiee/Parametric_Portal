/**
 * Application entry point using @parametric-portal/devtools session factory.
 * All logging, error handling, and bootstrap logic delegated to devtools package.
 */
import { createMain, initWhenReady } from '@parametric-portal/devtools/bootstrap';
import { createDevSession } from '@parametric-portal/devtools/session';

const session = createDevSession({
    app: 'parametric-icons',
    env: import.meta.env,
});

const { init } = createMain({
    appModule: () => import('./app.tsx'),
    appName: 'parametric-icons',
    appVersion: (import.meta.env['APP_VERSION'] as string | undefined) ?? '0.0.0',
    cssModule: () => import('./main.css'),
    isDev: import.meta.env.DEV,
    loggerLayer: session.layer,
    onError: session.renderDebug,
    onFatal: (e: Error) => session.renderDebug(e, { phase: 'fatal' }),
    startTime: session.startTime,
});

initWhenReady(init, session.layer);
import.meta.hot?.dispose(session.dispose);
