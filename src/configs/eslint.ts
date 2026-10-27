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
        // Agency process artifacts: git-ignored in every repo, but present on
        // disk locally, so `pnpm lint` would otherwise try to parse them.
        "docs/superpowers/",
        "scratchpad/",
        // Third member of that class: the match-harness Phase 0 reference
        // capture. `matching/capture-reference.mjs` downloads the live site's
        // own HTML/CSS/JS byte-for-byte into a fixed `matching/spec` (line 31,
        // `const OUT = "matching/spec"` — a const, not configurable), so eslint
        // gets handed third-party minified bundles. Measured on 29 Navy's first
        // capture: 745 errors, `pnpm verify` red — Webflow's two chunks 377 and
        // 78, jQuery 3.5.1 290.
        //
        // `prettier --check .` survives the same files, but only by accident of
        // prettier 3 defaulting --ignore-path to `.gitignore`, which the recipe's
        // block fills with `matching/*`. Eslint flat config reads no ignore file
        // at all, and `.prettierignore` does NOT list the capture: measured,
        // `prettier --check matching/spec --ignore-path .prettierignore` flags
        // five files. That asymmetry is the whole bug.
        //
        // SCOPED TO `matching/spec/`, deliberately NOT `matching/`. The probes,
        // gate scripts and site records under `matching/` are ours and must stay
        // linted — beachfront-dentistry ignores `matching/` wholesale and has
        // un-linted its own `adv-verify-svc*.mjs` that way. The narrowness cuts
        // both ways: `matching/spec*` also swallows the TRACKED
        // `matching/spec-sections/`.
        "matching/spec/",
        // Same class, same generated .gitignore block: the harness's scratch
        // diff workspace. Included on class grounds, NOT on a reproduced signal
        // — nothing in the harness writes it and no clone has one on disk.
        "scratch-diff*/",
      ],
    },
  ] as Linter.Config[];
}

export default createEslintConfig;
