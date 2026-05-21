import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateSvelteConfig } from "../../../src/recipes/svelte-5/step-svelte-config.js";

async function withSvelteConfig(contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "reddoor-svelte5-"));
  await writeFile(join(dir, "svelte.config.js"), contents, "utf-8");
  return dir;
}

describe("svelte-5 step: svelte.config.js", () => {
  it("removes a top-level vitePreprocess import + preprocess key", async () => {
    const cwd = await withSvelteConfig(
      `import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import adapter from "@sveltejs/adapter-netlify";

export default {
  preprocess: vitePreprocess(),
  kit: { adapter: adapter() },
};
`,
    );
    const changed = await migrateSvelteConfig(cwd);
    expect(changed).toBe(true);
    const next = await readFile(join(cwd, "svelte.config.js"), "utf-8");
    expect(next).not.toContain("vitePreprocess");
    expect(next).not.toContain("preprocess:");
    expect(next).toContain("kit: { adapter: adapter() }");
  });

  it("is a noop when neither import nor key is present", async () => {
    const cwd = await withSvelteConfig(
      `import adapter from "@sveltejs/adapter-netlify";

export default {
  kit: { adapter: adapter() },
};
`,
    );
    const changed = await migrateSvelteConfig(cwd);
    expect(changed).toBe(false);
  });

  it("removes vitePreprocess from a multi-name import without dropping the other names", async () => {
    const cwd = await withSvelteConfig(
      `import { vitePreprocess, sveltePreprocess } from "@sveltejs/vite-plugin-svelte";
import adapter from "@sveltejs/adapter-netlify";

export default {
  preprocess: vitePreprocess(),
  kit: { adapter: adapter() },
};
`,
    );
    const changed = await migrateSvelteConfig(cwd);
    expect(changed).toBe(true);
    const next = await readFile(join(cwd, "svelte.config.js"), "utf-8");
    expect(next).toContain("sveltePreprocess");
    expect(next).not.toContain("vitePreprocess");
    expect(next).not.toContain("preprocess:");
  });

  it("removes the preprocess key when vitePreprocess is called with arguments", async () => {
    const cwd = await withSvelteConfig(
      `import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import adapter from "@sveltejs/adapter-netlify";

export default {
  preprocess: vitePreprocess({ script: true }),
  kit: { adapter: adapter() },
};
`,
    );
    const changed = await migrateSvelteConfig(cwd);
    expect(changed).toBe(true);
    const next = await readFile(join(cwd, "svelte.config.js"), "utf-8");
    expect(next).not.toContain("vitePreprocess");
    expect(next).not.toContain("preprocess:");
  });
});
