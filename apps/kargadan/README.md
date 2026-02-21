# Kargadan App Placeholder

This folder reserves the workspace location for the Rhino AI integration initiative.

Planned subprojects:

- `plugin/` for the Rhino in-process C# bridge
- `harness/` for the TypeScript agent loop and provider orchestration

Shared protocol/domain contracts remain centralized in:

- `packages/types/src/kargadan`

Hard boundary:

- no app-local `contracts/` folder and no duplicated envelope/state shapes under `apps/kargadan`.
