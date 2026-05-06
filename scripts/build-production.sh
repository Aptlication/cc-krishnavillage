#!/usr/bin/env sh
set -e

echo "==> Building admin dashboard..."
pnpm --filter @workspace/admin run build

echo "==> Building mobile PWA..."
EXPO_PUBLIC_DOMAIN="app.krishnavillage.com.au" \
  pnpm --filter @workspace/mobile run build

echo "==> Building API server..."
pnpm --filter @workspace/api-server run build

echo "==> Production build complete."
