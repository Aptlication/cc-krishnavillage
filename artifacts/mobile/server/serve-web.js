/**
 * Production static server for the Expo web export.
 * Serves dist/ with SPA fallback routing and correct PWA headers.
 * Proxies /api/* to the API server.
 *
 * API_URL  — full https URL of the api-server (Railway production)
 * API_HOST — api-server hostname (default: localhost)
 * API_PORT — api-server port    (default: 8083)
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const DIST_ROOT = path.resolve(__dirname, "..", "dist");
const port = parseInt(process.env.PORT || "3000", 10);

const API_URL = process.env.API_URL
  ? process.env.API_URL.replace(/\/$/, "")
  : null;
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
  if (basename === "sw.js") return "no-cache, no-store, must-revalidate";
  if (filePath.endsWith(".html")) return "no-cache";
  if (/\.[a-f0-9]{8,}\.(js|css)$/.test(basename)) return "public, max-age=31536000, immutable";
  return "public, max-age=3600";
}

function proxyToApi(req, res) {
  const onProxyRes = (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  };
  const onError = (err) => {
    console.error("[mobile proxy] API request failed:", err.message);
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "API unavailable" }));
  };

  if (API_URL) {
    const target = new URL(req.url, API_URL);
    const isHttps = target.protocol === "https:";
    const requester = isHttps ? https : http;
    const proxyReq = requester.request(
      {
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: target.pathname + target.search,
        method: req.method,
        headers: { ...req.headers, host: target.hostname },
      },
      onProxyRes,
    );
    proxyReq.on("error", onError);
    req.pipe(proxyReq, { end: true });
  } else {
    const proxyReq = http.request(
      {
        hostname: API_HOST,
        port: API_PORT,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `${API_HOST}:${API_PORT}` },
      },
      onProxyRes,
    );
    proxyReq.on("error", onError);
    req.pipe(proxyReq, { end: true });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname).replace(/\.\.+/g, "");

  if (pathname.startsWith("/api/")) {
    proxyToApi(req, res);
    return;
  }

  let filePath = path.join(DIST_ROOT, pathname);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

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
  console.log(`Serving Expo web PWA from dist/ on port ${port}`);
  if (API_URL) console.log(`  API proxy → ${API_URL}`);
  else console.log(`  API proxy → http://${API_HOST}:${API_PORT}`);
});
