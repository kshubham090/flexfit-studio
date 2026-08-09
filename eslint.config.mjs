import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript", "prettier"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "drizzle/**",
      "test-flexfit.db",
      "flexfit.db",
      // Next.js regenerates this file itself; not ours to fix or format.
      "next-env.d.ts",
    ],
  },
  {
    rules: {
      // Prefix with _ to mark a destructured/parameter binding as
      // intentionally unused (e.g. omitting a field, an unused callback
      // param) -- used deliberately in a few places in this codebase.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default eslintConfig;
