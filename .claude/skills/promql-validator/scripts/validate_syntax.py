#!/usr/bin/env python3
# ruff: noqa: ARG005
"""PromQL Syntax Validator -- checks metric names, label matchers, functions, durations, delimiters.

Commands:
    validate <query>    Validate PromQL syntax (JSON output)
"""

from functools import reduce
import json
import re
import sys
from typing import Final

from _common import (
    CheckSpec,
    cmd,
    CommandRegistry,
    dispatch,
    DURATION,
    Finding,
    FUNCTIONS,
    KEYWORDS,
    levenshtein,
    RE_FUNC_CALL,
    RE_METRIC_NAME,
    RE_STRING_LITERAL,
    run_check_specs,
)


# --- [CONSTANTS] --------------------------------------------------------------

_DELIMITER_PAIRS: Final[dict[str, str]] = {"[": "]", "{": "}", "(": ")"}
_CLOSER_TO_OPENER: Final[dict[str, str]] = {closer: opener for opener, closer in _DELIMITER_PAIRS.items()}
_OPENER_LABELS: Final[dict[str, str]] = {"[": "bracket", "{": "brace", "(": "paren"}

_RE_EMPTY_MATCHER: Final = re.compile(r"\{\s*\}")
_RE_RANGE_CONTENT: Final = re.compile(r"\[([^\]]+)\]")
_RE_DURATION_FULL: Final = re.compile(DURATION)
_RE_UTF8_METRIC: Final = re.compile(r'\{\s*"([^"]+)"')
_RE_DOT_METRIC_IN_SELECTOR: Final = re.compile(r"\{\s*([a-zA-Z_]\w*\.\w[\w.]+)\s*[=!<>~]")

# --- [DATA_DRIVEN_CHECKS] ----------------------------------------------------

_SYNTAX_SPECS: Final = (
    CheckSpec(
        name="missing_range_vector",
        pattern=re.compile(
            r"\b(rate|irate|increase|delta|idelta)\s*\(\s*[a-zA-Z_:][a-zA-Z0-9_:]*\s*(?:\{[^}]*\})?\s*\)"
        ),
        severity="error",
        message_fn=lambda match: "rate/irate/increase/delta/idelta require range vector [duration]",
        recommendation="Add [5m] or appropriate range vector after the metric selector",
    ),
    CheckSpec(
        name="misplaced_offset",
        pattern=re.compile(r"\boffset\s+\d+[smhdwy]\s*\[", re.IGNORECASE),
        severity="error",
        message_fn=lambda match: "offset must come after range vector, not before",
        recommendation="Move offset after the range: metric[5m] offset 1h",
    ),
    CheckSpec(
        name="double_operator",
        pattern=re.compile(r"(?<!\*)[+\-*/]{2,}(?!\*)"),
        severity="warning",
        message_fn=lambda match: "Consecutive operators -- possible typo",
        recommendation="",
    ),
)

# --- [DISPATCH] ---------------------------------------------------------------

CMDS: CommandRegistry = {}

# --- [FUNCTIONS] --------------------------------------------------------------


def _check_delimiters(query: str) -> list[Finding]:
    """Check balanced brackets, braces, parens, and quotes via single-pass fold."""
    def _fold(
        state: tuple[dict[str, list[int]], list[Finding], bool, bool], indexed: tuple[int, str]
    ) -> tuple[dict[str, list[int]], list[Finding], bool, bool]:
        stacks, errors, in_string, esc = state
        pos, ch = indexed
        match (esc, ch, in_string):
            case (True, _, _):
                return (stacks, errors, in_string, False)
            case (_, "\\", _):
                return (stacks, errors, in_string, True)
            case (_, '"', _):
                return (stacks, errors, not in_string, False)
            case (_, _, True):
                return (stacks, errors, in_string, False)
            case (_, opener, False) if opener in stacks:
                stacks[opener].append(pos)
                return (stacks, errors, False, False)
            case (_, closer, False) if closer in _CLOSER_TO_OPENER:
                opener = _CLOSER_TO_OPENER[closer]
                match stacks[opener]:
                    case []:
                        label = _OPENER_LABELS[opener]
                        errors.append({
                            "type": f"unmatched_{label}",
                            "message": f"Unmatched closing {label} at position {pos}",
                            "position": pos,
                            "severity": "error",
                        })
                    case [*_, _]:
                        stacks[opener].pop()
                return (stacks, errors, False, False)
            case _:
                return (stacks, errors, False, False)
    stacks, errors, in_string, _ = reduce(_fold, enumerate(query), ({"[": [], "{": [], "(": []}, [], False, False))
    return (
        errors
        + (
            [{"type": "unclosed_string", "message": "Unclosed string literal", "severity": "error"}]
            if in_string
            else []
        )
        + [
            {
                "type": f"unclosed_{_OPENER_LABELS[opener]}",
                "message": f"Unclosed {_OPENER_LABELS[opener]} at position {pos}",
                "position": pos,
                "severity": "error",
            }
            for opener, stack in stacks.items()
            for pos in stack
        ]
    )


