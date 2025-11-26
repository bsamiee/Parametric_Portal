# Agent Context Query Protocol

Machine-readable repository context for AI agents and automation tools.

## Overview

The agent context system provides a **single source of truth** for understanding the repository structure, dependencies, and public APIs. This enables AI agents to make informed decisions without scanning the entire codebase.

## Files

### `project-map.json`

**Purpose**: Comprehensive repository metadata

**Schema**:
```typescript
{
  workspace: {
    root: string;           // Workspace root path
    packageManager: string; // "pnpm"
    nxVersion: string;      // "22.2.0-canary.20251121-9a6c7ad"
  };
  projects: Record<string, {
    root: string;           // Project root path
    sourceRoot: string;     // Source code directory
    dependencies: string[]; // Direct dependencies
    exports: Record<string, string>; // package.json exports
    publicApi: string[];    // Exported symbols
  }>;
  graph: {
    nodes: Array<{ name: string; type: string; data: object }>;
    edges: Array<{ source: string; target: string; type: string }>;
    cycles: string[][];     // Circular dependency chains
  };
  imports: Record<string, string>; // Path alias mappings (@/*)
}
```

**Generation**: `pnpm generate:context` (runs `tools/generate-context/index.ts`)

**Update Frequency**:
- On every CI run (main branch push)
- Manually via `pnpm generate:context`
- Automatically in CI workflows

**Freshness Guarantee**: ≤5 minutes on main branch (CI upload)

## Query Examples

### CLI (jq)

**List all packages**:
```bash
jq -r '.projects | keys[]' project-map.json
```

**Get package dependencies**:
```bash
jq -r '.projects["@parametric/components"].dependencies[]' project-map.json
```

**Find packages depending on a specific package**:
```bash
jq -r '
  .graph.edges[] 
  | select(.target == "@parametric/theme") 
  | .source
' project-map.json
```

**Check for circular dependencies**:
```bash
jq -r '.graph.cycles | length' project-map.json
```

**Get public API surface**:
```bash
jq -r '.projects["@parametric/components"].publicApi[]' project-map.json
```

**Find packages by type** (app vs library):
```bash
jq -r '
  .graph.nodes[] 
  | select(.type == "lib") 
  | .name
' project-map.json
```

### TypeScript

**Load and query**:
```typescript
import { readFileSync } from 'node:fs';
import * as S from '@effect/schema/Schema';
import { Effect, pipe } from 'effect';
import { ProjectMapSchema } from './tools/generate-context/schema';

const loadProjectMap = (): Effect.Effect<ProjectMap, never, never> =>
  pipe(
    Effect.try(() => readFileSync('docs/agent-context/project-map.json', 'utf8')),
    Effect.flatMap((content) => 
      Effect.try(() => JSON.parse(content))
    ),
    Effect.flatMap((data) => 
      S.decodeUnknown(ProjectMapSchema)(data)
    ),
    Effect.orDie
  );

// Usage
const projectMap = Effect.runSync(loadProjectMap());

// Find affected packages by changed file
const findAffectedPackages = (changedFile: string): ReadonlyArray<string> => {
  const changedProject = Object.entries(projectMap.projects).find(
    ([_, project]) => changedFile.startsWith(project.root)
  )?.[0];

  if (!changedProject) return [];

  // Recursive BFS to find all dependents (no loops, no mutations)
  const findDependentsRecursive = (
    queue: ReadonlyArray<string>,
    visited: ReadonlySet<string>,
    edges: ReadonlyArray<Edge>
  ): ReadonlyArray<string> =>
    queue.length === 0
      ? Array.from(visited)
      : pipe(
          edges.filter(e => e.target === queue[0]),
          newEdges => findDependentsRecursive(
            [...queue.slice(1), ...newEdges.map(e => e.source).filter(s => !visited.has(s))],
            new Set([...visited, queue[0]]),
            edges
          )
        );

  return findDependentsRecursive([changedProject], new Set<string>(), projectMap.graph.edges);
};
```

### Python (for ML workflows)

