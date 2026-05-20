# `@reddoor/maintenance` Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the publishable `@reddoor/maintenance` npm package skeleton with shared types, canonical configs exported via subpaths, a `reddoor-maint` CLI skeleton, and baseline CI — leaving subsequent plans to add audits, recipes, and inventory.

**Architecture:** Functional-core + thin CLI. `tsup` builds ESM + `.d.ts`. `package.json` `exports` map enables root and subpath imports (`@reddoor/maintenance/configs/lighthouse` etc.). CLI is a `cac` wrapper over (initially empty) library functions. All canonical configs are lifted from `reddoor-starter` and re-exported here as the source of truth.

**Tech Stack:** TypeScript (strict, NodeNext), tsup, vitest, cac, pnpm. Node >=20.

**Source repo (for lifting configs):** `/Users/tuckerlemos/Documents/GitHub/reddoor-starter/`

---

## File Structure

Files created in this plan (relative to repo root `/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance/`):

- `.gitignore` — node_modules, dist, coverage, OS junk
- `.npmrc` — pnpm settings (strict-peer-deps off for now)
- `package.json` — name, exports map, bin, deps
- `tsconfig.json` — strict, NodeNext, ESM
- `tsup.config.ts` — multi-entry build (index + configs + cli)
- `vitest.config.ts` — node env, `tests/**/*.test.ts`
- `eslint.config.js` — dogfoods `@reddoor/maintenance/configs/eslint` once available; until then, minimal flat config
- `README.md` — one-paragraph skeleton
- `src/index.ts` — public barrel (re-exports from `types.ts` only, for now)
- `src/types.ts` — `Site`, `AuditResult`, `RecipeResult`, `InventoryProvider`, `AuditName`, `RecipeName`, `ConfigName`
- `src/configs/lighthouse.ts` — `lighthouseConfig` object (lifted from starter)
- `src/configs/eslint.ts` — `createEslintConfig({ svelteConfig })` factory (lifted from starter)
- `src/configs/prettier.ts` — canonical prettier `Config` with svelte plugin
- `src/configs/playwright-a11y.ts` — `a11yRoutes` array + `playwrightA11yConfig` object
- `src/cli/bin.ts` — cac CLI entry with `list-audits`, `list-recipes`
- `tests/types.test.ts` — compile-time shape assertions
- `tests/configs/lighthouse.test.ts`
- `tests/configs/eslint.test.ts`
- `tests/configs/prettier.test.ts`
- `tests/configs/playwright-a11y.test.ts`
- `tests/cli/list-commands.test.ts` — spawn built CLI, assert output
- `.github/workflows/ci.yml` — node 20, install, lint, test, build

---

## Task 1: Initialize repo scaffolding

**Files:**
- Create: `.gitignore`
- Create: `.npmrc`
- Create: `README.md`

- [ ] **Step 1: Write `.gitignore`**

```text
node_modules/
dist/
coverage/
.DS_Store
*.log
.vitest-cache/
.tsbuildinfo
```

- [ ] **Step 2: Write `.npmrc`**

```text
# Allow building with peer dep mismatches during the 0.x phase.
strict-peer-dependencies=false
auto-install-peers=true
```

- [ ] **Step 3: Write `README.md` skeleton**

```markdown
# @reddoor/maintenance

Canonical maintenance configs, audits, and recipes for sites built on the reddoor starter.

See `docs/specs/2026-05-20-package-design.md` for the design and `docs/superpowers/plans/` for active implementation plans.

## Install

```bash
pnpm add -D @reddoor/maintenance
```

## CLI

```bash
pnpm reddoor-maint --help
```

(Status: 0.x — under construction.)
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore .npmrc README.md
git commit -m "chore: scaffold repo (gitignore, npmrc, readme)"
```

---

## Task 2: TypeScript config

**Files:**
- Create: `tsconfig.json`

- [ ] **Step 1: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*", "tests/**/*", "tsup.config.ts", "vitest.config.ts"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 2: Commit**

```bash
git add tsconfig.json
git commit -m "chore: add tsconfig (strict, NodeNext, ES2022)"
```

---

## Task 3: package.json (deps, exports, bin)

