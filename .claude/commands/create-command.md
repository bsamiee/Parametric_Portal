---
description: Create new slash command via command-builder workflow (project)
argument-hint: [command-name] [pattern: file|multi|agent|skill|free] [purpose?]
---

## Parameters
Name: $1
Pattern: $2
Purpose: ${3:-unspecified}

## Infrastructure
@.claude/skills/command-builder/SKILL.md
@.claude/skills/parallel-dispatch/SKILL.md
@.claude/skills/deep-research/SKILL.md
@.claude/styles/report.md

## Task
Execute command-builder **Tasks:** with Scope=create, Name=$1, Pattern=$2.

Purpose=${3:-unspecified} provides triggers, arguments, and use-cases for requirements capture.
