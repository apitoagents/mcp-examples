#!/usr/bin/env node
// `npx @apitoagents/sample-shop-mcp`: the same server over stdio, for clients
// that launch local MCP servers (Claude Desktop, Claude Code, the Inspector).
// Unless UPSTREAM_URL is set, it starts the bundled Sample Shop API itself so
// a single command gives a working demo.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

const here = dirname(fileURLToPath(import.meta.url));
const API_PORT = Number(process.env.SAMPLE_API_PORT ?? 4010);

async function waitFor(url: string, attempts = 50) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The bundled Sample Shop API did not start on ${url}`);
}

let api: ChildProcess | undefined;
if (!process.env.UPSTREAM_URL) {
  const script = join(here, "..", "sample-api", "server.mjs");
  if (!existsSync(script)) {
    console.error("Bundled sample API not found; set UPSTREAM_URL to an existing Sample Shop API.");
    process.exit(1);
  }
  // stdout is the MCP channel: the child's output must go to stderr only.
  api = spawn(process.execPath, [script], {
    env: { ...process.env, PORT: String(API_PORT), HOST: "127.0.0.1" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  process.env.UPSTREAM_URL = `http://127.0.0.1:${API_PORT}`;
  await waitFor(`${process.env.UPSTREAM_URL}/health`);
  const stop = () => api?.kill();
  process.on("exit", stop);
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
}

const { buildServer } = await import("./shop-server.js");
await buildServer().connect(new StdioServerTransport());
