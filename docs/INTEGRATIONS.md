# Integrations Guide

Third-party services, GitHub Apps, and configuration recommendations for Parametric Portal.

## Recommended GitHub Apps

### Code Coverage

**Codecov** (https://about.codecov.io/)
- **Purpose**: Visualize test coverage, track trends, enforce coverage requirements
- **Integration**: Automatic via coverage artifacts uploaded by CI
- **Configuration**: Create `codecov.yml` in root:
  ```yaml
  coverage:
    status:
      project:
        default:
          target: 80%
          threshold: 2%
      patch:
        default:
          target: 80%
  comment:
    layout: "reach,diff,flags,tree"
    behavior: default
  ```

### Dependency Security

**Socket.dev** (https://socket.dev/)
- **Purpose**: Real-time dependency security and supply chain protection
- **Features**: Detects malware, typosquatting, install scripts, maintainer changes
- **Integration**: Install GitHub App, auto-scans PRs
- **Free for open source**

**Snyk** (https://snyk.io/)
- **Purpose**: Vulnerability scanning, license compliance, container security
- **Features**: Auto-fix PRs, prioritized remediation, developer-first UX
- **Integration**: Install GitHub App
- **Free tier**: 200 tests/month

### Continuous Integration

**Nx Cloud** (https://nx.app/)
- **Purpose**: Distributed task execution, remote caching, flaky test detection
- **Features**: 10x faster builds, smart task scheduling, CI analytics
- **Integration**: Add `NX_CLOUD_ACCESS_TOKEN` secret
- **Free tier**: 500 hours/month

### Code Quality

**SonarCloud** (https://sonarcloud.io/)
- **Purpose**: Static code analysis, bug detection, security hotspots
- **Features**: Quality gates, code smells, technical debt tracking
- **Integration**: Install GitHub App, enable in CI
- **Free for open source**

## Branch Protection Configuration

**Repository Settings → Branches → Branch protection rules**

### Main Branch

**Pattern**: `main`

**Required Status Checks**:
- ✅ Require status checks to pass before merging
- ✅ Require branches to be up to date before merging
- Required checks:
  - `quality` (from ci.yml)
  - `mutation-score` (if using Stryker)
  - `PR Metadata` (from pr-meta.yml)

**Pull Request Reviews**:
- ✅ Require pull request reviews before merging
- Number of required approvals: `1`
- ✅ Dismiss stale pull request approvals when new commits are pushed
- ✅ Require review from Code Owners (if CODEOWNERS defined)

**Merge Restrictions**:
- ✅ Require linear history (squash or rebase only)
- ✅ Allow auto-merge
- ✅ Automatically delete head branches

**Rules Applied to Administrators**: ✅ (Optional, recommended for team repos)

**Additional Settings**:
- ✅ Require signed commits (recommended for security)
- ✅ Do not allow bypassing the above settings

## CODEOWNERS Template

Create `.github/CODEOWNERS`:

```
# Default reviewers for all code
* @your-org/parametric-portal-maintainers

# Workflow owners
/.github/workflows/ @your-org/devops-team

# Documentation owners
/docs/ @your-org/documentation-team
*.md @your-org/documentation-team

# Package-specific owners
/packages/components/ @your-org/ui-team
/packages/theme/ @your-org/design-team
/packages/types/ @your-org/platform-team

# Configuration files
/vite.config.ts @your-org/build-team
/vitest.config.ts @your-org/qa-team
/biome.json @your-org/platform-team
/nx.json @your-org/build-team
/renovate.json @your-org/devops-team
```

## README Badges

Add to your `README.md`:

```markdown
# Parametric Portal

[![CI](https://github.com/your-org/Parametric_Portal/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/Parametric_Portal/actions/workflows/ci.yml)
[![Security](https://github.com/your-org/Parametric_Portal/actions/workflows/security.yml/badge.svg)](https://github.com/your-org/Parametric_Portal/actions/workflows/security.yml)
[![codecov](https://codecov.io/gh/your-org/Parametric_Portal/branch/main/graph/badge.svg)](https://codecov.io/gh/your-org/Parametric_Portal)
[![License](https://img.shields.io/github/license/your-org/Parametric_Portal)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0--dev-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.3.0--canary-blue.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-7.2.4-646CFF.svg)](https://vite.dev/)
[![Effect](https://img.shields.io/badge/Effect-3.19.6-purple.svg)](https://effect.website/)
```

## Secrets Configuration

**Repository Settings → Secrets and variables → Actions**

### Required Secrets

**GITHUB_TOKEN**
- **Purpose**: Default token for GitHub API operations
- **Automatically provided**: No manual setup needed
- **Permissions**: Configured per workflow via `permissions:` block

### Optional Secrets

**CLAUDE_CODE_OAUTH_TOKEN** (if using Claude Code for extended features)
- **Purpose**: Extended Claude API access for code review
- **Acquisition**: Contact Anthropic for enterprise API access
- **Usage**: claude-pr-review.yml, claude.yml, claude-maintenance.yml

**NX_CLOUD_ACCESS_TOKEN** (if using Nx Cloud)
- **Purpose**: Remote caching and distributed task execution
- **Acquisition**: Sign up at https://nx.app/
- **Usage**: Add to CI workflows for caching

**CODECOV_TOKEN** (if private repo)
- **Purpose**: Upload coverage reports to Codecov
- **Acquisition**: Codecov dashboard after installing GitHub App
- **Usage**: CI workflow coverage upload step

## Dependency Dashboard

**Renovate Configuration**: `renovate.json`

Renovate automatically creates a "Dependency Dashboard" issue in your repository.

**Features**:
- Overview of all open Renovate PRs
- Rate-limited PR creation status
- Pending updates grouped by type
- Detected dependencies
- OSV vulnerability alerts

**Customization**:
```json
{
  "dependencyDashboard": true,
  "dependencyDashboardTitle": "📦 Dependency Dashboard",
  "dependencyDashboardHeader": "This is your central place for managing all dependency updates.",
  "dependencyDashboardFooter": "💡 Tip: Use `/renovate rebase` command to rebase PRs"
}
```

## Notification Configuration

**Repository Settings → Notifications**

### Watch Configuration

**Recommended for maintainers**:
- ✅ Participating and @mentions
- ✅ All Activity (for core team only)

**Team members**:
- ✅ Participating and @mentions
- ✅ Custom: Pull requests, Releases

### Slack/Discord Integration

**GitHub Slack App** (https://slack.github.com/)
- Subscribe channels to repo activity
- Example: `/github subscribe your-org/Parametric_Portal reviews comments`

**Discord GitHub Webhook**:
1. Discord Server Settings → Integrations → Webhooks → New Webhook
2. Copy webhook URL
3. GitHub → Settings → Webhooks → Add webhook
4. Paste URL, select events (PR, Issues, Push)

## Performance Monitoring

### Lighthouse CI

Add to CI workflow:

```yaml
- name: Lighthouse CI
  uses: treosh/lighthouse-ci-action@v10
  with:
    urls: |
      http://localhost:5173
    uploadArtifacts: true
    temporaryPublicStorage: true
```

### Bundle Size Monitoring

Already integrated via `bundle-analysis.yml` workflow.

**Enhancement**: Add bundlephobia badge to README:
```markdown
[![bundlephobia](https://img.shields.io/bundlephobia/minzip/@your-scope/package)](https://bundlephobia.com/package/@your-scope/package)
```

## Security Headers

**Recommended HTTP Security Headers** (configure in hosting provider):

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()
```

**Note**: CSP is also generated by `vite-plugin-csp` with SRI hashes for all assets.

## GitHub Advanced Security

**Enterprise Feature** (requires GitHub Enterprise)

**Code Scanning**:
- Integrated via CodeQL in `security.yml`
- Detects vulnerabilities in code

**Secret Scanning**:
- Integrated via Gitleaks in `security.yml`
- Push protection prevents secret commits

**Dependency Review**:
- Automatic vulnerability detection
- Block PRs with high/critical vulnerabilities

**Enable**: Repository Settings → Security → Code security and analysis

## CI/CD Pipeline Optimization

### Caching Strategy

**pnpm Store**:
```yaml
- uses: actions/cache@v4
  with:
    path: ${{ env.STORE_PATH }}
    key: ${{ runner.os }}-pnpm-store-${{ hashFiles('**/pnpm-lock.yaml') }}
```

**Nx Cache**:
```yaml
- uses: actions/cache@v4
  with:
    path: .nx/cache
    key: ${{ runner.os }}-nx-${{ hashFiles('**/pnpm-lock.yaml') }}-${{ github.sha }}
```

**Benefits**:
- 50-80% faster CI runs
- Reduced GitHub Actions minutes usage
- Consistent build artifacts

### Matrix Builds

For cross-platform testing:

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]
    node: [25.2.1]
```

**Note**: Current implementation uses single platform (ubuntu-latest) for cost efficiency.

## Cost Optimization

### GitHub Actions Minutes

**Free Tier**:
- Public repos: Unlimited
- Private repos: 2000 minutes/month

**Optimization Strategies**:
1. Use concurrency groups to cancel outdated runs
2. Cache dependencies aggressively
3. Run expensive jobs (mutation testing) only on main
4. Use Nx affected to test only changed packages

### Claude API Usage

**Current Estimate**: ~$10/month for 100 PRs + 50 issues

**Optimization**:
1. Use Sonnet (cheaper) for routine tasks
2. Use Opus (more expensive) only for critical reviews
3. Cache review results for unchanged files
4. Rate limit via concurrency groups

### Storage

**Artifacts Retention**:
- Default: 90 days
- Recommended: 7-30 days for most artifacts
- Coverage reports: 30 days
- Build artifacts: 7 days

**Configuration** (per workflow):
```yaml
- uses: actions/upload-artifact@v4
  with:
    retention-days: 7
```

## Monitoring and Observability

### GitHub Insights

**Repository Insights → Pulse**:
- Activity summary (PRs, issues, contributors)
- Deployment frequency
- Dependency updates

**Repository Insights → Traffic**:
- Clones, visitors, popular content
- Referrers

**Repository Insights → Dependency Graph**:
- Visualize dependencies
- Vulnerability alerts

### Custom Dashboards

**GitHub Projects**:
- Create project board
- Automate card movement via workflows
- Track epic progress

**Example Automation**:
```yaml
- name: Add to Project
  uses: actions/add-to-project@v0.5.0
  with:
    project-url: https://github.com/orgs/your-org/projects/1
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

## External Monitoring

**Recommended Tools**:

1. **Sentry** (https://sentry.io/) - Error tracking, performance monitoring
2. **LogRocket** (https://logrocket.com/) - Session replay, performance insights
3. **Datadog** (https://www.datadoghq.com/) - Full-stack observability
4. **New Relic** (https://newrelic.com/) - APM, infrastructure monitoring

## Support and Resources

**GitHub Discussions**: Enable for community Q&A
**GitHub Wiki**: For extended documentation
**GitHub Pages**: Host generated docs (Storybook, TypeDoc)

---

**Last Updated**: 2025-11-28
**Maintained By**: Parametric Portal Team
