// Conformance scenario run against every example server in this repository.
// Usage: MCP_URL=http://127.0.0.1:3001/mcp node conformance.mjs
// Expects the Sample Shop API to be running on 127.0.0.1:4010.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { randomUUID } from "node:crypto";

const url = process.env.MCP_URL ?? "http://127.0.0.1:3001/mcp";
const expectedTools = ["search_products", "get_product", "create_order", "cancel_order"];
let failures = 0;
const check = (condition, label) => {
  console.log(`${condition ? "ok  " : "FAIL"} ${label}`);
  if (!condition) failures++;
};
const text = (result) => result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
const structured = (result) => {
  if (result.isError) throw new Error(`tool returned an error where success was expected: ${text(result)}`);
  return result.structuredContent ?? JSON.parse(text(result));
};

const client = new Client({ name: "conformance", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));
console.log(`connected to ${url}`);

// 1. Tool catalogue: same four tools, each with a description and a schema.
const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
check(JSON.stringify(names) === JSON.stringify([...expectedTools].sort()), `tools are ${expectedTools.join(", ")}`);
for (const tool of tools) {
  check((tool.description ?? "").length > 40, `${tool.name} has a real description`);
  check(tool.inputSchema?.type === "object", `${tool.name} has an object input schema`);
}
const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
check(byName.search_products?.annotations?.readOnlyHint === true, "search_products is annotated read-only");
check(byName.cancel_order?.annotations?.destructiveHint === true, "cancel_order is annotated destructive");

// 2. Read tools: search with pagination, then look one product up.
const page1 = structured(await client.callTool({ name: "search_products", arguments: { query: "lamp", limit: 2 } }));
check(Array.isArray(page1.items) && page1.items.length === 2, "search_products returns a page of 2");
check(page1.nextCursor !== undefined, "search_products reports nextCursor");
check(page1.items.every((p) => p.id && p.name && p.price && !("priceCents" in p)), "results are summarised, not raw records");
const page2 = structured(await client.callTool({ name: "search_products", arguments: { category: "kitchen", limit: 3 } }));
check(typeof page2.nextCursor === "string", "a larger category needs a second page");
const page3 = structured(await client.callTool({ name: "search_products", arguments: { category: "kitchen", limit: 3, cursor: page2.nextCursor } }));
check(page3.items.length >= 1 && page3.nextCursor === null, "following the cursor reaches the last page");
const product = structured(await client.callTool({ name: "get_product", arguments: { productId: "p-1004" } }));
check(product.name === "Oak dining table", "get_product returns the right product");

// 3. Errors tell the assistant what to do next.
const missing = await client.callTool({ name: "get_product", arguments: { productId: "p-0000" } });
check(missing.isError === true && /not found/i.test(text(missing)), "unknown id is an error that says not found");
// SDKs differ here, and both forms are protocol-correct: some return a tool
// result with isError, others reject the call with a JSON-RPC invalid-params
// error (which the client surfaces as an exception).
const badLimit = await client
  .callTool({ name: "search_products", arguments: { limit: 99 } })
  .then((result) => result.isError === true)
  .catch((error) => error.code === -32602);
check(badLimit, "limit out of range is rejected as an error");

// 4. Idempotent write: same key twice gives the same order, not a duplicate.
const key = randomUUID();
const order1 = structured(await client.callTool({ name: "create_order", arguments: { productId: "p-1007", quantity: 2, idempotencyKey: key } }));
const order2 = structured(await client.callTool({ name: "create_order", arguments: { productId: "p-1007", quantity: 2, idempotencyKey: key } }));
check(order1.id && order1.id === order2.id, "create_order with the same idempotency key returns the same order");
check(order1.status === "placed" && order1.totalCents === 7800, "order has status and total");
const conflict = await client.callTool({ name: "create_order", arguments: { productId: "p-1007", quantity: 3, idempotencyKey: key } });
check(conflict.isError === true && /conflict/i.test(text(conflict)), "reusing a key with a different payload is a conflict error");

// 5. Guarded action: refuses without confirmation, then cancels.
const ask = await client.callTool({ name: "cancel_order", arguments: { orderId: order1.id } });
check(ask.isError === true && /confirm/i.test(text(ask)) && text(ask).includes(order1.id), "cancel_order without confirm asks for confirmation and shows the order");
const cancelled = structured(await client.callTool({ name: "cancel_order", arguments: { orderId: order1.id, confirm: true } }));
check(cancelled.status === "cancelled", "cancel_order with confirm=true cancels");
const again = await client.callTool({ name: "cancel_order", arguments: { orderId: order1.id, confirm: true } });
check(again.isError === true && /conflict|cancelled/i.test(text(again)), "cancelling twice is reported, not repeated");

await client.close();
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
