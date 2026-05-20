import js from "@eslint/js";
import ts from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import prettier from "eslint-config-prettier";
import globals from "globals";
import type { Linter } from "eslint";

export type CreateEslintConfigOptions = {
  svelteConfig: unknown;
};

export function createEslintConfig(opts: CreateEslintConfigOptions): Linter.Config[] {
  return [
    js.configs.recommended,
    ...ts.configs.recommended,
    ...svelte.configs.recommended,
    prettier,
    ...svelte.configs.prettier,
    {
      languageOptions: {
        globals: {
          ...globals.browser,
          ...globals.node,
        },
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
        "svelte/no-navigation-without-resolve": "off",
      },
    },
    {
      files: ["**/*.svelte", "**/*.svelte.js", "**/*.svelte.ts"],
      languageOptions: {
        parserOptions: {
          parser: ts.parser,
          svelteConfig: opts.svelteConfig,
        },
      },
    },
    {
      files: ["**/*.d.ts"],
      rules: {
        "no-var": "off",
        "@typescript-eslint/no-unused-vars": "off",
      },
    },
    {
      ignores: [
        "build/",
        ".svelte-kit/",
        ".netlify/",
        "node_modules/",
        "static/",
        "customtypes/",
        "src/lib/slices/**/index.js",
      ],
    },
  ] as Linter.Config[];
}

export default createEslintConfig;
