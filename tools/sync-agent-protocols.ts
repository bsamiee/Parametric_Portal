#!/usr/bin/env tsx
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
/// <reference types="node" />
import { Effect, Option, pipe } from 'effect';

// --- Type Definitions --------------------------------------------------------

type SyncHash = string & { readonly brand: unique symbol };
type Section = { readonly header: string; readonly content: string };
type Sections = { readonly sections: ReadonlyArray<Section> };
type GeneratedFile = {
    readonly content: string;
    readonly hash: SyncHash;
    readonly path: string;
};
type DriftReport = {
    readonly drifted: ReadonlyArray<string>;
    readonly synchronized: ReadonlyArray<string>;
};

// --- Schema Definitions ------------------------------------------------------

// --- Constants ---------------------------------------------------------------

const B = Object.freeze({
    args: {
        dryRun: '--dry-run',
    },
    files: {
        agentsMd: 'AGENTS.md',
        claudeMd: 'CLAUDE.md',
        copilotInstructions: '.github/copilot-instructions.md',
        requirements: 'REQUIREMENTS.md',
    },
    hash: {
        algorithm: 'sha256',
        encoding: 'hex',
    },
    markers: {
        hashComment: (hash: string): string => `<!-- SYNC_HASH: ${hash} -->`,
        hashPattern: /<!-- SYNC_HASH: ([a-f0-9]+) -->/,
    },
    sections: {
        agentMatrix: ['## Custom Agent Profiles'],
        dogmaticRules: ['## Dogmatic Code Philosophy'],
        qualityTargets: ['### Quality Targets'],
        stack: ['## Bleeding-Edge Technology Stack'],
    },
    templates: {
        agents: {
            footer: '',
            header: '# Parametric Portal — Agent Charter (Bleeding-Edge, Dogmatic)\n\n',
        },
        claude: {
            footer: '',
            header: '# Parametric Portal - Code Standards\n\n',
        },
        copilot: {
            footer: '',
            header: '# Parametric Portal — Copilot Instructions\n\n',
        },
    },
} as const);

// --- Pure Utility Functions --------------------------------------------------

const normalizeContent = (content: string): string =>
    content
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n')
        .trim();

const computeHash = (content: string): SyncHash =>
    createHash(B.hash.algorithm).update(normalizeContent(content)).digest(B.hash.encoding) as SyncHash;

const extractSections = (markdown: string, headers: ReadonlyArray<string>): ReadonlyArray<Section> => {
    const lines = markdown.split('\n');
    const result: Array<Section> = [];

    for (const targetHeader of headers) {
        const headerIndex = lines.findIndex((line) => line.trim() === targetHeader);
        headerIndex === -1 && result.push({ content: '', header: targetHeader });

        if (headerIndex !== -1) {
            const nextHeaderIndex = lines.findIndex(
                (line, idx) => idx > headerIndex && line.startsWith('## ') && !line.startsWith('### '),
            );

            const sectionLines =
                nextHeaderIndex === -1 ? lines.slice(headerIndex) : lines.slice(headerIndex, nextHeaderIndex);

            result.push({
                content: sectionLines.join('\n').trim(),
                header: targetHeader,
            });
        }
    }

    return result;
};

const findSectionContent = (sections: ReadonlyArray<Section>, header: string): string =>
    pipe(
        sections.find((s) => s.header === header),
        Option.fromNullable,
        Option.map((s) => s.content),
        Option.getOrElse(() => ''),
    );

const extractHashFromFile = (content: string): Option.Option<SyncHash> =>
    pipe(
        Option.fromNullable(content.match(B.markers.hashPattern)),
        Option.flatMap((match) => Option.fromNullable(match[1])),
        Option.map((hash) => hash as SyncHash),
    );

const buildFileContent = (header: string, sections: string, hash: SyncHash, footer: string): string =>
    `${header}${sections}\n\n${footer}${B.markers.hashComment(hash)}\n`;

// --- Effect Pipeline ---------------------------------------------------------

const readRequirements = (root: string): Effect.Effect<string, Error, never> =>
    Effect.try({
        catch: () => new Error(`[ERROR] Failed to read ${B.files.requirements}`),
        try: () => {
            const path = join(root, B.files.requirements);
            return existsSync(path) ? readFileSync(path, 'utf-8') : '';
        },
    });

const extractAllSections = (markdown: string): Effect.Effect<Sections, Error, never> =>
    Effect.try({
        catch: (e) => new Error(`[ERROR] Failed to extract sections: ${String(e)}`),
        try: () => {
            const stack = extractSections(markdown, B.sections.stack);
            const dogmatic = extractSections(markdown, B.sections.dogmaticRules);
            const agents = extractSections(markdown, B.sections.agentMatrix);
            const quality = extractSections(markdown, B.sections.qualityTargets);

            return {
                sections: [...stack, ...dogmatic, ...agents, ...quality],
            };
        },
    });

const buildAgentsContent = (sections: Sections): Effect.Effect<string, never, never> =>
    Effect.succeed(
        [
            findSectionContent(sections.sections, B.sections.stack[0]),
            findSectionContent(sections.sections, B.sections.dogmaticRules[0]),
            findSectionContent(sections.sections, B.sections.agentMatrix[0]),
            findSectionContent(sections.sections, B.sections.qualityTargets[0]),
        ]
            .filter((s) => s.length > 0)
            .join('\n\n'),
    );

const buildCopilotContent = (sections: Sections): Effect.Effect<string, never, never> =>
    Effect.succeed(
        [
            findSectionContent(sections.sections, B.sections.stack[0]),
            findSectionContent(sections.sections, B.sections.dogmaticRules[0]),
            findSectionContent(sections.sections, B.sections.agentMatrix[0]),
            findSectionContent(sections.sections, B.sections.qualityTargets[0]),
        ]
            .filter((s) => s.length > 0)
            .join('\n\n'),
    );

