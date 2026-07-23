/**
 * Vercel monorepo packaging bug workaround
 * -----------------------------------------
 * With Root Directory = "frontend", the Git clone still lives at:
 *   /vercel/path0/                 (repo root)
 *   /vercel/path0/frontend/        (Next app)
 *
 * Next builds correctly into frontend/.next, but a later packaging step
 * resolves paths from /vercel/path0 (repo root), looking for:
 *   /vercel/path0/.next/package.json
 *   /vercel/path0/node_modules/next/...
 *
 * Mirror the app's build artifacts + node_modules up to the repo root so
 * those lstats succeed.
 */
const fs = require("node:fs");
const path = require("node:path");

const cwd = process.cwd();
const appName = path.basename(cwd);

function log(...args) {
  console.log("[ensure-next-package-json]", ...args);
}

function ensurePkg(pkgPath) {
  fs.mkdirSync(path.dirname(pkgPath), { recursive: true });
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);
    log("wrote", pkgPath);
  } else {
    log("present", pkgPath);
  }
}

function linkInto(repoRoot, name) {
  const target = path.join(cwd, name);
  const linkPath = path.join(repoRoot, name);
  if (!fs.existsSync(target)) {
    log("skip missing", target);
    return;
  }
  if (fs.existsSync(linkPath) || fs.lstatSync(linkPath).isSymbolicLink?.()) {
    try {
      const stat = fs.lstatSync(linkPath);
      if (stat.isSymbolicLink() || stat.isDirectory() || stat.isFile()) {
        log("already exists", linkPath);
        return;
      }
    } catch {
      // continue
    }
  }
  try {
    if (fs.existsSync(linkPath)) {
      log("already exists", linkPath);
      return;
    }
  } catch {
    // continue
  }

  const type = fs.statSync(target).isDirectory() ? "dir" : "file";
  try {
    fs.symlinkSync(target, linkPath, type);
    log("symlinked", linkPath, "->", target);
  } catch (error) {
    log(
      "symlink failed for",
      name,
      error instanceof Error ? error.message : error,
    );
    // File fallback for package.json only
    if (name === "package.json") {
      fs.copyFileSync(target, linkPath);
      log("copied", linkPath);
    }
  }
}

const appNextDir = path.join(cwd, ".next");
ensurePkg(path.join(appNextDir, "package.json"));

if (appName !== "frontend") {
  process.exit(0);
}

const repoRoot = path.join(cwd, "..");

// Critical paths the packager resolves from the monorepo root:
for (const name of [".next", "node_modules", "package.json", "next.config.mjs"]) {
  linkInto(repoRoot, name);
}

// Double-check root .next/package.json is visible via the symlink
ensurePkg(path.join(repoRoot, ".next", "package.json"));

const nextSetup = path.join(
  repoRoot,
  "node_modules",
  "next",
  "dist",
  "build",
  "adapter",
  "setup-node-env.external.js",
);
log(
  fs.existsSync(nextSetup)
    ? `ok next adapter file: ${nextSetup}`
    : `MISSING next adapter file: ${nextSetup}`,
);
