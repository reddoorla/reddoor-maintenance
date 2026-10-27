import { describe, it, expect } from "vitest";
import { writeFile, readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPackageJson, writePackageJson, bumpDep } from "../../src/util/pkg.js";

async function withPkgFile(
  initial: object,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "reddoor-pkg-"));
  const path = join(dir, "package.json");
  await writeFile(path, JSON.stringify(initial, null, 2) + "\n", "utf-8");
  return { path, cleanup: async () => {} };
}

describe("util/pkg", () => {
  it("readPackageJson parses the file", async () => {
    const { path } = await withPkgFile({ name: "x", version: "1.0.0" });
    const pkg = await readPackageJson(path);
    expect(pkg.name).toBe("x");
  });

  it("writePackageJson preserves 2-space indent + trailing newline", async () => {
    const { path } = await withPkgFile({ name: "x" });
    await writePackageJson(path, { name: "x", version: "1.0.0" });
    const raw = await readFile(path, "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain('  "name"');
  });

  it("writePackageJson preserves 4-space indent when the existing file uses 4 spaces", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reddoor-pkg-"));
    const path = join(dir, "package.json");
    await writeFile(path, JSON.stringify({ name: "x" }, null, 4) + "\n", "utf-8");

    await writePackageJson(path, { name: "x", version: "1.0.0" });
    const raw = await readFile(path, "utf-8");
    expect(raw).toContain('    "name"');
    expect(raw).not.toMatch(/^ {2}"name"/m);
  });

  it("writePackageJson preserves tab indent when the existing file uses tabs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reddoor-pkg-"));
    const path = join(dir, "package.json");
    await writeFile(path, JSON.stringify({ name: "x" }, null, "\t") + "\n", "utf-8");

    await writePackageJson(path, { name: "x", version: "1.0.0" });
    const raw = await readFile(path, "utf-8");
    expect(raw).toMatch(/^\t"name"/m);
  });

  it("writePackageJson defaults to 2-space when no existing file is found", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reddoor-pkg-"));
    const path = join(dir, "package.json");
    // path doesn't exist yet — writePackageJson should still succeed with the default
    await writePackageJson(path, { name: "x" });
    const raw = await readFile(path, "utf-8");
    expect(raw).toContain('  "name"');
  });

  it("bumpDep updates an existing dependency in place", () => {
    const pkg = { dependencies: { foo: "^1.0.0" } };
    const next = bumpDep(pkg, "foo", "^2.0.0");
    expect(next.dependencies?.foo).toBe("^2.0.0");
    // input unchanged
    expect(pkg.dependencies.foo).toBe("^1.0.0");
  });

  it("bumpDep adds to devDependencies when the dep is only there", () => {
    const pkg = { devDependencies: { bar: "^1.0.0" } };
    const next = bumpDep(pkg, "bar", "^2.0.0");
    expect(next.devDependencies?.bar).toBe("^2.0.0");
  });

  it("bumpDep is a noop when the version already matches", () => {
    const pkg = { dependencies: { foo: "^1.0.0" } };
    const next = bumpDep(pkg, "foo", "^1.0.0");
    expect(next).toEqual(pkg);
  });

  it("bumpDep with mode='bump-only' does NOT add a missing dep", () => {
    const pkg = { dependencies: { foo: "^1.0.0" } };
    const next = bumpDep(pkg, "bar", "^1.0.0", { mode: "bump-only" });
    // bar was not present; bump-only mode must leave the pkg unchanged.
    expect(next).toEqual(pkg);
    expect(next.dependencies?.bar).toBeUndefined();
    expect(next.devDependencies?.bar).toBeUndefined();
  });

  it("bumpDep with mode='bump-only' still bumps existing deps", () => {
    const pkg = { devDependencies: { foo: "^1.0.0" } };
    const next = bumpDep(pkg, "foo", "^2.0.0", { mode: "bump-only" });
    expect(next.devDependencies?.foo).toBe("^2.0.0");
  });

  it("bumpDep default mode (ensure) still adds missing deps to devDeps", () => {
    const pkg = { dependencies: { foo: "^1.0.0" } };
    const next = bumpDep(pkg, "bar", "^1.0.0");
    expect(next.devDependencies?.bar).toBe("^1.0.0");
  });
});
