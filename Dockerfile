# Build context: repository root
#   docker build -t mediago .

# ===== Stage 1: Node Builder (runs natively on build machine) =====
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS node-builder

RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

# Map Docker TARGETARCH to Node arch naming for deps download
ARG TARGETARCH
RUN if [ "$TARGETARCH" = "amd64" ]; then \
      echo "linux-x64" > /tmp/deps-platform; \
    else \
      echo "linux-${TARGETARCH}" > /tmp/deps-platform; \
    fi

WORKDIR /src

# Install dependencies — copy all workspace package.json files first for caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY apps/ui/package.json apps/ui/package.json
COPY apps/player-ui/package.json apps/player-ui/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/core/package.json apps/core/package.json
COPY apps/electron/package.json apps/electron/package.json
COPY packages/ packages/
RUN pnpm install --frozen-lockfile

# Copy source files and root configs needed by builds
COPY tsconfig*.json turbo.json .env* ./
COPY apps/ui/ apps/ui/
COPY apps/player-ui/ apps/player-ui/
COPY apps/electron/app/package.json apps/electron/app/package.json
COPY scripts/ scripts/

# Build player-ui (will be embedded in Go core binary)
RUN pnpm --filter @mediago/player-ui run build

# Build web UI for server mode
ENV APP_TARGET=server
ENV NODE_ENV=production
RUN pnpm build:web:raw

# Download third-party tools for TARGET platform
RUN pnpm deps:download:raw --platform "$(cat /tmp/deps-platform)"

# ===== Stage 2: Go Builder =====
FROM --platform=$BUILDPLATFORM golang:1.25-bookworm AS go-builder

ARG TARGETOS=linux
ARG TARGETARCH=amd64

WORKDIR /src

# Cache Go module downloads
COPY apps/core/go.mod apps/core/go.sum apps/core/
RUN cd apps/core && go mod download

# Copy Go source
COPY apps/core/ apps/core/

# Copy player-ui dist into assets for go:embed
COPY --from=node-builder /src/apps/player-ui/dist apps/core/assets/player/

# Ensure all dependencies are downloaded (go.sum may have been updated)
RUN cd apps/core && go mod download

# Build Go core binary (cross-compile, no CGO)
RUN cd apps/core && \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/mediago-core ./cmd/server

# ===== Stage 3: Runtime =====
FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates libicu72 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Core binary
COPY --from=go-builder /out/mediago-core /usr/local/bin/mediago-core

# Web UI static files
COPY --from=node-builder /src/apps/ui/build/server /app/static

# Third-party tools — copy from the platform-specific directory
ARG TARGETARCH
COPY --from=node-builder /src/.deps/linux-* /app/deps-tmp/
RUN mkdir -p /app/deps && \
    if [ -d /app/deps-tmp ]; then \
      find /app/deps-tmp -type f -exec cp {} /app/deps/ \; ; \
    fi && \
    chmod +x /app/deps/* 2>/dev/null || true && \
    rm -rf /app/deps-tmp

COPY THIRD_PARTY_NOTICES.md /app/THIRD_PARTY_NOTICES.md

RUN mkdir -p /app/mediago/data /app/mediago/logs /app/mediago/downloads

# Entrypoint script — isolates the invocation flags from the Dockerfile
# so editing the default args doesn't require rebuilding the full image
# layer and so callers can still append overrides via `docker run`.
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8899

VOLUME ["/app/mediago"]

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
