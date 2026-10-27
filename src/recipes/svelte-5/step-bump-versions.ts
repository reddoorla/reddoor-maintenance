import { join } from "node:path";
import { readPackageJson, writePackageJson, bumpDep } from "../../util/pkg.js";

const SVELTE_5_VERSIONS: Record<string, string> = {
  svelte: "^5.55.5",
  "@sveltejs/kit": "^2.59.0",
  "@sveltejs/vite-plugin-svelte": "^7.0.0",
  "@sveltejs/adapter-netlify": "^6.0.4",
  "@sveltejs/adapter-auto": "^7.0.0",
  vite: "^8.0.10",
  "svelte-check": "^4.4.7",
  typescript: "^6.0.3",
  "typescript-svelte-plugin": "^0.3.52",
};

export async function bumpToSvelte5Versions(cwd: string): Promise<boolean> {
  const pkgPath = join(cwd, "package.json");
  const pkg = await readPackageJson(pkgPath);
  let next = pkg;
  // bump-only: a svelte-4 site that doesn't declare e.g. adapter-netlify
  // should not get it added during the upgrade.
  for (const [name, version] of Object.entries(SVELTE_5_VERSIONS)) {
    next = bumpDep(next, name, version, { mode: "bump-only" });
  }
  if (next === pkg) return false;
  await writePackageJson(pkgPath, next);
  return true;
}
