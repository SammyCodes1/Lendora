/**
 * Vercel post-build packaging sometimes lstats `.next/package.json` after the
 * Next 16 adapter has already rewritten outputs under `/vercel/output`.
 * Ensure the file exists so that step does not ENOENT.
 */
const fs = require("node:fs");
const path = require("node:path");

const nextDir = path.join(process.cwd(), ".next");
const pkgPath = path.join(nextDir, "package.json");

fs.mkdirSync(nextDir, { recursive: true });

if (!fs.existsSync(pkgPath)) {
  fs.writeFileSync(pkgPath, `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);
  console.log("[ensure-next-package-json] wrote", pkgPath);
} else {
  console.log("[ensure-next-package-json] present", pkgPath);
}
