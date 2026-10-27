import { readFile, writeFile } from "node:fs/promises";

export type PackageJsonLike = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
};

export async function readPackageJson(path: string): Promise<PackageJsonLike> {
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as PackageJsonLike;
}

/** Sniff the indent style (tab vs 2 vs 4 vs N spaces) from existing package.json
 * content by looking at the first indented `"key"` line. Defaults to two spaces. */
function detectIndentFromContent(raw: string): string {
  const match = raw.match(/\n([ \t]+)"/);
  return match ? (match[1] ?? "  ") : "  ";
}

export async function writePackageJson(path: string, pkg: PackageJsonLike): Promise<void> {
  let indent = "  ";
  try {
    const existing = await readFile(path, "utf-8");
    indent = detectIndentFromContent(existing);
  } catch {
    // file doesn't exist yet — first write — keep the 2-space default
  }
  const content = JSON.stringify(pkg, null, indent) + "\n";
  await writeFile(path, content, "utf-8");
}

export type BumpDepMode =
  | "ensure" // default: add to devDependencies if missing
  | "bump-only"; // never add; only update existing entries

export type BumpDepOptions = {
  mode?: BumpDepMode;
};

export function bumpDep(
  pkg: PackageJsonLike,
  name: string,
  version: string,
  opts: BumpDepOptions = {},
): PackageJsonLike {
  const mode = opts.mode ?? "ensure";

  const next: PackageJsonLike = {
    ...pkg,
  };

  if (pkg.dependencies) {
    next.dependencies = { ...pkg.dependencies };
  }
  if (pkg.devDependencies) {
    next.devDependencies = { ...pkg.devDependencies };
  }

  if (next.dependencies && name in next.dependencies) {
    if (next.dependencies[name] === version) return pkg;
    next.dependencies[name] = version;
    return next;
  }
  if (next.devDependencies && name in next.devDependencies) {
    if (next.devDependencies[name] === version) return pkg;
    next.devDependencies[name] = version;
    return next;
  }
  // Not present in either map. bump-only leaves the pkg alone so recipes
  // can express "raise the floor on packages this site already uses" without
  // also installing every related dep across the fleet.
  if (mode === "bump-only") return pkg;
  next.devDependencies = { ...(next.devDependencies ?? {}), [name]: version };
  return next;
}
