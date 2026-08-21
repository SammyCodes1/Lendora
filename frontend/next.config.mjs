import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep tracing rooted at this package (monorepo-safe on Vercel rootDirectory=frontend).
  outputFileTracingRoot: projectRoot,
  // Explicit empty turbopack config so Next 16 doesn't error when a webpack()
  // function is present (production still uses `next build --webpack`).
  turbopack: {},
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "arclend.cv" }],
        destination: "https://www.arclend.cv/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "lendora-alpha.vercel.app" }],
        destination: "https://www.arclend.cv/:path*",
        permanent: true,
      },
    ];
  },
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
