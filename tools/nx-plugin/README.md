# @parametric/nx-plugin

Local Nx plugin providing workspace-specific task lifecycle hooks.

## Features

- **preTasksExecution**: Validates environment variables (NX_CLOUD_ACCESS_TOKEN, CI)
- **postTasksExecution**: Reports task metrics (total, cached, failed, duration)
- **Local Generator** (`library`): Scaffolds new packages with workspace conventions

## Configuration

Plugin is registered in `nx.json`:

```json
{
    "plugins": [
        {
            "options": { "analytics": true, "validateEnv": true },
            "plugin": "./tools/nx-plugin"
        }
    ]
}
```

## Known Issues

**baseUrl Workaround (Nx #32009)**: Nx's SWC-based TypeScript plugin loader requires `baseUrl` in tsconfig.base.json. This is deprecated in TypeScript 7 but required until Nx fixes the upstream issue.

## Generator Usage

```bash
pnpm nx g @parametric/nx-plugin:library my-package
```
