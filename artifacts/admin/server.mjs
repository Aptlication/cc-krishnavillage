import { createServer, request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import { createReadStream, existsSync } from "fs";
import { join, extname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT ?? 23744);
const distDir = resolve(__dirname, "dist/public");

const API_URL = process.env.API_URL
  ? process.env.API_URL.replace(/\/$/, "")
  : null;
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
// Bypass token — acquired from the api-server on startup so the admin
// dashboard never shows a login wall. The token is injected into every
// proxied /api request.
// ---------------------------------------------------------------------------
let bypassToken = null;

async function fetchBypassToken() {
  const password = process.env.ADMIN_BYPASS_SECRET || process.env.INITIAL_ADMIN_PASSWORD;
  if (!password) {
    console.warn("Admin bypass: ADMIN_BYPASS_SECRET not set — skipping");
    return false;
  }

  const base = API_URL || `http://${apiHost}:${apiPort}`;
  const loginUrl = `${base}/api/staff/login`;

  try {
    const res = await fetch(loginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password }),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.token) {
        bypassToken = json.token;
        console.log("Admin bypass token acquired from", loginUrl);
        return true;
      }
    } else {
      console.warn("Bypass login failed:", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.warn("Bypass token fetch error:", err.message);
  }
  return false;
}

async function initBypassToken() {
  const MAX_ATTEMPTS = 20;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 3000));
    const ok = await fetchBypassToken();
    if (ok) return;
    console.log(`Bypass token attempt ${attempt}/${MAX_ATTEMPTS} failed — retrying…`);
  }
  console.warn("Could not acquire bypass token after all attempts. Login wall will be shown.");
}

// Fire-and-forget; never crash the process on failure
initBypassToken().catch((err) => console.error("initBypassToken unexpected error:", err));

// Refresh before the 8-hour JWT expiry
setInterval(() => fetchBypassToken().catch(() => {}), 7 * 60 * 60 * 1000);

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

  const headers = { ...req.headers };
  if (bypassToken) headers["authorization"] = `Bearer ${bypassToken}`;

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
      { hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: target.pathname + target.search,
        method: req.method,
        headers: { ...headers, host: target.hostname } },
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
  const url = new URL(req.url, `http://localhost`);
  const pathname = url.pathname;

  const effectivePath = pathname.startsWith("/admin")
    ? pathname.slice("/admin".length) || "/"
    : pathname;
  const effectiveUrl = req.url.replace(/^\/admin/, "") || "/";

  if (effectivePath.startsWith("/api")) {
    proxyApi(effectiveUrl, req, res);
    return;
  }

  let filePath = pathname;
  if (filePath.startsWith("/admin")) {
    filePath = filePath.slice("/admin".length) || "/";
  }
  if (filePath === "" || filePath === "/") filePath = "/index.html";

  let fullPath = join(distDir, filePath);
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
  console.log(`Admin dashboard serving on port ${port}`);
  if (API_URL) console.log(`  API proxy → ${API_URL}`);
  else console.log(`  API proxy → http://${apiHost}:${apiPort}`);
});
