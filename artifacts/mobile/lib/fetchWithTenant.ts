/**
 * Thin wrapper around `fetch` that automatically attaches X-Tenant-ID to every request.
 * Use this instead of bare `fetch()` in guest-facing screens.
 */
const TENANT_ID = process.env.EXPO_PUBLIC_TENANT_ID ?? "1";

export function fetchWithTenant(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const existing = new Headers(init.headers ?? {});
  if (!existing.has("x-tenant-id")) {
    existing.set("x-tenant-id", TENANT_ID);
  }
  return fetch(input, { ...init, headers: existing });
}
