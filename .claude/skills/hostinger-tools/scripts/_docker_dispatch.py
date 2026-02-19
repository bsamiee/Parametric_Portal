"""Docker and snapshot dispatch handlers for Hostinger API."""

from collections.abc import Callable
from typing import Any, Final


type Args = dict[str, Any]
type CmdBuilder = Callable[[Args], tuple[str, str, dict[str, Any] | None]]
type OutputFormatter = Callable[[dict[str, Any], Args], dict[str, Any]]
type Handler = tuple[CmdBuilder, OutputFormatter]


def is_successful_response(response: Any) -> bool:
    """Inspect API response for error indicators."""
    match response:
        case (status_code, _) if isinstance(status_code, int):
            return 200 <= status_code < 300
        case dict():
            return (
                response.get("error") is None
                and response.get("errors") is None
                and response.get("status") not in ("error", "failed")
            )
        case str():
            return "error" not in response.lower()
        case None:
            return False
        case _:
            return False


DOCKER_HANDLERS: Final[dict[str, Handler]] = {
    "docker-list": (
        lambda args: ("GET", f"/api/vps/v1/virtual-machine/{args['id']}/docker-compose/project?page=1", None),
        lambda response, _: {
            "projects": response
            if isinstance(response, list)
            else response.get("data", response.get("projects", response))
        },
    ),
    "docker-view": (
        lambda args: (
            "GET",
            f"/api/vps/v1/virtual-machine/{args['id']}/docker-compose/project/{args['project']}",
            None,
        ),
        lambda response, args: {"project": args["project"], "contents": response},
    ),
    "docker-containers": (
        lambda args: (
            "GET",
            f"/api/vps/v1/virtual-machine/{args['id']}/docker-compose/project/{args['project']}/containers",
            None,
        ),
        lambda response, args: {
            "project": args["project"],
            "containers": response if isinstance(response, list) else response.get("data", response),
        },
    ),
    "docker-logs": (
        lambda args: (
            "GET",
            f"/api/vps/v1/virtual-machine/{args['id']}/docker-compose/project/{args['project']}/logs",
            None,
        ),
        lambda response, args: {
            "project": args["project"],
            "logs": response.get("logs", response),
        },
    ),
    "docker-create": (
        lambda args: (
            "POST",
            f"/api/vps/v1/virtual-machine/{args['id']}/docker-compose/project",
            {"project_name": args["project"], "content": args["content"]},
        ),
        lambda response, args: {"project": args["project"], "created": is_successful_response(response)},
    ),
    "docker-start": (
        lambda args: (
            "POST",
            f"/api/vps/v1/virtual-machine/{args['id']}/docker-compose/project/{args['project']}/start",
            None,
        ),
        lambda response, args: {"project": args["project"], "started": is_successful_response(response)},
    ),
    "docker-stop": (
        lambda args: (
            "POST",
            f"/api/vps/v1/virtual-machine/{args['id']}/docker-compose/project/{args['project']}/stop",
            None,
        ),
        lambda response, args: {"project": args["project"], "stopped": is_successful_response(response)},
    ),
    "docker-restart": (
        lambda args: (
            "POST",
            f"/api/vps/v1/virtual-machine/{args['id']}/docker-compose/project/{args['project']}/restart",
            None,
        ),
        lambda response, args: {"project": args["project"], "restarted": is_successful_response(response)},
    ),
    "docker-update": (
        lambda args: (
            "PUT",
            f"/api/vps/v1/virtual-machine/{args['id']}/docker-compose/project/{args['project']}",
            None,
        ),
        lambda response, args: {"project": args["project"], "updated": is_successful_response(response)},
    ),
    "docker-delete": (
        lambda args: (
            "DELETE",
            f"/api/vps/v1/virtual-machine/{args['id']}/docker-compose/project/{args['project']}",
            None,
        ),
        lambda response, args: {"project": args["project"], "deleted": is_successful_response(response)},
    ),
}

SNAPSHOT_HANDLERS: Final[dict[str, Handler]] = {
    "snapshot-view": (
        lambda args: ("GET", f"/api/vps/v1/virtual-machines/{args['id']}/snapshot", None),
        lambda response, args: {"id": args.get("id"), "snapshot": response},
    ),
    "snapshot-create": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machines/{args['id']}/snapshot", None),
        lambda response, args: {"id": args.get("id"), "created": "error" not in response},
    ),
    "snapshot-delete": (
        lambda args: ("DELETE", f"/api/vps/v1/virtual-machines/{args['id']}/snapshot", None),
        lambda response, args: {"id": args.get("id"), "deleted": "error" not in response},
    ),
    "snapshot-restore": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machines/{args['id']}/snapshot/restore", None),
        lambda response, args: {"id": args.get("id"), "restored": "error" not in response},
    ),
    "backup-list": (
        lambda args: ("GET", f"/api/vps/v1/virtual-machines/{args['id']}/backups", None),
        lambda response, _: {
            "backups": response
            if isinstance(response, list)
            else response.get("data", response.get("backups", response))
        },
    ),
    "backup-restore": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machines/{args['id']}/backups/{args['backup_id']}/restore", None),
        lambda response, args: {"id": args["id"], "backup_id": args["backup_id"], "restored": "error" not in response},
    ),
}
