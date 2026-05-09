FROM node:22-bookworm-slim
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@10

# Copy workspace config (needed for pnpm to resolve workspace: deps)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy shared libs the api-server depends on
COPY lib/ ./lib/

# Copy the api-server source
COPY artifacts/api-server/ ./artifacts/api-server/

# Install all workspace dependencies (frozen — exact lockfile)
RUN pnpm install --frozen-lockfile

# Build the api-server bundle
RUN pnpm --filter @workspace/api-server run build

# At runtime: migrate DB schema then start the server
# DATABASE_URL and all other secrets are injected by Railway at runtime
CMD pnpm --filter @workspace/db run push-force && node --enable-source-maps artifacts/api-server/dist/index.mjs
