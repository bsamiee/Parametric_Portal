/**
 * Library Generator - Creates new packages following workspace conventions
 * @see https://nx.dev/docs/extending-nx/local-generators
 */
import {
    type Tree,
    addProjectConfiguration,
    formatFiles,
    generateFiles,
    joinPathFragments,
    names,
} from '@nx/devkit';

// --- Type Definitions -------------------------------------------------------

type LibrarySchema = {
    readonly name: string;
    readonly description?: string;
    readonly directory?: string;
    readonly tags?: string;
};

type NormalizedOptions = LibrarySchema & {
    readonly className: string;
    readonly constantName: string;
    readonly fileName: string;
    readonly projectName: string;
    readonly projectRoot: string;
    readonly tagList: ReadonlyArray<string>;
};

// --- Constants (Single B) ---------------------------------------------------

const B = Object.freeze({
    defaults: {
        description: (name: string) => `${name} library`,
        directory: 'packages',
    },
    patterns: {
        tagSeparator: ',',
    },
    project: {
        type: 'library' as const,
    },
    templates: {
        dir: joinPathFragments(__dirname, 'files'),
    },
} as const);

// --- Pure Utility Functions -------------------------------------------------

const normalizeOptions = (schema: LibrarySchema): NormalizedOptions => {
    const n = names(schema.name);
    const projectRoot = joinPathFragments(schema.directory ?? B.defaults.directory, n.fileName);
    return {
        ...schema,
        className: n.className,
        constantName: n.constantCase,
        description: schema.description ?? B.defaults.description(n.className),
        fileName: n.fileName,
        projectName: `@parametric-portal/${n.fileName}`,
        projectRoot,
        tagList: schema.tags?.split(B.patterns.tagSeparator).map((t) => t.trim()) ?? [],
    };
};

const createProjectConfig = (opts: NormalizedOptions) => ({
    name: opts.projectName,
    projectType: B.project.type,
    root: opts.projectRoot,
    sourceRoot: `${opts.projectRoot}/src`,
    tags: [...opts.tagList],
    targets: {},
});

// --- Generator Entry Point --------------------------------------------------

const generator = async (tree: Tree, schema: LibrarySchema): Promise<void> => {
    const opts = normalizeOptions(schema);

    addProjectConfiguration(tree, opts.projectName, createProjectConfig(opts));

    generateFiles(tree, B.templates.dir, opts.projectRoot, {
        ...opts,
        template: '',
    });

    await formatFiles(tree);
};

// --- Export -----------------------------------------------------------------

export { generator as default, generator };
export type { LibrarySchema, NormalizedOptions };
