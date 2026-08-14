// tests/prismic/models/write.test.ts
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import {
  writeModelFile,
  modelFilePath,
  type FormatModelFile,
} from "../../../src/prismic/models/write.js";
import { defaultSpawn } from "../../../src/audits/util/spawn.js";
import { formatWithPrettier } from "../../../src/recipes/_prettier.js";
import type { RemoteEntry } from "../../../src/prismic/models/types.js";

let dir: string;
beforeEach(async () => {
  // `realpath` because macOS hands out `/var/folders/…`, a symlink to
  // `/private/var/folders/…`. The module resolves the paths it writes to (it
  // has to — see the symlink-escape test), so a fixture root that is itself
  // reached through a link would make every containment comparison a
  // coin-flip on which spelling each side happened to use.
  dir = await realpath(await mkdtemp(join(tmpdir(), "prismic-write-")));
  await giveOwnPrettier(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const LIB = "./src/lib/slices";

/**
 * Give a fixture repo its own `node_modules/.bin/prettier`.
 *
 * `writeModelFile` now refuses to format through anything it has not found
 * under the TARGET's root, so every test that expects formatting to be
 * ATTEMPTED needs one — and the tests that expect it to be REFUSED get a root
 * without one. That split is the whole point of the guard; before it, both
 * shapes spawned and both reported `formatted: true`.
 *
 * Returns the resolved path, which is what the module passes to spawn.
 */
const giveOwnPrettier = async (root: string, body = "#!/bin/sh\nexit 0\n"): Promise<string> => {
  const bin = join(root, "node_modules", ".bin", "prettier");
  await mkdir(dirname(bin), { recursive: true });
  await writeFile(bin, body, { mode: 0o755 });
  return await realpath(bin);
};

/**
 * Formatter doubles, TYPED as `FormatModelFile`. A bare `vi.fn(async () => …)`
 * is `Mock<Procedure | Constructable>`, which vitest runs happily and `tsc`
 * rejects — the split this plan warns about, hit here on the first gate.
 *
 * These used to be `SpawnFn` doubles, because `writeModelFile` used to take an
 * arbitrary-argv process spawner. It takes the CAPABILITY now — "format these
 * paths, in this repo, with this binary" — so the doubles are at that seam
 * instead, and the two behaviours that used to be asserted through a spawn
 * (prettier exits non-zero, the spawn itself throws) are asserted where they now
 * live, in `tests/recipes/_prettier.test.ts`. The end-to-end test at the bottom
 * of this file still drives the REAL binding, spawn and all.
 */
const okFormat = (): Mock<FormatModelFile> => vi.fn<FormatModelFile>(async () => true);
const failingFormat = (): Mock<FormatModelFile> => vi.fn<FormatModelFile>(async () => false);
const throwingFormat = (): Mock<FormatModelFile> =>
  vi.fn<FormatModelFile>(async () => {
    throw new Error("ENOENT pnpm");
  });

const slice = (id: string): RemoteEntry => ({
  kind: "slice",
  id,
  model: { id, type: "SharedSlice" },
});

/** Present-or-not, following NOTHING: a dangling symlink counts as present,
 *  which is the whole point in the symlink test below. */
const present = async (p: string): Promise<boolean> => {
  try {
    await lstat(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * The Error a call threw, or `undefined` if it did not throw.
 *
 * Used INSTEAD of `expect(…).rejects` in every test below whose real claim is
 * that a file was not touched — and the reason is the whole point of those
 * tests. `await expect(…).rejects.toThrow()` placed above a filesystem
 * assertion fails FIRST when a guard is removed, so the filesystem line never
 * executes and the absence it asserts is never actually checked. The mutation
 * looks like it proved something and proved the wrong thing. Capturing the
 * refusal instead lets the state assertion run first and be the one that reds,
 * with the message check kept afterwards.
 */
const refusalFrom = async (call: Promise<unknown>): Promise<Error | undefined> => {
  try {
    await call;
    return undefined;
  } catch (e) {
    return e as Error;
  }
};

describe("modelFilePath", () => {
  it("puts a custom type at customtypes/<id>/index.json", () => {
    expect(modelFilePath({ kind: "customtype", id: "frozen_page" }, LIB)).toBe(
      "customtypes/frozen_page/index.json",
    );
  });

  // Slice Machine's on-disk convention is a PascalCase directory. Deriving it
  // from the id is the only option for a model that exists ONLY in Prismic —
  // there is no local directory to reuse. It is a GUESS, and 6 of the fleet's
  // 132 slice directories prove the guess can be wrong; see the collision test
  // in `writeModelFile` for what stops that guess from destroying a file.
  it("puts a slice at <library>/<PascalCaseId>/model.json", () => {
    expect(modelFilePath({ kind: "slice", id: "video_block" }, LIB)).toBe(
      "src/lib/slices/VideoBlock/model.json",
    );
  });

  it("handles an id that is already one word", () => {
    expect(modelFilePath({ kind: "slice", id: "hero" }, LIB)).toBe(
      "src/lib/slices/Hero/model.json",
    );
  });

  it("accepts a library written without the leading ./", () => {
    expect(modelFilePath({ kind: "slice", id: "hero" }, "src/lib/slices")).toBe(
      "src/lib/slices/Hero/model.json",
    );
  });

  // The id comes from PRISMIC — it is the one value in this module that is not
  // ours. An ALLOW-LIST, because a deny-list of dangerous shapes is defeated by
  // the shape nobody listed. All 200 model ids in the fleet fit inside it
  // (measured 2026-08-13 from every repo's origin/main via `git ls-tree`).
  it.each([
    ["empty", ""],
    ["a path separator", "a/b"],
    ["a parent-directory hop", "../../etc/passwd"],
    ["a dot segment", "."],
    ["a dot in the name", "page.json"],
    ["a space", "frozen page"],
    ["a backslash", "a\\b"],
  ])("refuses an id containing %s", (_what, id) => {
    expect(() => modelFilePath({ kind: "customtype", id }, LIB)).toThrow(/id/i);
  });

  // `pascal()` STRIPS separators, so validating the id after the transform would
  // wave "../../x" through as the harmless-looking directory "X" — a model
  // written to a plausible path under a name nobody asked for, reported as
  // success. Validation has to happen before the lossy step, which is why the
  // case above is checked on the raw id and this one exists at all.
  it("refuses an id that survives the allow-list but pascals to nothing", () => {
    expect(() => modelFilePath({ kind: "slice", id: "___" }, LIB)).toThrow();
  });

  // An empty library is not "the fleet default" — config.ts treats
  // `libraries: []` as a STATEMENT that a site has no slice library, so an empty
  // string here means we do not know where slices live. Guessing puts a slice
  // model at the repo root of a live client site.
  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["only a dot-slash", "./"],
  ])("refuses a %s slice library", (_what, library) => {
    expect(() => modelFilePath({ kind: "slice", id: "hero" }, library)).toThrow(/librar/i);
  });

  // The returned string is used TWO ways — under `join(repoRoot, …)` and as an
  // argv to the target repo's prettier — and those two readings only agree for a
  // plain relative path. An absolute library makes them disagree silently:
  // the write lands under the repo, prettier formats a different file entirely.
  it("refuses an absolute library, which the two readers of this path disagree about", () => {
    expect(() => modelFilePath({ kind: "slice", id: "hero" }, "/etc/slices")).toThrow();
  });

  it("refuses a library that climbs out of the repo", () => {
    expect(() => modelFilePath({ kind: "slice", id: "hero" }, "../../elsewhere")).toThrow();
  });
});

describe("writeModelFile", () => {
  const entry: RemoteEntry = {
    kind: "customtype",
    id: "frozen_page",
    model: { id: "frozen_page", label: "Frozen" },
  };

  it("creates the directory and writes parseable JSON", async () => {
    const format = okFormat();
    const res = await writeModelFile(format, dir, entry, LIB);
    expect(res.path).toBe("customtypes/frozen_page/index.json");
    expect(JSON.parse(await readFile(join(dir, res.path), "utf-8"))).toEqual({
      id: "frozen_page",
      label: "Frozen",
    });
  });

  // THE TRAP. The first pull-down PR failed CI on `prettier --check` for
  // customtypes/frozen_page/index.json while catalog_page/index.json — generated
  // by the identical code path in the same run — passed. Formatting is
  // content-dependent, so no canonical JSON.stringify shape is safe.
  //
  // The command is the TARGET's own prettier by absolute path, not `pnpm exec
  // prettier`: `pnpm exec` picks by resolution, and in a fleet clone with no
  // node_modules it was measured (2026-08-13) both running an unrequested
  // `pnpm install` inside the client repo and falling through to the CALLING
  // repo's prettier — reporting `formatted: true` for a format the target never
  // did.
  //
  // Asserted as the WHOLE CALL LIST, not `toHaveBeenCalledWith`: the claim is
  // that this module formats the one file it wrote and touches nothing else, and
  // a "was called with" assertion is silent about a second call.
  it("formats the written file with the TARGET REPO's own prettier, by absolute path", async () => {
    const bin = await realpath(join(dir, "node_modules", ".bin", "prettier"));
    const format = okFormat();
    await writeModelFile(format, dir, entry, LIB);
    expect(format.mock.calls).toEqual([
      [dir, ["customtypes/frozen_page/index.json"], { bin, timeoutMs: 60_000 }],
    ]);
  });

  // ABSENCE ASSERTION — mutation-proven. The one that says what this module is
  // FOR. A fleet clone is `git clone` and nothing else (clone-if-needed.ts runs
  // no install), and the documented invocation `pnpm reddoor-maint …` puts THIS
  // repo's node_modules/.bin on PATH — so a spawn that lets resolution decide
  // formats a live client's file with OUR prettier and exits 0. Both answers
  // then arrive as `formatted: true`, and the deviation from `--stdin-filepath`
  // was justified specifically to use the TARGET's prettier.
  it("does not invoke the formatter at all when the target repo has no prettier of its own", async () => {
    const bare = join(dir, "bare-clone");
    await mkdir(bare, { recursive: true });
    const format = okFormat();
    const res = await writeModelFile(format, bare, entry, LIB);
    expect(format).not.toHaveBeenCalled();
    expect(res.formatted).toBe(false);
    // The model is still written — losing it would be worse than not formatting.
    expect(JSON.parse(await readFile(join(bare, res.path), "utf-8"))).toMatchObject({
      id: "frozen_page",
    });
  });

  // A dangling shim is not a prettier. `realpath` (not `stat` on the link)
  // is what makes the difference visible.
  it("treats a dangling .bin/prettier as absent rather than present", async () => {
    const bare = join(dir, "dangling");
    await mkdir(join(bare, "node_modules", ".bin"), { recursive: true });
    await symlink(join(bare, "gone"), join(bare, "node_modules", ".bin", "prettier"));
    const format = okFormat();
    expect((await writeModelFile(format, bare, entry, LIB)).formatted).toBe(false);
    expect(format).not.toHaveBeenCalled();
  });

  it("reports formatted:false (never throws) when prettier is unavailable", async () => {
    const res = await writeModelFile(throwingFormat(), dir, entry, LIB);
    expect(res.formatted).toBe(false);
    expect(JSON.parse(await readFile(join(dir, res.path), "utf-8"))).toMatchObject({
      id: "frozen_page",
    });
  });

  // A repo on a prettier that rejects the file exits non-zero rather than
  // throwing — a different channel to the same fact, and the caller keys its
  // "(unformatted)" flag off this one boolean, so both channels have to reach
  // it.
  it("reports formatted:false when prettier exits non-zero", async () => {
    const res = await writeModelFile(failingFormat(), dir, entry, LIB);
    expect(res.formatted).toBe(false);
    expect(JSON.parse(await readFile(join(dir, res.path), "utf-8"))).toMatchObject({
      id: "frozen_page",
    });
  });

  it("reports formatted:true on a clean prettier run", async () => {
    expect((await writeModelFile(okFormat(), dir, entry, LIB)).formatted).toBe(true);
  });

  // Measured 2026-08-13 from each of the 15 in-scope repos' `origin/main` via
  // `git ls-tree` (never a working tree): 180 of the fleet's 200 committed model
  // files are 2-space indented; only erp-industrial (5) and gallerysonder (15)
  // are tab-indented, and they are the only two repos that set `useTabs: true`.
  // Nine of the remaining 13 ship a prettier config that does not mention
  // `useTabs`; the other four (data-dynamiq, the-pointe, the-pointe-burbank,
  // the-tower-burbank) ship no prettier config at all. Prettier's default is
  // spaces either way.
  //
  // This baseline only decides what the file looks like when prettier could NOT
  // run — which is exactly the fleet-clone-with-no-node_modules case above — so
  // a tab baseline would red `prettier --check` in 13 of 15 repos on the one
  // path it exists to serve.
  it("writes 2-space JSON with a trailing newline as the pre-prettier baseline", async () => {
    const bare = join(dir, "unformattable");
    await mkdir(bare, { recursive: true });
    const res = await writeModelFile(okFormat(), bare, entry, LIB);
    expect(res.formatted).toBe(false);
    const raw = await readFile(join(bare, res.path), "utf-8");
    expect(raw).toContain('\n  "id"');
    expect(raw).not.toContain("\t");
    expect(raw.endsWith("\n")).toBe(true);
  });

  // ABSENCE ASSERTION — mutation-proven: deleting the occupant check in write.ts
  // makes this fail on the "video_block" comparison below, not merely on the
  // rejects() line.
  //
  // The directory name is a GUESS derived from the id, and the fleet proves the
  // guess collides: gallerysonder's src/lib/slices/ContentWidthMedia/model.json
  // declares id "video_block", while "content_width_media" is a real slice id at
  // caltex-landing and hedloc (measured 2026-08-13, every repo's origin/main via
  // `git ls-tree`; 6 of 132 slice directories differ from pascal(id)). Pull that
  // id down at gallerysonder and the naive write replaces a live model with a
  // different one — data loss produced by the operation whose entire purpose is
  // to be the SAFE alternative to deleting a model.
  it("refuses to overwrite a file that declares a DIFFERENT model id", async () => {
    const format = okFormat();
    const occupied = "src/lib/slices/ContentWidthMedia/model.json";
    await mkdir(join(dir, "src/lib/slices/ContentWidthMedia"), { recursive: true });
    await writeFile(
      join(dir, occupied),
      JSON.stringify({ id: "video_block", type: "SharedSlice" }, null, "\t") + "\n",
    );

    const err = await refusalFrom(writeModelFile(format, dir, slice("content_width_media"), LIB));
    expect(JSON.parse(await readFile(join(dir, occupied), "utf-8"))).toEqual({
      id: "video_block",
      type: "SharedSlice",
    });
    expect(format).not.toHaveBeenCalled();
    expect(err?.message).toMatch(/video_block/);
  });

  // The same-id case is the one legitimate overwrite: refreshing a model from
  // Prismic replaces the model it names, not somebody else's.
  //
  // The call-list assertion is here for a reason found by the 2026-08-13 red
  // team: no test constrained the injected capability on the REFRESH branch, and
  // that branch is where every surviving attack variant sat. It is the path that
  // may legitimately destroy bytes in a live client repo, so it is the path that
  // must say exactly what it invoked — the one file it just wrote, once, in the
  // target repo, with the binary found under that repo's own root.
  it("overwrites a file that declares the SAME model id", async () => {
    const rel = "customtypes/frozen_page/index.json";
    const bin = await realpath(join(dir, "node_modules", ".bin", "prettier"));
    await mkdir(join(dir, "customtypes/frozen_page"), { recursive: true });
    await writeFile(join(dir, rel), JSON.stringify({ id: "frozen_page", label: "Stale" }));
    const format = okFormat();
    const res = await writeModelFile(format, dir, entry, LIB);
    expect(res.formatted).toBe(true);
    expect(JSON.parse(await readFile(join(dir, res.path), "utf-8"))).toEqual({
      id: "frozen_page",
      label: "Frozen",
    });
    expect(format.mock.calls).toEqual([[dir, [rel], { bin, timeoutMs: 60_000 }]]);
  });

  // ABSENCE ASSERTION — mutation-proven: restoring the old
  // `writeFile(full, …, { flag: "w" })` makes this fail on the content
  // comparison, because O_TRUNC needs write permission on the FILE (which it
  // has) and not on the directory (which it does not) — so the old code sails
  // through a refusal the new code cannot even start.
  //
  // The same-id refresh is the one path here that may legitimately destroy
  // bytes in a live client repo, so it is the one path that must never destroy
  // them by accident. `w` truncates first and writes second: ENOSPC, EDQUOT,
  // EIO or the operator interrupting this human-invoked CLI in between leaves
  // the live model as a fragment that is not valid JSON — wreckage that is
  // self-latching (the fragment is what `occupantId` reads on the retry) and
  // indistinguishable from this module's other failures, every one of which
  // leaves the repo untouched. Staging a complete file and renaming it over the
  // target makes the model path hold the old model or the new one, never a
  // fragment.
  it("leaves the existing model intact when the replacement cannot be staged", async () => {
    const rel = "customtypes/frozen_page/index.json";
    const modelDir = join(dir, "customtypes/frozen_page");
    const before = JSON.stringify({ id: "frozen_page", label: "Live" }, null, 2) + "\n";
    await mkdir(modelDir, { recursive: true });
    await writeFile(join(dir, rel), before);

    await chmod(modelDir, 0o500); // r-x: the file stays writable, the directory does not
    let err: Error | undefined;
    try {
      err = await refusalFrom(writeModelFile(okFormat(), dir, entry, LIB));
    } finally {
      await chmod(modelDir, 0o700);
    }
    expect(await readFile(join(dir, rel), "utf-8")).toBe(before);
    expect(err?.message).toMatch(/UNTOUCHED/);
  });

  // ABSENCE ASSERTION — mutation-proven: giving the temp a per-run unique name
  // (`${full}.${process.pid}-${n}.tmp`) makes this fail on the count, because
  // the second attempt no longer contends for the path the first one used and
  // the pre-staged blocker stops blocking.
  //
  // This module has no delete verb and never will, so the leftovers it can
  // produce have to be BOUNDED rather than cleaned up. A unique temp name means
  // every interrupted write leaves another untracked file in a live client repo,
  // forever; one name per model path means the mess is one file however many
  // times it fails. The failure is injected by putting a DIRECTORY at the temp
  // path — a real EISDIR from the real filesystem, not a stub.
  it("leaves at most ONE temp file however many times staging fails", async () => {
    const rel = "customtypes/frozen_page/index.json";
    const modelDir = join(dir, "customtypes/frozen_page");
    const before = JSON.stringify({ id: "frozen_page", label: "Live" }, null, 2) + "\n";
    await mkdir(modelDir, { recursive: true });
    await writeFile(join(dir, rel), before);
    await mkdir(join(dir, `${rel}.tmp`)); // staging cannot write over a directory

    const first = await refusalFrom(writeModelFile(okFormat(), dir, entry, LIB));
    const second = await refusalFrom(writeModelFile(okFormat(), dir, entry, LIB));

    const strays = (await readdir(modelDir)).filter((f) => f.endsWith(".tmp"));
    expect(strays).toEqual(["index.json.tmp"]);
    expect(await readFile(join(dir, rel), "utf-8")).toBe(before);
    expect(first?.message).toMatch(/UNTOUCHED/);
    expect(second?.message).toMatch(/UNTOUCHED/);
  });

  // ABSENCE ASSERTION — mutation-proven: changing the temp's flag back to `wx`
  // makes this fail, because the leftover blocks the create and the model is
  // never refreshed.
  //
  // The other half of "bounded, not cleaned up". A temp left by an interrupted
  // run must not become a permanent hard stop for that model — with a
  // deterministic name, `wx` would make it exactly that, and no delete verb
  // exists here to clear it. `w` overwrites the stale temp, and the `rename`
  // then CONSUMES it: a successful pull-down removes the mess a failed one left,
  // which is cleanup without the ability to delete.
  it("overwrites a temp left by an interrupted run, and consumes it on success", async () => {
    const rel = "customtypes/frozen_page/index.json";
    const modelDir = join(dir, "customtypes/frozen_page");
    await mkdir(modelDir, { recursive: true });
    await writeFile(join(dir, rel), JSON.stringify({ id: "frozen_page", label: "Stale" }));
    await writeFile(join(dir, `${rel}.tmp`), "{ half-written wreckage from a killed run");

    const res = await writeModelFile(okFormat(), dir, entry, LIB);

    expect(JSON.parse(await readFile(join(dir, res.path), "utf-8"))).toEqual({
      id: "frozen_page",
      label: "Frozen",
    });
    expect((await readdir(modelDir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  // ABSENCE ASSERTION — mutation-proven. "I cannot tell what is at this path" is
  // not "nothing is at this path"; a file we cannot identify is exactly the one
  // we must not clobber.
  //
  // The message check is not decoration and its shape was chosen by a mutation
  // that exposed the loose version: `/JSON/i` PASSES on the wrong error, because
  // every message here begins with a path ending "index.json". Removing the
  // parse guard left the file intact anyway (the exclusive-create flag catches
  // it second) and the test still went green — a guard proven only by a
  // regex that matched a filename. It names the cause now.
  it("refuses to overwrite a file it cannot parse", async () => {
    const rel = "customtypes/frozen_page/index.json";
    await mkdir(join(dir, "customtypes/frozen_page"), { recursive: true });
    await writeFile(join(dir, rel), "{ not json");
    const err = await refusalFrom(writeModelFile(okFormat(), dir, entry, LIB));
    expect(await readFile(join(dir, rel), "utf-8")).toBe("{ not json");
    expect(err?.message).toMatch(/is not valid JSON/);
  });

  it("refuses to overwrite a JSON file that declares no id", async () => {
    const rel = "customtypes/frozen_page/index.json";
    await mkdir(join(dir, "customtypes/frozen_page"), { recursive: true });
    await writeFile(join(dir, rel), JSON.stringify({ label: "who am i" }));
    const err = await refusalFrom(writeModelFile(okFormat(), dir, entry, LIB));
    expect(JSON.parse(await readFile(join(dir, rel), "utf-8"))).toEqual({ label: "who am i" });
    expect(err?.message).toMatch(/declares no string "id"/);
  });

  it("refuses when a DIRECTORY sits where the model file goes", async () => {
    await mkdir(join(dir, "customtypes/frozen_page/index.json"), { recursive: true });
    await expect(writeModelFile(okFormat(), dir, entry, LIB)).rejects.toThrow();
  });

  // ABSENCE ASSERTION — mutation-proven: replacing the `wx` flag with a plain
  // write creates `nowhere.json` THROUGH the link and this fails.
  //
  // A dangling symlink reads back ENOENT — the errno that means "absent" — while
  // the link itself is plainly there. local.ts hits the same lie and answers it
  // with an lstat probe; a writer has a better answer, because `wx` asks the
  // kernel the question atomically instead of asking twice and hoping.
  it("refuses to write through a dangling symlink", async () => {
    const rel = "customtypes/frozen_page/index.json";
    await mkdir(join(dir, "customtypes/frozen_page"), { recursive: true });
    await symlink(join(dir, "nowhere.json"), join(dir, rel));
    const format = okFormat();
    const err = await refusalFrom(writeModelFile(format, dir, entry, LIB));
    expect(await present(join(dir, "nowhere.json"))).toBe(false);
    // The link ITSELF must survive untouched. "Nothing was created through it"
    // and "nothing was destroyed at it" are two different claims, and only the
    // first was checked here until the 2026-08-13 red team pointed out that a
    // refusal which quietly replaced the operator's link would pass this test.
    expect(await lstat(join(dir, rel)).then((s) => s.isSymbolicLink())).toBe(true);
    // …and nothing was handed to the formatter for a file that was never written.
    expect(format).not.toHaveBeenCalled();
    expect(err).toBeInstanceOf(Error);
  });

  // ABSENCE ASSERTION — mutation-proven: dropping the path-shape guard in
  // modelFilePath writes the model into `<tmp>/outside/Hero/model.json`, which is
  // a sibling of the repo — and every sibling of a repo in this fleet is another
  // LIVE CLIENT REPO.
  //
  // Named for what it actually proves. It is a check on the SHAPE of the string,
  // and a string-shape check cannot see a symlink; the test below is the one
  // that proves the universal.
  it("refuses a library whose spelling points outside the repo root", async () => {
    const repoRoot = join(dir, "repo");
    await mkdir(repoRoot, { recursive: true });
    const format = okFormat();
    const err = await refusalFrom(writeModelFile(format, repoRoot, slice("hero"), "../outside"));
    expect(await present(join(dir, "outside"))).toBe(false);
    expect(format).not.toHaveBeenCalled();
    expect(err).toBeInstanceOf(Error);
  });

  // ABSENCE ASSERTION — mutation-proven: removing the realpath containment check
  // lands the model in `<tmp>/sibling/frozen_page/index.json` and this fails on
  // the `present` line.
  //
  // Every segment of "customtypes/frozen_page/index.json" is innocuous, so the
  // string-shape check waves it through; `readFile` answers ENOENT at the leaf,
  // so the path reads as PROVEN free; `mkdir -p` follows the link; and `wx`
  // succeeds. The model lands in a sibling directory — another live client repo,
  // in this fleet — and the returned repo-relative path is a lie, with prettier
  // pointed at a name it never touched.
  //
  // Deliberately asymmetric with local.ts, which READS models through symlinks
  // by design: a read through a link returns a file the operator put there, a
  // write through one puts a file somewhere the operator never named.
  it("refuses to write through a symlinked path component that leaves the repo", async () => {
    const repoRoot = join(dir, "repo");
    const sibling = join(dir, "sibling");
    await mkdir(repoRoot, { recursive: true });
    await mkdir(sibling, { recursive: true });
    await symlink(sibling, join(repoRoot, "customtypes"));

    const format = okFormat();
    const err = await refusalFrom(writeModelFile(format, repoRoot, entry, LIB));
    expect(await present(join(sibling, "frozen_page"))).toBe(false);
    expect(format).not.toHaveBeenCalled();
    expect(err?.message).toMatch(/outside this repo/);
  });

  // The other side of that asymmetry: a symlink that stays INSIDE the repo is
  // somebody's deliberate layout, not an escape, and refusing it would break the
  // very repos local.ts reads through links today.
  it("allows a symlinked path component that stays inside the repo", async () => {
    const repoRoot = join(dir, "repo");
    await mkdir(join(repoRoot, "real-customtypes"), { recursive: true });
    await giveOwnPrettier(repoRoot);
    await symlink(join(repoRoot, "real-customtypes"), join(repoRoot, "customtypes"));

    const res = await writeModelFile(okFormat(), repoRoot, entry, LIB);
    expect(
      JSON.parse(
        await readFile(join(repoRoot, "real-customtypes/frozen_page/index.json"), "utf-8"),
      ),
    ).toEqual({
      id: "frozen_page",
      label: "Frozen",
    });
    expect(res.path).toBe("customtypes/frozen_page/index.json");
  });

  // `entry.id` picks the PATH; `model.id` is what every reader of the file keys
  // on afterwards (local.ts reads the body, not the directory). If they
  // disagree, the pulled model reappears as remote-only on the very next run and
  // a second pull writes a second copy — a loop that never converges, in
  // silence. remote.ts's `sendModel` refuses the same mismatch at the other end
  // of the pipeline for the same reason.
  it("refuses an entry whose model body declares a different id", async () => {
    const format = okFormat();
    const err = await refusalFrom(
      writeModelFile(
        format,
        dir,
        { kind: "customtype", id: "frozen_page", model: { id: "catalog_page" } },
        LIB,
      ),
    );
    expect(await present(join(dir, "customtypes"))).toBe(false);
    expect(format).not.toHaveBeenCalled();
    expect(err?.message).toMatch(/catalog_page/);
  });
});

/**
 * The claim the rest of this file only asserts against a double: that the file
 * on disk ends up shaped by the TARGET repo's prettier config, not ours.
 *
 * It runs the real `defaultSpawn` against a fixture repo whose `.prettierrc.json`
 * says `useTabs: true` — which this repo's own config does not, and which the
 * module's 2-space baseline does not. A tab-indented result can only have come
 * from the fixture's configuration, resolved by the executable the fixture owns
 * at the path the module found under the fixture's root.
 *
 * The fixture's shim delegates to this repo's prettier binary because installing
 * a genuinely separate copy would need a network install, and the gate must not
 * do that. That is also exactly how pnpm's own `.bin` shim works — an entry
 * point in the repo pointing at a package in a store — so the thing under test
 * (which entry point the module found, and whose config won) is unchanged.
 */
describe("writeModelFile against a real prettier", () => {
  const OUR_PRETTIER = fileURLToPath(
    new URL("../../../node_modules/.bin/prettier", import.meta.url),
  );

  it("formats with the TARGET's config, not this repo's", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "prismic-write-real-")));
    try {
      const bin = await giveOwnPrettier(
        root,
        `#!/bin/sh\nexec ${JSON.stringify(OUR_PRETTIER)} "$@"\n`,
      );
      await writeFile(join(root, ".prettierrc.json"), JSON.stringify({ useTabs: true }) + "\n");

      // THE REAL BINDING, spelled exactly as an injection site must spell it —
      // this is the one place in the suite where the narrowed capability is tied
      // back to an actual process spawn, so the argv the target's prettier
      // really receives is still asserted rather than assumed.
      const seen: { cmd: string; args: readonly string[] }[] = [];
      const recording: FormatModelFile = (repoRoot, relPaths, opts) =>
        formatWithPrettier(
          (cmd, args, spawnOpts) => {
            seen.push({ cmd, args });
            return defaultSpawn(cmd, args, spawnOpts);
          },
          repoRoot,
          relPaths,
          opts,
        );

      const res = await writeModelFile(
        recording,
        root,
        { kind: "customtype", id: "frozen_page", model: { id: "frozen_page", label: "Frozen" } },
        "./src/lib/slices",
      );

      expect(res.formatted).toBe(true);
      expect(seen).toEqual([{ cmd: bin, args: ["--write", "customtypes/frozen_page/index.json"] }]);
      const raw = await readFile(join(root, res.path), "utf-8");
      expect(raw).toContain('\n\t"id"'); // the FIXTURE's useTabs:true won
      expect(raw).not.toContain('\n  "id"'); // …over the module's 2-space baseline
      expect(JSON.parse(raw)).toEqual({ id: "frozen_page", label: "Frozen" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

// THE SOURCE-LEVEL GUARD FOR THIS FILE LIVES IN index.test.ts.
//
// It used to live here, as an allow-list of the filesystem CAPABILITIES this
// file obtains — the bindings, not the specifiers, because `node:fs/promises`
// has to stay permitted and so a specifier list can never say "may write, may
// not delete". That allow-list is now in `tests/prismic/models/index.test.ts`,
// run over EVERY file in `src/prismic/models/`, and this copy is deleted rather
// than kept in sync: the second guard is always the one that stops being
// updated.
//
// Two things moved and one changed. The bindings walk moved verbatim. The fs
// verb list is now the UNION over the three adapters that touch files (config,
// local, write) rather than write.ts's own five, which means this file could
// take a READ verb the other two already have without the guard firing. Nothing
// that removes a path is on the union either, so the no-delete property is
// unchanged; what is traded away is per-file least privilege, deliberately, so
// that an ordinary edit does not redden a test that must stay credible.
//
// The `spawn("rm", …)` sentinel that also moved there is now close to vestigial,
// and deliberately so: `writeModelFile` no longer TAKES a process spawner. It
// takes {@link FormatModelFile}, the capability it actually needs, so the argv
// is built at the injection site and this module cannot express `rm -rf` at all.
// The 2026-08-13 red team went through that sentinel three ways (`const run =
// spawn`, a helper parameter, a property), which is what a deny-list on a
// callee's SPELLING is worth. Narrowing the signature was the fix; the sentinel
// stays only as a tripwire on the way back. See the header of index.test.ts for
// the full history and for the escape classes that guard does NOT close.
