"""VPS dispatch handlers for Hostinger API (VPS core, config, recovery, firewall, SSH, scripts, reference)."""
from typing import Any, Final
from collections.abc import Callable

type Args = dict[str, Any]
type CmdBuilder = Callable[[Args], tuple[str, str, dict[str, Any] | None]]
type OutputFormatter = Callable[[dict[str, Any], Args], dict[str, Any]]
type Handler = tuple[CmdBuilder, OutputFormatter]


# --- [FORMATTERS] -------------------------------------------------------------
def _list_fmt(key: str) -> OutputFormatter:
    """Create list formatter extracting array from response."""
    return lambda response, _: {key: response if isinstance(response, list) else response.get("data", response.get(key, response))}


def _item_fmt(key: str) -> OutputFormatter:
    """Create item formatter for single resource."""
    return lambda response, args: {"id": args.get("id"), key: response} if isinstance(args, dict) else {"id": None, key: response}


def _action_fmt(action: str) -> OutputFormatter:
    """Create action formatter for mutations."""
    return lambda response, args: {"id": args.get("id"), action: "error" not in response}


# --- [VPS_DISPATCH] -----------------------------------------------------------
VPS_HANDLERS: Final[dict[str, Handler]] = {
    # --- VPS_CORE ---
    "vps-list": (
        lambda _: ("GET", "/api/vps/v1/virtual-machines", None),
        _list_fmt("machines"),
    ),
    "vps-view": (
        lambda args: ("GET", f"/api/vps/v1/virtual-machines/{args['id']}", None),
        _item_fmt("machine"),
    ),
    "vps-start": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machines/{args['id']}/start", None),
        _action_fmt("started"),
    ),
    "vps-stop": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machines/{args['id']}/stop", None),
        _action_fmt("stopped"),
    ),
    "vps-restart": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machines/{args['id']}/restart", None),
        _action_fmt("restarted"),
    ),
    "vps-metrics": (
        lambda args: ("GET", f"/api/vps/v1/virtual-machines/{args['id']}/metrics?date_from={args['from_date']}&date_to={args['to_date']}", None),
        _item_fmt("metrics"),
    ),
    "vps-actions": (
        lambda args: ("GET", f"/api/vps/v1/virtual-machines/{args['id']}/actions", None),
        _list_fmt("actions"),
    ),
    "vps-action-view": (
        lambda args: ("GET", f"/api/vps/v1/virtual-machines/{args['id']}/actions/{args['action_id']}", None),
        lambda response, args: {"id": args["id"], "action_id": args["action_id"], "action": response},
    ),
    # --- VPS_CONFIG ---
    "vps-hostname-set": (
        lambda args: ("PUT", f"/api/vps/v1/virtual-machines/{args['id']}/hostname", {"hostname": args["hostname"]}),
        lambda response, args: {"id": args["id"], "hostname": args["hostname"], "set": "error" not in response},
    ),
    "vps-hostname-reset": (
        lambda args: ("DELETE", f"/api/vps/v1/virtual-machines/{args['id']}/hostname", None),
        _action_fmt("reset"),
    ),
    "vps-nameservers-set": (
        lambda args: ("PUT", f"/api/vps/v1/virtual-machines/{args['id']}/nameservers", {"ns1": args["ns1"], **({"ns2": args["ns2"]} if args.get("ns2") else {})}),
        lambda response, args: {"id": args["id"], "ns1": args["ns1"], "set": "error" not in response},
    ),
    "vps-password-set": (
        lambda args: ("PUT", f"/api/vps/v1/virtual-machines/{args['id']}/root-password", {"password": args["password"]}),
        _action_fmt("set"),
    ),
    "vps-panel-password-set": (
        lambda args: ("PUT", f"/api/vps/v1/virtual-machines/{args['id']}/panel-password", {"password": args["password"]}),
        _action_fmt("set"),
    ),
    "vps-ptr-create": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machines/{args['id']}/ptr/{args['ip_id']}", {"domain": args["domain"]}),
        lambda response, args: {"id": args["id"], "ip_id": args["ip_id"], "domain": args["domain"], "created": "error" not in response},
    ),
    "vps-ptr-delete": (
        lambda args: ("DELETE", f"/api/vps/v1/virtual-machines/{args['id']}/ptr/{args['ip_id']}", None),
        lambda response, args: {"id": args["id"], "ip_id": args["ip_id"], "deleted": "error" not in response},
    ),
    # --- VPS_RECOVERY ---
    "vps-recovery-start": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machines/{args['id']}/recovery", {"root_password": args["root_password"]}),
        _action_fmt("started"),
    ),
    "vps-recovery-stop": (
        lambda args: ("DELETE", f"/api/vps/v1/virtual-machines/{args['id']}/recovery", None),
        _action_fmt("stopped"),
    ),
    "vps-recreate": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machines/{args['id']}/recreate", {"template_id": int(args["template_id"]), **({"password": args["password"]} if args.get("password") else {})}),
        _action_fmt("recreated"),
    ),
    # --- FIREWALL ---
    "firewall-list": (
        lambda _: ("GET", "/api/vps/v1/firewall?page=1", None),
        _list_fmt("firewalls"),
    ),
    "firewall-view": (
        lambda args: ("GET", f"/api/vps/v1/firewall/{args['id']}", None),
        _item_fmt("firewall"),
    ),
    "firewall-create": (
        lambda args: ("POST", "/api/vps/v1/firewall", {"name": args["name"]}),
        lambda response, args: {"name": args["name"], "created": response.get("id") if isinstance(response, dict) else None, "firewall": response},
    ),
    "firewall-delete": (
        lambda args: ("DELETE", f"/api/vps/v1/firewall/{args['id']}", None),
        _action_fmt("deleted"),
    ),
    "firewall-activate": (
        lambda args: ("POST", f"/api/vps/v1/firewall/{args['firewall_id']}/virtual-machine/{args['vps_id']}", None),
        lambda response, args: {"firewall_id": args["firewall_id"], "vps_id": args["vps_id"], "activated": "error" not in response},
    ),
    "firewall-deactivate": (
        lambda args: ("DELETE", f"/api/vps/v1/firewall/{args['firewall_id']}/virtual-machine/{args['vps_id']}", None),
        lambda response, args: {"firewall_id": args["firewall_id"], "vps_id": args["vps_id"], "deactivated": "error" not in response},
    ),
    "firewall-sync": (
        lambda args: ("POST", f"/api/vps/v1/firewall/{args['firewall_id']}/virtual-machine/{args['vps_id']}/sync", None),
        lambda response, args: {"firewall_id": args["firewall_id"], "vps_id": args["vps_id"], "synced": "error" not in response},
    ),
    "firewall-rule-create": (
        lambda args: ("POST", f"/api/vps/v1/firewall/{args['id']}/rules", {"protocol": args["protocol"], "port": args["port"], "source": args["source"], "source_detail": args["source_detail"]}),
        lambda response, args: {"id": args["id"], "created": "error" not in response, "rule": response},
    ),
    "firewall-rule-update": (
        lambda args: ("PUT", f"/api/vps/v1/firewall/{args['id']}/rules/{args['rule_id']}", {"protocol": args["protocol"], "port": args["port"], "source": args["source"], "source_detail": args["source_detail"]}),
        lambda response, args: {"id": args["id"], "rule_id": args["rule_id"], "updated": "error" not in response},
    ),
    "firewall-rule-delete": (
        lambda args: ("DELETE", f"/api/vps/v1/firewall/{args['id']}/rules/{args['rule_id']}", None),
        lambda response, args: {"id": args["id"], "rule_id": args["rule_id"], "deleted": "error" not in response},
    ),
    # --- SSH_KEYS ---
    "ssh-key-list": (
        lambda _: ("GET", "/api/vps/v1/public-keys", None),
        _list_fmt("keys"),
    ),
    "ssh-key-create": (
        lambda args: ("POST", "/api/vps/v1/public-keys", {"name": args["name"], "key": args["key"]}),
        lambda response, args: {"name": args["name"], "created": response.get("id"), "key": response},
    ),
    "ssh-key-delete": (
        lambda args: ("DELETE", f"/api/vps/v1/public-keys/{args['id']}", None),
        _action_fmt("deleted"),
    ),
    "ssh-key-attach": (
        lambda args: ("POST", f"/api/vps/v1/virtual-machines/{args['vps_id']}/public-keys", {"ids": [int(identifier) for identifier in str(args["key_ids"]).split(",")]}),
        lambda response, args: {"vps_id": args["vps_id"], "attached": "error" not in response},
    ),
    "ssh-key-attached": (
        lambda args: ("GET", f"/api/vps/v1/virtual-machines/{args['vps_id']}/public-keys", None),
        _list_fmt("keys"),
    ),
    # --- SCRIPTS ---
    "script-list": (
        lambda _: ("GET", "/api/vps/v1/post-install-scripts", None),
        _list_fmt("scripts"),
    ),
    "script-view": (
        lambda args: ("GET", f"/api/vps/v1/post-install-scripts/{args['id']}", None),
        _item_fmt("script"),
    ),
    "script-create": (
        lambda args: ("POST", "/api/vps/v1/post-install-scripts", {"name": args["name"], "content": args["content"]}),
        lambda response, args: {"name": args["name"], "created": response.get("id") if isinstance(response, dict) else None, "script": response},
    ),
    "script-update": (
        lambda args: ("PUT", f"/api/vps/v1/post-install-scripts/{args['id']}", {"name": args["name"], "content": args["content"]}),
        lambda response, args: {"id": args["id"], "updated": "error" not in response},
    ),
    "script-delete": (
        lambda args: ("DELETE", f"/api/vps/v1/post-install-scripts/{args['id']}", None),
        _action_fmt("deleted"),
    ),
    # --- REFERENCE ---
    "datacenter-list": (
        lambda _: ("GET", "/api/vps/v1/data-centers", None),
        _list_fmt("datacenters"),
    ),
    "template-list": (
        lambda _: ("GET", "/api/vps/v1/templates", None),
        _list_fmt("templates"),
    ),
    "template-view": (
        lambda args: ("GET", f"/api/vps/v1/templates/{args['id']}", None),
        _item_fmt("template"),
    ),
}
