#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx", "msgspec"]
# ///
"""Greptile API — codebase-aware queries via typed polymorphic dispatch."""

# --- [IMPORTS] ----------------------------------------------------------------
import os
import sys
from typing import Any, Final, Literal, NamedTuple
from urllib.parse import quote

import httpx
import msgspec

# --- [TYPES] ------------------------------------------------------------------
type Remote = Literal["github", "gitlab"]
type Method = Literal["GET", "POST"]
type Args = dict[str, Any]
type Result[T] = tuple[Literal["ok"], T] | tuple[Literal["err"], str, bool]
type Build = tuple[Method, str, msgspec.Struct | None]


# --- [SCHEMA] -----------------------------------------------------------------
class Cfg(msgspec.Struct, frozen=True, kw_only=True):
    """Immutable configuration."""
    base: str = "https://api.greptile.com/v2"
    env_greptile: str = "GREPTILE_TOKEN"
    env_gh: str = "GITHUB_TOKEN"
    env_gh_alt: str = "GH_TOKEN"
    timeout: int = 60
    timeout_query: int = 300
    remote: Remote = "github"
    branch: str = "main"
    repo: str = "bsamiee/Parametric_Portal"
    ok_max: int = 399
    server_err: int = 500


class Cmd(NamedTuple):
    """Command metadata."""
    desc: str
    opts: str
    required: tuple[str, ...] = ()


class Spec(msgspec.Struct, frozen=True):
    """Repository specification."""
    remote: Remote = "github"
    branch: str = "main"
    repository: str = "bsamiee/Parametric_Portal"


class Msg(msgspec.Struct, frozen=True):
    """Chat message."""
    id: str
    content: str
    role: Literal["user", "assistant"] = "user"


class IndexReq(msgspec.Struct, frozen=True):
    """Index request body."""
    remote: Remote
    repository: str
    branch: str
    reload: bool = True
    notify: bool = False


class QueryReq(msgspec.Struct, frozen=True):
    """Query request body."""
    messages: list[Msg]
    repositories: list[Spec]
    genius: bool = False
    stream: bool = False


class Src(msgspec.Struct, frozen=True):
    """Source reference."""
    repository: str = ""
    remote: str = ""
    branch: str = ""
    filepath: str = ""
    linestart: int | None = None
    lineend: int | None = None
    summary: str = ""


class IndexResp(msgspec.Struct, frozen=True):
    """Index response."""
    message: str = ""
    statusEndpoint: str = ""  # noqa: N815


class StatusResp(msgspec.Struct, frozen=True):
    """Status response."""
    sha: str | None = None
    status: str = ""
    repository: str = ""
    remote: str = ""
    branch: str = ""
    filesProcessed: int = 0  # noqa: N815
    numFiles: int = 0  # noqa: N815
    private: bool = False


class QueryResp(msgspec.Struct, frozen=True):
    """Query response."""
    message: str = ""
    sources: list[Src] = []


# --- [CONSTANTS] --------------------------------------------------------------
C: Final[Cfg] = Cfg()
SCRIPT: Final[str] = "uv run .claude/skills/greptile-tools/scripts/greptile.py"
CMDS: Final[dict[str, Cmd]] = {
    "index": Cmd("Index repository", "[--repo R] [--branch B] [--remote github|gitlab]"),
    "status": Cmd("Check indexing status", "[--repo R] [--branch B]"),
    "query": Cmd("Natural language Q&A", "--query Q [--repo R] [--genius]", ("query",)),
}


# --- [PURE_FUNCTIONS] ---------------------------------------------------------
def _env(k: str, alt: str = "") -> str:
    return os.environ.get(k, os.environ.get(alt, "")) if alt else os.environ.get(k, "")


def _spec(a: Args) -> Spec:
    return Spec(a.get("remote", C.remote), a.get("branch", C.branch), a.get("repo", C.repo))


def _rid(s: Spec) -> str:
    return quote(f"{s.remote}:{s.branch}:{s.repository}", safe="")


def _hdr() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {_env(C.env_greptile)}",
        "X-GitHub-Token": _env(C.env_gh, C.env_gh_alt),
        "Content-Type": "application/json",
    }


def _parse(args: list[str]) -> Args:
    """Parse CLI args via tail recursion."""
    def go(i: int, acc: Args) -> Args:
        return (
            acc if i >= len(args) else
            go(i + 2, {**acc, args[i][2:].replace("-", "_"): args[i + 1]})
            if args[i].startswith("--") and i + 1 < len(args) and not args[i + 1].startswith("--") else
            go(i + 1, {**acc, args[i][2:].replace("-", "_"): True})
            if args[i].startswith("--") else
            go(i + 1, acc)
        )
    return go(0, {})


def _validate(cmd: str, opts: Args) -> Result[None]:
    """Validate command requirements → Result."""
    missing = [f"--{k}" for k in CMDS[cmd].required if not opts.get(k)]
    return (
        ("err", f"Missing: {', '.join(missing)}", False) if missing else
        ("err", f"Missing {C.env_greptile}", False) if not _env(C.env_greptile) else
        ("err", f"Missing {C.env_gh}|{C.env_gh_alt}", False) if not _env(C.env_gh, C.env_gh_alt) else
        ("ok", None)
    )


