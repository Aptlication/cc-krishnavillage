import { createServer, request as httpRequest } from "http";
import { createReadStream, existsSync } from "fs";
import { join, extname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT ?? 23744);
const apiPort = Number(process.env.API_PORT ?? 8083);
const distDir = resolve(__dirname, "dist/public");

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

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const pathname = url.pathname;

  // Strip /admin prefix so both /api/... and /admin/api/... are proxied
  const effectivePath = pathname.startsWith("/admin")
    ? pathname.slice("/admin".length) || "/"
    : pathname;
  const effectiveUrl = req.url.replace(/^\/admin/, "") || "/";

  if (effectivePath.startsWith("/api")) {
    const proxyReq = httpRequest(
      {
        hostname: "localhost",
        port: apiPort,
        path: effectiveUrl,
        method: req.method,
        headers: req.headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on("error", (err) => {
      console.error("Proxy error:", err.message);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "API proxy error" }));
    });
    req.pipe(proxyReq);
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
});
