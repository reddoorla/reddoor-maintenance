import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function migrateSvelteConfig(cwd: string): Promise<boolean> {
  const path = join(cwd, "svelte.config.js");
  let src: string;
  try {
    src = await readFile(path, "utf-8");
  } catch {
    return false;
  }

  let next = src;
  next = next.replace(
    /^import\s+\{\s*vitePreprocess\s*\}\s+from\s+["']@sveltejs\/vite-plugin-svelte["'];\n/m,
    "",
  );
  next = next.replace(/^\s*preprocess:\s*vitePreprocess\(\)\s*,?\s*\n/m, "");

  if (next === src) return false;
  await writeFile(path, next, "utf-8");
  return true;
}
