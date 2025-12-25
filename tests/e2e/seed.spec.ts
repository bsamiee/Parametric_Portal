/**
 * Seed test for Playwright AI Agents.
 *
 * Bootstraps E2E testing environment, validates app accessibility,
 * and serves as template for AI-generated tests.
 */
import { expect, test } from '@playwright/test';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    apps: {
        api: { baseURL: 'http://localhost:4000', healthPath: '/api/health/liveness' },
        parametric_icons: { baseURL: 'http://localhost:3001', title: /Parametric Icons/i },
    },
} as const);

// --- [TESTS] -----------------------------------------------------------------

test.describe('Application Bootstrap', () => {
    test('parametric_icons - app loads successfully', async ({ page }) => {
        await page.goto(B.apps.parametric_icons.baseURL);
        await page.waitForLoadState('domcontentloaded');
        await expect(page).toHaveTitle(B.apps.parametric_icons.title);
    });
    test('api - health check returns ok', async ({ request }) => {
        const response = await request.get(`${B.apps.api.baseURL}${B.apps.api.healthPath}`);
        expect(response.ok()).toBe(true);
    });
});
