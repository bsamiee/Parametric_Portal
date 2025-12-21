/// <reference types="vite/client" />
/**
 * Root Vite configuration: imports factory and executes for workspace root.
 * Apps/packages import from vite.factory.ts to avoid triggering this execution.
 */

import { Effect } from 'effect';
import { defineConfig } from 'vite';
import { B, createConfig } from './vite.factory.ts';

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            mode: 'app',
            name: 'ParametricPortal',
            pwa: { description: B.pwa.desc, name: B.pwa.name, shortName: B.pwa.short, themeColor: B.pwa.theme },
        }),
    ),
);
