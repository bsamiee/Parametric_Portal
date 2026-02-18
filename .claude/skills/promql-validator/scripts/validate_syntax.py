#!/usr/bin/env python3
# ruff: noqa: ARG005
"""PromQL Syntax Validator -- checks metric names, label matchers, functions, durations, delimiters.

Commands:
    validate <query>    Validate PromQL syntax (JSON output)
"""

import json
import re
import sys
from functools import reduce
from typing import Final

from _common import (
    DURATION,
    FUNCTIONS,
    KEYWORDS,
    RE_FUNC_CALL,
    RE_METRIC_NAME,
    RE_STRING_LITERAL,
    CheckSpec,
    CommandRegistry,
    Finding,
    cmd,
    dispatch,
    levenshtein,
    run_check_specs,
)

# --- [CONSTANTS] --------------------------------------------------------------

_DELIMITER_PAIRS: Final[dict[str, str]] = {'[': ']', '{': '}', '(': ')'}
_CLOSER_TO_OPENER: Final[dict[str, str]] = {closer: opener for opener, closer in _DELIMITER_PAIRS.items()}
_OPENER_LABELS: Final[dict[str, str]] = {'[': 'bracket', '{': 'brace', '(': 'paren'}

_RE_EMPTY_MATCHER: Final = re.compile(r'\{\s*\}')
_RE_RANGE_CONTENT: Final = re.compile(r'\[([^\]]+)\]')
_RE_DURATION_FULL: Final = re.compile(DURATION)
_RE_UTF8_METRIC: Final = re.compile(r'\{\s*"([^"]+)"')
_RE_DOT_METRIC_IN_SELECTOR: Final = re.compile(r'\{\s*([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]+)\s*[=!<>~]')

# --- [DATA_DRIVEN_CHECKS] ----------------------------------------------------

