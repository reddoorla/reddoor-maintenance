import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSite, safeRelative, type BuildSteps } from "../../scripts/prismic-sync-build.mjs";

let tmp: string;
beforeEach(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "prismic-sync-build-")));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function input(spec: object): Promise<string> {
  const inDir = join(tmp, "in");
  await mkdir(inDir, { recursive: true });
  await writeFile(join(inDir, "spec.json"), JSON.stringify(spec), "utf-8");
  await writeFile(join(inDir, "tree.tar"), "", "utf-8");
  return inDir;
}

function steps(over: Partial<BuildSteps> = {}): BuildSteps {
  return {
    extract: async (_tar, work) => {
      await mkdir(join(work, "customtypes", "page"), { recursive: true });
      await writeFile(join(work, "customtypes", "page", "index.json"), "{}\n", "utf-8");
    },
    install: async () => {},
    format: async () => true,
    codegen: async (work) => {
      await writeFile(join(work, "prismicio-types.d.ts"), "// types\n", "utf-8");
    },
    ...over,
  };
}

const result = async (out: string) => JSON.parse(await readFile(join(out, "result.json"), "utf-8"));

describe("prismic-sync-build", () => {
  it("copies out the named files and reports success", async () => {
    const inDir = await input({
      models: ["customtypes/page/index.json"],
      generated: ["prismicio-types.d.ts"],
      migrated: true,
    });
    const out = join(tmp, "out");
    await buildSite({ inDir, outDir: out, work: join(tmp, "w"), steps: steps() });
    expect(await result(out)).toEqual({ ok: true, formatted: true, error: null });
    expect(await readFile(join(out, "files", "prismicio-types.d.ts"), "utf-8")).toBe("// types\n");
    expect(await readFile(join(out, "files", "customtypes/page/index.json"), "utf-8")).toBe("{}\n");
  });

  it("never throws for a site's failure: it writes the reason instead", async () => {
    const inDir = await input({
      models: ["customtypes/page/index.json"],
      generated: [],
      migrated: false,
    });
    const out = join(tmp, "out");
    const r = await buildSite({
      inDir,
      outDir: out,
      work: join(tmp, "w"),
      steps: steps({
        install: async () => {
          throw new Error("lockfile out of date");
        },
      }),
    });
    expect(r.ok).toBe(false);
    expect(await result(out)).toMatchObject({ ok: false, error: "lockfile out of date" });
  });

  it("copies no link and no path outside the spec", async () => {
    const inDir = await input({
      models: ["customtypes/page/index.json", "../escape.json", "/etc/passwd"],
      generated: ["prismicio-types.d.ts"],
      migrated: true,
    });
    const out = join(tmp, "out");
    await buildSite({
      inDir,
      outDir: out,
      work: join(tmp, "w"),
      steps: steps({
        codegen: async (work) => {
          await symlink("/etc/hostname", join(work, "prismicio-types.d.ts"));
        },
      }),
    });
    expect(await result(out)).toMatchObject({ ok: true });
    await expect(lstat(join(out, "files", "prismicio-types.d.ts"))).rejects.toThrow(/ENOENT/);
    await expect(lstat(join(tmp, "escape.json"))).rejects.toThrow(/ENOENT/);
  });

  it("does not run codegen on a site that is not migrated", async () => {
    const inDir = await input({
      models: ["customtypes/page/index.json"],
      generated: [],
      migrated: false,
    });
    let ran = false;
    await buildSite({
      inDir,
      outDir: join(tmp, "out"),
      work: join(tmp, "w"),
      steps: steps({
        codegen: async () => {
          ran = true;
        },
      }),
    });
    expect(ran).toBe(false);
  });

  it("accepts only plain relative paths", () => {
    expect(safeRelative("customtypes/page/index.json")).toBe(true);
    expect(safeRelative("src/lib/slices/Hero/model.json")).toBe(true);
    for (const bad of ["", "/etc/passwd", "../x", "a/../b", "a//b", "./a", "a b", 7]) {
      expect(safeRelative(bad)).toBe(false);
    }
  });
});
