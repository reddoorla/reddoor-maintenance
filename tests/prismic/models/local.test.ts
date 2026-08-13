// tests/prismic/models/local.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localModels } from "../../../src/prismic/models/local.js";

let dir: string;

async function writeJson(rel: string, value: unknown): Promise<void> {
  const full = join(dir, rel);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, JSON.stringify(value, null, "\t") + "\n");
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "prismic-local-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("localModels", () => {
  it("reads custom types from customtypes/<dir>/index.json", async () => {
    await writeJson("customtypes/page/index.json", { id: "page", label: "Page" });
    const models = await localModels(dir, ["./src/lib/slices"]);
    expect(models).toEqual([
      {
        kind: "customtype",
        id: "page",
        model: { id: "page", label: "Page" },
        path: "customtypes/page/index.json",
      },
    ]);
  });

  // The slice DIRECTORY name is PascalCase and does NOT match the model id
  // (gallerysonder's ContentWidthMedia holds id "video_block"). Keying on the
  // directory would produce ids Prismic has never heard of.
  it("keys a slice by its model id, not its directory name", async () => {
    await writeJson("src/lib/slices/ContentWidthMedia/model.json", {
      id: "video_block",
      type: "SharedSlice",
    });
    const models = await localModels(dir, ["./src/lib/slices"]);
    expect(models[0]).toMatchObject({
      kind: "slice",
      id: "video_block",
      path: "src/lib/slices/ContentWidthMedia/model.json",
    });
  });

  it("returns customtypes and slices together", async () => {
    await writeJson("customtypes/page/index.json", { id: "page" });
    await writeJson("src/lib/slices/Hero/model.json", { id: "hero", type: "SharedSlice" });
    const models = await localModels(dir, ["./src/lib/slices"]);
    expect(models.map((m) => `${m.kind}:${m.id}`).sort()).toEqual([
      "customtype:page",
      "slice:hero",
    ]);
  });

  it("returns [] for a repo with neither directory", async () => {
    expect(await localModels(dir, ["./src/lib/slices"])).toEqual([]);
  });

  // alamo-anatomy's config points at a slice directory that does not exist.
  it("tolerates a configured library directory that is missing", async () => {
    await writeJson("customtypes/page/index.json", { id: "page" });
    const models = await localModels(dir, ["./src/lib/nowhere"]);
    expect(models.map((m) => m.id)).toEqual(["page"]);
  });

  it("skips a subdirectory with no model file rather than failing", async () => {
    await mkdir(join(dir, "src/lib/slices/NotASlice"), { recursive: true });
    await writeJson("src/lib/slices/Hero/model.json", { id: "hero", type: "SharedSlice" });
    expect((await localModels(dir, ["./src/lib/slices"])).map((m) => m.id)).toEqual(["hero"]);
  });

  // A silent skip here is the exact failure class this module exists to prevent:
  // a model that cannot be read looks identical to a model that does not exist,
  // and CI would then report "in sync" while the field was missing remotely.
  it("THROWS on malformed model JSON, naming the file", async () => {
    await mkdir(join(dir, "customtypes/page"), { recursive: true });
    await writeFile(join(dir, "customtypes/page/index.json"), "{ nope");
    await expect(localModels(dir, [])).rejects.toThrow(/customtypes\/page\/index\.json/);
  });

  it("THROWS when a model file has no string id", async () => {
    await writeJson("customtypes/page/index.json", { label: "Page" });
    await expect(localModels(dir, [])).rejects.toThrow(/id/);
  });

  it("reads multiple libraries", async () => {
    await writeJson("src/lib/slices/Hero/model.json", { id: "hero", type: "SharedSlice" });
    await writeJson("src/lib/blux/Band/model.json", { id: "blux_band", type: "SharedSlice" });
    const ids = (await localModels(dir, ["./src/lib/slices", "./src/lib/blux"])).map((m) => m.id);
    expect(ids.sort()).toEqual(["blux_band", "hero"]);
  });

  // A library listed twice is a config typo, not a duplicate model — it must not
  // trip the duplicate-id check with a file colliding against itself.
  it("reads a library listed twice only once", async () => {
    await writeJson("src/lib/slices/Hero/model.json", { id: "hero", type: "SharedSlice" });
    const models = await localModels(dir, ["./src/lib/slices", "src/lib/slices"]);
    expect(models.map((m) => m.id)).toEqual(["hero"]);
  });

  // Two directories CAN declare the same model id — the slice directory name and
  // the model `id` are independent (gallerysonder's `ContentWidthMedia/` holds
  // `video_block`), so nothing on disk prevents a collision. Left undetected it
  // is a silent, arbitrary push: `diffModels` processes both entries
  // independently, one can land in `unchanged` while the other lands in
  // `toUpdate` against the SAME remote model, and the push sends whichever of
  // the two directories sorts last — stable since the listing is sorted, but no
  // less arbitrary. Detected here rather than papered over in
  // `diffModels`, because the operator has a real problem only they can fix.
  it("THROWS on two local files declaring the same id, naming BOTH paths", async () => {
    await writeJson("src/lib/slices/Hero/model.json", { id: "hero", type: "SharedSlice" });
    await writeJson("src/lib/slices/HeroLegacy/model.json", { id: "hero", type: "SharedSlice" });
    const err = await localModels(dir, ["./src/lib/slices"]).catch((e: Error) => e);
    expect((err as Error).message).toContain("src/lib/slices/Hero/model.json");
    expect((err as Error).message).toContain("src/lib/slices/HeroLegacy/model.json");
    expect((err as Error).message).toMatch(/duplicate/i);
  });

  // A custom type and a slice sharing an id is LEGAL — different Types API
  // collections — and `diffModels` already keys on kind+id. Only same-kind
  // collisions are an error.
  it("allows a customtype and a slice to share an id", async () => {
    await writeJson("customtypes/hero/index.json", { id: "hero" });
    await writeJson("src/lib/slices/Hero/model.json", { id: "hero", type: "SharedSlice" });
    const models = await localModels(dir, ["./src/lib/slices"]);
    expect(models.map((m) => m.kind).sort()).toEqual(["customtype", "slice"]);
  });

  // --- present-but-unreadable: everything below must THROW, never skip -------
  // Only a PROVEN absence (ENOENT) may skip. A model that is on disk and cannot
  // be read is the same silent-divergence hazard as a corrupt one: skipping it
  // makes CI report "in sync" while the field is missing in Prismic. EACCES is
  // not tested — CI can run as root, where it is unreproducible — so these use
  // failures we can create deterministically as any user.

  it("THROWS when index.json is a DIRECTORY rather than a file", async () => {
    await mkdir(join(dir, "customtypes/page/index.json"), { recursive: true });
    await expect(localModels(dir, [])).rejects.toThrow(/customtypes\/page\/index\.json/);
  });

  it("THROWS when a slice's model.json is a DIRECTORY rather than a file", async () => {
    await mkdir(join(dir, "src/lib/slices/Hero/model.json"), { recursive: true });
    await expect(localModels(dir, ["./src/lib/slices"])).rejects.toThrow(
      /src\/lib\/slices\/Hero\/model\.json/,
    );
  });

  // A dangling symlink is the case `stat` gets wrong: it follows the link, sees
  // ENOENT and calls the model absent, even though the repo plainly contains an
  // entry at that path. `lstat` sees the link itself, so this throws.
  it("THROWS when a model file is a dangling symlink", async () => {
    await mkdir(join(dir, "customtypes/page"), { recursive: true });
    await symlink(join(dir, "does-not-exist.json"), join(dir, "customtypes/page/index.json"));
    await expect(localModels(dir, [])).rejects.toThrow(/customtypes\/page\/index\.json/);
  });

  // A library that exists but cannot be listed must not read as "this site has
  // no slices" — that would report every one of its slices as absent, and a
  // push acting on that would look like a fleet-wide slice wipe.
  it("THROWS when a configured library path is a regular file, not a directory", async () => {
    await mkdir(join(dir, "src/lib"), { recursive: true });
    await writeFile(join(dir, "src/lib/slices"), "not a directory\n");
    await expect(localModels(dir, ["./src/lib/slices"])).rejects.toThrow(/src\/lib\/slices/);
  });

  it("THROWS on a model file containing literal null, naming the file", async () => {
    await mkdir(join(dir, "customtypes/page"), { recursive: true });
    await writeFile(join(dir, "customtypes/page/index.json"), "null\n");
    await expect(localModels(dir, [])).rejects.toThrow(/customtypes\/page\/index\.json/);
  });

  // `null`, `[]` and `"a string"` all PARSE — the guard is about what parsed to,
  // not whether it parsed. Without it the `.id` read throws a bare TypeError
  // naming no file.
  it("THROWS on a model file that parses to an array or a string, naming the file", async () => {
    for (const [i, raw] of ["[]", '"a string"', "42"].entries()) {
      await mkdir(join(dir, `customtypes/t${i}`), { recursive: true });
      await writeFile(join(dir, `customtypes/t${i}/index.json`), `${raw}\n`);
      await expect(localModels(dir, [])).rejects.toThrow(
        new RegExp(`customtypes/t${i}/index\\.json.*not a JSON object`),
      );
      await rm(join(dir, `customtypes/t${i}`), { recursive: true, force: true });
    }
  });

  // --- symlinked model DIRECTORIES ------------------------------------------
  // `readdir` reports a symlink-to-a-directory as isSymbolicLink() and NOT
  // isDirectory(), so a naive `.filter(d => d.isDirectory())` drops a real,
  // fully readable model with no entry and no error. These cases run for BOTH
  // roots because customtypes/ and each library are separate call sites.

  it("follows a symlinked customtype directory", async () => {
    await writeJson("real/page/index.json", { id: "page", label: "Page" });
    await mkdir(join(dir, "customtypes"), { recursive: true });
    await symlink(join(dir, "real/page"), join(dir, "customtypes/page"));
    const models = await localModels(dir, []);
    expect(models.map((m) => `${m.kind}:${m.id}`)).toEqual(["customtype:page"]);
  });

  it("follows a symlinked slice directory", async () => {
    await writeJson("real/Hero/model.json", { id: "hero", type: "SharedSlice" });
    await mkdir(join(dir, "src/lib/slices"), { recursive: true });
    await symlink(join(dir, "real/Hero"), join(dir, "src/lib/slices/Hero"));
    const models = await localModels(dir, ["./src/lib/slices"]);
    expect(models.map((m) => `${m.kind}:${m.id}`)).toEqual(["slice:hero"]);
  });

  // Present-but-unresolvable is not absent: that link may well have been a model
  // directory, and we are not entitled to decide it wasn't.
  it("THROWS on a dangling symlink where a customtype directory should be", async () => {
    await mkdir(join(dir, "customtypes"), { recursive: true });
    await symlink(join(dir, "nowhere"), join(dir, "customtypes/page"));
    await expect(localModels(dir, [])).rejects.toThrow(/customtypes\/page/);
  });

  it("THROWS on a dangling symlink where a slice directory should be", async () => {
    await mkdir(join(dir, "src/lib/slices"), { recursive: true });
    await symlink(join(dir, "nowhere"), join(dir, "src/lib/slices/Hero"));
    await expect(localModels(dir, ["./src/lib/slices"])).rejects.toThrow(/src\/lib\/slices\/Hero/);
  });

  // A symlink to a FILE is skipped in silence, exactly like the plain README.md
  // that sits in a slices directory: a non-directory entry is legitimately not a
  // candidate model directory. This is the one place the polarity differs from
  // the file level, and it is deliberate.
  it("skips a symlink to a regular file in customtypes/ without erroring", async () => {
    await writeFile(join(dir, "notes.txt"), "hello\n");
    await writeJson("customtypes/page/index.json", { id: "page" });
    await symlink(join(dir, "notes.txt"), join(dir, "customtypes/README.md"));
    expect((await localModels(dir, [])).map((m) => m.id)).toEqual(["page"]);
  });

  it("skips a symlink to a regular file in a slice library without erroring", async () => {
    await writeFile(join(dir, "notes.txt"), "hello\n");
    await writeJson("src/lib/slices/Hero/model.json", { id: "hero", type: "SharedSlice" });
    await symlink(join(dir, "notes.txt"), join(dir, "src/lib/slices/README.md"));
    expect((await localModels(dir, ["./src/lib/slices"])).map((m) => m.id)).toEqual(["hero"]);
  });

  // A symlink LOOP is the deterministic stand-in for "any other errno": stat
  // answers ELOOP, which is neither "it's a directory" nor "it's absent".
  it("THROWS on an unresolvable (looping) symlink in customtypes/", async () => {
    await mkdir(join(dir, "customtypes"), { recursive: true });
    await symlink(join(dir, "customtypes/b"), join(dir, "customtypes/a"));
    await symlink(join(dir, "customtypes/a"), join(dir, "customtypes/b"));
    await expect(localModels(dir, [])).rejects.toThrow(/customtypes\/(a|b)/);
  });

  it("THROWS on an unresolvable (looping) symlink in a slice library", async () => {
    await mkdir(join(dir, "src/lib/slices"), { recursive: true });
    await symlink(join(dir, "src/lib/slices/b"), join(dir, "src/lib/slices/a"));
    await symlink(join(dir, "src/lib/slices/a"), join(dir, "src/lib/slices/b"));
    await expect(localModels(dir, ["./src/lib/slices"])).rejects.toThrow(/src\/lib\/slices\/(a|b)/);
  });

  // --- variation ids --------------------------------------------------------

  it("THROWS when a slice variation has no id, naming the file and the index", async () => {
    await writeJson("src/lib/slices/Hero/model.json", {
      id: "hero",
      type: "SharedSlice",
      variations: [{ id: "default", name: "Default" }, { name: "Broken" }],
    });
    const err = await localModels(dir, ["./src/lib/slices"]).catch((e: Error) => e);
    expect((err as Error).message).toContain("src/lib/slices/Hero/model.json");
    expect((err as Error).message).toContain("1");
    expect((err as Error).message).toMatch(/variation/i);
  });

  // Custom types have no `variations` at all, so the check must be a no-op for
  // anything that is not an array — otherwise it would reject every custom type
  // in the fleet.
  it("accepts models whose variations are absent or not an array", async () => {
    await writeJson("customtypes/page/index.json", { id: "page", label: "Page" });
    await writeJson("src/lib/slices/Odd/model.json", { id: "odd", variations: "not-an-array" });
    const ids = (await localModels(dir, ["./src/lib/slices"])).map((m) => m.id);
    expect(ids.sort()).toEqual(["odd", "page"]);
  });

  it("accepts a slice whose variations all carry string ids", async () => {
    await writeJson("src/lib/slices/Hero/model.json", {
      id: "hero",
      type: "SharedSlice",
      variations: [
        { id: "default", name: "Default" },
        { id: "reversed", name: "Reversed" },
      ],
    });
    expect((await localModels(dir, ["./src/lib/slices"])).map((m) => m.id)).toEqual(["hero"]);
  });
});
