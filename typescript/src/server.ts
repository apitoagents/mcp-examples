// Streamable HTTP entry point. One fresh McpServer per request: stateless, so
// the endpoint scales horizontally and holds nothing between calls.
import express from "express";
import { hostHeaderValidation } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { buildServer } from "./shop-server.js";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3001);
// DNS-rebinding protection: only these Host headers are accepted. Add your
// public hostname through ALLOWED_HOSTS (comma-separated) when deploying.
const allowedHosts = [
  "localhost",
  "127.0.0.1",
  "[::1]",
  ...(process.env.ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean),
];

const handler = createMcpHandler(() => buildServer());
const node = toNodeHandler(handler);
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(hostHeaderValidation(allowedHosts));
app.all("/mcp", (req, res) => void node(req, res, req.body));
app.get("/health", (_req, res) => void res.json({ ok: true }));
// Server card: lets directories (Smithery reads this path) describe the server
// without connecting. Harmless for clients that never look.
app.get("/.well-known/mcp/server-card.json", (req, res) =>
  void res.json({
    name: "sample-shop",
    title: "Sample Shop MCP server",
    version: "1.0.1",
    description:
      "Open-source sample shop with a paginated product search, an idempotent order tool and a guarded cancellation. Built by API to Agents to show the three kinds of tool every integration needs.",
    url: `https://${req.headers.host ?? "demo.apitoagents.com"}/mcp`,
    transport: "streamable-http",
    authentication: { schemes: [] },
    tools: [
      { name: "search_products", description: "Paginated catalogue search (read-only)." },
      { name: "get_product", description: "One product by id (read-only)." },
      { name: "create_order", description: "Place an order; idempotent by key." },
      { name: "cancel_order", description: "Cancel an order; requires explicit confirmation." },
    ],
    documentation: "https://apitoagents.com/docs",
    source: "https://github.com/apitoagents/mcp-examples",
    package: "@apitoagents/sample-shop-mcp",
  }),
);
app.get("/", (_req, res) =>
  void res.json({
    name: "sample-shop",
    mcp: "/mcp",
    docs: "https://apitoagents.com/docs",
    source: "https://github.com/apitoagents/mcp-examples",
  }),
);
app.listen(PORT, HOST, () => {
  console.log(`sample-shop MCP (TypeScript) on http://${HOST}:${PORT}/mcp`);
});
