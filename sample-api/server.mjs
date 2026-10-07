// Sample Shop API: the upstream every MCP example in this repository wraps.
// Zero dependencies. Run with: node sample-api/server.mjs
// Listens on 127.0.0.1:4010 and requires the header X-API-Key: demo-key.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const openapi = readFileSync(join(here, "openapi.json"), "utf8");
const PORT = Number(process.env.PORT ?? 4010);
const API_KEY = process.env.API_KEY ?? "demo-key";

const products = [
  ["p-1001", "Arc floor lamp", "Brushed steel arc lamp with a linen shade.", "lighting", 18900, true],
  ["p-1002", "Desk lamp, matte black", "Dimmable LED desk lamp with a USB port.", "lighting", 4900, true],
  ["p-1003", "Paper lantern pendant", "Rice paper pendant shade, 45 cm.", "lighting", 2900, false],
  ["p-1004", "Oak dining table", "Solid oak table for six, oiled finish.", "furniture", 89900, true],
  ["p-1005", "Reading armchair", "Wool upholstered armchair with beech legs.", "furniture", 42900, true],
  ["p-1006", "Bookshelf, five tiers", "Powder-coated steel frame with ash shelves.", "furniture", 25900, true],
  ["p-1007", "Cast iron skillet", "Pre-seasoned 26 cm skillet.", "kitchen", 3900, true],
  ["p-1008", "Chef's knife", "20 cm high-carbon stainless steel blade.", "kitchen", 7900, true],
  ["p-1009", "Stoneware mug set", "Four hand-glazed mugs, 350 ml.", "kitchen", 3200, true],
  ["p-1010", "Pour-over kettle", "Gooseneck kettle with a thermometer lid.", "kitchen", 5900, false],
].map(([id, name, description, category, priceCents, inStock]) => ({
  id,
  name,
  description,
  category,
  priceCents,
  currency: "USD",
  inStock,
}));

const orders = new Map();
const idempotency = new Map();
let nextOrder = 5001;

const send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const error = (res, status, code, message) => send(res, status, { code, message });
const readJson = (req) =>
  new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 65536) reject(new Error("too large"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("invalid json"));
      }
    });
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/openapi.json") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(openapi);
  }
  if (url.pathname === "/health") return send(res, 200, { ok: true });
  if (req.headers["x-api-key"] !== API_KEY)
    return error(res, 401, "unauthorized", "Send X-API-Key.");

  // GET /products
  if (req.method === "GET" && url.pathname === "/products") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const category = url.searchParams.get("category");
    const limit = Number(url.searchParams.get("limit") ?? 5);
    const cursor = Number(url.searchParams.get("cursor") ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 20)
      return error(res, 400, "invalid_input", "limit must be an integer from 1 to 20.");
    if (category && !["lighting", "furniture", "kitchen"].includes(category))
      return error(res, 400, "invalid_input", "Unknown category.");
    if (!Number.isInteger(cursor) || cursor < 0)
      return error(res, 400, "invalid_input", "Bad cursor.");
    const matches = products.filter(
      (p) =>
        (!q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)) &&
        (!category || p.category === category),
    );
    const items = matches.slice(cursor, cursor + limit);
    const next = cursor + limit < matches.length ? String(cursor + limit) : null;
    return send(res, 200, { items, nextCursor: next });
  }

  // GET /products/{id}
  let m = url.pathname.match(/^\/products\/([^/]+)$/);
  if (req.method === "GET" && m) {
    const product = products.find((p) => p.id === m[1]);
    return product ? send(res, 200, product) : error(res, 404, "not_found", "No such product.");
  }

  // POST /orders
  if (req.method === "POST" && url.pathname === "/orders") {
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8 || key.length > 128)
      return error(res, 400, "invalid_input", "Idempotency-Key header is required (8 to 128 chars).");
    let body;
    try {
      body = await readJson(req);
    } catch {
      return error(res, 400, "invalid_input", "Body must be JSON.");
    }
    const { productId, quantity } = body;
    if (typeof productId !== "string" || !Number.isInteger(quantity) || quantity < 1 || quantity > 10)
      return error(res, 400, "invalid_input", "productId (string) and quantity (1 to 10) are required.");
    const seen = idempotency.get(key);
    if (seen) {
      if (seen.productId !== productId || seen.quantity !== quantity)
        return error(res, 409, "idempotency_conflict", "This Idempotency-Key was used with a different payload.");
      return send(res, 200, orders.get(seen.orderId));
    }
    const product = products.find((p) => p.id === productId);
    if (!product) return error(res, 404, "not_found", "No such product.");
    const order = {
      id: `o-${nextOrder++}`,
      productId,
      quantity,
      status: "placed",
      totalCents: product.priceCents * quantity,
      currency: "USD",
    };
    orders.set(order.id, order);
    idempotency.set(key, { productId, quantity, orderId: order.id });
    return send(res, 201, order);
  }

  // GET /orders/{id}
  m = url.pathname.match(/^\/orders\/([^/]+)$/);
  if (req.method === "GET" && m) {
    const order = orders.get(m[1]);
    return order ? send(res, 200, order) : error(res, 404, "not_found", "No such order.");
  }

  // POST /orders/{id}/cancel
  m = url.pathname.match(/^\/orders\/([^/]+)\/cancel$/);
  if (req.method === "POST" && m) {
    const order = orders.get(m[1]);
    if (!order) return error(res, 404, "not_found", "No such order.");
    if (order.status !== "placed")
      return error(res, 409, "order_not_cancellable", `Order is ${order.status}.`);
    order.status = "cancelled";
    return send(res, 200, order);
  }

  return error(res, 404, "not_found", "No such route.");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Sample Shop API listening on http://127.0.0.1:${PORT} (X-API-Key: ${API_KEY})`);
});
