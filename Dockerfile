# Build context: repository root
#   docker build -t mediago .

# ===== Stage 1: Node Builder (runs natively on build machine) =====
FROM --platform=$BUILDPLATFORM node:24.14.0-bookworm-slim AS node-builder

RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.23.0 --activate

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
COPY apps/core/package.json apps/core/package.json
COPY apps/electron/package.json apps/electron/package.json
COPY packages/browser-extension/package.json packages/browser-extension/package.json
COPY packages/core-sdk/package.json packages/core-sdk/package.json
COPY packages/electron-preload/package.json packages/electron-preload/package.json
COPY packages/mediago-extension/package.json packages/mediago-extension/package.json
COPY packages/node-service/package.json packages/node-service/package.json
COPY packages/common/package.json packages/common/package.json
COPY packages/tooling/package.json packages/tooling/package.json
RUN pnpm install --frozen-lockfile

# Copy source files and root configs needed by builds
COPY tsconfig*.json turbo.json .env* ./
COPY apps/ui/ apps/ui/
COPY apps/player-ui/ apps/player-ui/
COPY apps/electron/app/package.json apps/electron/app/package.json
COPY packages/ packages/
COPY remote-config/assets/ remote-config/assets/

# Build player-ui (will be embedded in Go core binary)
RUN pnpm --filter @mediago/player-ui run build

# Build web UI for server mode
ENV APP_TARGET=server
ENV NODE_ENV=production
RUN pnpm build:web:raw

# Download third-party tools for TARGET platform
RUN pnpm deps:download:raw --tools N_m3u8DL-RE,BBDown,aria2,yt-dlp,deno,mediago --platform "$(cat /tmp/deps-platform)"

# ===== Stage 2: Go Builder =====
FROM --platform=$BUILDPLATFORM golang:1.27.3-bookworm AS go-builder

# Inherit BuildKit platform values; defaults here override --platform.
ARG TARGETOS
ARG TARGETARCH

WORKDIR /src

# Cache Go module downloads
COPY apps/core/go.mod apps/core/go.sum apps/core/
RUN cd apps/core && go mod download

# Copy Go source
COPY apps/core/ apps/core/

# Copy player-ui dist into assets for go:embed
COPY --from=node-builder /src/apps/player-ui/dist apps/core/assets/player/

# Copy the main Web UI into the same Core binary
COPY --from=node-builder /src/apps/ui/build/server apps/core/assets/web/

# Ensure all dependencies are downloaded (go.sum may have been updated)
RUN cd apps/core && go mod download

# Build Go core binary (cross-compile, no CGO)
RUN cd apps/core && \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/mediago-core ./cmd/server

# Rebuild the separately maintained download engine from checksum-pinned source.
# The repository API client is a different CLI and cannot replace this engine.
COPY packages/tooling/src/runtime-deps/rebuild-mediago.go /src/rebuild-mediago.go
COPY --from=node-builder /src/.deps/ /out/deps/
RUN GOTOOLCHAIN=go1.27.3 go run /src/rebuild-mediago.go \
    --output /out/deps/linux-$(if [ "$TARGETARCH" = "amd64" ]; then echo x64; else echo "$TARGETARCH"; fi)/mediago \
    --platform linux-${TARGETARCH}

RUN mkdir -p /out/runtime-deps && \
    cp /out/deps/linux-*/* /out/runtime-deps/ && \
    chmod +x /out/runtime-deps/*

# Prepare matching native libraries for the download tools and Jellyfin FFmpeg.
FROM debian:trixie-slim AS runtime-libraries
RUN apt-get update && \
    apt-get install -y --no-install-recommends libicu76 zlib1g ca-certificates curl xz-utils && \
    mkdir -p /runtime-libraries/var/lib/dpkg/status.d && \
    cp --parents -a /usr/lib/*-linux-gnu/libicudata.so.76* \
      /usr/lib/*-linux-gnu/libicui18n.so.76* /usr/lib/*-linux-gnu/libicuuc.so.76* \
      /usr/lib/*-linux-gnu/libz.so.1* /runtime-libraries/ && \
    dpkg-query --status libicu76 > /runtime-libraries/var/lib/dpkg/status.d/libicu76 && \
    dpkg-query --status zlib1g > /runtime-libraries/var/lib/dpkg/status.d/zlib1g

COPY packages/tooling/src/runtime-deps/install-docker-ffmpeg.sh /tmp/install-docker-ffmpeg.sh
RUN sh /tmp/install-docker-ffmpeg.sh /runtime-libraries

# ===== Stage 3: Runtime =====
FROM gcr.io/distroless/cc-debian13:latest

# Preserve architecture-specific library paths and package metadata for scanning.
COPY --from=runtime-libraries /runtime-libraries/ /

WORKDIR /app
COPY --from=go-builder /out/mediago-core /usr/local/bin/mediago-core
COPY --from=go-builder /out/runtime-deps/ /app/deps/
COPY THIRD_PARTY_NOTICES.md /app/THIRD_PARTY_NOTICES.md
EXPOSE 8899
VOLUME ["/app/mediago"]
# Core is PID1 and receives SIGTERM directly. Extra docker-run flags still append.
ENTRYPOINT ["/usr/local/bin/mediago-core", "--port=8899", "--enable-auth", "--db-path=/app/mediago/data/mediago.db", "--config-dir=/app/mediago/data", "--log-dir=/app/mediago/logs", "--local-dir=/app/mediago/downloads", "--deps-dir=/app/deps"]
