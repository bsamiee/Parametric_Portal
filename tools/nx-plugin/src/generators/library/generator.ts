/**
 * Library Generator - Creates new packages following workspace conventions
 * @see https://nx.dev/docs/extending-nx/local-generators
 */
import { type Tree, addProjectConfiguration, formatFiles, generateFiles, joinPathFragments, names } from '@nx/devkit';

// --- Constants (Single B) ---------------------------------------------------

const B = {
    defaults: { dir: 'packages', desc: (n: string) => `${n} library` },
    project: { type: 'library' as const },
    templates: { dir: joinPathFragments(__dirname, 'files') },
} as const;

// --- Types (Inferred) -------------------------------------------------------

type Schema = { readonly name: string; readonly description?: string; readonly directory?: string; readonly tags?: string };
type Opts = Schema & { readonly className: string; readonly constantName: string; readonly fileName: string; readonly projectName: string; readonly projectRoot: string; readonly tagList: ReadonlyArray<string> };

// --- Pure Utilities ---------------------------------------------------------

const normalize = (s: Schema): Opts => {
    const n = names(s.name);
    const root = joinPathFragments(s.directory ?? B.defaults.dir, n.fileName);
    return { ...s, className: n.className, constantName: n.constantCase, description: s.description ?? B.defaults.desc(n.className), fileName: n.fileName, projectName: `@parametric-portal/${n.fileName}`, projectRoot: root, tagList: s.tags?.split(',').map((t) => t.trim()) ?? [] };
};

// --- Generator --------------------------------------------------------------

const generator = async (tree: Tree, schema: Schema): Promise<void> => {
    const o = normalize(schema);
    addProjectConfiguration(tree, o.projectName, { name: o.projectName, projectType: B.project.type, root: o.projectRoot, sourceRoot: `${o.projectRoot}/src`, tags: [...o.tagList], targets: {} });
    generateFiles(tree, B.templates.dir, o.projectRoot, { ...o, template: '' });
    await formatFiles(tree);
};

export { generator as default, generator };
