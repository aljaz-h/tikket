# syntax=docker/dockerfile:1

# ---- Build stage -------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Native modules (better-sqlite3, sharp, @node-rs/argon2) ship prebuilt binaries for
# linux x64/arm64 (glibc and musl), so install scripts are skipped. On other
# platforms drop --ignore-scripts and install a toolchain here:
#   RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++
COPY package.json package-lock.json .npmrc ./
# Behind a TLS-intercepting proxy, pass its CA: docker build --secret id=ca,src=ca.pem .
RUN --mount=type=secret,id=ca,required=false \
	NODE_EXTRA_CA_CERTS=/run/secrets/ca npm ci --no-audit --no-fund --ignore-scripts
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund --ignore-scripts

# ---- Runtime stage -----------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
LABEL org.opencontainers.image.title="Tikket" \
	org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=3000 \
	DATA_DIR=/data \
	MIGRATIONS_DIR=/app/drizzle \
	BODY_SIZE_LIMIT=25M \
	SHUTDOWN_TIMEOUT=10
WORKDIR /app

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts

# Application files stay root-owned (read-only for the app user); only /data is writable.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Start-up validates configuration and the data directory, then applies migrations under a
# cross-process lock before listening; /api/health only reports healthy after that.
# adapter-node shuts down gracefully on SIGTERM.
CMD ["node", "build"]
