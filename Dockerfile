# Public demo image: the Sample Shop API and the TypeScript MCP server in one
# container. Built by `gcloud builds submit` from the repository root; see
# demo/README.md for the exact commands.
FROM node:22-alpine AS build
WORKDIR /app
COPY typescript/package.json typescript/package-lock.json typescript/
RUN cd typescript && npm ci --no-fund --no-audit
COPY sample-api sample-api
COPY typescript typescript
RUN cd typescript && npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY --from=build /app/typescript/dist typescript/dist
COPY --from=build /app/typescript/node_modules typescript/node_modules
COPY --from=build /app/typescript/package.json typescript/package.json
COPY sample-api sample-api
COPY demo/start.mjs demo/start.mjs
USER node
EXPOSE 8080
CMD ["node", "demo/start.mjs"]
