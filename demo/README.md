# Public demo: demo.apitoagents.com

One container runs the Sample Shop API and the TypeScript MCP server (see [`../Dockerfile`](../Dockerfile) and [`start.mjs`](start.mjs)). It serves `https://demo.apitoagents.com/mcp` from Cloud Run with in-memory data that resets whenever the instance restarts.

Terraform (in the Neoval devops repository, environment `production/apitoagents`, file `demo.tf`) owns the service, its service account, public invoker access, the domain mapping and the DNS record. Releases push only the image, the same split as the audit worker.

## Release a new image

From the repository root, with Application Default Credentials for the project:

```bash
TAG=europe-west4-docker.pkg.dev/apitoagents-app-prod/demo/sample-shop:$(git rev-parse --short HEAD)
gcloud builds submit --project apitoagents-app-prod --tag "$TAG" .
gcloud run deploy sample-shop-demo --project apitoagents-app-prod --region europe-west1 --image "$TAG"
```

Then check:

```bash
curl -s https://demo.apitoagents.com/health
```

## Connect

- Claude (web/desktop): Settings → Connectors → add custom connector → `https://demo.apitoagents.com/mcp`
- Claude Code: `claude mcp add --transport http sample-shop https://demo.apitoagents.com/mcp`
- Inspector: `npx @modelcontextprotocol/inspector`, Streamable HTTP, same URL
