import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

// Local `next dev` writes to `.next-dev` so it never clashes with `next build`.
// On Vercel always use `.next` — the platform looks for `.next/package.json`
// after the build (ENOENT if distDir is anything else or mis-detected).
const isVercel = process.env.VERCEL === "1";
const distDir =
  isVercel || process.env.NODE_ENV === "production"
    ? ".next"
    : process.env.NODE_ENV === "development"
      ? ".next-dev"
      : ".next";

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: projectRoot,
  distDir,
  webpack(config) {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@react-native-async-storage/async-storage": false,
      "pino-pretty": false,
    };

    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      {
        module: /node_modules[\\/]ox[\\/]_esm[\\/]tempo[\\/]internal[\\/]virtualMasterPool\.js/,
        message: /Critical dependency: the request of a dependency is an expression/,
      },
    ];

    return config;
  },
};

export default nextConfig;
