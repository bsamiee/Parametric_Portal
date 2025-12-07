#!/usr/bin/env python3
"""SessionStart hook: Inject skill index into context."""

# --- [IMPORTS] ----------------------------------------------------------------
from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass
from functools import reduce
from pathlib import Path
from typing import Final

# --- [TYPES] ------------------------------------------------------------------
type Frontmatter = dict[str, str]
type ParseState = tuple[Frontmatter, str | None, list[str]]

# --- [CONSTANTS] --------------------------------------------------------------
MAX_DESC: Final[int] = 75
WRAPPER: Final[str] = "skills"
SUFFIX: Final[str] = "..."
DEBUG: Final[bool] = os.environ.get("CLAUDE_HOOK_DEBUG", "").lower() in ("1", "true")
MULTILINE: Final[frozenset[str]] = frozenset((">-", ">", "|-", "|"))
FIELD_RE: Final[re.Pattern[str]] = re.compile(r"^([^:]+):(.*)$")


@dataclass(frozen=True, slots=True)
class SkillEntry:
    """Skill with name and description."""

    name: str
    description: str


# --- [PURE_FUNCTIONS] ---------------------------------------------------------
def _debug(msg: str) -> None:
    _ = DEBUG and print(f"[load-skill-index] {msg}", file=sys.stderr)


def _truncate(text: str) -> str:
    return text[:MAX_DESC] + SUFFIX if len(text) > MAX_DESC else text


def _find_end(lines: list[str]) -> int | None:
    return next((i for i, ln in enumerate(lines[1:], 1) if ln.strip() == "---"), None)


def _fold_line(state: ParseState, line: str) -> ParseState:
    """Fold single line into parse state (result, current_field, parts)."""
    result, field, parts = state
    match_ = FIELD_RE.match(line)

    return (
        # Case 1: New field line
        (
            {**result, field: " ".join(parts)} if field and parts else result,
            match_.group(1).strip(),
            [],
        )
        if match_ and not line.startswith(" ") and match_.group(2).strip() in MULTILINE
        # Case 2: New field with inline value
        else (
            {
                **({**result, field: " ".join(parts)} if field and parts else result),
                match_.group(1).strip(): match_.group(2).strip().strip("'\""),
            },
            None,
            [],
        )
        if match_ and not line.startswith(" ")
        # Case 3: Continuation line
        else (result, field, [*parts, line.strip()])
        if field and line.startswith("  ")
        # Case 4: Skip
        else state
    )


def _finalize(state: ParseState) -> Frontmatter:
    """Finalize parse state into frontmatter dict."""
    result, field, parts = state
    return {**result, field: " ".join(parts)} if field and parts else result


def _parse_frontmatter(content: str) -> Frontmatter:
    """Parse YAML frontmatter via fold."""
    lines = content.split("\n")
    end = _find_end(lines) if lines and lines[0].strip() == "---" else None
    return (
        _finalize(reduce(_fold_line, lines[1:end], ({}, None, [])))
        if end is not None
        else {}
    )


def _skill_to_entry(path: Path) -> SkillEntry | None:
    """Transform skill directory to SkillEntry."""
    skill_file = path / "SKILL.md"
    return (
        None
        if not path.is_dir() or not skill_file.exists()
        else _extract_entry(_parse_frontmatter(skill_file.read_text()))
    )


def _extract_entry(fm: Frontmatter) -> SkillEntry | None:
    """Extract SkillEntry from frontmatter."""
    name, desc = fm.get("name", ""), fm.get("description", "")
    return SkillEntry(name, desc) if name and desc else None


def _format_entry(entry: SkillEntry) -> str:
    """Format SkillEntry as index line."""
    return f"{entry.name}: {_truncate(entry.description)}"


# --- [PIPELINE] ---------------------------------------------------------------
def _collect_skills(skills_dir: Path) -> list[SkillEntry]:
    """Collect valid skill entries via filter/map."""
    candidates = [(_skill_to_entry(p), p.name) for p in sorted(skills_dir.iterdir())]
    _ = [_debug(f"Skip: {name}") for entry, name in candidates if entry is None]
    _ = [_debug(f"Added: {e.name}") for e, _ in candidates if e is not None]
    return [entry for entry, _ in candidates if entry is not None]


def _write_env_cache(count: int) -> None:
    """Write skill count to env file if available."""
    env_file = os.environ.get("CLAUDE_ENV_FILE")
    _ = env_file and (
        Path(env_file).open("a").write(f"export CLAUDE_SKILL_COUNT={count}\n"),
        _debug(f"Cached count={count}"),
    )


def _build_response(entries: list[SkillEntry]) -> dict[str, object]:
    """Build JSON response via pure transformation."""
    lines = [_format_entry(e) for e in entries]
    _ = _write_env_cache(len(lines))
    _debug(f"Outputting {len(lines)} skills")
    return {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": f"<{WRAPPER}>\n{'\n'.join(lines)}\n</{WRAPPER}>",
        }
    }


def _run_pipeline(skills_dir: Path) -> str | None:
    """Execute pipeline, return JSON or None."""
    return (
        None
        if not skills_dir.exists()
        else (
            None
            if not (entries := _collect_skills(skills_dir))
            else json.dumps(_build_response(entries))
        )
    )


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> None:
    """Hook entry point."""
    _debug("Starting")
    project_dir = Path(os.environ.get("CLAUDE_PROJECT_DIR", ".")).resolve()
    skills_dir = project_dir / ".claude" / "skills"

    _debug(f"Project: {project_dir}")
    _debug(f"Skills: {skills_dir}")

    result = _run_pipeline(skills_dir)
    _ = result is None and _debug("No skills found")
    _ = result and print(result)
    sys.exit(0)


if __name__ == "__main__":
    main()