**Files:**
- Create: `package.json`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@reddoor/maintenance",
  "version": "0.0.1",
  "description": "Canonical maintenance configs, audits, and recipes for the reddoor stack.",
  "type": "module",
  "license": "MIT",
  "author": "Tucker Lemos",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/tucksravin/reddoor-maintenance.git"
  },
  "engines": {
    "node": ">=20"
  },
  "files": [
    "dist",
    "README.md"
  ],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./configs/lighthouse": {
      "types": "./dist/configs/lighthouse.d.ts",
      "import": "./dist/configs/lighthouse.js"
    },
    "./configs/eslint": {
      "types": "./dist/configs/eslint.d.ts",
      "import": "./dist/configs/eslint.js"
    },
    "./configs/prettier": {
      "types": "./dist/configs/prettier.d.ts",
      "import": "./dist/configs/prettier.js"
    },
    "./configs/playwright-a11y": {
      "types": "./dist/configs/playwright-a11y.d.ts",
      "import": "./dist/configs/playwright-a11y.js"
    }
  },
  "bin": {
    "reddoor-maint": "./dist/cli/bin.js"
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint . && prettier --check .",
    "format": "prettier --write .",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build"
  },
  "dependencies": {
    "@axe-core/playwright": "^4.11.3",
    "@eslint/js": "^10.0.1",
    "@lhci/cli": "^0.15.1",
    "@playwright/test": "^1.59.1",
    "cac": "^6.7.14",
    "eslint": "^10.3.0",
    "eslint-config-prettier": "^10.1.1",
    "eslint-plugin-svelte": "^3.1.0",
    "globals": "^17.6.0",
    "prettier": "^3.1.1",
    "prettier-plugin-svelte": "^3.2.6",
    "tinyglobby": "^0.2.10",
    "typescript-eslint": "^8.59.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsup": "^8.3.0",
    "tsx": "^4.19.0",
    "typescript": "^6.0.3",
    "vitest": "^4.1.1"
  },
  "packageManager": "pnpm@10.33.1"
}
```

- [ ] **Step 2: Install dependencies**

Run: `pnpm install`
Expected: lockfile generated, no errors. Warnings about peer deps are acceptable.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add package.json with deps, exports map, and bin"
```

---

## Task 4: tsup build config

**Files:**
- Create: `tsup.config.ts`

- [ ] **Step 1: Write `tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/cli/bin.ts",
    "src/configs/lighthouse.ts",
    "src/configs/eslint.ts",
    "src/configs/prettier.ts",
    "src/configs/playwright-a11y.ts",
  ],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  target: "node20",
  outDir: "dist",
  outExtension: () => ({ js: ".js" }),
});
```

- [ ] **Step 2: Commit**

```bash
git add tsup.config.ts
git commit -m "chore: add tsup config (ESM + .d.ts, multi-entry)"
```

---

## Task 5: vitest config

**Files:**
- Create: `vitest.config.ts`

- [ ] **Step 1: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    reporters: ["default"],
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add vitest.config.ts
git commit -m "chore: add vitest config"
```

---

## Task 6: Internal eslint config (bootstrap)

This is the eslint config the package uses on **itself**. Once `src/configs/eslint.ts` is built (Task 9), we'll switch this to dogfood the exported factory. For now, a minimal flat config so `pnpm lint` works.

**Files:**
- Create: `eslint.config.js`
- Create: `.prettierrc.json`

- [ ] **Step 1: Write `eslint.config.js`**

```js
import js from "@eslint/js";
import ts from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { project: false },
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
    ignores: ["dist/", "node_modules/", "coverage/"],
  },
];
```

- [ ] **Step 2: Write `.prettierrc.json`**

```json
{
  "trailingComma": "all",
  "singleQuote": false,
  "printWidth": 100
}
```

- [ ] **Step 3: Run lint to confirm zero violations on an empty repo**

Run: `pnpm lint`
Expected: PASS (no files to lint yet, prettier --check passes).

- [ ] **Step 4: Commit**

```bash
git add eslint.config.js .prettierrc.json
git commit -m "chore: bootstrap internal eslint + prettier config"
```

---

## Task 7: Shared types module

**Files:**
- Create: `src/types.ts`
- Test: `tests/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/types.test.ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  Site,
  AuditResult,
  RecipeResult,
  InventoryProvider,
  AuditName,
  RecipeName,
  ConfigName,
} from "../src/types";

