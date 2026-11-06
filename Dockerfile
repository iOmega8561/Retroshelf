# syntax=docker/dockerfile:1.7
#
# Retroshelf, full image: the latest stable EmulatorJS release (scripts, translations and every
# core) is bundled and served by Retroshelf itself, so players never contact a CDN and the
# whole stack works on networks without internet access.
#   podman build -t localhost/retroshelf:latest .
#   podman build --build-arg EMULATORJS_VERSION=4.2.3 -t localhost/retroshelf:latest .   # pin
# Light image that loads EmulatorJS from its CDN instead: Dockerfile.light
#
ARG NODE_VERSION=22

# ---------- Stage 1: web UI (Vite + React + Tailwind, TypeScript) ----------
FROM docker.io/library/node:${NODE_VERSION}-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY shared/ /src/shared/
COPY web/ ./
RUN npm run build

# ---------- Stage 2: server (Express, TypeScript) ----------
FROM docker.io/library/node:${NODE_VERSION}-alpine AS server
WORKDIR /src/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY shared/ /src/shared/
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# ---------- Stage 3: EmulatorJS release ----------
FROM docker.io/library/node:${NODE_VERSION}-alpine AS emulatorjs
# "stable" resolves to the current stable release at build time; set a version to pin it.
ARG EMULATORJS_VERSION=stable
# Optional integrity check of the release archive: --build-arg EMULATORJS_SHA256=<sha256>
ARG EMULATORJS_SHA256=
RUN apk add --no-cache 7zip curl
WORKDIR /ejs
RUN set -eu; \
    version="$EMULATORJS_VERSION"; \
    if [ "$version" = "stable" ]; then \
      version="$(curl -fsSL https://cdn.emulatorjs.org/stable/data/version.json | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).version')"; \
    fi; \
    echo "Bundling EmulatorJS ${version}"; \
    curl -fsSL --retry 3 -o release.7z "https://cdn.emulatorjs.org/releases/${version}.7z"; \
    sha="$(sha256sum release.7z | cut -d' ' -f1)"; \
    echo "EmulatorJS ${version} sha256 ${sha}"; \
    if [ -n "$EMULATORJS_SHA256" ] && [ "$sha" != "$EMULATORJS_SHA256" ]; then \
      echo "EmulatorJS archive checksum mismatch" >&2; exit 1; \
    fi; \
    sevenzip="$(command -v 7z || command -v 7zz || command -v 7za)"; \
    "$sevenzip" x -y -bd -oextracted release.7z >/dev/null; \
    test -f extracted/data/loader.js; \
    test -f extracted/data/emulator.min.js; \
    mkdir out; \
    mv extracted/data out/data; \
    cp extracted/LICENSE out/LICENSE; \
    rm -rf extracted release.7z

# ---------- Stage 4: runtime ----------
FROM docker.io/library/node:${NODE_VERSION}-alpine AS runtime

LABEL org.opencontainers.image.title="Retroshelf" \
      org.opencontainers.image.description="Self-hosted retro game library with in-browser play via EmulatorJS" \
      org.opencontainers.image.source="https://example.invalid/retroshelf"

# The base image ships a "node" user on 1000:1000; replace it with an explicit, unprivileged
# system account so the UID/GID contract is visible here rather than inherited.
RUN deluser --remove-home node 2>/dev/null || true; \
    delgroup node 2>/dev/null || true; \
    addgroup -S -g 1000 retroshelf && \
    adduser -S -D -H -u 1000 -G retroshelf -h /app -s /sbin/nologin retroshelf

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    LIBRARY_DIR=/library \
    WEB_DIR=/app/web \
    EJS_LOCAL_DIR=/app/emulatorjs/data

WORKDIR /app
# Application files stay root-owned and read-only for the runtime user: the process never
# writes anywhere, so the container runs with a read-only root filesystem.
COPY --from=server /src/server/package.json ./package.json
COPY --from=server /src/server/node_modules ./node_modules
COPY --from=server /src/server/dist ./dist
COPY --from=web /src/web/dist ./web
# EmulatorJS is GPL-3.0; its licence ships next to it.
COPY --from=emulatorjs /ejs/out ./emulatorjs

USER 1000:1000
EXPOSE 8080
STOPSIGNAL SIGTERM
# Honoured by Docker and by Podman when building with --format docker; Quadlet uses HealthCmd=.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "/app/dist/healthcheck.js"]
CMD ["node", "dist/index.js"]
