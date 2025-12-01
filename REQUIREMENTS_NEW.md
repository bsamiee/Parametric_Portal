---
description: Technical specification and authoritative constraints for Parametric Portal
alwaysApply: true
---

# Parametric Portal — Technical Specification

**Version**: 0.1.0 · **Status**: Draft · **Authority**: Single Source of Truth

---

## 1. Identity & Mission

**Parametric Portal** is a bleeding-edge Nx/Vite/Effect monorepo that demonstrates dogmatic functional programming patterns with ultra-strict type safety, featuring an advanced automation infrastructure that is agentic coding first (human usage secondary)

### Core Tenets

The following principles are non-negotiable:

1. **Bleeding-edge only**: TypeScript 6.0-dev, React 19 canary, Vite 7, Effect 3, Nx 22 canary
2. **Code Philosophy**: Strict, dogmatic adherance to the code philosophy and paradigm of the project: Functional Programming, Monadic ROP, Expression Code, DRY, STRONG Type, Algorithmic, Parametric, and Polymorphic code
3. **Functional purity**: No `let`, no mutations, no `if/else`, no `try/catch`, no loops
4. **Type maximalism**: Complete coverage, branded types via @effect/schema, zero `any`
5. **Pattern consistency**: Single B Constant, dispatch tables, polymorphic entry points
6. **Zero compromise**: No rule suppression, no shortcuts, redesign to comply
7. **No backwards compatability**: NEVER support backwards compatability, ALWAYS change code for the best result, regardless of existing type signatures and API usage

### Non-Goals

This project explicitly DOES NOT prioritize:

- Production stability (uses canaries/betas/nightlies)
- Backward compatibility (breaks for latest features)
- Mainstream conventions (challenges industry defaults)

### Constraint Hierarchy

[HIERARCHY]: When patterns conflict, apply this precedence:

1. **Type safety** → No `any`, use branded types
2. **Functional purity** → No `let`, no mutations, no side effects
3. **Pattern consistency** → B Constant + Dispatch Tables everywhere
4. **Effect/Option** → Error channel + monadic composition
5. **Biome compliance** → Zero suppressions, redesign to comply

---

## 2. Stack Catalog

[CATALOG]: All dependency versions are defined in `pnpm-workspace.yaml` catalog.

<!-- Detailed version matrix to be populated -->

---

## 3. Architectural Principles

[RATIONALE]: This section explains the "Why" behind bleeding-edge, FP/ROP, and Effect.

<!-- Detailed principles to be populated -->

---

## 4. Code Patterns

[PATTERNS]: The following code patterns are MANDATORY:

<!-- Single B Constant, Dispatch Tables, Effect pipelines, Option monads to be populated -->

---

## 5. Configuration Cascade

[CASCADE]: Configuration files inherit and extend in this order:

<!-- vite.config.ts → vitest → nx → biome → tsconfig relationships to be populated -->

---

## 6. File Organization

[STRUCTURE]: Files MUST follow this organization standard:

<!-- Import ordering, section separators, file structure to be populated -->

---

## 7. Workspace Structure

[WORKSPACE]: Monorepo layout and catalog system:

<!-- packages/, apps/, catalog system to be populated -->

---

## 8. Build Toolchain

[BUILD]: Nx targets and Vite plugins:

<!-- Nx targets, Vite plugins, development workflows to be populated -->

---

## 9. Type System

[TYPES]: TypeScript 6.0-dev usage and @effect/schema patterns:

<!-- TypeScript 6.0-dev, @effect/schema, branded types to be populated -->

---

## 10. Testing

[TESTING]: Vitest configuration and coverage requirements:

<!-- Vitest, coverage targets, Effect/Option testing to be populated -->

---

## 11. Quality Gates

[QUALITY]: Biome rules and complexity limits:

<!-- Biome rules, complexity limits, density metrics to be populated -->

---

## 12. Integration Protocol

[PROTOCOL]: See `AGENTS.md` [VALIDATION] and [CONSTRAINTS] for submission requirements.

Complexity limit: ≤25 per function. Catalog usage: `"dep": "catalog:"`.

---

## 13. Maintenance

[MAINTENANCE]: Version updates and troubleshooting:

<!-- Version update protocols, dependency management to be populated -->

---

## 14. Exemplar Library

[EXEMPLARS]: Canonical implementations to study:

**Primary Patterns** (dual masters, equal weight):
- `vite.config.ts` → Master pattern (392 lines, B constant + dispatch tables)
- `.github/scripts/schema.ts` → Automation master (SpecRegistry, Ops factory, Effect pipelines)

**Supporting Exemplars**:
- `packages/components/` → Factory API pattern
- `packages/theme/` → Frozen configs, Effect pipelines
- `tsconfig.base.json` → Strictest TypeScript configuration
- `biome.json` → Comprehensive linting rules (70+ rules)
