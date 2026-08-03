const path = require("path");
const fs = require("fs");

/**
 * Resolve plugin package paths as strings (required by Next.js).
 * Prefer this app's Tailwind v3 over a parent node_modules Tailwind v4.
 */
function resolvePlugin(name) {
  const candidates = [
    path.join(__dirname, "node_modules", name),
    path.join(__dirname, "frontend", "node_modules", name),
  ];

  for (const dir of candidates) {
    const pkgJson = path.join(dir, "package.json");
    if (!fs.existsSync(pkgJson)) continue;

    if (name === "tailwindcss") {
      const { version } = JSON.parse(fs.readFileSync(pkgJson, "utf8"));
      if (String(version).startsWith("4.")) continue;
    }

    return dir;
  }

  return name;
}

module.exports = {
  plugins: {
    [resolvePlugin("tailwindcss")]: {},
    [resolvePlugin("autoprefixer")]: {},
  },
};
