---
description: Create new agent via agent-builder workflow (project)
argument-hint: [agent-name] [type: readonly|write|orchestrator|full] [purpose?]
---

## Parameters
Name: $1
Type: $2
Purpose: ${3:-unspecified}

## Infrastructure
@.claude/skills/agent-builder/SKILL.md
@.claude/skills/parallel-dispatch/SKILL.md
@.claude/skills/deep-research/SKILL.md
@.claude/styles/report.md

## Task
Execute agent-builder **Tasks:** with Scope=create, Name=$1, Type=$2.

Purpose=${3:-unspecified} provides triggers, use-cases, and deliverables for requirements capture.
