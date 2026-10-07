// A thin client for the Sample Shop API. The MCP server never exposes the
// upstream credential to the assistant: it is read from the environment here
// and attached to every request.
export type Product = {
  id: string;
  name: string;
  description?: string;
  category: "lighting" | "furniture" | "kitchen";
  priceCents: number;
  currency: "USD";
  inStock: boolean;
};
export type Order = {
  id: string;
  productId: string;
  quantity: number;
  status: "placed" | "shipped" | "cancelled";
  totalCents: number;
  currency: "USD";
};
export type ProductPage = { items: Product[]; nextCursor: string | null };

/** Distinguishes the three outcomes an assistant must handle differently. */
export class UpstreamError extends Error {
  constructor(
    public readonly kind: "invalid_input" | "not_found" | "conflict" | "unavailable",
    message: string,
  ) {
    super(message);
  }
}

export class ShopClient {
  constructor(
    private readonly baseUrl = process.env.UPSTREAM_URL ?? "http://127.0.0.1:4010",
    private readonly apiKey = process.env.UPSTREAM_API_KEY ?? "demo-key",
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        ...init,
        headers: {
          "X-API-Key": this.apiKey,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(5000),
      });
    } catch (cause) {
      throw new UpstreamError("unavailable", `The shop API did not respond: ${(cause as Error).message}`);
    }
    if (response.ok) return (await response.json()) as T;
    const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
    const message = body.message ?? response.statusText;
    if (response.status === 400) throw new UpstreamError("invalid_input", message);
    if (response.status === 404) throw new UpstreamError("not_found", message);
    if (response.status === 409) throw new UpstreamError("conflict", message);
    throw new UpstreamError("unavailable", `The shop API returned ${response.status}: ${message}`);
  }

  searchProducts(params: { q?: string; category?: string; limit?: number; cursor?: string }) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params))
      if (value !== undefined && value !== "") query.set(key, String(value));
    return this.request<ProductPage>(`/products?${query}`);
  }
  getProduct(id: string) {
    return this.request<Product>(`/products/${encodeURIComponent(id)}`);
  }
  createOrder(productId: string, quantity: number, idempotencyKey: string) {
    return this.request<Order>("/orders", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ productId, quantity }),
    });
  }
  getOrder(id: string) {
    return this.request<Order>(`/orders/${encodeURIComponent(id)}`);
  }
  cancelOrder(id: string) {
    return this.request<Order>(`/orders/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  }
}
