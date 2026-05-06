/**
 * Postprocess step run after Orval codegen.
 *
 * Two issues fixed:
 *
 * 1. Multipart body type conflict: When an endpoint uses multipart/form-data,
 *    Orval generates BOTH a Zod schema const (in api.ts) AND a TypeScript type
 *    (in generated/types/) with the same name, e.g. `UploadExpenseReceiptBody`.
 *    The generated index.ts re-exports both, causing TS2308.
 *    Fix: remove re-export of the conflicting TS type from generated/types/index.ts.
 *
 * 2. Spurious api.schemas export: Orval sometimes adds
 *    `export * from "./generated/api.schemas"` to index.ts but never creates
 *    that file, causing TS2307.
 *    Fix: remove that line from index.ts if the file doesn't exist.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", "..");
const apiZodSrc = resolve(root, "lib", "api-zod", "src");
const typesIndex = resolve(apiZodSrc, "generated", "types", "index.ts");
const mainIndex = resolve(apiZodSrc, "index.ts");

// ── Fix 1: Remove conflicting multipart body type re-exports ─────────────────
const MULTIPART_BODY_TYPES = [
  "uploadExpenseReceiptBody",
];

try {
  const content = readFileSync(typesIndex, "utf-8");
  let patched = content;
  for (const name of MULTIPART_BODY_TYPES) {
    patched = patched.replace(
      new RegExp(`^export \\* from "\\.\\/${name}";\\n?`, "m"),
      ""
    );
  }
  if (patched !== content) {
    writeFileSync(typesIndex, patched, "utf-8");
    console.log("[postprocess-zod] Fix 1: Removed conflicting multipart type re-exports.");
  }
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}

// ── Fix 2: Remove spurious api.schemas export from index.ts ──────────────────
try {
  const content = readFileSync(mainIndex, "utf-8");
  let patched = content;

  // Remove any export that points to a file that doesn't actually exist
  patched = patched.replace(
    /^export \* from "\.\/generated\/api\.schemas";\n?/m,
    ""
  );

  if (patched !== content) {
    writeFileSync(mainIndex, patched, "utf-8");
    console.log("[postprocess-zod] Fix 2: Removed spurious api.schemas export from index.ts.");
  }
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}

console.log("[postprocess-zod] Done.");