def _api(method: Method, path: str, body: msgspec.Struct | None, timeout: int) -> Result[bytes]:
    """Execute API request → Result[bytes]."""
    try:
        with httpx.Client(timeout=timeout) as c:
            r = c.request(method, f"{C.base}{path}", headers=_hdr(),
                          content=msgspec.json.encode(body) if body else None)
        return (
            ("ok", r.content) if r.status_code <= C.ok_max else
            ("err", f"Auth failed ({r.status_code}): {r.text[:200]}", False) if r.status_code in (401, 403) else
            ("err", "Not found: repo not indexed", True) if r.status_code == 404 else
            ("err", "Rate limited", True) if r.status_code == 429 else
            ("err", f"API error ({r.status_code}): {r.text[:200]}", r.status_code >= C.server_err)
        )
    except httpx.TimeoutException:
        return ("err", "Request timeout", True)
    except httpx.RequestError as e:
        return ("err", f"Network error: {e}", True)


def _decode[T](data: bytes, t: type[T]) -> Result[dict[str, Any]]:
    """Decode response → Result[dict]."""
    try:
        d = msgspec.json.decode(data, type=t) if data else t()
        return ("ok", msgspec.to_builtins(d) if isinstance(d, msgspec.Struct) else d)
    except msgspec.DecodeError as e:
        return ("err", f"Invalid response: {e}", False)


def _usage(msg: str, cmd: str | None = None) -> dict[str, Any]:
    """Generate usage error output."""
    m = CMDS.get(cmd or "")
    body = (
        f"[ERROR] {msg}\n\n[USAGE] {SCRIPT} {cmd} {m.opts}"
        + (f"\n  Required: {', '.join(f'--{r}' for r in m.required)}" if m and m.required else "")
        if m else
        f"[ERROR] {msg}\n\n[COMMANDS]\n" + "\n".join(f"  {c:<8} {CMDS[c].desc}" for c in CMDS)
    )
    return {"status": "error", "message": body}


def _emit(d: dict[str, Any]) -> int:
    """Output JSON → exit code."""
    sys.stdout.buffer.write(msgspec.json.format(msgspec.json.encode(d), indent=2) + b"\n")
    return 0 if d.get("status") == "success" else 1


# --- [DISPATCH_TABLES] --------------------------------------------------------
def _bld_index(a: Args) -> Build:
    s = _spec(a)
    return ("POST", "/repositories", IndexReq(s.remote, s.repository, s.branch))


def _bld_status(a: Args) -> Build:
    return ("GET", f"/repositories/{_rid(_spec(a))}", None)


def _bld_query(a: Args) -> Build:
    return ("POST", "/query", QueryReq([Msg("1", a["query"])], [_spec(a)], a.get("genius") is True))


def _fmt_index(r: dict[str, Any], a: Args) -> dict[str, Any]:
    return {"repo": a.get("repo", C.repo), "message": r.get("message", "")}


def _fmt_status(r: dict[str, Any], a: Args) -> dict[str, Any]:
    return {
        "repo": r.get("repository", a.get("repo", C.repo)),
        "indexing": r.get("status", "unknown"),
        "sha": r.get("sha") or "pending",
        "progress": f"{r.get('filesProcessed', 0)}/{r.get('numFiles', 0)}",
        "ready": r.get("status") == "COMPLETED",
    }


def _fmt_query(r: dict[str, Any], a: Args) -> dict[str, Any]:
    srcs = [{"file": s.get("filepath", ""), "lines": f"{s.get('linestart')}-{s.get('lineend')}"
             if s.get("linestart") else None, "summary": s.get("summary", "")}
            for s in r.get("sources", []) if isinstance(s, dict)]
    return {"query": a["query"], "answer": r.get("message", ""), "sources": srcs}


HANDLERS: Final[dict[str, tuple[Any, Any, type]]] = {
    "index": (_bld_index, _fmt_index, IndexResp),
    "status": (_bld_status, _fmt_status, StatusResp),
    "query": (_bld_query, _fmt_query, QueryResp),
}


# --- [ENTRY_POINT] ------------------------------------------------------------
def main() -> int:
    """CLI entry → ROP chain."""
    cli_args = sys.argv[1:]
    cmd = cli_args[0] if cli_args else None
    cmd = None if cmd in ("-h", "--help", None) else cmd
    opts = _parse(cli_args[1:]) if cmd else {}

    # Guard: command validation
    match (cmd, cmd in CMDS if cmd else False):
        case (None, _):
            return _emit(_usage("No command specified"))
        case (c, False):
            return _emit(_usage(f"Unknown: {c}"))

    # Guard: option validation
    match _validate(cmd, opts):
        case ("err", msg, _):
            return _emit(_usage(msg, cmd))

    # Execute: build → api → decode → format
    build, fmt, resp_t = HANDLERS[cmd]
    method, path, body = build(opts)
    timeout = C.timeout_query if cmd == "query" else C.timeout

    match _api(method, path, body, timeout):
        case ("err", msg, retry):
            return _emit({"status": "error", "message": msg, "retryable": retry})
        case ("ok", data):
            match _decode(data, resp_t):
                case ("err", msg, retry):
                    return _emit({"status": "error", "message": msg, "retryable": retry})
                case ("ok", raw):
                    return _emit({"status": "success", **fmt(raw if isinstance(raw, dict) else {}, opts)})
    return 1  # Unreachable


if __name__ == "__main__":
    sys.exit(main())
