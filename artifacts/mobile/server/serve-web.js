/**
 * Production static server for the Expo web export.
 * Serves dist/ with SPA fallback routing and correct PWA headers.
 * Also proxies /api/* requests to the API server so that the mobile
 * PWA can reach the backend from any origin (dev or production).
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const DIST_ROOT = path.resolve(__dirname, "..", "dist");
const port = parseInt(process.env.PORT || "3000", 10);

// API server to proxy to. In dev this is localhost:8083.
// In production Replit routes /api/* at the platform level but the
// proxy here acts as a safety-net and ensures dev works correctly.
const API_PORT = parseInt(process.env.API_PORT || "8083", 10);
const API_HOST = process.env.API_HOST || "localhost";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".ttf":  "font/ttf",
  ".otf":  "font/otf",
  ".map":  "application/json",
};

function getCacheControl(filePath) {
  const basename = path.basename(filePath);
  // Service worker must always be re-fetched
  if (basename === "sw.js") return "no-cache, no-store, must-revalidate";
  // HTML files — short cache so updates propagate quickly
  if (filePath.endsWith(".html")) return "no-cache";
  // Hashed JS/CSS bundles can be cached long-term
  if (/\.[a-f0-9]{8,}\.(js|css)$/.test(basename)) return "public, max-age=31536000, immutable";
  return "public, max-age=3600";
}

function proxyToApi(req, res) {
  const options = {
    hostname: API_HOST,
    port: API_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `${API_HOST}:${API_PORT}` },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (err) => {
    console.error("[mobile proxy] API request failed:", err.message);
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "API unavailable" }));
  });

  req.pipe(proxyReq, { end: true });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname).replace(/\.\.+/g, "");

  // Proxy /api/* to the API server
  if (pathname.startsWith("/api/")) {
    proxyToApi(req, res);
    return;
  }

  // Resolve to a file in dist/
  let filePath = path.join(DIST_ROOT, pathname);

  // If it's a directory, look for index.html inside
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  // If file doesn't exist → SPA fallback to index.html
  if (!fs.existsSync(filePath)) {
    filePath = path.join(DIST_ROOT, "index.html");
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found — dist/index.html missing. Run the build first.");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const cacheControl = getCacheControl(filePath);

  const content = fs.readFileSync(filePath);
  res.writeHead(200, {
    "content-type": contentType,
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff",
  });
  res.end(content);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Serving Expo web PWA from dist/ on port ${port} (API proxy → ${API_HOST}:${API_PORT})`);
});
