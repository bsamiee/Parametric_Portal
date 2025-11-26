/// <reference types="node" />
import { Schema as S } from '@effect/schema';
import { pipe } from 'effect';

// --- Type Definitions --------------------------------------------------------

type ProjectMap = S.Schema.Type<typeof ProjectMapSchema>;
type Project = S.Schema.Type<typeof ProjectSchema>;
type Graph = S.Schema.Type<typeof GraphSchema>;
type Workspace = S.Schema.Type<typeof WorkspaceSchema>;

// --- Schema Definitions ------------------------------------------------------

const WorkspaceSchema = S.Struct({
    nxVersion: S.String,
    packageManager: S.String,
    root: S.String,
});

const ExportEntrySchema = S.Struct({
    import: S.optional(S.String),
    require: S.optional(S.String),
    types: S.optional(S.String),
});

const ProjectSchema = S.Struct({
    dependencies: S.Array(S.String),
    exports: S.Record({ key: S.String, value: ExportEntrySchema }),
    name: S.String,
    publicApi: S.Array(S.String),
    root: S.String,
    sourceRoot: S.String,
    type: S.Union(S.Literal('app'), S.Literal('library')),
});

const GraphNodeSchema = S.Struct({
    name: S.String,
    type: S.Union(S.Literal('app'), S.Literal('library')),
});

const GraphEdgeSchema = S.Struct({
    source: S.String,
    target: S.String,
    type: S.Union(S.Literal('static'), S.Literal('dynamic'), S.Literal('implicit')),
});

const GraphSchema = S.Struct({
    cycles: S.Array(S.Array(S.String)),
    edges: S.Array(GraphEdgeSchema),
    nodes: S.Array(GraphNodeSchema),
});

const ImportAliasSchema = S.Struct({
    alias: S.String,
    path: S.String,
});

const ProjectMapSchema = S.Struct({
    generatedAt: S.String,
    graph: GraphSchema,
    imports: S.Array(ImportAliasSchema),
    projects: S.Record({ key: S.String, value: ProjectSchema }),
    version: pipe(S.String, S.pattern(/^\d+\.\d+\.\d+$/)),
    workspace: WorkspaceSchema,
});

// --- Constants ---------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        exports: {} as Record<string, { import?: string; require?: string; types?: string }>,
        publicApi: [] as ReadonlyArray<string>,
    },
    version: '1.0.0',
} as const);

// --- Export ------------------------------------------------------------------

export {
    B as SCHEMA_DEFAULTS,
    ExportEntrySchema,
    GraphEdgeSchema,
    GraphNodeSchema,
    GraphSchema,
    ImportAliasSchema,
    ProjectMapSchema,
    ProjectSchema,
    WorkspaceSchema,
};
export type { Graph, Project, ProjectMap, Workspace };
