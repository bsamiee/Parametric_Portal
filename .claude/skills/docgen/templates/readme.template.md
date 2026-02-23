# [H1][README_TEMPLATE]
>**Dictum:** *README scaffolding encodes section contracts, not aspirational outlines.*

<br>

Produces one README file at the appropriate scope level. Section selection determined by `readme-gen.md` §3[SCOPE_ROUTING]. Content requirements per section defined in `readme-gen.md` §2[SECTION_CATALOG].

**Density:** Root READMEs target 80-200 lines; package/module READMEs target 40-100 lines. Below 40 lines signals missing sections; above 200 signals scope creep.<br>
**References:** `readme-gen.md` (exploration, section catalog, scope routing), `readme-standards.md` (canonical structure, audience tiers), `validation.md` §1 (compliance checklist), `patterns.md` [1][5][6][7] (TROPHY_README, STALE_DOCS, PSEUDOCODE_EXAMPLE, AUDIENCE_MIXING).<br>
**Workflow:** Fill placeholders, remove guidance comments, verify all commands execute, validate against `validation.md` §1.

---
**Placeholders**

| [INDEX] | [PLACEHOLDER]          | [EXAMPLE]                                          |
| :-----: | ---------------------- | -------------------------------------------------- |
|   [1]   | `${ProjectName}`       | `Parametric Portal`                                |
|   [2]   | `${OneLiner}`          | `Type-safe configuration management for .NET`      |
|   [3]   | `${CIBadgeURL}`        | `https://github.com/org/repo/actions/...badge.svg` |
|   [4]   | `${CoverageURL}`       | `https://codecov.io/gh/org/repo`                   |
|   [5]   | `${LicenseType}`       | `MIT`                                              |
|   [6]   | `${RuntimeVersion}`    | `Node.js >=20, pnpm >=9`                          |
|   [7]   | `${SystemDeps}`        | `PostgreSQL 16+, Redis 7+`                         |
|   [8]   | `${InstallCommand}`    | `pnpm add @parametric/core`                        |
|   [9]   | `${VerifyCommand}`     | `pnpm exec parametric --version`                   |
|  [10]   | `${UsageExample}`      | Import + function call + expected output           |
|  [11]   | `${ArchDiagramNodes}`  | `Client, Gateway, Identity, Commerce`              |
|  [12]   | `${ContributingLink}`  | `See [CONTRIBUTING.md](./CONTRIBUTING.md)`         |
|  [13]   | `${LicenseSPDX}`       | `MIT`                                              |

---
<!-- Scope: Project root — full 12-section structure. -->
<!-- For package/module/hub scopes, omit sections per readme-gen.md §3.1. -->

# ${ProjectName}

> ${OneLiner}

[![Build Status](${CIBadgeURL})](ci-url)
[![Coverage](${CoverageURL})](coverage-url)
[![License](https://img.shields.io/badge/license-${LicenseType}-blue.svg)](LICENSE)

## Table of Contents

<!-- Auto-generate from H2 headings. -->

## Description

<!-- Three components in one paragraph: capability, motivation, differentiation. -->
<!-- No feature lists. No "this project is a..." framing. -->

## Prerequisites

- **Runtime:** ${RuntimeVersion}
- **Dependencies:** ${SystemDeps}

## Install

```sh
${InstallCommand}
```

**Verify:**

```sh
${VerifyCommand}
```

## Usage

<!-- Minimum viable example — smallest working invocation. -->
<!-- Must be runnable, not pseudocode. See readme-gen.md §2.4 for format per project type. -->

${UsageExample}

## Configuration

<!-- Environment variables, config files, feature flags. -->

| Variable | Default | Description |
| -------- | ------- | ----------- |
<!-- One row per environment variable. -->

## Architecture

<!-- C4 Level 1 system context. Mermaid graph LR with 3-7 nodes. -->
<!-- Followed by responsibility table. See readme-gen.md §2.5. -->

## API

<!-- Libraries: public API surface with signatures and examples. -->
<!-- Services: endpoint table with method, path, description. -->

## Contributing

${ContributingLink}

## License

[${LicenseSPDX}](./LICENSE)

---
**Guidance**

*Scope Selection* — Before filling this template, determine the README scope per `readme-gen.md` §3.2. Root scope uses all sections above. Package scope omits Architecture and Contributing. Module scope retains only Title, Description, Architecture, and API. Directory hub scope replaces all content sections with a navigation index table. Filling the wrong scope produces AUDIENCE_MIXING (patterns.md [7]).<br>
*Exploration Before Generation* — Every placeholder value derives from project artifacts, not assumptions. `${InstallCommand}` comes from `package.json` scripts or `*.csproj` build targets. `${RuntimeVersion}` comes from CI configuration or engine fields. Filling placeholders from memory produces STALE_DOCS (patterns.md [5]).<br>
*Example Viability* — The `${UsageExample}` placeholder must expand to compilable, importable, executable code. Truncated snippets or pseudocode trigger PSEUDOCODE_EXAMPLE (patterns.md [6]). Test the example against the current API surface before committing.

---
**Post-Scaffold Checklist**

- [ ] All `${...}` placeholders replaced with project-specific values
- [ ] Scope-inappropriate sections removed (per readme-gen.md §3.1)
- [ ] Install commands verified against current package manifest
- [ ] Usage example is runnable — not pseudocode, not truncated
- [ ] Architecture diagram limited to 3-7 bounded contexts
- [ ] No feature lists in Description (TROPHY_README)
- [ ] Badge URLs point to live services — no placeholder badges
- [ ] License SPDX identifier matches LICENSE file content
