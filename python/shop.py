"""A thin client for the Sample Shop API.

The MCP server never shows the upstream credential to the assistant: it is read
from the environment here and attached to every request.
"""

from __future__ import annotations

import os
from typing import Any, Literal

import httpx

Kind = Literal["invalid_input", "not_found", "conflict", "unavailable"]


class UpstreamError(Exception):
    """One of the four outcomes an assistant must handle differently."""

    def __init__(self, kind: Kind, message: str) -> None:
        super().__init__(message)
        self.kind = kind


class ShopClient:
    def __init__(self, base_url: str | None = None, api_key: str | None = None) -> None:
        self.base_url = base_url or os.environ.get("UPSTREAM_URL", "http://127.0.0.1:4010")
        self.api_key = api_key or os.environ.get("UPSTREAM_API_KEY", "demo-key")
        self.http = httpx.Client(base_url=self.base_url, timeout=5.0)

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        headers = {"X-API-Key": self.api_key, **kwargs.pop("headers", {})}
        try:
            response = self.http.request(method, path, headers=headers, **kwargs)
        except httpx.HTTPError as error:
            raise UpstreamError("unavailable", f"The shop API did not respond: {error}") from error
        if response.is_success:
            return response.json()
        try:
            message = response.json().get("message", response.reason_phrase)
        except ValueError:
            message = response.reason_phrase
        if response.status_code == 400:
            raise UpstreamError("invalid_input", message)
        if response.status_code == 404:
            raise UpstreamError("not_found", message)
        if response.status_code == 409:
            raise UpstreamError("conflict", message)
        raise UpstreamError("unavailable", f"The shop API returned {response.status_code}: {message}")

    def search_products(self, **params: Any) -> dict[str, Any]:
        clean = {k: v for k, v in params.items() if v not in (None, "")}
        return self._request("GET", "/products", params=clean)

    def get_product(self, product_id: str) -> dict[str, Any]:
        return self._request("GET", f"/products/{product_id}")

    def create_order(self, product_id: str, quantity: int, idempotency_key: str) -> dict[str, Any]:
        return self._request(
            "POST",
            "/orders",
            headers={"Idempotency-Key": idempotency_key},
            json={"productId": product_id, "quantity": quantity},
        )

    def get_order(self, order_id: str) -> dict[str, Any]:
        return self._request("GET", f"/orders/{order_id}")

    def cancel_order(self, order_id: str) -> dict[str, Any]:
        return self._request("POST", f"/orders/{order_id}/cancel")
