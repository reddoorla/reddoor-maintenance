import js from "@eslint/js";
import ts from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

// Note: we do NOT use createEslintConfig({svelteConfig}) here because this package
// has no Svelte files. We mirror the non-svelte rules from src/configs/eslint.ts
// so that a divergence shows up as a lint failure in CI.
export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    ignores: ["dist/", "node_modules/", "coverage/", "tests/fixtures/"],
  },
];
