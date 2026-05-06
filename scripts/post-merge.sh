#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# Rebuild the admin dashboard static bundle so the API server always
# serves up-to-date code after any task merge that changes admin source files.
echo "Rebuilding admin dashboard..."
pnpm --filter @workspace/admin build
echo "Admin dashboard rebuild complete."

# Rebuild the mobile PWA static bundle so the API server always serves
# up-to-date code after any task merge that changes mobile source files.
# REPLIT_DEV_DOMAIN is provided by the Replit environment; it becomes
# EXPO_PUBLIC_DOMAIN inside the mobile app at build time.
echo "Rebuilding mobile PWA..."
EXPO_PUBLIC_DOMAIN="${REPLIT_DEV_DOMAIN:-}" \
  pnpm --filter @workspace/mobile run build
echo "Mobile PWA rebuild complete."
