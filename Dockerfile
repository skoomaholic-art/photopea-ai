# Existing Poster Editor UI and its Node API in one Cloud Run service.
# Build only the explicit static asset allowlist; no credentials enter the image.
FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:vendor && npm run build:static

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    AI_REQUESTS_ENABLED=false \
    PORT=8080
WORKDIR /app
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist/ ./
COPY --from=builder /app/scripts/dev-server.mjs /app/scripts/runtime-files.mjs ./scripts/
COPY --from=builder /app/worker/image-sources.js ./worker/image-sources.js
USER node
EXPOSE 8080
CMD ["sh", "-c", "exec node scripts/dev-server.mjs --host 0.0.0.0 --port ${PORT}"]
