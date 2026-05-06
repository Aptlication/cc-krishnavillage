/**
 * Production web build script.
 * Runs `expo export --platform web` to produce a static PWA in dist/.
 * EXPO_PUBLIC_DOMAIN is set from the deployment environment so API calls
 * resolve to the correct backend domain at runtime.
 */

const { spawn } = require("child_process");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

function getDeploymentDomain() {
  const raw =
    process.env.EXPO_PUBLIC_DOMAIN ||
    process.env.REPLIT_INTERNAL_APP_DOMAIN ||
    process.env.REPLIT_DEV_DOMAIN ||
    "";

  if (!raw) {
    console.error("ERROR: No deployment domain found.");
    process.exit(1);
  }

  // Strip protocol if present
  return raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function main() {
  const domain = getDeploymentDomain();
  console.log(`Building web PWA for domain: ${domain}`);

  const env = {
    ...process.env,
    EXPO_PUBLIC_DOMAIN: domain,
    NODE_ENV: "production",
  };

  const child = spawn(
    "pnpm",
    ["exec", "expo", "export", "--platform", "web", "--output-dir", "dist"],
    {
      stdio: "inherit",
      cwd: projectRoot,
      env,
    }
  );

  child.on("exit", (code) => {
    if (code !== 0) {
      console.error(`expo export failed with exit code ${code}`);
      process.exit(code ?? 1);
    }
    console.log("Web build complete → dist/");
  });
}

main();
