#!/usr/bin/env tsx
/**
 * Bundle size analyzer for monorepo packages.
 * Outputs JSON with raw, gzip, and brotli sizes for each package.
 * Uses Pkg and Sizes types from schema.ts for consistency.
 */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import type { Pkg, Sizes } from './schema.ts';

// --- Pure Functions ---------------------------------------------------------

const findMainEntry = (distPath: string): string | undefined =>
    readdirSync(distPath, { recursive: true, withFileTypes: true }).find((f) => f.isFile() && f.name.endsWith('.js'))
        ?.name;

const getCompressedSize = (filePath: string, cmd: 'brotli' | 'gzip'): number =>
    parseInt(execSync(`${cmd} -c "${filePath}" | wc -c`, { encoding: 'utf8' }).trim(), 10);

const getDirSize = (dirPath: string): number =>
    readdirSync(dirPath, { withFileTypes: true }).reduce((total, entry) => {
        const fullPath = join(dirPath, entry.name);
        return total + (entry.isDirectory() ? getDirSize(fullPath) : statSync(fullPath).size);
    }, 0);

const analyzePackage = (distPath: string): Pkg => {
    const name = basename(dirname(distPath));
    const raw = getDirSize(distPath);
    const mainFile = findMainEntry(distPath);
    const mainPath = mainFile ? join(distPath, mainFile) : undefined;
    const hasMain = mainPath && existsSync(mainPath);

    return {
        brotli: hasMain ? getCompressedSize(mainPath, 'brotli') : 0,
        gzip: hasMain ? getCompressedSize(mainPath, 'gzip') : 0,
        name,
        raw,
    };
};

// --- Entry Point ------------------------------------------------------------

const analyze = (packagesDir = 'packages'): Sizes => ({
    packages: (existsSync(packagesDir) ? readdirSync(packagesDir, { withFileTypes: true }) : [])
        .filter((dir) => dir.isDirectory())
        .map((dir) => join(packagesDir, dir.name, 'dist'))
        .filter(existsSync)
        .map(analyzePackage),
});

// --- Export -----------------------------------------------------------------

export { analyze };

// CLI entry point
process.stdout.write(JSON.stringify(analyze(process.argv[2]), null, 2));
