#!/usr/bin/env python3
"""SessionStart hook: Inject skill index and nx targets via XML tags."""

# --- [IMPORTS] ----------------------------------------------------------------
from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass, field
from functools import reduce
from pathlib import Path
from typing import Final, NamedTuple

# --- [TYPES] ------------------------------------------------------------------
type Frontmatter = dict[str, str]
type ParseState = tuple[Frontmatter, str | None, list[str]]


class SkillEntry(NamedTuple):
    """Skill with name and trigger phrase."""

    name: str
    trigger: str


# --- [CONSTANTS] --------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class _B:
    """Immutable configuration constants."""

    multiline: frozenset[str] = frozenset((">-", ">", "|-", "|"))
    field_re: re.Pattern[str] = field(
        default_factory=lambda: re.compile(r"^([^:]+):(.*)$")
    )
    trigger_re: re.Pattern[str] = field(
        default_factory=lambda: re.compile(r"Use (?:when|this|for)[^.]*\.", re.I)
    )
    target_groups: tuple[tuple[str, tuple[str, ...]], ...] = (
        ("quality", ("check", "lint", "fix", "typecheck")),
        ("build", ("build", "dev", "analyze")),
        ("test", ("test", "mutate")),
        ("inspect", ("inspect:build", "inspect:dev")),
        ("util", ("pwa:icons", "pwa:icons:watch")),
    )


B: Final[_B] = _B()
DEBUG: Final[bool] = os.environ.get("CLAUDE_HOOK_DEBUG", "").lower() in ("1", "true")


# --- [PURE_FUNCTIONS] ---------------------------------------------------------
def _debug(msg: str) -> None:
    _ = DEBUG and print(f"[hook] {msg}", file=sys.stderr)


def _find_end(lines: list[str]) -> int | None:
    return next((i for i, ln in enumerate(lines[1:], 1) if ln.strip() == "---"), None)


def _fold_line(state: ParseState, line: str) -> ParseState:
    """Fold single line into parse state via pattern matching."""
    result, current_field, parts = state
    match_ = B.field_re.match(line)

    match (match_, line.startswith(" "), current_field):
        case (m, False, _) if m and m.group(2).strip() in B.multiline:
            finalized = (
                {**result, current_field: " ".join(parts)}
                if current_field and parts
                else result
            )
            return (finalized, m.group(1).strip(), [])
        case (m, False, _) if m:
            finalized = (
                {**result, current_field: " ".join(parts)}
                if current_field and parts
                else result
            )
            return (
                {**finalized, m.group(1).strip(): m.group(2).strip().strip("'\"")},
                None,
                [],
            )
        case (_, True, f) if f:
            return (result, current_field, [*parts, line.strip()])
        case _:
            return state


def _finalize(state: ParseState) -> Frontmatter:
    result, current_field, parts = state
    return (
        {**result, current_field: " ".join(parts)}
        if current_field and parts
        else result
    )


def _parse_frontmatter(content: str) -> Frontmatter:
    lines = content.split("\n")
    end = _find_end(lines) if lines and lines[0].strip() == "---" else None
    return _finalize(reduce(_fold_line, lines[1:end], ({}, None, []))) if end else {}


def _extract_trigger(desc: str) -> str:
    """Extract 'Use when...' phrase or fallback to first sentence."""
    match = B.trigger_re.search(desc)
    return (
        match.group(0) if match else (desc.split(".")[0] + "." if "." in desc else desc)
    )


def _parse_json_file(path: Path) -> dict | None:
    return (
        (json.loads(path.read_text()) if path.exists() and path.is_file() else None)
        if path.suffix == ".json"
        else None
    )


def _skill_to_entry(path: Path) -> SkillEntry | None:
    skill_file = path / "SKILL.md"
    match (path.is_dir(), skill_file.exists()):
        case (True, True):
            fm = _parse_frontmatter(skill_file.read_text())
            name, desc = fm.get("name", ""), fm.get("description", "")
            return SkillEntry(name, _extract_trigger(desc)) if name and desc else None
        case _:
            return None


# --- [COLLECTORS] -------------------------------------------------------------
def _collect_skills(skills_dir: Path) -> list[SkillEntry]:
    candidates = [(p, _skill_to_entry(p)) for p in sorted(skills_dir.iterdir())]
    _ = [_debug(f"Skip: {p.name}") for p, entry in candidates if entry is None]
    return [entry for _, entry in candidates if entry is not None]


def _collect_nx_targets(project_dir: Path) -> frozenset[str]:
    nx_json = _parse_json_file(project_dir / "nx.json")
    return (
        frozenset(nx_json.get("targetDefaults", {}).keys()) if nx_json else frozenset()
    )


# --- [FORMATTERS] -------------------------------------------------------------
def _format_skill_xml(skill: SkillEntry) -> str:
    return f'    <skill name="{skill.name}">{skill.trigger}</skill>'


def _format_group_xml(
    name: str, targets: tuple[str, ...], available: frozenset[str]
) -> str | None:
    found = [t for t in targets if t in available]
    return f'    <group name="{name}">{" ".join(found)}</group>' if found else None


def _format_xml(skills: list[SkillEntry], targets: frozenset[str]) -> str:
    """Format as XML tags per Anthropic Claude 4.x best practices."""
    skill_lines = [_format_skill_xml(s) for s in skills]
    group_lines = [
        line
        for name, group_targets in B.target_groups
        if (line := _format_group_xml(name, group_targets, targets))
    ]

    # Add ungrouped targets
    used = {t for _, group in B.target_groups for t in group}
    ungrouped = sorted(targets - used)
    _ = ungrouped and group_lines.append(
        f'    <group name="other">{" ".join(ungrouped)}</group>'
    )

    return "\n".join(
        [
            "<session_context>",
            f'  <skills count="{len(skills)}">',
            *skill_lines,
            "  </skills>",
            '  <nx_targets command="nx run-many -t {target}">',
            *group_lines,
            "  </nx_targets>",
            "</session_context>",
        ]
    )


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> None:
    _debug("Starting")
    project_dir = Path(os.environ.get("CLAUDE_PROJECT_DIR", ".")).resolve()
    skills_dir = project_dir / ".claude" / "skills"

    skills = _collect_skills(skills_dir) if skills_dir.exists() else []
    targets = _collect_nx_targets(project_dir)

    _debug(f"Found: {len(skills)} skills, {len(targets)} targets")

    match (skills, targets):
        case ([], ts) if not ts:
            _debug("No skills or targets found")
        case _:
            print(_format_xml(skills, targets))

    sys.exit(0)


if __name__ == "__main__":
    main()
