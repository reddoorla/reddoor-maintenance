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
});