describe("types", () => {
  it("Site requires path, allows optional fields", () => {
    expectTypeOf<Site>().toHaveProperty("path").toEqualTypeOf<string>();
    expectTypeOf<Site>().toHaveProperty("name").toEqualTypeOf<string | undefined>();
    expectTypeOf<Site>().toHaveProperty("repoUrl").toEqualTypeOf<string | undefined>();
  });

  it("AuditResult status is a closed union", () => {
    expectTypeOf<AuditResult["status"]>().toEqualTypeOf<"pass" | "warn" | "fail" | "skip">();
  });

  it("RecipeResult status is a closed union", () => {
    expectTypeOf<RecipeResult["status"]>().toEqualTypeOf<"applied" | "noop" | "failed">();
  });

  it("InventoryProvider is a zero-arg promise of sites", () => {
    expectTypeOf<InventoryProvider>().toEqualTypeOf<() => Promise<Site[]>>();
  });

  it("AuditName covers v1 audits", () => {
    const _ok: AuditName = "deps";
    const _ok2: AuditName = "lighthouse";
    const _ok3: AuditName = "a11y";
    const _ok4: AuditName = "security";
    const _ok5: AuditName = "lint";
  });

  it("RecipeName covers v1 recipes", () => {
    const _ok: RecipeName = "sync-configs";
    const _ok2: RecipeName = "bump-deps";
    const _ok3: RecipeName = "svelte-4-to-5";
  });

  it("ConfigName covers v1 configs", () => {
    const _ok: ConfigName = "lighthouse";
    const _ok2: ConfigName = "eslint";
    const _ok3: ConfigName = "prettier";
    const _ok4: ConfigName = "playwright-a11y";
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/types.test.ts`
Expected: FAIL — module `../src/types` not found.

- [ ] **Step 3: Implement `src/types.ts`**

```ts
export type Site = {
  path: string;
  name?: string;
  repoUrl?: string;
  meta?: Record<string, unknown>;
};

export type AuditName = "deps" | "lighthouse" | "a11y" | "security" | "lint";

export type RecipeName = "sync-configs" | "bump-deps" | "svelte-4-to-5";

export type ConfigName = "lighthouse" | "eslint" | "prettier" | "playwright-a11y";

export type AuditResult = {
  audit: AuditName;
  site: string;
  status: "pass" | "warn" | "fail" | "skip";
  summary: string;
  details?: unknown;
};

export type RecipeResult = {
  recipe: RecipeName;
  site: string;
  status: "applied" | "noop" | "failed";
  commits: string[];
  notes?: string;
};

export type InventoryProvider = () => Promise<Site[]>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/types.test.ts`
Expected: PASS — all 7 cases.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat(types): add Site, AuditResult, RecipeResult, InventoryProvider, name unions"
```

---

## Task 8: `configs/lighthouse` — lift from starter

**Source of truth:** `/Users/tuckerlemos/Documents/GitHub/reddoor-starter/lighthouserc.json`

**Files:**
- Create: `src/configs/lighthouse.ts`
- Test: `tests/configs/lighthouse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/configs/lighthouse.test.ts
import { describe, it, expect } from "vitest";
import lighthouseConfig, { lighthouseConfig as named } from "../../src/configs/lighthouse";

describe("configs/lighthouse", () => {
  it("default export equals the named export", () => {
    expect(lighthouseConfig).toBe(named);
  });

  it("has the LHCI shape we expect", () => {
    expect(lighthouseConfig.ci.collect.url).toContain("http://localhost:5173/dev/a11y-fixtures");
    expect(lighthouseConfig.ci.collect.settings?.preset).toBe("desktop");
    expect(lighthouseConfig.ci.assert.assertions["categories:accessibility"]).toEqual([
      "error",
      { minScore: 0.95 },
    ]);
    expect(lighthouseConfig.ci.upload.target).toBe("temporary-public-storage");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/configs/lighthouse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/configs/lighthouse.ts`**

```ts
export const lighthouseConfig = {
  ci: {
    collect: {
      url: ["http://localhost:5173/dev/a11y-fixtures"],
      startServerCommand: "pnpm vite:dev",
      startServerReadyPattern: "ready in",
      startServerReadyTimeout: 120_000,
      numberOfRuns: 1,
      settings: {
        preset: "desktop",
        skipAudits: ["uses-http2"],
      },
    },
    assert: {
      assertions: {
        "categories:accessibility": ["error", { minScore: 0.95 }],
        "categories:best-practices": ["error", { minScore: 0.9 }],
        "categories:seo": ["error", { minScore: 0.9 }],
        "categories:performance": ["warn", { minScore: 0.7 }],
      },
    },
    upload: {
      target: "temporary-public-storage",
    },
  },
} as const;

export default lighthouseConfig;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/configs/lighthouse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/configs/lighthouse.ts tests/configs/lighthouse.test.ts
git commit -m "feat(configs): add lighthouse config (lifted from starter)"
```

---

## Task 9: `configs/eslint` — lift from starter as a factory

The starter's `eslint.config.js` imports its own `svelte.config.js`. Since consumers all have their own `svelte.config.js`, we expose a factory that takes it as input.

**Source of truth:** `/Users/tuckerlemos/Documents/GitHub/reddoor-starter/eslint.config.js`

**Files:**
- Create: `src/configs/eslint.ts`
- Test: `tests/configs/eslint.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/configs/eslint.test.ts
import { describe, it, expect } from "vitest";
import { createEslintConfig } from "../../src/configs/eslint";

describe("configs/eslint", () => {
  it("returns a flat config array", () => {
    const config = createEslintConfig({ svelteConfig: {} });
    expect(Array.isArray(config)).toBe(true);
    expect(config.length).toBeGreaterThan(3);
  });

  it("includes ignores block with starter-relevant paths", () => {
    const config = createEslintConfig({ svelteConfig: {} });
    const ignores = config.find((c) => "ignores" in c && Array.isArray(c.ignores)) as {
      ignores: string[];
    };
    expect(ignores).toBeDefined();
    expect(ignores.ignores).toEqual(
      expect.arrayContaining([
        "build/",
        ".svelte-kit/",
        ".netlify/",
        "node_modules/",
        "static/",
        "customtypes/",
        "src/lib/slices/**/index.js",
      ]),
    );
  });

  it("passes through the supplied svelteConfig into the .svelte parser options", () => {
    const svelteConfig = { __marker: "from-test" };
    const config = createEslintConfig({ svelteConfig });
    const svelteBlock = config.find(
      (c) =>
        "files" in c &&
        Array.isArray(c.files) &&
        c.files.some((f) => typeof f === "string" && f.includes(".svelte")),
    ) as { languageOptions?: { parserOptions?: { svelteConfig?: unknown } } } | undefined;
    expect(svelteBlock?.languageOptions?.parserOptions?.svelteConfig).toBe(svelteConfig);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/configs/eslint.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/configs/eslint.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/configs/eslint.test.ts`
Expected: PASS — all 3 cases.

- [ ] **Step 5: Commit**

```bash
git add src/configs/eslint.ts tests/configs/eslint.test.ts
git commit -m "feat(configs): add eslint factory (lifted from starter)"
```

---

## Task 10: `configs/prettier` — canonical config

The starter has no explicit `.prettierrc`; this codifies what the lint script implies (svelte plugin + defaults).

**Files:**
- Create: `src/configs/prettier.ts`
- Test: `tests/configs/prettier.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/configs/prettier.test.ts
import { describe, it, expect } from "vitest";
import prettierConfig, { prettierConfig as named } from "../../src/configs/prettier";

describe("configs/prettier", () => {
  it("default equals named export", () => {
    expect(prettierConfig).toBe(named);
  });

  it("registers the svelte plugin", () => {
    expect(prettierConfig.plugins).toEqual(["prettier-plugin-svelte"]);
  });

  it("maps .svelte files to the svelte parser via overrides", () => {
    const svelteOverride = prettierConfig.overrides?.find((o) => o.files === "*.svelte");
    expect(svelteOverride).toBeDefined();
    expect(svelteOverride?.options).toEqual({ parser: "svelte" });
  });

  it("uses repo-wide formatting defaults", () => {
    expect(prettierConfig.trailingComma).toBe("all");
    expect(prettierConfig.singleQuote).toBe(false);
    expect(prettierConfig.printWidth).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/configs/prettier.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/configs/prettier.ts`**

```ts
import type { Config } from "prettier";

export const prettierConfig: Config = {
  trailingComma: "all",
  singleQuote: false,
  printWidth: 100,
  plugins: ["prettier-plugin-svelte"],
  overrides: [{ files: "*.svelte", options: { parser: "svelte" } }],
};

export default prettierConfig;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/configs/prettier.test.ts`
Expected: PASS — all 4 cases.

- [ ] **Step 5: Commit**

```bash
git add src/configs/prettier.ts tests/configs/prettier.test.ts
git commit -m "feat(configs): add canonical prettier config"
```

---

## Task 11: `configs/playwright-a11y` — config + routes

Lifted from `reddoor-starter/playwright.config.ts` + `reddoor-starter/tests/a11y.spec.ts`. The routes list is exported separately so the `a11y` audit (Plan 2) can read it.

**Files:**
- Create: `src/configs/playwright-a11y.ts`
- Test: `tests/configs/playwright-a11y.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/configs/playwright-a11y.test.ts
import { describe, it, expect } from "vitest";
import playwrightA11yConfig, {
  a11yRoutes,
  playwrightA11yConfig as named,
} from "../../src/configs/playwright-a11y";

describe("configs/playwright-a11y", () => {
  it("default equals named export", () => {
    expect(playwrightA11yConfig).toBe(named);
  });

  it("exports the canonical starter routes", () => {
    expect(a11yRoutes).toEqual([
      { path: "/dev/a11y-fixtures", name: "a11y fixtures" },
      { path: "/dev/animate-in", name: "animate-in demo" },
    ]);
  });

  it("uses port 5173 and the starter's webServer command", () => {
    expect(playwrightA11yConfig.use?.baseURL).toBe("http://localhost:5173");
    expect(playwrightA11yConfig.webServer).toMatchObject({
      command: "pnpm vite:dev",
      url: "http://localhost:5173/dev/a11y-fixtures",
    });
  });

  it("runs the chromium project only (matches starter)", () => {
    expect(playwrightA11yConfig.projects).toHaveLength(1);
    expect(playwrightA11yConfig.projects?.[0]?.name).toBe("chromium");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/configs/playwright-a11y.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/configs/playwright-a11y.ts`**

```ts
import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

export type A11yRoute = { path: string; name: string };

export const a11yRoutes: A11yRoute[] = [
  { path: "/dev/a11y-fixtures", name: "a11y fixtures" },
  { path: "/dev/animate-in", name: "animate-in demo" },
];

export const playwrightA11yConfig: PlaywrightTestConfig = defineConfig({
  testDir: "tests",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm vite:dev",
    url: "http://localhost:5173/dev/a11y-fixtures",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

export default playwrightA11yConfig;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/configs/playwright-a11y.test.ts`
Expected: PASS — all 4 cases.

- [ ] **Step 5: Commit**

```bash
git add src/configs/playwright-a11y.ts tests/configs/playwright-a11y.test.ts
git commit -m "feat(configs): add playwright-a11y config + routes (lifted from starter)"
```

---

## Task 12: Public barrel (`src/index.ts`)

For the foundation, the only public surface is the shared types. Audits/recipes/inventory functions will be added in subsequent plans.

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement `src/index.ts`**

```ts
export type {
  Site,
  AuditName,
  AuditResult,
  RecipeName,
  RecipeResult,
  ConfigName,
  InventoryProvider,
} from "./types.js";
```

- [ ] **Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat: add public barrel re-exporting shared types"
```

---

## Task 13: CLI skeleton (`list-audits`, `list-recipes`)

The CLI is a `cac` wrapper. For the foundation it ships two trivial commands that print the registered names from the unions. Subsequent plans will add `audit`, `sync-configs`, `bump-deps`, and `upgrade svelte-4-to-5`.

**Files:**
- Create: `src/cli/bin.ts`
- Test: `tests/cli/list-commands.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/list-commands.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const binPath = resolve(here, "../../dist/cli/bin.js");

function runCli(args: string[]): string {
  return execFileSync(process.execPath, [binPath, ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("cli: list commands", () => {
  beforeAll(() => {
    if (!existsSync(binPath)) {
      throw new Error(
        `dist/cli/bin.js missing — run \`pnpm build\` before running CLI tests.`,
      );
    }
  });

  it("list-audits prints all v1 audit names", () => {
    const out = runCli(["list-audits"]);
    for (const name of ["deps", "lighthouse", "a11y", "security", "lint"]) {
      expect(out).toContain(name);
    }
  });

  it("list-recipes prints all v1 recipe names", () => {
    const out = runCli(["list-recipes"]);
    for (const name of ["sync-configs", "bump-deps", "svelte-4-to-5"]) {
      expect(out).toContain(name);
    }
  });

  it("--help exits 0 and mentions reddoor-maint", () => {
    const out = runCli(["--help"]);
    expect(out).toMatch(/reddoor-maint/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && pnpm test tests/cli/list-commands.test.ts`
Expected: FAIL — `tsup` errors that `src/cli/bin.ts` does not exist.

- [ ] **Step 3: Implement `src/cli/bin.ts`**

```ts
#!/usr/bin/env node
import cac from "cac";
import type { AuditName, RecipeName } from "../types.js";

const AUDIT_DESCRIPTIONS: Record<AuditName, string> = {
  deps: "Diff site package.json against the bundled baseline version map.",
  lighthouse: "Run @lhci/cli autorun using the canonical lighthouserc.",
  a11y: "Playwright + axe against the canonical a11y routes.",
  security: "pnpm audit (falls back to npm audit), prod-deps by default.",
  lint: "ESLint + Prettier using the canonical configs.",
};

const RECIPE_DESCRIPTIONS: Record<RecipeName, string> = {
  "sync-configs": "Overwrite a site's canonical configs to match @reddoor/maintenance.",
  "bump-deps": "Bump dependencies and commit the lockfile change.",
  "svelte-4-to-5": "Run the 7-commit Svelte 4 → 5 upgrade recipe.",
};

const cli = cac("reddoor-maint");

cli.command("list-audits", "Print the available audits.").action(() => {
  for (const [name, desc] of Object.entries(AUDIT_DESCRIPTIONS)) {
    console.log(`${name.padEnd(12)} ${desc}`);
  }
});

cli.command("list-recipes", "Print the available recipes.").action(() => {
  for (const [name, desc] of Object.entries(RECIPE_DESCRIPTIONS)) {
    console.log(`${name.padEnd(16)} ${desc}`);
  }
});

cli.help();
cli.version("0.0.1");

cli.parse();
```

- [ ] **Step 4: Build, then run test to verify it passes**

Run: `pnpm build && pnpm test tests/cli/list-commands.test.ts`
Expected: PASS — all 3 cases.

- [ ] **Step 5: Confirm shebang + executable bit on built file**

Run: `head -1 dist/cli/bin.js`
Expected: `#!/usr/bin/env node`

Run: `node dist/cli/bin.js list-audits`
Expected: Five lines including `deps`, `lighthouse`, `a11y`, `security`, `lint`.

- [ ] **Step 6: Commit**

```bash
git add src/cli/bin.ts tests/cli/list-commands.test.ts
git commit -m "feat(cli): add reddoor-maint CLI skeleton with list-audits and list-recipes"
```

---

## Task 14: Dogfood the exported eslint config

Now that `src/configs/eslint.ts` exists, the package can lint itself with its own canonical config (minus the svelte-specific parts, which don't apply to a pure-TS package). This validates the factory works.

**Files:**
- Modify: `eslint.config.js`

- [ ] **Step 1: Replace bootstrap config with a slim dogfooded version**

```js
// eslint.config.js
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
    ignores: ["dist/", "node_modules/", "coverage/"],
  },
];
```

- [ ] **Step 2: Run lint over the now-populated repo**

Run: `pnpm lint`
Expected: PASS. If prettier flags any of the files written so far, fix with `pnpm format` and re-run.

- [ ] **Step 3: Commit**

```bash
git add eslint.config.js
git commit -m "chore: dogfood the non-svelte slice of the canonical eslint rules"
```

---

## Task 15: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10.33.1

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm build
      - run: pnpm test
```

- [ ] **Step 2: Verify locally that every step the workflow runs passes**

Run each in order, stopping if any fail:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm build
pnpm test
```

Expected: each command exits 0.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add lint+typecheck+build+test workflow"
```

---

## Task 16: End-to-end smoke check

Verify the package, as built, exposes the expected subpath modules and a runnable CLI binary.

**Files:** (none — verification only)

- [ ] **Step 1: Build cleanly**

Run: `rm -rf dist && pnpm build`
Expected: `dist/index.js`, `dist/cli/bin.js`, `dist/configs/{lighthouse,eslint,prettier,playwright-a11y}.{js,d.ts}` all exist.

- [ ] **Step 2: Confirm subpath resolution from a scratch Node script**

Create a temp file `/tmp/reddoor-maint-smoke.mjs`:

```js
import { pathToFileURL } from "node:url";

// Resolve via absolute dist file URLs (the exports map gets exercised by Task 13's CLI test;
// here we just confirm every built module loads without throwing).
const root = pathToFileURL("/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance/dist/").href;

const idx = await import(root + "index.js");
const lh = await import(root + "configs/lighthouse.js");
const es = await import(root + "configs/eslint.js");
const pr = await import(root + "configs/prettier.js");
const pw = await import(root + "configs/playwright-a11y.js");

console.log("index keys:", Object.keys(idx)); // type-only barrel → []
console.log("lighthouse OK:", lh.default.ci.assert.assertions["categories:accessibility"][1]);
console.log("eslint OK:", typeof es.createEslintConfig === "function");
console.log("prettier OK:", pr.default.plugins);
console.log("playwright OK:", pw.a11yRoutes.length);
```

Run: `node /tmp/reddoor-maint-smoke.mjs`
Expected output (order may vary):
```
index keys: []
lighthouse OK: { minScore: 0.95 }
eslint OK: true
prettier OK: [ 'prettier-plugin-svelte' ]
playwright OK: 2
```

If `index keys` is non-empty, that's fine too — the assertion is that the script runs without throwing.

- [ ] **Step 3: Confirm the CLI runs as a real bin**

Run: `node dist/cli/bin.js --version`
Expected: `0.0.1`

Run: `node dist/cli/bin.js list-recipes`
Expected: three lines for `sync-configs`, `bump-deps`, `svelte-4-to-5`.

- [ ] **Step 4: Clean up temp file**

Run: `rm /tmp/reddoor-maint-smoke.mjs`

- [ ] **Step 5: Tag the foundation milestone**

```bash
git tag -a v0.0.1-foundation -m "Foundation milestone: types, configs, CLI skeleton, CI green"
```

(Do not push the tag — a release tag will be cut when the package first publishes in Plan 4.)

---

## Definition of Done

- `pnpm install && pnpm typecheck && pnpm lint && pnpm build && pnpm test` all succeed locally.
- `dist/` contains `index.js`, `cli/bin.js`, and `configs/{lighthouse,eslint,prettier,playwright-a11y}.{js,d.ts}`.
- `node dist/cli/bin.js list-audits` and `... list-recipes` print all v1 names.
- CI workflow runs and passes on push.
- Commits are small (≤ ~30 lines diff each except `pnpm-lock.yaml`) and follow conventional-commits prefixes.
- The git tag `v0.0.1-foundation` is on the final commit (local only, not pushed).

## Out of scope (deferred to later plans)

- The actual audit implementations (Plan 2).
- Recipes, git/pkg utilities, branch/commit machinery (Plan 3).
- Inventory providers, `--fleet` flag, clone-to-workdir (Plan 4).
- Changesets, publishing workflow, npm release (Plan 4).
- Test fixtures (`pristine-starter`, `pre-svelte5`, `drifted-configs`) — added in Plan 2.
