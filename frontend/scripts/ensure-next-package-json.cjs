/**
 * Vercel monorepo packaging workaround
 *
 * Layout on Vercel (Root Directory NOT set, so repo root = /vercel/path0):
 *   /vercel/path0/                 monorepo root  (Vercel resolves paths here)
 *   /vercel/path0/frontend/        Next app        (build cwd)
 *
 * Next builds into frontend/.next, but Vercel's packaging later resolves
 * many paths from /vercel/path0 (repo root). We must COPY (not symlink)
 * key artefacts up to the repo root so those lstats succeed.
 *
 * Previous versions used fs.symlinkSync which silently fails on Vercel's
 * containerised filesystem, causing ENOENT on .next/package.json.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const cwd = process.cwd();
const appName = path.basename(cwd);

function log(...args) {
  console.log("[ensure-next-package-json]", ...args);
}

/** Write a minimal package.json into a directory (creating parents). */
function ensurePkg(pkgPath) {
  fs.mkdirSync(path.dirname(pkgPath), { recursive: true });
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(
      pkgPath,
      `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
    );
    log("wrote", pkgPath);
  }
}

/**
 * Recursively copy `src` → `dest`, skipping node_modules inside .next
 * (they're huge and unnecessary — packaging only needs the package.json
 * sentinel and the build manifest files).
 */
function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      // Skip heavy dirs that packaging doesn't need
      if (child === "node_modules" || child === "cache") continue;
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

/**
 * Copy a top-level item from the app dir to the repo root if the
 * destination doesn't already exist.
 */
function copyInto(repoRoot, name) {
  const src = path.join(cwd, name);
  const dest = path.join(repoRoot, name);
  if (!fs.existsSync(src)) return;
  if (fs.existsSync(dest)) {
    log("exists, skip", name);
    return;
  }
  try {
    copyRecursive(src, dest);
    log("copied", name);
  } catch (err) {
    log("copy failed", name, err instanceof Error ? err.message : err);
  }
}

// ── Step 1: Always create .next/package.json in the app dir ──
const appNextDir = path.join(cwd, ".next");
ensurePkg(path.join(appNextDir, "package.json"));

// If we're NOT in the "frontend" subdirectory the rest doesn't apply.
if (appName !== "frontend") {
  log("not in frontend/, done");
  process.exit(0);
}

const repoRoot = path.join(cwd, "..");
log("repo root =", repoRoot);

// ── Step 2: Copy .next to repo root ──
const rootNextDir = path.join(repoRoot, ".next");
if (!fs.existsSync(rootNextDir)) {
  log("copying .next → repo root");
  copyRecursive(appNextDir, rootNextDir);
} else {
  log(".next already at repo root");
}
// Ensure the sentinel file exists at root too
ensurePkg(path.join(rootNextDir, "package.json"));

// ── Step 3: Expose node_modules at repo root ──
// Use a symlink for node_modules (it's huge); fall back to skip if it fails.
const rootNodeModules = path.join(repoRoot, "node_modules");
const appNodeModules = path.join(cwd, "node_modules");
if (!fs.existsSync(rootNodeModules) && fs.existsSync(appNodeModules)) {
  try {
    fs.symlinkSync(appNodeModules, rootNodeModules, "dir");
    log("symlinked node_modules");
  } catch {
    log("node_modules symlink failed, trying junction");
    try {
      fs.symlinkSync(appNodeModules, rootNodeModules, "junction");
      log("junction node_modules ok");
    } catch (e2) {
      log("node_modules link failed entirely:", e2.message);
    }
  }
}

// ── Step 4: Copy other app paths that packaging may resolve from root ──
for (const name of fs.readdirSync(cwd)) {
  if (name === ".next" || name === "node_modules" || name.startsWith(".")) {
    continue;
  }

  if (name === "package.json" || name === "package-lock.json") {
    // Prefer the app package.json over the monorepo one for Next packaging
    const rootPkgPath = path.join(repoRoot, name);
    try {
      const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
      if (!rootPkg.dependencies?.next && !rootPkg.devDependencies?.next) {
        log("replacing root", name, "with app version");
        fs.copyFileSync(path.join(cwd, name), rootPkgPath);
      }
    } catch {
      fs.copyFileSync(path.join(cwd, name), rootPkgPath);
    }
    continue;
  }

  copyInto(repoRoot, name);
}

// ── Step 5: Verification probes ──
const probe = path.join(
  repoRoot,
  "node_modules",
  "next",
  "dist",
  "build",
  "adapter",
  "setup-node-env.external.js",
);
const constantsProbe = path.join(
  repoRoot,
  "constants",
  "abis",
  "LendingPool.json",
);
const nextPkgProbe = path.join(repoRoot, ".next", "package.json");
log(fs.existsSync(probe) ? `ok ${probe}` : `MISSING ${probe}`);
log(fs.existsSync(constantsProbe) ? `ok ${constantsProbe}` : `MISSING ${constantsProbe}`);
log(fs.existsSync(nextPkgProbe) ? `ok ${nextPkgProbe}` : `MISSING ${nextPkgProbe}`);
