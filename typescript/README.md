# @apitoagents/sample-shop-mcp

An MCP server for a small sample shop, written with the official TypeScript SDK. It shows the three kinds of tool every real integration needs: paginated reads (`search_products`, `get_product`), an idempotent write (`create_order`) and a guarded action that refuses to run without explicit confirmation (`cancel_order`).

The same server exists in Python, C# and PHP, all passing one conformance scenario: [github.com/apitoagents/mcp-examples](https://github.com/apitoagents/mcp-examples). Walkthrough: [apitoagents.com/docs/build-mcp-server-typescript](https://apitoagents.com/docs/build-mcp-server-typescript).

## Try it in one command (stdio)

```bash
npx @apitoagents/sample-shop-mcp
```

That starts the bundled Sample Shop API on `127.0.0.1:4010` and serves the MCP tools over stdio, which is what Claude Desktop, Claude Code and the MCP Inspector expect from a local server.

Claude Code:

```bash
claude mcp add sample-shop -- npx -y @apitoagents/sample-shop-mcp
```

Claude Desktop (`claude_desktop_config.json`):

```json
{ "mcpServers": { "sample-shop": { "command": "npx", "args": ["-y", "@apitoagents/sample-shop-mcp"] } } }
```

## Run it over Streamable HTTP

```bash
UPSTREAM_URL=http://127.0.0.1:4010 npx -p @apitoagents/sample-shop-mcp node node_modules/@apitoagents/sample-shop-mcp/dist/server.js
```

Or from a clone: `npm ci && npm run build && npm start` (listens on `127.0.0.1:3001/mcp`). Environment: `HOST`, `PORT`, `UPSTREAM_URL`, `UPSTREAM_API_KEY` (default `demo-key`), `ALLOWED_HOSTS` (comma-separated public hostnames accepted in the Host header).

## Public demo

A hosted copy runs at `https://demo.apitoagents.com/mcp` (in-memory data, resets regularly). Add it as a remote MCP server in Claude or ChatGPT and ask for a desk lamp.

MIT. Built by [API to Agents](https://apitoagents.com), which designs and hosts servers like this for companies' own APIs.
