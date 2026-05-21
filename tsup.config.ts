import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/cli/bin.ts",
    "src/cli/commands/audit.ts",
    "src/configs/lighthouse.ts",
    "src/configs/eslint.ts",
    "src/configs/prettier.ts",
    "src/configs/playwright-a11y.ts",
    "src/configs/svelte.ts",
    "src/util/git.ts",
    "src/util/pkg.ts",
    "src/recipes/sync-configs.ts",
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
