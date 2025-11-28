#!/usr/bin/env tsx
/**
 * Bundle size analyzer for monorepo packages.
 * Outputs JSON with raw, gzip, and brotli sizes for each package.
 * Uses Pkg and Sizes types from schema.ts for consistency.
 * Uses Node.js native zlib for secure, cross-platform compression.
 */

// --- Imports -----------------------------------------------------------------

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';

import type { Pkg, Sizes } from './schema.ts';

// --- Constants ---------------------------------------------------------------

const B = Object.freeze({
    defaultDir: 'packages',
    entryExt: '.js',
} as const);

// --- Pure Functions ---------------------------------------------------------

const findMainEntry = (distPath: string): string | undefined => {
    const entries = readdirSync(distPath, { recursive: true, withFileTypes: true });
    const jsFile = entries.find((f) => f.isFile() && f.name.endsWith(B.entryExt));
    // Return full relative path from distPath (parentPath available in Node 20+)
    return jsFile ? join(jsFile.parentPath ?? jsFile.path, jsFile.name).replace(`${distPath}/`, '') : undefined;
};

const getCompressedSize = (filePath: string, algo: 'brotli' | 'gzip'): number => {
    const content = readFileSync(filePath);
    const compressed = algo === 'brotli' ? brotliCompressSync(content) : gzipSync(content);
    return compressed.length;
};

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

const analyze = (packagesDir = B.defaultDir): Sizes => ({
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
