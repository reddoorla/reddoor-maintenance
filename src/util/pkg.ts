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

export async function writePackageJson(path: string, pkg: PackageJsonLike): Promise<void> {
  const content = JSON.stringify(pkg, null, 2) + "\n";
  await writeFile(path, content, "utf-8");
}

export function bumpDep(pkg: PackageJsonLike, name: string, version: string): PackageJsonLike {
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
  // Not present in either: add to devDependencies.
  next.devDependencies = { ...(next.devDependencies ?? {}), [name]: version };
  return next;
}
