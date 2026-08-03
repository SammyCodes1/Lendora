import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    // These rules enforce React Compiler constraints. The compiler is not
    // enabled for this application; standard hooks rules remain active.
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
    },
  },
  globalIgnores([
    ".next/**",
    ".next-dev/**",
    ".chrome-*/**",
    ".edge-*/**",
    "out/**",
    "dist/**",
    "next-env.d.ts",
  ]),
]);