_SYNTAX_SPECS: Final = (
    CheckSpec(
        name='missing_range_vector',
        pattern=re.compile(
            r'\b(rate|irate|increase|delta|idelta)\s*\(\s*[a-zA-Z_:][a-zA-Z0-9_:]*\s*(?:\{[^}]*\})?\s*\)'
        ),
        severity='error',
        message_fn=lambda match: 'rate/irate/increase/delta/idelta require range vector [duration]',
        recommendation='Add [5m] or appropriate range vector after the metric selector',
    ),
    CheckSpec(
        name='misplaced_offset',
        pattern=re.compile(r'\boffset\s+\d+[smhdwy]\s*\[', re.IGNORECASE),
        severity='error',
        message_fn=lambda match: 'offset must come after range vector, not before',
        recommendation='Move offset after the range: metric[5m] offset 1h',
    ),
    CheckSpec(
        name='double_operator',
        pattern=re.compile(r'(?<!\*)[+\-*/]{2,}(?!\*)'),
        severity='warning',
        message_fn=lambda match: 'Consecutive operators -- possible typo',
        recommendation='',
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
        stacks, errors, in_string, escape = state
        position, character = indexed
        match character:
            case _ if escape:
                return (stacks, errors, in_string, False)
            case '\\':
                return (stacks, errors, in_string, True)
            case '"':
                return (stacks, errors, not in_string, False)
            case _ if in_string:
                return (stacks, errors, in_string, False)
            case opener if opener in stacks:
                stacks[opener].append(position)
                return (stacks, errors, False, False)
            case closer if closer in _CLOSER_TO_OPENER:
                opener = _CLOSER_TO_OPENER[closer]
                if not stacks[opener]:
                    label = _OPENER_LABELS[opener]
                    errors.append(
                        {
                            'type': f'unmatched_{label}',
                            'message': f'Unmatched closing {label} at position {position}',
                            'position': position,
                            'severity': 'error',
                        }
                    )
                else:
                    stacks[opener].pop()
                return (stacks, errors, False, False)
            case _:
                return (stacks, errors, False, False)

    stacks, errors, in_string, _ = reduce(_fold, enumerate(query), ({'[': [], '{': [], '(': []}, [], False, False))
    return (
        errors
        + (
            [{'type': 'unclosed_string', 'message': 'Unclosed string literal', 'severity': 'error'}]
            if in_string
            else []
        )
        + [
            {
                'type': f'unclosed_{_OPENER_LABELS[opener]}',
                'message': f'Unclosed {_OPENER_LABELS[opener]} at position {pos}',
                'position': pos,
                'severity': 'error',
            }
            for opener, stack in stacks.items()
            for pos in stack
        ]
    )


def _check_selectors(query: str) -> list[Finding]:
    """Check metric selectors and UTF-8 syntax.

    Args:
        query: PromQL query string to validate.

    Returns:
        List of finding dicts for selector issues.
    """
    query_clean = RE_STRING_LITERAL.sub('""', query)
    findings: list[Finding] = []

    if _RE_EMPTY_MATCHER.search(query_clean):
        findings.append(
            {
                'type': 'empty_label_matcher',
                'message': 'Empty label matcher {} may match many series',
                'severity': 'warning',
            }
        )

    for match in _RE_UTF8_METRIC.finditer(query):
        name = match.group(1)
        if RE_METRIC_NAME.fullmatch(name):
            findings.append(
                {
                    'type': 'utf8_metric_unnecessary_quoting',
                    'message': f'"{name}" valid in classic format, quoting unnecessary',
                    'severity': 'info',
                }
            )
        elif not name.strip() or '\x00' in name:
            findings.append(
                {'type': 'invalid_utf8_metric', 'message': f'Invalid UTF-8 metric name: "{name}"', 'severity': 'error'}
            )

    findings.extend(
        {
            'type': 'possible_utf8_syntax_error',
            'message': f'"{match.group(1)}" has dots -- use {{"{match.group(1)}"}} for UTF-8 metric',
            'severity': 'warning',
        }
        for match in _RE_DOT_METRIC_IN_SELECTOR.finditer(query_clean)
    )

    return findings


def _check_time_ranges(query: str) -> list[Finding]:
    """Check duration syntax in range vectors and subqueries.

    Args:
        query: PromQL query string to validate.

    Returns:
        List of finding dicts for invalid durations and subqueries.
    """
    findings: list[Finding] = []
    for raw in _RE_RANGE_CONTENT.findall(query):
        content = raw.strip()
        parts = content.split(':')
        if len(parts) == 1 and not _RE_DURATION_FULL.fullmatch(content):
            findings.append(
                {'type': 'invalid_duration', 'message': f'Invalid duration: {content}', 'severity': 'error'}
            )
        elif len(parts) > 2:
            findings.append(
                {'type': 'invalid_subquery', 'message': f'Invalid subquery: [{content}]', 'severity': 'error'}
            )
        else:
            findings.extend(
                {'type': 'invalid_duration', 'message': f'Invalid duration: {part}', 'severity': 'error'}
                for part in (segment.strip() for segment in parts)
                if part and not _RE_DURATION_FULL.fullmatch(part)
            )
    return findings


def _check_functions(query: str) -> list[Finding]:
    """Check for unknown function names with typo suggestions."""
    return [
        {
            'type': 'unknown_function',
            'message': f'Unknown function: {func}'
            + (
                f'. Did you mean: {", ".join(close)}?'
                if (
                    close := [
                        c
                        for c in FUNCTIONS
                        if abs(len(func.lower()) - len(c)) <= 2 and levenshtein(func.lower(), c) <= 2
                    ][:3]
                )
                else ''
            ),
            'severity': 'error',
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
                'status': 'ERROR',
                'query': '',
                'errors': [{'type': 'empty_query', 'message': 'Query is empty', 'severity': 'error'}],
                'warnings': [],
                'valid': False,
            },
            indent=2,
        )

    spec_findings = run_check_specs(query, _SYNTAX_SPECS)
    custom_findings = [
        finding for check_fn in (_check_delimiters, _check_functions, _check_time_ranges) for finding in check_fn(query)
    ]

    all_errors = [finding for finding in spec_findings + custom_findings if finding['severity'] == 'error']
    all_warnings = [finding for finding in spec_findings + custom_findings if finding['severity'] == 'warning']
    selector_warnings = _check_selectors(query)

    status = 'ERROR' if all_errors else ('WARNING' if all_warnings or selector_warnings else 'VALID')
    return json.dumps(
        {
            'status': status,
            'query': query,
            'errors': all_errors,
            'warnings': all_warnings + selector_warnings,
            'valid': not all_errors,
        },
        indent=2,
    )


# --- [ENTRY_POINT] ------------------------------------------------------------


def main() -> int:
    """Dispatch command and print output.

    Returns:
        Exit code: 0 if query is valid, 1 otherwise.
    """
    return dispatch(CMDS, 'validate_syntax.py', exit_key='valid')


if __name__ == '__main__':
    sys.exit(main())
