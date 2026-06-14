import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/forms/index.ts",
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
  // Copy bundled email assets (check.png + blurredTests.jpg) into dist so the
  // runtime loader at dist/reports/maintenance-email/assets/index.js can read
  // them via fs.readFile from a path relative to import.meta.url.
  onSuccess: async () => {
    const { copyFile, mkdir } = await import("node:fs/promises");
    const dest = "dist/reports/maintenance-email/assets";
    await mkdir(dest, { recursive: true });
    await copyFile("src/reports/maintenance-email/assets/check.png", `${dest}/check.png`);
    await copyFile(
      "src/reports/maintenance-email/assets/blurredTests.jpg",
      `${dest}/blurredTests.jpg`,
    );
  },
});
