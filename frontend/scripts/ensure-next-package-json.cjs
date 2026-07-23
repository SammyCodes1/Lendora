/**
 * On Vercel monorepos with Root Directory = "frontend", the clone root is still
 * `/vercel/path0` and the app builds to `/vercel/path0/frontend/.next`.
 * A later packaging step lstats `/vercel/path0/.next/package.json` and fails
 * with ENOENT. Mirror (symlink preferred) the real build output there.
 */
const fs = require("node:fs");
const path = require("node:path");

const cwd = process.cwd();
const appNextDir = path.join(cwd, ".next");
const appPkg = path.join(appNextDir, "package.json");

function ensurePkg(pkgPath) {
  fs.mkdirSync(path.dirname(pkgPath), { recursive: true });
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);
    console.log("[ensure-next-package-json] wrote", pkgPath);
  } else {
    console.log("[ensure-next-package-json] present", pkgPath);
  }
}

ensurePkg(appPkg);

// Monorepo layout: cwd is .../frontend
if (path.basename(cwd) !== "frontend") {
  process.exit(0);
}

const repoRoot = path.join(cwd, "..");
const rootNextDir = path.join(repoRoot, ".next");

try {
  if (fs.existsSync(rootNextDir)) {
    const stat = fs.lstatSync(rootNextDir);
    if (stat.isSymbolicLink() || stat.isDirectory()) {
      ensurePkg(path.join(rootNextDir, "package.json"));
      // If it's an empty/partial dir, still try to expose the real build via copy of package.json
      console.log("[ensure-next-package-json] root .next already exists");
      process.exit(0);
    }
  }

  // Prefer a directory symlink so packaging can read the full Next output.
  fs.symlinkSync(appNextDir, rootNextDir, "dir");
  console.log("[ensure-next-package-json] symlinked", rootNextDir, "->", appNextDir);
} catch (error) {
  console.warn(
    "[ensure-next-package-json] symlink failed, falling back to package.json copy:",
    error instanceof Error ? error.message : error,
  );
  ensurePkg(path.join(rootNextDir, "package.json"));
  // Best-effort: copy critical files if present
  for (const name of [
    "BUILD_ID",
    "build-manifest.json",
    "routes-manifest.json",
    "prerender-manifest.json",
    "required-server-files.json",
  ]) {
    const from = path.join(appNextDir, name);
    const to = path.join(rootNextDir, name);
    if (fs.existsSync(from) && !fs.existsSync(to)) {
      try {
        fs.copyFileSync(from, to);
      } catch {
        // ignore
      }
    }
  }
}
