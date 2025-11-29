# @parametric/nx-plugin

Local Nx plugin providing workspace-specific functionality.

## Features

- **Local Generator** (`library`): Scaffolds new packages with Single B constant pattern
- **Project Graph Plugin** (`createNodesV2`, `createDependencies`): Workspace dependency detection  
- **Task Lifecycle Hooks** (`preTasksExecution`, `postTasksExecution`): Env validation + metrics

## Activation Status

**✅ Plugin is active** - registered in `nx.json`.

### Requirements
- `baseUrl: "."` must be set in `tsconfig.base.json` (SWC workaround for Nx issue #32009)
- Plugin pattern scoped to `{apps,packages}/*/package.json`

## Generator Usage

```bash
pnpm generate:library my-new-package
```
