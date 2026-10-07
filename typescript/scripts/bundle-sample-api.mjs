// Copies the repository's sample API next to dist/ so the published package is
// self-contained: `npx @apitoagents/sample-shop-mcp` can start it on its own.
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(root, "sample-api");
mkdirSync(target, { recursive: true });
for (const file of ["server.mjs", "openapi.json"])
  cpSync(join(root, "..", "sample-api", file), join(target, file));