**Load and query**:
```python
import json
from typing import Dict, List, Set

def load_project_map(path: str = 'docs/agent-context/project-map.json') -> Dict:
    with open(path, 'r') as f:
        return json.load(f)

def find_dependents(project_map: Dict, target: str) -> Set[str]:
    """Find all packages that depend on target package"""
    edges = project_map['graph']['edges']
    return {edge['source'] for edge in edges if edge['target'] == target}

def get_export_map(project_map: Dict) -> Dict[str, List[str]]:
    """Get mapping of packages to their public exports"""
    return {
        name: project['publicApi']
        for name, project in project_map['projects'].items()
    }
```

### Bash (for CI scripts)

**Query in CI**:
```bash
#!/bin/bash
# Find packages affected by changed files

changed_files=$(git diff --name-only HEAD~1 HEAD)
affected_packages=()

for file in $changed_files; do
  # Find which package contains this file
  package=$(jq -r "
    .projects 
    | to_entries[] 
    | select(.value.root as \$root | \"$file\" | startswith(\$root)) 
    | .key
  " project-map.json)
  
  if [ -n "$package" ]; then
    affected_packages+=("$package")
  fi
done

# Deduplicate
affected_packages=($(echo "${affected_packages[@]}" | tr ' ' '\n' | sort -u))

echo "Affected packages: ${affected_packages[@]}"
```

## Integration with AI Agents

### Claude Code

**Prompt Template**:
```markdown
Context: I'm working on the Parametric Portal monorepo.

Repository Structure:
{contents of project-map.json}

Task: {specific task}

Please consider:
1. Dependencies between packages
2. Public API contracts
3. Import path aliases
4. Circular dependency constraints
```

### GitHub Copilot

**Workspace Context**: GitHub Copilot automatically indexes repository files, including `project-map.json`.

**Usage**: Reference packages by name, and Copilot will suggest imports based on the graph.

### Custom Agents

**Input**: Pass `project-map.json` as context
**Output**: Use graph to determine:
- Which packages to test
- Which documentation to update
- Breaking change impact radius
- Migration ordering (topological sort)

## Parsing AGENT_CONTEXT from Templates

**Tool**: `tools/parse-agent-context.ts`

**Usage**:
```bash
# Extract context from issue body
echo "$ISSUE_BODY" | pnpm parse:context

# Output (JSON):
{
  "type": "feature",
  "scope": ["packages/components"],
  "agents": ["typescript-advanced", "testing-specialist"],
  "patterns": ["Effect-pipeline", "Option-monad"],
  "priority": "p1",
  "breaking": false,
  "test_coverage": "required"
}
```

**In Workflows**:
```yaml
- name: Parse Agent Context
  id: context
  run: |
    context=$(echo "${{ github.event.issue.body }}" | pnpm parse:context)
    echo "context=$context" >> $GITHUB_OUTPUT

- name: Use Context
  run: |
    agents=$(echo '${{ steps.context.outputs.context }}' | jq -r '.agents[]')
    echo "Recommended agents: $agents"
```

## Schema Validation

**Effect Schema**: `tools/generate-context/schema.ts`

```typescript
export const ProjectMapSchema = S.Struct({
  workspace: S.Struct({
    root: S.String,
    packageManager: S.String,
    nxVersion: S.String,
  }),
  projects: S.Record(
    S.String,
    S.Struct({
      root: S.String,
      sourceRoot: S.String,
      dependencies: S.Array(S.String),
      exports: S.Record(S.String, S.String),
      publicApi: S.Array(S.String),
    })
  ),
  graph: S.Struct({
    nodes: S.Array(
      S.Struct({
        name: S.String,
        type: S.String,
        data: S.Record(S.String, S.Unknown),
      })
    ),
    edges: S.Array(
      S.Struct({
        source: S.String,
        target: S.String,
        type: S.String,
      })
    ),
    cycles: S.Array(S.Array(S.String)),
  }),
  imports: S.Record(S.String, S.String),
});

export type ProjectMap = S.Schema.Type<typeof ProjectMapSchema>;
```

**Validation**:
```typescript
import { ProjectMapSchema } from './schema';
import * as S from '@effect/schema/Schema';

const validate = (data: unknown): ProjectMap => {
  return S.decodeUnknownSync(ProjectMapSchema)(data);
};
```

## Advanced Queries

### Topological Sort (for build/migration order)

