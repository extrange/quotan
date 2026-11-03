FROM node:24-bookworm-slim AS base

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# -------------------------

FROM base AS build

ARG TARGETARCH

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci --no-audit --no-fund

COPY tsconfig.base.json biome.jsonc ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
COPY scripts scripts

# Transformers.js only needs the CPU ONNX runtime on the target architecture.
# Drop the browser runtime and the CUDA/TensorRT providers before copying node_modules.
RUN npm run build \
    && npm prune --omit=dev \
    && if [ "$TARGETARCH" = "arm64" ]; then \
        rm -rf node_modules/onnxruntime-node/bin/napi-v6/linux/x64; \
    else \
        rm -rf node_modules/onnxruntime-node/bin/napi-v6/linux/arm64; \
    fi \
    && rm -rf \
        node_modules/onnxruntime-node/bin/napi-v6/darwin \
        node_modules/onnxruntime-node/bin/napi-v6/win32 \
        node_modules/onnxruntime-web \
    && find node_modules/onnxruntime-node/bin/napi-v6 -type f \
        \( -name 'libonnxruntime_providers_cuda.so' \
        -o -name 'libonnxruntime_providers_tensorrt.so' \) -delete

# -------------------------

FROM node:24-bookworm-slim AS deployment

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    TZ=Asia/Singapore \
    DATABASE_PATH=/data/quotan.sqlite \
    WEB_DIST_PATH=/app/apps/web/dist

# The official Node image already provides the unprivileged `node` user
# (uid/gid 1000), which matches a typical Linux bind-mount owner.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app /data \
    && chown -R node:node /app /data

WORKDIR /app

# Reuse the compiled native modules and pruned production dependencies.
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/package.json package.json
COPY --from=build --chown=node:node /app/apps/api/package.json apps/api/package.json
COPY --from=build --chown=node:node /app/apps/web/package.json apps/web/package.json
COPY --from=build --chown=node:node /app/packages/shared/package.json packages/shared/package.json
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /app/apps/web/dist apps/web/dist
COPY --from=build --chown=node:node /app/packages/shared/dist packages/shared/dist

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT ?? 3000) + '/api/healthz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/api/dist/main.js"]
