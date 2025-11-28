#!/usr/bin/env tsx
/**
 * Bundle size analyzer for monorepo packages.
 * Outputs JSON with raw, gzip, and brotli sizes for each package.
 */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

// --- Types ------------------------------------------------------------------

type PackageSize = {
    readonly brotli: number;
    readonly gzip: number;
    readonly name: string;
    readonly raw: number;
};

type SizeReport = {
    readonly packages: ReadonlyArray<PackageSize>;
};

// --- Pure Functions ---------------------------------------------------------

const findMainEntry = (distPath: string): string | undefined => {
    const files = readdirSync(distPath, { recursive: true, withFileTypes: true });
    return files.find((f) => f.isFile() && f.name.endsWith('.js'))?.name;
};

const getCompressedSize = (filePath: string, cmd: 'gzip' | 'brotli'): number => {
    const flag = cmd === 'gzip' ? '-c' : '-c';
    const result = execSync(`${cmd} ${flag} "${filePath}" | wc -c`, { encoding: 'utf8' });
    return parseInt(result.trim(), 10);
};

const getDirSize = (dirPath: string): number =>
    readdirSync(dirPath, { withFileTypes: true }).reduce((total, entry) => {
        const fullPath = join(dirPath, entry.name);
        return total + (entry.isDirectory() ? getDirSize(fullPath) : statSync(fullPath).size);
    }, 0);

const analyzePackage = (distPath: string): PackageSize => {
    const pkgName = basename(dirname(distPath));
    const raw = getDirSize(distPath);

    const mainFile = findMainEntry(distPath);
    const mainPath = mainFile ? join(distPath, mainFile) : undefined;

    return {
        brotli: mainPath && existsSync(mainPath) ? getCompressedSize(mainPath, 'brotli') : 0,
        gzip: mainPath && existsSync(mainPath) ? getCompressedSize(mainPath, 'gzip') : 0,
        name: pkgName,
        raw,
    };
};

// --- Entry Point ------------------------------------------------------------

const analyze = (packagesDir = 'packages'): SizeReport => ({
    packages: (existsSync(packagesDir) ? readdirSync(packagesDir, { withFileTypes: true }) : [])
        .filter((dir) => dir.isDirectory())
        .map((dir) => join(packagesDir, dir.name, 'dist'))
        .filter(existsSync)
        .map(analyzePackage),
});

// Output JSON to stdout when run directly
process.stdout.write(JSON.stringify(analyze(process.argv[2]), null, 2));