```typescript
const topologicalSort = (projectMap: ProjectMap): ReadonlyArray<string> => {
  // Build adjacency list and in-degree immutably
  const packages = Object.keys(projectMap.projects);
  
  const graph = packages.reduce(
    (acc, pkg) => ({ ...acc, [pkg]: [] as ReadonlyArray<string> }),
    {} as Record<string, ReadonlyArray<string>>
  );
  
  const initialInDegree = packages.reduce(
    (acc, pkg) => ({ ...acc, [pkg]: 0 }),
    {} as Record<string, number>
  );
  
  const { graph: adjacencyList, inDegree } = projectMap.graph.edges.reduce(
    (acc, { source, target }) => ({
      graph: {
        ...acc.graph,
        [target]: [...(acc.graph[target] || []), source]
      },
      inDegree: {
        ...acc.inDegree,
        [source]: (acc.inDegree[source] || 0) + 1
      }
    }),
    { graph, inDegree: initialInDegree }
  );

  // Kahn's algorithm using pure recursion (no mutations)
  const processQueue = (
    queue: ReadonlyArray<string>,
    sorted: ReadonlyArray<string>,
    degrees: Record<string, number>
  ): ReadonlyArray<string> => {
    if (queue.length === 0) return sorted;

    const [current, ...remaining] = queue;
    const dependents = adjacencyList[current] || [];
    
    const { newQueue, newDegrees } = dependents.reduce(
      (acc, dependent) => {
        const degree = acc.newDegrees[dependent] - 1;
        return {
          newQueue: degree === 0 ? [...acc.newQueue, dependent] : acc.newQueue,
          newDegrees: { ...acc.newDegrees, [dependent]: degree }
        };
      },
      { newQueue: remaining, newDegrees: degrees }
    );

    return processQueue(newQueue, [...sorted, current], newDegrees);
  };

  const initialQueue = packages.filter(pkg => inDegree[pkg] === 0);
  return processQueue(initialQueue, [], inDegree);
};
```

### Find Breaking Change Impact

```typescript
const findBreakingChangeImpact = (
  projectMap: ProjectMap,
  changedPackage: string
): { readonly immediate: ReadonlyArray<string>; readonly transitive: ReadonlyArray<string> } => {
  const immediate = projectMap.graph.edges
    .filter((edge) => edge.target === changedPackage)
    .map((edge) => edge.source);

  // Recursive BFS traversal without loops
  const findTransitive = (
    queue: ReadonlyArray<string>,
    visited: ReadonlySet<string>
  ): ReadonlySet<string> => {
    if (queue.length === 0) return visited;

    const [current, ...remaining] = queue;
    const newVisited = new Set([...visited, current]);
    
    const newDependents = projectMap.graph.edges
      .filter((edge) => edge.target === current)
      .map((edge) => edge.source)
      .filter((source) => !newVisited.has(source) && !immediate.includes(source));

    return findTransitive([...remaining, ...newDependents], newVisited);
  };

  const transitiveSet = findTransitive(immediate, new Set<string>());

  return {
    immediate,
    transitive: Array.from(transitiveSet).filter((pkg) => !immediate.includes(pkg)),
  };
};
```

## Maintenance

**Regenerate Context**:
```bash
pnpm generate:context
```

**Verify Integrity**:
```bash
# Check for cycles
if [ "$(jq '.graph.cycles | length' project-map.json)" -gt 0 ]; then
  echo "ERROR: Circular dependencies detected"
  jq '.graph.cycles' project-map.json
  exit 1
fi
```

**CI Integration**: Automatically regenerated on every main branch push (see `ci.yml`)

## Best Practices

1. **Always use latest context**: Fetch `project-map.json` from main branch or regenerate locally
2. **Validate schema**: Use `ProjectMapSchema` for type-safe access
3. **Cache queries**: Compute expensive queries once, cache results
4. **Handle missing data**: Use Option/Either for safe access
5. **Document custom queries**: Add examples to this file for team reference

## Troubleshooting

**Context out of date?**
- Run `pnpm generate:context` locally
- Check CI artifact upload in workflow

**Missing package?**
- Verify package.json exists in package directory
- Check Nx project configuration in nx.json
- Regenerate context

**Schema validation fails?**
- Check TypeScript version (6.0-dev required)
- Verify Effect/schema version (3.19.6+)
- Regenerate context with latest schema

---

**Last Updated**: 2025-11-26
**Maintained By**: Parametric Portal Team
