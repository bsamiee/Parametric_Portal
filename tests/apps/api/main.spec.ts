/** Main entrypoint tests: fail-fast on invalid runtime env via process.exit(1).
 * Oracle: NodeRuntime.runMain contract -- missing required Config triggers nonzero exit. */
import { expect, it, vi } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const EXIT_FAILURE = 1 as const;

// --- [EDGE_CASES] ------------------------------------------------------------

it('exits with code 1 when DATABASE_URL is empty', async () => {
    const snapshot = process.env['DATABASE_URL'];
    process.env['DATABASE_URL'] = '';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.resetModules();
    await import('../../../apps/api/src/main.ts');
    await vi.waitFor(() => { expect(exitSpy).toHaveBeenCalled(); });
    expect(exitSpy).toHaveBeenCalledWith(EXIT_FAILURE);
    exitSpy.mockRestore();
    process.env['DATABASE_URL'] = snapshot;
});
