#!/bin/bash
# Idempotent label creation script for Parametric Portal
# Uses --force to update existing labels
# Total: 45 labels across 7 categories

set -e

echo "Creating/updating labels..."

# Type labels (7)
gh label create "type/bug" --color "d73a4a" --description "Something isn't working" --force
gh label create "type/feature" --color "a2eeef" --description "New feature or request" --force
gh label create "type/enhancement" --color "84b6eb" --description "Improvement to existing feature" --force
gh label create "type/docs" --color "0075ca" --description "Documentation only changes" --force
gh label create "type/refactor" --color "fbca04" --description "Code change that neither fixes nor adds" --force
gh label create "type/test" --color "bfd4f2" --description "Test additions or modifications" --force
gh label create "type/chore" --color "fef2c0" --description "Maintenance tasks" --force

# Priority labels (4)
gh label create "priority/critical" --color "b60205" --description "Must be fixed immediately" --force
gh label create "priority/high" --color "d93f0b" --description "Should be addressed soon" --force
gh label create "priority/medium" --color "fbca04" --description "Normal priority" --force
gh label create "priority/low" --color "0e8a16" --description "Can wait" --force

# Scope labels (10)
gh label create "scope/ui" --color "7057ff" --description "UI/UX changes" --force
gh label create "scope/api" --color "1d76db" --description "API changes" --force
gh label create "scope/config" --color "5319e7" --description "Configuration changes" --force
gh label create "scope/deps" --color "0366d6" --description "Dependency updates" --force
gh label create "scope/perf" --color "fbca04" --description "Performance improvements" --force
gh label create "scope/security" --color "b60205" --description "Security related" --force
gh label create "scope/ci" --color "333333" --description "CI/CD changes" --force
gh label create "scope/docs" --color "0075ca" --description "Documentation scope" --force
gh label create "scope/tests" --color "bfd4f2" --description "Testing scope" --force
gh label create "scope/types" --color "1d76db" --description "Type definitions" --force

# Effort labels (4)
gh label create "effort/trivial" --color "c5def5" --description "Less than 1 hour" --force
gh label create "effort/small" --color "bfdadc" --description "1-4 hours" --force
gh label create "effort/medium" --color "fef2c0" --description "1-3 days" --force
gh label create "effort/large" --color "f9d0c4" --description "1+ weeks" --force

# Tech labels (3)
gh label create "tech/react" --color "61dafb" --description "React related" --force
gh label create "tech/effect" --color "8b5cf6" --description "Effect-TS related" --force
gh label create "tech/vite" --color "646cff" --description "Vite related" --force

# Size labels (5)
gh label create "size/XS" --color "c5def5" --description "Extra small change" --force
gh label create "size/S" --color "bfdadc" --description "Small change" --force
gh label create "size/M" --color "fef2c0" --description "Medium change" --force
gh label create "size/L" --color "f9d0c4" --description "Large change" --force
gh label create "size/XL" --color "e99695" --description "Extra large change" --force

# Special labels (12)
gh label create "claude-implement" --color "9b59b6" --description "Request Claude implementation" --force
gh label create "dashboard" --color "006b75" --description "Repository dashboard" --force
gh label create "stale" --color "c4c4c4" --description "No recent activity" --force
gh label create "tech-debt" --color "ffa500" --description "Technical debt" --force
gh label create "needs-triage" --color "e4e669" --description "Needs triage" --force
gh label create "in-progress" --color "ededed" --description "Work in progress" --force
gh label create "pinned" --color "006b75" --description "Pinned issue" --force
gh label create "security" --color "b60205" --description "Security issue" --force
gh label create "automerge" --color "0e8a16" --description "Auto-merge enabled" --force
gh label create "renovate-blocked" --color "d73a4a" --description "Renovate PR blocked" --force
gh label create "good-first-issue" --color "7057ff" --description "Good for newcomers" --force
gh label create "help-wanted" --color "008672" --description "Extra attention needed" --force

echo "Done! Created/updated 45 labels."
exit 0
