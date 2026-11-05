FROM node:22-alpine AS builder
WORKDIR /app
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL:-}
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S app -u 1001 && npm i -g serve
COPY --from=builder --chown=app:nodejs /app/dist ./dist
USER app
EXPOSE 42780
CMD ["serve", "-s", "dist", "-l", "42780"]
