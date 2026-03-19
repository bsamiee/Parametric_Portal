# Nx Monorepo Constraints

## Nx Execution

Always `pnpm exec nx <command>` from repo root — never bare `nx`, `npx nx`, or `cd` into a package.

## Package Topology

Packages export mechanisms: types, schemas, factories, CSS slots (e.g., CSS custom properties like `--primary-color`). Apps define values: CSS values, factory invocations, visual overrides. No color/font/spacing literals in `packages/*`.

## Dependency Isolation

Enforce via Nx module boundary rules: `packages/*` (scope:lib) import only other scope:lib and external deps. `apps/*` (scope:app) import scope:lib and external deps, never other apps. No circular imports between packages.

## Task Pipeline

New packages inherit task pipeline from `nx.json` `targetDefaults`. Do not add `dependsOn` in `project.json` unless overriding the default chain. Verify with `pnpm exec nx show project <name> --web` after creation.

## Workspace Catalogs

Shared dependency versions in `pnpm-workspace.yaml` catalogs. Package references use `"<dep>": "catalog:"`. Never pin versions in individual `package.json` when a catalog entry exists.
