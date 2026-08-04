import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/generated/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Root-level and per-package Node build scripts (e.g. artifacts/*/build.mjs)
    // run directly under Node, outside any bundler, so they need Node's globals.
    files: ["*.mjs", "**/build.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "writable",
        exports: "writable",
        require: "readonly",
        global: "readonly",
      },
    },
  },
  {
    files: ["artifacts/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "scripts/**/*.{ts,tsx}"],
    rules: {
      // Pre-existing collectors/routes lean on `any` at the Graph API boundary
      // (tracked as BACKLOG 5.2 — ~155 uses). Downgraded to a warning so lint
      // is useful today without blocking CI on that separate cleanup effort.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // react-hooks catches real bugs (stale closures, conditional hooks) — kept
    // at full strength rather than relaxed, per BACKLOG 5.4.
    files: ["artifacts/m365-dashboard/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
);
