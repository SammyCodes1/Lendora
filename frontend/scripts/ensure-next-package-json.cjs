/**
 * Vercel monorepo packaging workaround
 *
 * Clone layout with Root Directory = "frontend":
 *   /vercel/path0/                 monorepo root
 *   /vercel/path0/frontend/        Next app (build cwd)
 *
 * Next builds into frontend/.next, but packaging later resolves many paths
 * from /vercel/path0 (repo root). Mirror the app tree up to the monorepo
 * root (symlink when missing) so those lstats succeed.
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
  }
}

function linkInto(repoRoot, name) {
  const target = path.join(cwd, name);
  const linkPath = path.join(repoRoot, name);
  if (!fs.existsSync(target)) {
    return;
  }
  if (fs.existsSync(linkPath)) {
    return;
  }
  const type = fs.statSync(target).isDirectory() ? "dir" : "file";
  try {
    fs.symlinkSync(target, linkPath, type);
    log("symlinked", name);
  } catch (error) {
    log("symlink failed", name, error instanceof Error ? error.message : error);
  }
}

function forceLink(repoRoot, name) {
  const target = path.join(cwd, name);
  const linkPath = path.join(repoRoot, name);
  if (!fs.existsSync(target)) {
    log("skip missing", name);
    return;
  }
  try {
    if (fs.existsSync(linkPath) || fs.lstatSync(linkPath).isSymbolicLink()) {
      const stat = fs.lstatSync(linkPath);
      if (stat.isSymbolicLink()) {
        const current = fs.readlinkSync(linkPath);
        if (path.resolve(path.dirname(linkPath), current) === path.resolve(target)) {
          log("already linked", name);
          return;
        }
        fs.unlinkSync(linkPath);
      } else if (name === ".next" || name === "node_modules") {
        // Do not delete real dirs; only re-link when absent
        log("real path exists, leave", name);
        return;
      } else {
        return;
      }
    }
  } catch {
    // create below
  }
  const type = fs.statSync(target).isDirectory() ? "dir" : "file";
  try {
    fs.symlinkSync(target, linkPath, type);
    log("force-linked", name);
  } catch (error) {
    log("force-link failed", name, error instanceof Error ? error.message : error);
  }
}

const appNextDir = path.join(cwd, ".next");
ensurePkg(path.join(appNextDir, "package.json"));

if (appName !== "frontend") {
  process.exit(0);
}

const repoRoot = path.join(cwd, "..");

// 1) Always expose build output + deps at monorepo root
forceLink(repoRoot, ".next");
forceLink(repoRoot, "node_modules");

// 2) Expose every other top-level app path packaging may resolve from root
//    (app/, components/, constants/, public/, …) when not already present.
for (const name of fs.readdirSync(cwd)) {
  if (name === ".next" || name === "node_modules") continue;
  // Never clobber monorepo-owned paths that already exist at root.
  if (name === "package.json" || name === "package-lock.json") {
    // Prefer app package.json for Next packaging if root only has monorepo meta.
    const rootPkgPath = path.join(repoRoot, "package.json");
    try {
      const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
      if (!rootPkg.dependencies?.next && !rootPkg.devDependencies?.next) {
        // Replace monorepo package.json with a symlink to the app package.json
        // only after backing up is unnecessary on ephemeral Vercel FS.
        fs.unlinkSync(rootPkgPath);
        forceLink(repoRoot, "package.json");
      }
    } catch {
      forceLink(repoRoot, "package.json");
    }
    continue;
  }
  linkInto(repoRoot, name);
}

ensurePkg(path.join(repoRoot, ".next", "package.json"));

const probe = path.join(
  repoRoot,
  "node_modules",
  "next",
  "dist",
  "build",
  "adapter",
  "setup-node-env.external.js",
);
const constantsProbe = path.join(repoRoot, "constants", "abis", "LendingPool.json");
log(fs.existsSync(probe) ? `ok ${probe}` : `MISSING ${probe}`);
log(fs.existsSync(constantsProbe) ? `ok ${constantsProbe}` : `MISSING ${constantsProbe}`);
