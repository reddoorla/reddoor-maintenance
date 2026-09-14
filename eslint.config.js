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
    // Workflow scripts (`.claude/workflows/*.workflow.js`) are plain JS run by the
    // Workflow tool, which injects these as globals and provides no module loader.
    // Without this every one of them is a wall of `no-undef`, which hides the real
    // errors ESLint is here to find.
    files: [".claude/workflows/*.js"],
    languageOptions: {
      globals: {
        agent: "readonly",
        args: "readonly",
        budget: "readonly",
        log: "readonly",
        parallel: "readonly",
        phase: "readonly",
        pipeline: "readonly",
        workflow: "readonly",
      },
    },
  },
  {
    // `.worktrees/` and `.claude/worktrees/` hold other sessions' checkouts (see
    // .gitignore). ESLint does not read .gitignore, so without this a main checkout
    // with three worktrees inside it reported 1,771 parser errors — every one of
    // them typed-linting another tree's files against this tree's tsconfig.
    ignores: [
      "dist/",
      "node_modules/",
      "coverage/",
      "tests/fixtures/",
      ".worktrees/",
      ".claude/worktrees/",
    ],
  },
];
