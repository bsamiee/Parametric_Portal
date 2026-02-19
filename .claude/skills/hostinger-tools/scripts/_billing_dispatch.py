"""Billing and hosting dispatch handlers for Hostinger API."""
# LOC: 49

from collections.abc import Callable
from typing import Any, Final


type Args = dict[str, Any]
type CmdBuilder = Callable[[Args], tuple[str, str, dict[str, Any] | None]]
type OutputFormatter = Callable[[dict[str, Any], Args], dict[str, Any]]
type Handler = tuple[CmdBuilder, OutputFormatter]


# --- [FORMATTERS] -------------------------------------------------------------
def _list_fmt(key: str) -> OutputFormatter:
    """Create list formatter extracting array from response."""
    return lambda response, _: {
        key: response if isinstance(response, list) else response.get("data", response.get(key, response))
    }


def _action_fmt(action: str) -> OutputFormatter:
    """Create action formatter for mutations."""
    return lambda response, args: {"id": args.get("id"), action: "error" not in response}


# --- [BILLING_DISPATCH] -------------------------------------------------------
BILLING_HANDLERS: Final[dict[str, Handler]] = {
    # --- BILLING ---
    "billing-catalog": (
        lambda args: (
            "GET",
            f"/api/billing/v1/catalog{'?category=' + args['category'] if args.get('category') else ''}",
            None,
        ),
        _list_fmt("items"),
    ),
    "billing-payment-methods": (
        lambda _: ("GET", "/api/billing/v1/payment-methods", None),
        _list_fmt("methods"),
    ),
    "billing-payment-method-set-default": (
        lambda args: ("PUT", f"/api/billing/v1/payment-methods/{args['id']}/default", None),
        _action_fmt("set"),
    ),
    "billing-payment-method-delete": (
        lambda args: ("DELETE", f"/api/billing/v1/payment-methods/{args['id']}", None),
        _action_fmt("deleted"),
    ),
    "billing-subscriptions": (
        lambda _: ("GET", "/api/billing/v1/subscriptions", None),
        _list_fmt("subscriptions"),
    ),
    "billing-subscription-cancel": (
        lambda args: ("DELETE", f"/api/billing/v1/subscriptions/{args['id']}", None),
        lambda response, args: {"id": args["id"], "cancelled": "error" not in response},
    ),
    "billing-auto-renewal-enable": (
        lambda args: ("POST", f"/api/billing/v1/subscriptions/{args['id']}/auto-renewal", None),
        lambda response, args: {"id": args["id"], "enabled": "error" not in response},
    ),
    "billing-auto-renewal-disable": (
        lambda args: ("DELETE", f"/api/billing/v1/subscriptions/{args['id']}/auto-renewal", None),
        lambda response, args: {"id": args["id"], "disabled": "error" not in response},
    ),
    # --- HOSTING ---
    "hosting-orders-list": (
        lambda _: ("GET", "/api/hosting/v1/orders", None),
        _list_fmt("orders"),
    ),
    "hosting-websites-list": (
        lambda _: ("GET", "/api/hosting/v1/websites", None),
        _list_fmt("websites"),
    ),
    "hosting-website-create": (
        lambda args: (
            "POST",
            "/api/hosting/v1/websites",
            {
                "domain": args["domain"],
                "order_id": int(args["order_id"]),
                **({} if not args.get("datacenter") else {"datacenter_code": args["datacenter"]}),
            },
        ),
        lambda response, args: {"domain": args["domain"], "created": "error" not in str(response), "website": response},
    ),
    "hosting-datacenters-list": (
        lambda args: ("GET", f"/api/hosting/v1/orders/{args['order_id']}/data-centers", None),
        _list_fmt("datacenters"),
    ),
}
