// [DIAG] Temporary diagnostic logging — remove once api-server startup is verified.
console.error("[api-server][DIAG] stage 1: index.mjs entered (imports starting)");

import app from "./app";
console.error("[api-server][DIAG] stage 2: ./app imported");

import { logger } from "./lib/logger";
console.error("[api-server][DIAG] stage 3: ./lib/logger imported");

import { ensureDefaultAdmin } from "./routes/staffRoute";
console.error("[api-server][DIAG] stage 4: ./routes/staffRoute imported");

const rawPort = process.env["PORT"];
console.error(`[api-server][DIAG] stage 5: PORT = ${JSON.stringify(rawPort)}`);

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);
console.error(`[api-server][DIAG] stage 6: parsed port = ${port}`);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const isProduction = process.env["NODE_ENV"] === "production";
console.error(`[api-server][DIAG] stage 7: NODE_ENV = ${JSON.stringify(process.env["NODE_ENV"])}, about to call app.listen`);

app.listen(port, (err) => {
  console.error("[api-server][DIAG] stage 8: app.listen callback fired");
  if (err) {
    console.error("[api-server][DIAG] stage 9a: app.listen reported error", err);
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  console.error(`[api-server][DIAG] stage 9b: HTTP server is actually listening on port ${port}`);
  logger.info({ port }, "Server listening");

  ensureDefaultAdmin().catch((err) => {
    console.error("[api-server][DIAG] stage 10: ensureDefaultAdmin rejected", err);
    logger.error({ err }, "ensureDefaultAdmin failed — server will continue running");
  });
});

console.error("[api-server][DIAG] stage end-of-sync: index.mjs synchronous code finished");

// Surface anything that would otherwise crash the process silently.
process.on("uncaughtException", (err) => {
  console.error("[api-server][DIAG] uncaughtException", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[api-server][DIAG] unhandledRejection", reason);
});
process.on("exit", (code) => {
  console.error(`[api-server][DIAG] process.on('exit') code=${code}`);
});
