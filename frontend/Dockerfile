# Frontend Build Stage
FROM node:18-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
COPY frontend/package*.json ./frontend/
RUN npm install

# Copy source
COPY frontend ./frontend

# Build
RUN npm run build --workspace=frontend

# Production Stage
FROM node:18-alpine

WORKDIR /app

# Install serve to run the frontend
RUN npm install -g serve

# Copy built files from builder
COPY --from=builder /app/frontend/dist ./dist

# Expose port
EXPOSE 3000

# Start application
CMD ["serve", "-s", "dist", "-l", "3000"]
