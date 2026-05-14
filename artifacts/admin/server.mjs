import { createServer, request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import { createReadStream, existsSync } from "fs";
import { join, extname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT ?? 23744);
const distDir = resolve(__dirname, "dist/public");

// ---------------------------------------------------------------------------
// Deployment mode
//
// STANDALONE=true  — served at a root domain (admin.krishnavillage.com.au).
//                    Requests arrive as /  /api/...  /assets/...
//                    The dist is built with BASE_PATH=/ (build:standalone).
//
// (default)        — embedded in the monorepo at /admin/ path prefix.
//                    The metasidecar routes /admin/* → this process.
//                    The dist is built with BASE_PATH=/admin/ (build).
// ---------------------------------------------------------------------------
const STANDALONE = process.env.STANDALONE === "true";

// Defensively strip "KEY=value" format in case the env var was set incorrectly
// e.g. value is "API_URL=https://..." instead of just "https://..."
function parseEnvUrl(raw) {
  if (!raw) return null;
  const val = raw.includes("=http") ? raw.slice(raw.indexOf("=") + 1) : raw;
  return val.replace(/\/$/, "") || null;
}
const API_URL = parseEnvUrl(process.env.API_URL);
const apiPort = Number(process.env.API_PORT ?? 8083);
const apiHost = process.env.API_HOST ?? "localhost";

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// ---------------------------------------------------------------------------
// Auth is now handled entirely by the browser: it stores a JWT in
// localStorage after login and the api-client attaches it as a Bearer token
// on every request. This proxy passes that Authorization header through
// untouched. (Previously this file fetched an admin token on startup and
// overrode every Authorization header — removed when the login wall was
// restored.)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Request path normalisation
//
// In STANDALONE mode every request arrives with its real path (/, /api/...).
// In embedded (monorepo) mode the metasidecar keeps the /admin prefix intact,
// so we strip it before processing.
// ---------------------------------------------------------------------------
function normalisePaths(req) {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;

  if (STANDALONE) {
    // Paths are already correct — no prefix to strip.
    return { effectivePath: pathname, effectiveUrl: req.url, filePath: pathname };
  }

  // Embedded mode: strip /admin prefix forwarded by the metasidecar.
  const effectivePath = pathname.startsWith("/admin")
    ? pathname.slice("/admin".length) || "/"
    : pathname;
  const effectiveUrl = req.url.replace(/^\/admin/, "") || "/";
  const filePath = pathname.startsWith("/admin")
    ? pathname.slice("/admin".length) || "/"
    : pathname;

  return { effectivePath, effectiveUrl, filePath };
}

// ---------------------------------------------------------------------------
// API proxy
// ---------------------------------------------------------------------------
function proxyApi(effectiveUrl, req, res) {
  const onProxyRes = (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
    proxyRes.pipe(res);
  };
  const onError = (err) => {
    console.error("Proxy error:", err.message);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "API proxy error" }));
  };

  // Pass the browser's headers through verbatim — including any
  // Authorization: Bearer <jwt> set by the api-client after login.
  const headers = { ...req.headers };

  if (API_URL) {
    let target;
    try {
      target = new URL(effectiveUrl, API_URL);
    } catch (err) {
      console.error("Proxy URL build error:", err.message, "API_URL:", API_URL, "effectiveUrl:", effectiveUrl);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Bad API_URL configuration" }));
      return;
    }
    const isHttps = target.protocol === "https:";
    const requester = isHttps ? httpsRequest : httpRequest;
    const proxyReq = requester(
      {
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: target.pathname + target.search,
        method: req.method,
        headers: { ...headers, host: target.hostname },
      },
      onProxyRes,
    );
    proxyReq.on("error", onError);
    req.pipe(proxyReq);
  } else {
    const proxyReq = httpRequest(
      { hostname: apiHost, port: apiPort, path: effectiveUrl, method: req.method, headers },
      onProxyRes,
    );
    proxyReq.on("error", onError);
    req.pipe(proxyReq);
  }
}

// ---------------------------------------------------------------------------
// Static file server
// ---------------------------------------------------------------------------
const server = createServer((req, res) => {
  const { effectivePath, effectiveUrl, filePath } = normalisePaths(req);

  if (effectivePath.startsWith("/api")) {
    proxyApi(effectiveUrl, req, res);
    return;
  }

  const resolvedFilePath = filePath === "" || filePath === "/" ? "/index.html" : filePath;
  let fullPath = join(distDir, resolvedFilePath);
  if (!existsSync(fullPath) || !extname(fullPath)) {
    fullPath = join(distDir, "index.html");
  }

  const ext = extname(fullPath);
  const contentType = MIME[ext] ?? "application/octet-stream";

  const headers = { "Content-Type": contentType };
  if (ext === ".html") {
    headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
    headers["Pragma"] = "no-cache";
    headers["Clear-Site-Data"] = '"cache"';
  } else if ([".js", ".css"].includes(ext)) {
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  }

  res.writeHead(200, headers);
  createReadStream(fullPath).pipe(res);
});

server.listen(port, "::", () => {
  console.log(`Admin dashboard serving on port ${port} (${STANDALONE ? "standalone" : "embedded /admin"} mode)`);
  if (API_URL) console.log(`  API proxy → ${API_URL}`);
  else console.log(`  API proxy → http://${apiHost}:${apiPort}`);
});
