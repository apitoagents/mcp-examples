// The MCP server itself, independent of any transport: the HTTP entry point
// (server.ts) and the stdio CLI (cli.ts) both build it from here.
// Four tools show the three kinds every integration needs: read tools
// (search_products, get_product), an idempotent write (create_order), and a
// guarded action that refuses to run without explicit confirmation (cancel_order).
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { ShopClient, UpstreamError, type Product } from "./shop.js";

const shop = new ShopClient();

// Assistants read tool results as text; keep them short and never include
// fields the user has no business seeing.
const productSummary = (p: Product) => ({
  id: p.id,
  name: p.name,
  category: p.category,
  price: `$${(p.priceCents / 100).toFixed(2)}`,
  inStock: p.inStock,
});
const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
  structuredContent: data as Record<string, unknown>,
});
// isError tells the assistant the call failed; the text tells it what to do next.
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });
const explain = (error: unknown) => {
  if (!(error instanceof UpstreamError)) throw error;
  switch (error.kind) {
    case "invalid_input":
      return fail(`Invalid input: ${error.message} Adjust the arguments and call again.`);
    case "not_found":
      return fail(`Not found: ${error.message} Do not retry with the same identifier; ask the user to check it.`);
    case "conflict":
      return fail(`Conflict: ${error.message} Do not retry automatically; tell the user what happened.`);
    default:
      return fail(`The shop service is unavailable right now: ${error.message} Wait before retrying, and tell the user.`);
  }
};

export function buildServer() {
  const server = new McpServer({ name: "sample-shop", version: "1.0.0" });

  server.registerTool(
    "search_products",
    {
      title: "Search products",
      description:
        "Search the shop catalogue by phrase and optional category. Returns one page of up to `limit` products and a `nextCursor`; when nextCursor is not null, more results exist and you must say so rather than claiming the list is complete. Use get_product for full details of one item. This tool does not place orders.",
      inputSchema: z.object({
        query: z.string().max(100).optional().describe("Words to match against product names and descriptions."),
        category: z.enum(["lighting", "furniture", "kitchen"]).optional().describe("Restrict results to one category."),
        limit: z.number().int().min(1).max(20).default(5).describe("Page size."),
        cursor: z.string().optional().describe("Opaque token from a previous page's nextCursor. Never invent one."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, category, limit, cursor }) => {
      try {
        const page = await shop.searchProducts({ q: query, category, limit, cursor });
        return ok({ items: page.items.map(productSummary), nextCursor: page.nextCursor });
      } catch (error) {
        return explain(error);
      }
    },
  );

  server.registerTool(
    "get_product",
    {
      title: "Get product details",
      description: "Return the full details of one product by its id (for example p-1001). Use search_products first if you only know a name.",
      inputSchema: z.object({ productId: z.string().describe("The product id from search_products.") }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ productId }) => {
      try {
        const p = await shop.getProduct(productId);
        return ok({ ...productSummary(p), description: p.description });
      } catch (error) {
        return explain(error);
      }
    },
  );

  server.registerTool(
    "create_order",
    {
      title: "Create an order",
      description:
        "Place an order for one product. Generate one random idempotencyKey per user request and reuse the same key if you retry after an error or timeout; the shop returns the original order instead of creating a duplicate. Confirm product and quantity with the user before calling. Returns the order with its id, status and total.",
      inputSchema: z.object({
        productId: z.string().describe("Product id from search_products or get_product."),
        quantity: z.number().int().min(1).max(10).describe("Units to order, 1 to 10."),
        idempotencyKey: z.string().min(8).max(128).describe("A unique key you generate for this order attempt and reuse on retry."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ productId, quantity, idempotencyKey }) => {
      try {
        const order = await shop.createOrder(productId, quantity, idempotencyKey);
        return ok({ ...order, total: `$${(order.totalCents / 100).toFixed(2)}` });
      } catch (error) {
        return explain(error);
      }
    },
  );

  server.registerTool(
    "cancel_order",
    {
      title: "Cancel an order",
      description:
        "Cancel an order that has not shipped. This cannot be undone. Call it first with confirm=false to get the order details, show them to the user, and only after the user explicitly agrees call again with confirm=true.",
      inputSchema: z.object({
        orderId: z.string().describe("The order id, for example o-5001."),
        confirm: z.boolean().default(false).describe("Set true only after the user has explicitly confirmed the cancellation."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ orderId, confirm }) => {
      try {
        if (!confirm) {
          const order = await shop.getOrder(orderId);
          return fail(
            `Confirmation required. Order ${order.id}: ${order.quantity} × ${order.productId}, status ${order.status}, total $${(order.totalCents / 100).toFixed(2)}. Ask the user to confirm, then call cancel_order again with confirm=true.`,
          );
        }
        const order = await shop.cancelOrder(orderId);
        return ok(order);
      } catch (error) {
        return explain(error);
      }
    },
  );

  return server;
}
