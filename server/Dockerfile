# Unified build: compiles server + web so the Express process can serve API and static frontend
# on a single port (localhost:42780 or the tunnel origin).
FROM node:22-alpine AS builder
WORKDIR /app
# build deps for bcrypt (native module)
RUN apk add --no-cache python3 make g++ linux-headers
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
COPY shared/package.json ./shared/package.json
RUN npm ci
COPY . .
RUN npm run build -w server \
 && npm run build -w web

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=42780 \
    NODE_OPTIONS=--enable-source-maps
# dumb-init reaps zombies / forwards SIGTERM; wget is used by the healthcheck
RUN apk add --no-cache mysql-client wget dumb-init \
 && addgroup -g 1001 -S nodejs \
 && adduser -S app -u 1001 -G nodejs
COPY --from=builder --chown=app:nodejs /app/server/dist ./dist
COPY --from=builder --chown=app:nodejs /app/server/package.json ./package.json
COPY --from=builder --chown=app:nodejs /app/node_modules ./node_modules
RUN npm prune --omit=dev && npm cache clean --force
COPY --from=builder --chown=app:nodejs /app/server/src/db/schema.sql ./src/db/schema.sql
# static frontend for single-origin serve (app.ts checks web/dist when NODE_ENV=production)
COPY --from=builder --chown=app:nodejs /app/web/dist ./web/dist
RUN mkdir -p /app/backup /app/uploads && chown -R app:nodejs /app
USER app
EXPOSE 42780
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD-SHELL wget -qO- "http://127.0.0.1:${PORT:-42780}/ready" || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