def _classify_utf8_metric(name: str) -> list[Finding]:
    """Classify a single UTF-8 metric name into findings."""
    match (RE_METRIC_NAME.fullmatch(name), not name.strip() or "\x00" in name):
        case (object(), _):
            return [
                {
                    "type": "utf8_metric_unnecessary_quoting",
                    "message": f'"{name}" valid in classic format, quoting unnecessary',
                    "severity": "info",
                }
            ]
        case (None, True):
            return [
                {
                    "type": "invalid_utf8_metric",
                    "message": f'Invalid UTF-8 metric name: "{name}"',
                    "severity": "error",
                }
            ]
        case _:
            return []


def _check_selectors(query: str) -> list[Finding]:
    """Check metric selectors and UTF-8 syntax."""
    query_clean = RE_STRING_LITERAL.sub('""', query)
    empty_matcher = (
        [
            {
                "type": "empty_label_matcher",
                "message": "Empty label matcher {} may match many series",
                "severity": "warning",
            }
        ]
        if _RE_EMPTY_MATCHER.search(query_clean)
        else []
    )
    utf8_findings = [finding for m in _RE_UTF8_METRIC.finditer(query) for finding in _classify_utf8_metric(m.group(1))]
    dot_findings = [
        {
            "type": "possible_utf8_syntax_error",
            "message": f'"{m.group(1)}" has dots -- use {{"{m.group(1)}"}} for UTF-8 metric',
            "severity": "warning",
        }
        for m in _RE_DOT_METRIC_IN_SELECTOR.finditer(query_clean)
    ]
    return empty_matcher + utf8_findings + dot_findings


def _validate_range_content(content: str) -> list[Finding]:
    """Validate a single range/subquery content string."""
    parts = content.split(":")
    match len(parts):
        case 1 if not _RE_DURATION_FULL.fullmatch(content):
            return [{"type": "invalid_duration", "message": f"Invalid duration: {content}", "severity": "error"}]
        case n if n > 2:
            return [{"type": "invalid_subquery", "message": f"Invalid subquery: [{content}]", "severity": "error"}]
        case _:
            return [
                {"type": "invalid_duration", "message": f"Invalid duration: {part}", "severity": "error"}
                for part in (segment.strip() for segment in parts)
                if part and not _RE_DURATION_FULL.fullmatch(part)
            ]


def _check_time_ranges(query: str) -> list[Finding]:
    """Check duration syntax in range vectors and subqueries."""
    return [finding for raw in _RE_RANGE_CONTENT.findall(query) for finding in _validate_range_content(raw.strip())]


def _check_functions(query: str) -> list[Finding]:
    """Check for unknown function names with typo suggestions."""
    return [
        {
            "type": "unknown_function",
            "message": f"Unknown function: {func}"
            + (
                f". Did you mean: {', '.join(close)}?"
                if (
                    close := [
                        c
                        for c in FUNCTIONS
                        if abs(len(func.lower()) - len(c)) <= 2 and levenshtein(func.lower(), c) <= 2
                    ][:3]
                )
                else ""
            ),
            "severity": "error",
        }
        for func in RE_FUNC_CALL.findall(query)
        if func.lower() not in KEYWORDS and func.lower() not in FUNCTIONS
    ]


# --- [COMMANDS] ---------------------------------------------------------------


@cmd(CMDS, 1)
def validate(query: str) -> str:
    """Validate PromQL syntax. Returns JSON with status, errors, warnings.

    Args:
        query: PromQL query string to validate.

    Returns:
        JSON string with status, query, errors, warnings, and valid flag.
    """
    query = query.strip()
    if not query:
        return json.dumps(
            {
                "status": "ERROR",
                "query": "",
                "errors": [{"type": "empty_query", "message": "Query is empty", "severity": "error"}],
                "warnings": [],
                "valid": False,
            },
            indent=2,
        )
    spec_findings = run_check_specs(query, _SYNTAX_SPECS)
    custom_findings = [
        finding for check_fn in (_check_delimiters, _check_functions, _check_time_ranges) for finding in check_fn(query)
    ]
    all_errors = [finding for finding in spec_findings + custom_findings if finding["severity"] == "error"]
    all_warnings = [finding for finding in spec_findings + custom_findings if finding["severity"] == "warning"]
    selector_warnings = _check_selectors(query)
    match (bool(all_errors), bool(all_warnings or selector_warnings)):
        case (True, _):
            status = "ERROR"
        case (False, True):
            status = "WARNING"
        case _:
            status = "VALID"
    return json.dumps(
        {
            "status": status,
            "query": query,
            "errors": all_errors,
            "warnings": all_warnings + selector_warnings,
            "valid": not all_errors,
        },
        indent=2,
    )


# --- [ENTRY_POINT] ------------------------------------------------------------


def main() -> int:
    """Dispatch command and print output.

    Returns:
        Exit code: 0 if query is valid, 1 otherwise.
    """
    return dispatch(CMDS, "validate_syntax.py", exit_key="valid")


if __name__ == "__main__":
    sys.exit(main())
