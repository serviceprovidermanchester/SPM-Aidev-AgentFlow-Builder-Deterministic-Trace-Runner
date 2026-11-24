# Multi-stage lightweight production Dockerfile for AgentFlow
# Built by SPManchester Private Limited (https://spmanchester.com)
FROM node:22-alpine

LABEL org.opencontainers.image.title="AgentFlow" \
      org.opencontainers.image.description="Enterprise Agent Workflow Builder & Deterministic Trace Runner" \
      org.opencontainers.image.vendor="SPManchester Private Limited" \
      org.opencontainers.image.authors="Sayed Mudassar Akbar <info@spmanchester.com>" \
      org.opencontainers.image.url="https://www.spmanchester.com"

WORKDIR /app

# Copy root metadata and backend / web / database assets
COPY package.json ./
COPY backend ./backend
COPY database ./database
COPY web ./web

# Create data directory for SQLite persistence
RUN mkdir -p /app/backend/data && chown -R node:node /app

USER node

ENV PORT=4000 \
    HOST=0.0.0.0 \
    NODE_ENV=production \
    DB_PATH=/app/backend/data/agentflow.sqlite

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4000/health || exit 1

CMD ["node", "backend/src/server.js"]
