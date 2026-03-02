# Code Organization

## Caps

- 350 LOC per source module, 175 LOC per spec file
- One service/class per module
- Nesting depth: 4 levels max

## Section Order (TS/Effect)

- Separator format: `// --- [LABEL]` padded to column 80
- Canonical order: Types → Schema → Constants → Errors → Services → Functions → Layers → Export
- Omit unused sections
- Acyclic rule: Higher sections never reference lower
- Database additions: `[TABLES]` after Schema, `[REPOSITORIES]` after Services
- API additions: `[GROUPS]` after Schema, `[MIDDLEWARE]` after Services

## Boundary Model

Encoded (raw external) -> Validated (schema-decoded) -> Domain (branded/typed). External data is `unknown` until schema-validated. Domain signatures accept branded primitives only — raw `string`/`number` forbidden.

## Naming

Same concept = same name everywhere. Map at boundary adapters only. No abbreviations under 4 characters (ecosystem aliases excepted). Except in instances where industry standard overrides (Error codes, etc...).

## Module Exports

Packages expose a single `index.ts` barrel. Deep imports from internal modules forbidden across package boundaries. Within a package, direct imports between modules — no internal barrels or re-export chains.

## Forbidden Patterns

Labels: `Helpers`, `Handlers`, `Utils`, `Config`, `Dispatch_Tables`, `Namespace_Objects`. Files: no utility/helper modules — colocate in domain.
