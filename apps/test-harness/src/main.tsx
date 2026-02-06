/**
 * Test harness entry point using the unified @parametric-portal/devtools surface.
 */
import { Devtools } from '@parametric-portal/devtools/devtools';

// --- [ENTRY_POINT] -----------------------------------------------------------

const session = Devtools.session({
    app: 'test-harness',
    env: import.meta.env,
});
const { init } = Devtools.bootstrap.create({
    appModule: () => import('./app.tsx'),
    appName: 'test-harness',
    appVersion: '0.0.1',
    cssModule: () => import('./main.css'),
    isDev: import.meta.env.DEV,
    session,
});
Devtools.bootstrap.whenReady(init);
import.meta.hot?.dispose(session.dispose);
