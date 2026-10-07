# MCP server examples: one API, four languages, one tool interface

Ready-to-clone examples that expose a REST API to ChatGPT, Claude and any other MCP client, written with the official Model Context Protocol SDKs for **TypeScript**, **Python**, **C#** and **PHP**. All four servers wrap the same small [Sample Shop API](sample-api/) and publish an identical set of four tools, and a [conformance test](tests/) proves it by running the same scenario against each of them in CI.

Maintained by [API to Agents](https://apitoagents.com), which builds and hosts this kind of server for companies that would rather not. The examples are MIT licensed; use them as a starting point for your own API.

## What the examples show

Every integration needs the same three kinds of tool, and every example here has them:

| Tool | Kind | What it demonstrates |
|---|---|---|
| `search_products` | read | Pagination with an opaque `nextCursor`, summarised results instead of raw records, a description that tells the assistant when the list is incomplete |
| `get_product` | read | Lookup by id, "not found" reported as an error that says not to retry |
| `create_order` | write | Idempotency: the assistant generates a key and reuses it on retry, so a timeout never creates a duplicate order |
| `cancel_order` | guarded | Refuses to act until called with `confirm=true`, after showing the user what will be cancelled |

Also shown in each: the upstream API key lives in the server's environment and is never visible to the assistant; errors distinguish invalid input, not found, conflict and upstream unavailable, each with a hint about what to do next; tools carry `readOnlyHint`, `destructiveHint` and `idempotentHint` annotations.

## Layout

```
sample-api/   Zero-dependency Node server + openapi.json. Products, orders, idempotent create, cancel.
typescript/   @modelcontextprotocol/server 2.3 + express, Streamable HTTP, stateless
python/       mcp 2.3 (MCPServer), Streamable HTTP, stateless
csharp/       ModelContextProtocol.AspNetCore 2.2, .NET 10, Streamable HTTP, stateless
php/          mcp/sdk 0.8, PHP 8.2+, Streamable HTTP with a file session store
tests/        Conformance scenario (TypeScript client) run against each server in CI
```

## Run it

Start the sample API once; it listens on `127.0.0.1:4010` and expects `X-API-Key: demo-key`.

```bash
node sample-api/server.mjs
```

Then start any server. Each reads `UPSTREAM_URL` (default `http://127.0.0.1:4010`) and `UPSTREAM_API_KEY` (default `demo-key`) from the environment.

```bash
# TypeScript — http://127.0.0.1:3001/mcp
cd typescript && npm ci && npm run build && npm start

# Python — http://127.0.0.1:3002/mcp
cd python && python -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python server.py

# C# — http://127.0.0.1:3003/mcp
cd csharp && dotnet run

# PHP — http://127.0.0.1:3004/mcp
cd php && composer install && php -S 127.0.0.1:3004 public/index.php
```

Run the conformance scenario against whichever one is up:

```bash
cd tests && npm ci && MCP_URL=http://127.0.0.1:3001/mcp npm test
```

## Connect an assistant

Each server is a remote MCP server over Streamable HTTP at `/mcp`. For a client on another machine, expose it over HTTPS and point the client at that URL:

- **Claude** (web, desktop, Claude Code): add it as a custom connector or MCP server by URL.
- **ChatGPT**: add it through the connector settings available on your plan.
- **Any MCP client**: use the Streamable HTTP transport with the server URL.

These examples use an API key on the *upstream* side only and no authentication on the MCP endpoint itself, which is fine on localhost and wrong on the internet. Before exposing one publicly, add bearer-token or OAuth protection at the endpoint; each SDK documents how.

## Adapting to your own API

1. Replace `sample-api/openapi.json` with your API description and the `shop` client in your language of choice with calls to your endpoints.
2. Keep the tool count small and outcome-shaped. The point is not to mirror every endpoint; see [choosing which API actions to expose](https://apitoagents.com/blog/choosing-api-actions-for-mcp-tools).
3. Keep the three kinds distinct: reads with permission checks, writes with idempotency keys, guarded actions with confirmation.
4. Keep the conformance test: edit `tests/conformance.mjs` to your tools and run it against every change.

Or run the free [Agent Readiness Audit](https://apitoagents.com/agent-readiness-audit): it reads your documentation and proposes the tools, the boundaries and a fixed price for having it built and hosted.

## License

MIT. See [LICENSE](LICENSE).
