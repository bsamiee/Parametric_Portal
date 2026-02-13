"""DNS and domain dispatch handlers for Hostinger API."""
# LOC: 82

import json
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


# --- [DNS_DISPATCH] -----------------------------------------------------------
DNS_HANDLERS: Final[dict[str, Handler]] = {
    # --- DNS ---
    "dns-records": (
        lambda args: ("GET", f"/api/dns/v1/zones/{args['domain']}", None),
        lambda response, args: {"domain": args["domain"], "records": response if isinstance(response, list) else response.get("zone", response)},
    ),
    "dns-snapshots": (
        lambda args: ("GET", f"/api/dns/v1/snapshots/{args['domain']}", None),
        lambda response, args: {"domain": args["domain"], "snapshots": response if isinstance(response, list) else response.get("data", response)},
    ),
    # --- DOMAINS ---
    "domain-list": (
        lambda _: ("GET", "/api/domains/v1/portfolio", None),
        _list_fmt("domains"),
    ),
    "domain-view": (
        lambda args: ("GET", f"/api/domains/v1/portfolio/{args['domain']}", None),
        lambda response, args: {"domain": args["domain"], "details": response},
    ),
    "domain-check": (
        lambda args: ("POST", "/api/domains/v1/availability", {"domain": args["domain"], "tlds": str(args["tlds"]).split(",")}),
        lambda response, args: {"domain": args["domain"], "availability": response if isinstance(response, list) else response.get("results", response)},
    ),
    # --- DOMAIN_EXTENDED ---
    "domain-lock-enable": (
        lambda args: ("POST", f"/api/domains/v1/portfolio/{args['domain']}/domain-lock", None),
        lambda response, args: {"domain": args["domain"], "locked": "error" not in str(response)},
    ),
    "domain-lock-disable": (
        lambda args: ("DELETE", f"/api/domains/v1/portfolio/{args['domain']}/domain-lock", None),
        lambda response, args: {"domain": args["domain"], "unlocked": "error" not in str(response)},
    ),
    "domain-privacy-enable": (
        lambda args: ("POST", f"/api/domains/v1/portfolio/{args['domain']}/privacy-protection", None),
        lambda response, args: {"domain": args["domain"], "privacy_enabled": "error" not in str(response)},
    ),
    "domain-privacy-disable": (
        lambda args: ("DELETE", f"/api/domains/v1/portfolio/{args['domain']}/privacy-protection", None),
        lambda response, args: {"domain": args["domain"], "privacy_disabled": "error" not in str(response)},
    ),
    "domain-forwarding-view": (
        lambda args: ("GET", f"/api/domains/v1/portfolio/{args['domain']}/forwarding", None),
        lambda response, args: {"domain": args["domain"], "forwarding": response},
    ),
    "domain-forwarding-create": (
        lambda args: ("POST", f"/api/domains/v1/portfolio/{args['domain']}/forwarding", {"redirect_url": args["redirect_url"], "redirect_type": args["redirect_type"]}),
        lambda response, args: {"domain": args["domain"], "created": "error" not in str(response), "forwarding": response},
    ),
    "domain-forwarding-delete": (
        lambda args: ("DELETE", f"/api/domains/v1/portfolio/{args['domain']}/forwarding", None),
        lambda response, args: {"domain": args["domain"], "deleted": "error" not in str(response)},
    ),
    "domain-nameservers-set": (
        lambda args: ("PUT", f"/api/domains/v1/portfolio/{args['domain']}/nameservers", {"ns1": args["ns1"], "ns2": args["ns2"], **({} if not args.get("ns3") else {"ns3": args["ns3"]}), **({} if not args.get("ns4") else {"ns4": args["ns4"]})}),
        lambda response, args: {"domain": args["domain"], "nameservers_set": "error" not in str(response)},
    ),
    # --- WHOIS ---
    "whois-list": (
        lambda args: ("GET", f"/api/domains/v1/whois{'?tld=' + args['tld'] if args.get('tld') else ''}", None),
        _list_fmt("profiles"),
    ),
    "whois-view": (
        lambda args: ("GET", f"/api/domains/v1/whois/{args['id']}", None),
        _item_fmt("profile"),
    ),
    "whois-create": (
        lambda args: ("POST", "/api/domains/v1/whois", {"tld": args["tld"], "entity_type": args["entity_type"], "country": args["country"], "whois_details": json.loads(args["whois_details"]) if isinstance(args["whois_details"], str) else args["whois_details"]}),
        lambda response, args: {"tld": args["tld"], "created": response.get("id") if isinstance(response, dict) else None, "profile": response},
    ),
    "whois-delete": (
        lambda args: ("DELETE", f"/api/domains/v1/whois/{args['id']}", None),
        _action_fmt("deleted"),
    ),
    "whois-usage": (
        lambda args: ("GET", f"/api/domains/v1/whois/{args['id']}/usage", None),
        lambda response, args: {"id": args["id"], "domains": response if isinstance(response, list) else response.get("domains", response)},
    ),
}
