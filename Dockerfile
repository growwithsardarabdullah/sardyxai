# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:20-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app

# better-sqlite3 is a native module; on slim images without a usable prebuilt
# binary (notably the linux/arm64 leg under QEMU) it compiles from source via
# node-gyp, which needs Python + a C++ toolchain. These live only in the build
# stages — the runtime image copies the already-compiled node_modules.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY freellmapi/package.json freellmapi/package-lock.json ./
COPY freellmapi/shared/package.json ./shared/
COPY freellmapi/server/package.json ./server/
RUN mkdir -p ./client && echo '{"name":"@freellmapi/client-stub","version":"0.0.0","private":true}' > ./client/package.json

RUN npm ci --legacy-peer-deps

FROM deps AS build
WORKDIR /app

COPY freellmapi/ ./
# Vercel's serverless function entry lives at /api/ at the project root.
# The Dockerfile context is the repo root, so copy it in explicitly.
# tsc -p tsconfig.api.json compiles this directory.
COPY api/ ./api/

RUN npm run build
RUN npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/server/package.json ./server/package.json
COPY --from=build --chown=node:node /app/server/dist ./server/dist
COPY --from=build --chown=node:node /app/api ./api

RUN mkdir -p /app/server/data && chown -R node:node /app/server/data

USER node

EXPOSE 3001
VOLUME ["/app/server/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/api/ping').then((res) => { if (!res.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["node", "server/dist/index.js"]
