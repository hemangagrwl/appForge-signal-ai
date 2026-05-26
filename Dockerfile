FROM node:20-alpine

WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# Remove test files from production image
RUN rm -rf tests/

# Non-root user for security
RUN addgroup -S appforge && adduser -S appforge -G appforge
USER appforge

EXPOSE 3000

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
