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
      // eslint-plugin-svelte 3.20+ allows only an `error` prop in +error.svelte,
      // but SvelteKit really does pass merged layout `data` to error pages
      // (typed by hand since kit generates no ./$types for +error). The rule
      // takes no options (schema: []), so scope it off for error pages only.
      files: ["**/+error.svelte"],
      rules: {
        "svelte/valid-prop-names-in-kit-pages": "off",
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
