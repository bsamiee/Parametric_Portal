# Parametric Portal Agent Guide

Read `CLAUDE.md`.
Read `REQUIREMENTS.md`.

## REQUIRED STANDARDS

If reviewing, refining, editing, creating, or modifying X file type, use skill Y (required):
- Typescript: `ts-standards`
- C#: `csharp-standards`
- Python: `python-standards`
- Bash/sh: `bash-script-generator`

## Codex-First Policy (Repo)
- Codex is the primary execution agent for this repository.
- Codex behavior is governed by user config in `~/.codex/config.toml` and this repo file.
- Claude-style lifecycle hooks are not required for Codex quality enforcement.

## Definition Of Done
1. Run affected checks while iterating.
2. Run language-specific validation for touched surfaces.
3. Run the full available root-script validation set before completion.
4. Run command-specific checks needed for the current change set.

## Deterministic Command Matrix

### Affected iteration gate
- `pnpm ts:check`
- `pnpm cs:check:affected`
- `pnpm py:check`

### TypeScript / React
- `pnpm ts:check`

### C#
- `pnpm cs:check`
- Preferred targeted variant during iteration: `pnpm cs:check:affected`

### Python
- `pnpm py:check`

### Full completion gate
- `pnpm ts:check`
- `pnpm cs:check`
- `pnpm py:check`

## Navigation And Context Discipline
- Use `fd` for discovery, then `rg` for exact references.
- Use structural search (`ast-grep`) for symbol-aware changes when available.
- Use Nx topology (`nx graph`, affected commands, `nx-mcp`) before broad scans.
- Read minimal file slices necessary for the current task.
- Navigation helpers:
  - `fd -H .`
  - `rg -n --hidden --glob '!.git' --glob '!node_modules' "<pattern>" <path>`
  - `pnpm exec ast-grep run --pattern "<structural-pattern>" <path>`
  - `ctags -R --exclude=.git --exclude=node_modules --exclude=dist --exclude=build --exclude=.nx .`

## Language Policy Convergence
- ALWAYS: follow `CLAUDE.md` + `REQUIREMENTS.md` strict schema-first / Effect-first approach.
- C#: preserve strict analyzer and formatting posture in `.editorconfig` and `Directory.Build.props`.
- Python: enforce Python 3.14+ baseline via Ruff + ty with explicit configuration.

## Refactor-First Constraint
- Prefer refining/extending existing modules over adding wrappers or duplicate helpers.
- Always read a file fully, identify if possible to do less code and refactor/extend existing logic over spamming new functionality.
- Keep implementations dense, strongly typed, and test/validation-backed.
- Avoid verbosity spam in plans or explanations; keep detail high and signal-focused.
