FROM node:20-alpine

RUN apk add --no-cache python3 make g++ docker-cli

WORKDIR /app

# Install dependencies
COPY server/package.json ./
RUN npm install --omit=dev

# Copy server source
COPY server/index.js ./
COPY server/.env ./

# Copy frontend into a predictable location
COPY client/public/ ./public/

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=10s --start-period=10s --retries=5 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "index.js"]
