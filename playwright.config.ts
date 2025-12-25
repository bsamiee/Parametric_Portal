/**
 * Playwright E2E test configuration.
 * Follows B constant pattern per REQUIREMENTS.md.
 */
import { defineConfig, devices } from '@playwright/test';

// --- [TYPES] -----------------------------------------------------------------

type AppConfig = Readonly<{
    name: string;
    baseURL: string;
    port: number;
    command: string;
    healthURL: string;
}>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    apps: {
        api: {
            baseURL: 'http://localhost:4000',
            command: 'pnpm exec nx dev @parametric-portal/api',
            healthURL: 'http://localhost:4000/api/health/liveness',
            name: 'api',
            port: 4000,
        },
        parametric_icons: {
            baseURL: 'http://localhost:3001',
            command: 'pnpm exec nx dev @parametric-portal/parametric-icons',
            healthURL: 'http://localhost:3001',
            name: 'parametric_icons',
            port: 3001,
        },
    } as const satisfies Record<string, AppConfig>,
    browser: {
        headless: true,
        screenshot: 'only-on-failure' as const,
        trace: 'retain-on-failure' as const,
        video: 'retain-on-failure' as const,
        viewport: { height: 720, width: 1280 },
    },
    output: {
        dir: 'test-results/e2e',
        reportDir: 'test-results/e2e/report',
    },
    patterns: {
        testDir: 'tests/e2e',
        testMatch: '**/*.spec.ts',
    },
    retry: {
        ci: 2,
        local: 0,
    },
    timeout: {
        action: 10_000,
        navigation: 30_000,
        test: 30_000,
        webServer: 120_000,
    },
    workers: {
        ci: 2,
        local: undefined,
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const isCI = (): boolean => process.env.CI === 'true';

const buildWebServer = (app: AppConfig) => ({
    command: app.command,
    reuseExistingServer: !isCI(),
    timeout: B.timeout.webServer,
    url: app.healthURL,
});

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig({
    forbidOnly: isCI(),

    fullyParallel: true,
    outputDir: B.output.dir,

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],

    reporter: [
        ['html', { open: 'never', outputFolder: B.output.reportDir }],
        ['list'],
        ...(isCI() ? [['json', { outputFile: `${B.output.dir}/results.json` }] as const] : []),
    ],
    retries: isCI() ? B.retry.ci : B.retry.local,
    testDir: B.patterns.testDir,
    testMatch: B.patterns.testMatch,

    timeout: B.timeout.test,

    use: {
        actionTimeout: B.timeout.action,
        baseURL: B.apps.parametric_icons.baseURL,
        navigationTimeout: B.timeout.navigation,
        screenshot: B.browser.screenshot,
        trace: B.browser.trace,
        video: B.browser.video,
        viewport: B.browser.viewport,
    },

    webServer: [buildWebServer(B.apps.api), buildWebServer(B.apps.parametric_icons)],
    workers: isCI() ? B.workers.ci : B.workers.local,
});

export { B as PLAYWRIGHT_CONFIG };
