# Build stage
FROM node:22-bookworm-slim AS builder

# Install build dependencies for native node modules (tree-sitter, better-sqlite3)
RUN apt-get update && \
    apt-get install -y python3 make g++ git && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy .npmrc first to configure pnpm before install
COPY .npmrc ./

# Copy package files and scripts
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY scripts ./scripts

# Install dependencies using hoisted node-linker so node_modules is self-contained (no symlinks)
# Ignore unrs-resolver build script locally, but we must rebuild it in CI so pnpm run build doesn't fail deps check.
RUN pnpm install --config.node-linker=hoisted --config.ignore-scripts=true || \
    (pnpm install --config.node-linker=hoisted --ignore-scripts && \
     pnpm rebuild tree-sitter better-sqlite3 esbuild tree-sitter-cli tree-sitter-go tree-sitter-javascript tree-sitter-python tree-sitter-c tree-sitter-c-sharp tree-sitter-cpp tree-sitter-java tree-sitter-kotlin tree-sitter-php tree-sitter-ruby tree-sitter-rust tree-sitter-swift tree-sitter-typescript sharp unrs-resolver)

# Copy source code
COPY . .

# Build the project (compiles TypeScript to JavaScript in dist/)
# Disable deps status check via env var to avoid unrs-resolver verification error
RUN PNPM_IGNORE_DEP_SCRIPTS=true pnpm run build

# Runtime stage
FROM node:22-bookworm-slim

# Install runtime dependencies
RUN apt-get update && \
    apt-get install -y ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy built package files and node_modules from builder
COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Create a workspace data directory with 777 permissions for indexing
RUN mkdir -p /data && chmod 777 /data
ENV WORKSPACE_PATH=/data

# Expose port (Fly.io uses 8080, Hugging Face uses 7860)
EXPOSE 8080

# Run the server on port specified by PORT env var, or fallback to 8080
CMD ["sh", "-c", "node dist/index.js mcp-http --port ${PORT:-8080} --host 0.0.0.0"]
