## 0.6.1 (2025-12-09)

### [FEATURES]]

- Advanced architecture templates with optimized ELK layout and enhanced Dracula theme ([#98](https://github.com/bsamiee/Parametric_Portal/pull/98))
- Add orthogonal label system for AI agent coordination ([#100](https://github.com/bsamiee/Parametric_Portal/pull/100))

### [BUG_FIXES]

- integrate marketplace actions, fix PR title normalization, consolidate workflow comments, fix Gemini dispatch permissions, and automate Claude Code Review ([#97](https://github.com/bsamiee/Parametric_Portal/pull/97))
- consolidate PR comments into body, simplify Gemini auth, fix workflow issues ([5b777be](https://github.com/bsamiee/Parametric_Portal/commit/5b777be))
- **ci:** resolve Biome lint errors in label-validator ([7d63a69](https://github.com/bsamiee/Parametric_Portal/commit/7d63a69))

### ❤️ Thank You

- bsamiee @bsamiee
- Copilot @Copilot

## 0.6.0 (2025-12-08)

### [FEATURES]]

- Add repo-agnostic changed-files workflow with Nx integration and unified PR comments ([#96](https://github.com/bsamiee/Parametric_Portal/pull/96))
- agentic infrastructure overhaul with skill system and style standards ([ad59dc6](https://github.com/bsamiee/Parametric_Portal/commit/ad59dc6))

### ❤️ Thank You

- bsamiee @bsamiee
- Copilot @Copilot

## 0.5.3 (2025-12-02)

### [BUG_FIXES]

- update ghaction-github-labeler to v5.3.0 (resolve 100% workflow failure) ([#89](https://github.com/bsamiee/Parametric_Portal/pull/89))
- invert negated condition in fallbackStack ternary + fix SonarCloud workflow ([#91](https://github.com/bsamiee/Parametric_Portal/pull/91))
- Issue Helper action for declarative issue automation ([#92](https://github.com/bsamiee/Parametric_Portal/pull/92))
- **renovate:** add collision safeguard and trigger dashboard recreation    2 │    3 │ - Add exclusion filter in schema.ts mutate function to never touch    4 │   Renovate's Dependency Dashboard issue (both share 'dashboard' label)    5 │ - Enable dependencyDashboardApproval to force Renovate to recreate    6 │   the dashboard on next run    7 │    8 │ 🤖 Generated with [Claude Code](https://claude.com/claude-code)    9 │   10 │ Co-Authored-By: Claude <noreply@anthropic.com> ─────┴────────────────────────────────────────────────────────────────────────── ([179393f](https://github.com/bsamiee/Parametric_Portal/commit/179393f))

### [DOCUMENTATION]

- update agentic infrastructure documentation to reflect production implementation ([#88](https://github.com/bsamiee/Parametric_Portal/pull/88))

### ❤️ Thank You

- bsamiee @bsamiee
- Claude
- Copilot @Copilot

## 0.5.2 (2025-12-01)

### [DOCUMENTATION]

- finalize CLAUDE.md and REQUIREMENTS.md agent protocols ([60d13cb](https://github.com/bsamiee/Parametric_Portal/commit/60d13cb))

### ❤️ Thank You

- bsamiee

## 0.5.1 (2025-11-30)

### Refactoring

- comprehensive GitHub workflow infrastructure audit and optimization ([#76](https://github.com/bsamiee/Parametric_Portal/pull/76), [#77](https://github.com/bsamiee/Parametric_Portal/issues/77))

### ❤️ Thank You

- bsamiee @bsamiee
- Copilot @Copilot

## 0.5.0 (2025-11-30)

### Features

- integrate Nx auto-healing with unified CI workflow ([ef2ed70](https://github.com/bsamiee/Parametric_Portal/commit/ef2ed70))
- aggressive biome and Nx auto-healing with force merge ([9b3e93e](https://github.com/bsamiee/Parametric_Portal/commit/9b3e93e))
- add dynamic agent allocation for PR-size-based distribution ([d298ca7](https://github.com/bsamiee/Parametric_Portal/commit/d298ca7))
- **nx:** integrate Nx Release and optimize CI pipeline ([1e5a2af](https://github.com/bsamiee/Parametric_Portal/commit/1e5a2af))

### Bug Fixes

- address reviewer comments for CI workflow ([d520670](https://github.com/bsamiee/Parametric_Portal/commit/d520670))
- remove circular reset target from nx.json ([08ff652](https://github.com/bsamiee/Parametric_Portal/commit/08ff652))
- improve Nx Cloud CI configuration based on official docs ([3bef613](https://github.com/bsamiee/Parametric_Portal/commit/3bef613))
- align messaging to REQUIREMENTS.md standards and add CHANGELOG.md ([f9b978b](https://github.com/bsamiee/Parametric_Portal/commit/f9b978b))
- address reviewer feedback - proper Nx integration and license compliance ([01cce36](https://github.com/bsamiee/Parametric_Portal/commit/01cce36))
- improve license compliance filter logic ([4f47a9d](https://github.com/bsamiee/Parametric_Portal/commit/4f47a9d))
- quote YAML description with colons to prevent parsing error ([2006943](https://github.com/bsamiee/Parametric_Portal/commit/2006943))
- add always() to release job condition for skipped dependency chain ([9455b43](https://github.com/bsamiee/Parametric_Portal/commit/9455b43))
- **claude:** replace UTF-8 >= with ASCII >= for better parsing ([537e1e4](https://github.com/bsamiee/Parametric_Portal/commit/537e1e4))
- **infra:** address PR review feedback and fix CI failures ([c7ad68e](https://github.com/bsamiee/Parametric_Portal/commit/c7ad68e))

### Performance

- optimize TTG by starting Nx Agents before dependencies ([c743eab](https://github.com/bsamiee/Parametric_Portal/commit/c743eab))

### Refactoring

- optimize Nx configuration and CI workflow integration ([aaa41a3](https://github.com/bsamiee/Parametric_Portal/commit/aaa41a3))
- clean Nx Cloud ID handling via env.ts fallback ([57d0aa9](https://github.com/bsamiee/Parametric_Portal/commit/57d0aa9))
- implement official Claude Code Action and standardize workflow versions ([#68](https://github.com/bsamiee/Parametric_Portal/pull/68))
- remove rulesets and simplify CI workflow ([391a8eb](https://github.com/bsamiee/Parametric_Portal/commit/391a8eb))
- **infra:** streamline infrastructure with Nx Cloud caching ([42f17c4](https://github.com/bsamiee/Parametric_Portal/commit/42f17c4))
- **infra:** align commit types across nx.json, labels, and schema ([99e9d02](https://github.com/bsamiee/Parametric_Portal/commit/99e9d02))

### Documentation

- update AGENTIC-INFRASTRUCTURE.md and fix issue pinning workflow ([#67](https://github.com/bsamiee/Parametric_Portal/pull/67))
- **infra:** update AGENTIC-INFRASTRUCTURE.md to match refactored state ([bdfcac3](https://github.com/bsamiee/Parametric_Portal/commit/bdfcac3))

### ❤️ Thank You

- bsamiee @bsamiee
- Claude
- Copilot @Copilot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- Nx release will auto-generate content below from conventional commits -->
