# syntax=docker/dockerfile:1

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS builder

# Install dependencies including dev dependencies for build
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev) for building
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:${NODE_VERSION}-alpine

# Use production node environment
ENV NODE_ENV=production

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
# Email templates (with the logo) and the brand mark for PDFs are read from src/ at runtime
COPY --from=builder /app/src/templates ./src/templates
COPY --from=builder /app/src/assets ./src/assets

# Create dist directory with proper permissions (if needed)
# RUN chown -R node:node /usr/src/app

# Expose the port that the application listens on.
EXPOSE 3000

# Run the application as a non-root user.
# USER node

# Run the application from the built files
CMD ["node", "dist/server.js"]