const buildClaudeContent = (sections: Sections): Effect.Effect<string, never, never> =>
    Effect.succeed(
        [
            findSectionContent(sections.sections, B.sections.stack[0]),
            findSectionContent(sections.sections, B.sections.dogmaticRules[0]),
            findSectionContent(sections.sections, B.sections.agentMatrix[0]),
            findSectionContent(sections.sections, B.sections.qualityTargets[0]),
        ]
            .filter((s) => s.length > 0)
            .join('\n\n'),
    );

const generateFiles = (root: string, sections: Sections): Effect.Effect<ReadonlyArray<GeneratedFile>, Error, never> =>
    pipe(
        Effect.all({
            agents: buildAgentsContent(sections),
            claude: buildClaudeContent(sections),
            copilot: buildCopilotContent(sections),
        }),
        Effect.map(({ agents, claude, copilot }) => {
            const agentsHash = computeHash(agents);
            const claudeHash = computeHash(claude);
            const copilotHash = computeHash(copilot);

            return [
                {
                    content: buildFileContent(B.templates.agents.header, agents, agentsHash, B.templates.agents.footer),
                    hash: agentsHash,
                    path: join(root, B.files.agentsMd),
                },
                {
                    content: buildFileContent(
                        B.templates.copilot.header,
                        copilot,
                        copilotHash,
                        B.templates.copilot.footer,
                    ),
                    hash: copilotHash,
                    path: join(root, B.files.copilotInstructions),
                },
                {
                    content: buildFileContent(B.templates.claude.header, claude, claudeHash, B.templates.claude.footer),
                    hash: claudeHash,
                    path: join(root, B.files.claudeMd),
                },
            ];
        }),
    );

const writeFile = (file: GeneratedFile): Effect.Effect<void, Error, never> =>
    Effect.try({
        catch: (e) => new Error(`[ERROR] Failed to write ${file.path}: ${String(e)}`),
        try: () => {
            writeFileSync(file.path, file.content, 'utf-8');
        },
    });

const writeFiles = (files: ReadonlyArray<GeneratedFile>): Effect.Effect<void, Error, never> =>
    pipe(
        Effect.all(files.map(writeFile)),
        Effect.map(() => undefined),
    );

const readExistingFile = (path: string): Effect.Effect<string, never, never> =>
    Effect.succeed(existsSync(path) ? readFileSync(path, 'utf-8') : '');

const checkDrift = (_root: string, expected: ReadonlyArray<GeneratedFile>): Effect.Effect<DriftReport, Error, never> =>
    pipe(
        Effect.all(
            expected.map((file) =>
                pipe(
                    readExistingFile(file.path),
                    Effect.map((content) => ({
                        actual: pipe(
                            extractHashFromFile(content),
                            Option.getOrElse(() => '' as SyncHash),
                        ),
                        expected: file.hash,
                        path: file.path,
                    })),
                ),
            ),
        ),
        Effect.map((results) => {
            const drifted = results.filter((r) => r.actual !== r.expected).map((r) => r.path);
            const synchronized = results.filter((r) => r.actual === r.expected).map((r) => r.path);

            return { drifted, synchronized };
        }),
    );

const reportDrift = (report: DriftReport): Effect.Effect<void, never, never> =>
    Effect.sync(() => {
        report.synchronized.length > 0 && process.stderr.write(`[OK] Synchronized (${report.synchronized.length}):\n`);
        for (const path of report.synchronized) {
            process.stderr.write(`  ✓ ${path}\n`);
        }

        report.drifted.length > 0 && process.stderr.write(`\n[ERROR] Drifted (${report.drifted.length}):\n`);
        for (const path of report.drifted) {
            process.stderr.write(`  ✗ ${path}\n`);
        }

        report.drifted.length === 0 && process.stderr.write('\n[OK] All files synchronized with REQUIREMENTS.md\n');
    });

const mainGenerate = (root: string): Effect.Effect<void, Error, never> =>
    pipe(
        Effect.log('[INFO] Reading REQUIREMENTS.md...'),
        Effect.flatMap(() => readRequirements(root)),
        Effect.flatMap(extractAllSections),
        Effect.tap(() => Effect.log('[INFO] Generating derivative files...')),
        Effect.flatMap((sections) => generateFiles(root, sections)),
        Effect.tap((files) => Effect.log(`[INFO] Writing ${files.length} files...`)),
        Effect.flatMap(writeFiles),
        Effect.tap(() => Effect.log('[OK] All files generated successfully')),
    );

const mainDryRun = (root: string): Effect.Effect<void, Error, never> =>
    pipe(
        Effect.log('[INFO] Running drift detection (dry-run mode)...'),
        Effect.flatMap(() => readRequirements(root)),
        Effect.flatMap(extractAllSections),
        Effect.flatMap((sections) => generateFiles(root, sections)),
        Effect.flatMap((files) => checkDrift(root, files)),
        Effect.tap(reportDrift),
        Effect.flatMap((report) =>
            report.drifted.length > 0
                ? Effect.fail(new Error('[ERROR] Drift detected - run without --dry-run to sync'))
                : Effect.succeed(undefined),
        ),
    );

const main = (): Effect.Effect<void, Error, never> => {
    const root = process.cwd();
    const isDryRun = process.argv.includes(B.args.dryRun);

    return isDryRun ? mainDryRun(root) : mainGenerate(root);
};

// --- Export ------------------------------------------------------------------

export { B as SYNC_CONFIG, computeHash, extractSections, normalizeContent };
export type { DriftReport, GeneratedFile, Section, Sections, SyncHash };

// --- CLI Execution -----------------------------------------------------------

Effect.runPromise(main()).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
});
