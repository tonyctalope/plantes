# syntax=docker/dockerfile:1

# Web app: plain static files, so build it once on the native build platform.
FROM --platform=$BUILDPLATFORM node:26-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY shared ./shared
COPY web ./web
RUN npm run build

# Production dependencies for the target platform (sharp ships prebuilt libvips).
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:26-alpine
ENV NODE_ENV=production \
    DATA_DIR=/data \
    WEB_DIR=/app/dist/web \
    PORT=8787
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY shared ./shared
COPY src ./src
COPY --from=web /app/dist/web ./dist/web
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# Node 26 runs the TypeScript sources directly (type stripping): no build step for the server.
CMD ["node", "src/main.ts"]
