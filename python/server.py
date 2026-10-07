"""MCP server for the Sample Shop API, served over Streamable HTTP.

Four tools show the three kinds every integration needs: read tools
(search_products, get_product), an idempotent write (create_order), and a
guarded action that refuses to run without explicit confirmation (cancel_order).
"""

from __future__ import annotations

import os
from typing import Annotated, Any, Literal

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import Field

from shop import ShopClient, UpstreamError

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "3002"))
shop = ShopClient()

# Tool parameter names are camelCase on purpose: the four language examples in
# this repository expose one identical interface, and the conformance test in
# tests/ exercises them all with the same arguments.

mcp = MCPServer(
    "sample-shop",
    version="1.0.0",
    instructions=(
        "Tools for the Sample Shop. Search and look up products freely. "
        "Confirm product and quantity with the user before create_order. "
        "cancel_order is irreversible and must be confirmed by the user first."
    ),
)


def _summary(p: dict[str, Any]) -> dict[str, Any]:
    """Assistants read results as text; keep them short and never leak fields."""
    return {
        "id": p["id"],
        "name": p["name"],
        "category": p["category"],
        "price": f"${p['priceCents'] / 100:.2f}",
        "inStock": p["inStock"],
    }


def _explain(error: UpstreamError) -> ToolError:
    """Map upstream outcomes to messages that tell the assistant what to do next."""
    if error.kind == "invalid_input":
        return ToolError(f"Invalid input: {error} Adjust the arguments and call again.")
    if error.kind == "not_found":
        return ToolError(f"Not found: {error} Do not retry with the same identifier; ask the user to check it.")
    if error.kind == "conflict":
        return ToolError(f"Conflict: {error} Do not retry automatically; tell the user what happened.")
    return ToolError(f"The shop service is unavailable right now: {error} Wait before retrying, and tell the user.")


@mcp.tool(
    title="Search products",
    description=(
        "Search the shop catalogue by phrase and optional category. Returns one page of up to "
        "`limit` products and a `nextCursor`; when nextCursor is not null, more results exist and "
        "you must say so rather than claiming the list is complete. Use get_product for full "
        "details of one item. This tool does not place orders."
    ),
    annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False),
)
def search_products(
    query: Annotated[str, Field(max_length=100, description="Words to match against product names and descriptions.")] = "",
    category: Annotated[Literal["lighting", "furniture", "kitchen"] | None, Field(description="Restrict results to one category.")] = None,
    limit: Annotated[int, Field(ge=1, le=20, description="Page size.")] = 5,
    cursor: Annotated[str | None, Field(description="Opaque token from a previous page's nextCursor. Never invent one.")] = None,
) -> dict[str, Any]:
    try:
        page = shop.search_products(q=query, category=category, limit=limit, cursor=cursor)
    except UpstreamError as error:
        raise _explain(error) from error
    return {"items": [_summary(p) for p in page["items"]], "nextCursor": page["nextCursor"]}


@mcp.tool(
    title="Get product details",
    description="Return the full details of one product by its id (for example p-1001). Use search_products first if you only know a name.",
    annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False),
)
def get_product(
    productId: Annotated[str, Field(description="The product id from search_products.")],
) -> dict[str, Any]:
    try:
        p = shop.get_product(productId)
    except UpstreamError as error:
        raise _explain(error) from error
    return {**_summary(p), "description": p.get("description")}


@mcp.tool(
    title="Create an order",
    description=(
        "Place an order for one product. Generate one random idempotency_key per user request and "
        "reuse the same key if you retry after an error or timeout; the shop returns the original "
        "order instead of creating a duplicate. Confirm product and quantity with the user before "
        "calling. Returns the order with its id, status and total."
    ),
    annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=False),
)
def create_order(
    productId: Annotated[str, Field(description="Product id from search_products or get_product.")],
    quantity: Annotated[int, Field(ge=1, le=10, description="Units to order, 1 to 10.")],
    idempotencyKey: Annotated[str, Field(min_length=8, max_length=128, description="A unique key you generate for this order attempt and reuse on retry.")],
) -> dict[str, Any]:
    try:
        order = shop.create_order(productId, quantity, idempotencyKey)
    except UpstreamError as error:
        raise _explain(error) from error
    return {**order, "total": f"${order['totalCents'] / 100:.2f}"}


@mcp.tool(
    title="Cancel an order",
    description=(
        "Cancel an order that has not shipped. This cannot be undone. Call it first with "
        "confirm=false to get the order details, show them to the user, and only after the user "
        "explicitly agrees call again with confirm=true."
    ),
    annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=True, openWorldHint=False),
)
def cancel_order(
    orderId: Annotated[str, Field(description="The order id, for example o-5001.")],
    confirm: Annotated[bool, Field(description="Set true only after the user has explicitly confirmed the cancellation.")] = False,
) -> dict[str, Any]:
    try:
        if not confirm:
            order = shop.get_order(orderId)
            raise ToolError(
                f"Confirmation required. Order {order['id']}: {order['quantity']} × {order['productId']}, "
                f"status {order['status']}, total ${order['totalCents'] / 100:.2f}. "
                "Ask the user to confirm, then call cancel_order again with confirm=true."
            )
        return shop.cancel_order(orderId)
    except UpstreamError as error:
        raise _explain(error) from error


if __name__ == "__main__":
    import uvicorn
    from starlette.responses import JSONResponse

    # Stateless: nothing is held between calls, so the endpoint scales horizontally.
    app = mcp.streamable_http_app(stateless_http=True, host=HOST)
    app.add_route("/health", lambda request: JSONResponse({"ok": True}))
    print(f"sample-shop MCP (Python) on http://{HOST}:{PORT}/mcp", flush=True)
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
