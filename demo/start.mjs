// Supervisor for the demo container: starts the Sample Shop API on a private
// port, then the MCP server on the port Cloud Run assigns. If either exits,
// the container exits so the platform restarts it with fresh in-memory data.
import { spawn } from "node:child_process";

const API_PORT = 4010;
const run = (script, env) =>
  spawn(process.execPath, [script], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "inherit", "inherit"],
  });

const api = run("sample-api/server.mjs", { PORT: String(API_PORT), HOST: "127.0.0.1" });
const server = run("typescript/dist/server.js", {
  UPSTREAM_URL: `http://127.0.0.1:${API_PORT}`,
  HOST: process.env.HOST ?? "0.0.0.0",
  PORT: process.env.PORT ?? "8080",
});
for (const child of [api, server])
  child.on("exit", (code) => {
    console.error(`child exited with ${code}; stopping demo`);
    api.kill();
    server.kill();
    process.exit(code ?? 1);
  });
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    api.kill();
    server.kill();
    process.exit(0);
  });
