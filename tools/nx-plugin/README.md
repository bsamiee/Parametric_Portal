# @parametric/nx-plugin

Local Nx plugin providing workspace-specific functionality.

## Features

- **Local Generator** (`library`): Scaffolds new packages with Single B constant pattern
- **Project Graph Plugin** (`createNodesV2`, `createDependencies`): Workspace dependency detection  
- **Task Lifecycle Hooks** (`preTasksExecution`, `postTasksExecution`): Env validation + metrics

## Activation

Plugin requires TypeScript transpilation at runtime. Add to `nx.json` when transpiler is available:

```json
{
  "plugins": [
    {
      "options": { "analytics": true, "inferTargets": false, "validateEnv": true },
      "plugin": "./tools/nx-plugin"
    }
  ]
}
```

**Note**: Requires `@swc-node/register` + `@swc/core` OR `ts-node` for runtime TS loading.
Current SWC baseUrl issue tracked upstream - plugin code ready when resolved.

## Generator Usage

```bash
pnpm generate:library my-new-package
```
