// tests/prismic/models/write.test.ts
import { readFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { writeModelFile, modelFilePath } from "../../../src/prismic/models/write.js";
import type { SpawnFn } from "../../../src/audits/util/spawn.js";
import type { RemoteEntry } from "../../../src/prismic/models/types.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "prismic-write-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const LIB = "./src/lib/slices";

/** Spawn doubles, TYPED as `SpawnFn`. A bare `vi.fn(async () => …)` is
 *  `Mock<Procedure | Constructable>`, which vitest runs happily and `tsc`
 *  rejects — the split this plan warns about, hit here on the first gate. */
const okSpawn = (): Mock<SpawnFn> =>
  vi.fn<SpawnFn>(async () => ({ code: 0, stdout: "", stderr: "" }));
const exitingSpawn = (code: number): Mock<SpawnFn> =>
  vi.fn<SpawnFn>(async () => ({ code, stdout: "", stderr: "not found" }));
const throwingSpawn = (): Mock<SpawnFn> =>
  vi.fn<SpawnFn>(async () => {
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
    const spawn = okSpawn();
    const res = await writeModelFile(spawn, dir, entry, LIB);
    expect(res.path).toBe("customtypes/frozen_page/index.json");
    expect(JSON.parse(await readFile(join(dir, res.path), "utf-8"))).toEqual({
      id: "frozen_page",
      label: "Frozen",
    });
  });

  // THE TRAP. The first pull-down PR failed CI on `prettier --check` for
  // customtypes/frozen_page/index.json while catalog_page/index.json — generated
  // by the identical code path in the same run — passed. Formatting is
  // content-dependent, so no canonical JSON.stringify shape is safe. The fleet is
  // useTabs:true and prettier is enforced on every file in CI.
  it("formats the written file with the TARGET REPO's own prettier", async () => {
    const spawn = okSpawn();
    await writeModelFile(spawn, dir, entry, LIB);
    expect(spawn).toHaveBeenCalledWith(
      "pnpm",
      ["exec", "prettier", "--write", "customtypes/frozen_page/index.json"],
      { cwd: dir },
    );
  });

  it("reports formatted:false (never throws) when prettier is unavailable", async () => {
    const res = await writeModelFile(throwingSpawn(), dir, entry, LIB);
    expect(res.formatted).toBe(false);
    expect(JSON.parse(await readFile(join(dir, res.path), "utf-8"))).toMatchObject({
      id: "frozen_page",
    });
  });

  // A repo whose node_modules are not installed, or one on a prettier that
  // rejects the file, exits non-zero rather than throwing — a different channel
  // to the same fact, and the caller keys its "(unformatted)" flag off this one
  // boolean, so both channels have to reach it.
  it("reports formatted:false when prettier exits non-zero", async () => {
    const res = await writeModelFile(exitingSpawn(2), dir, entry, LIB);
    expect(res.formatted).toBe(false);
    expect(JSON.parse(await readFile(join(dir, res.path), "utf-8"))).toMatchObject({
      id: "frozen_page",
    });
  });

  it("reports formatted:true on a clean prettier run", async () => {
    expect((await writeModelFile(okSpawn(), dir, entry, LIB)).formatted).toBe(true);
  });

  it("writes tab-indented JSON with a trailing newline as the pre-prettier baseline", async () => {
    const res = await writeModelFile(okSpawn(), dir, entry, LIB);
    const raw = await readFile(join(dir, res.path), "utf-8");
    expect(raw).toContain("\n\t");
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
    const spawn = okSpawn();
    const occupied = "src/lib/slices/ContentWidthMedia/model.json";
    await mkdir(join(dir, "src/lib/slices/ContentWidthMedia"), { recursive: true });
    await writeFile(
      join(dir, occupied),
      JSON.stringify({ id: "video_block", type: "SharedSlice" }, null, "\t") + "\n",
    );

    const err = await refusalFrom(writeModelFile(spawn, dir, slice("content_width_media"), LIB));
    expect(JSON.parse(await readFile(join(dir, occupied), "utf-8"))).toEqual({
      id: "video_block",
      type: "SharedSlice",
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(err?.message).toMatch(/video_block/);
  });

  // The same-id case is the one legitimate overwrite: refreshing a model from
  // Prismic replaces the model it names, not somebody else's.
  it("overwrites a file that declares the SAME model id", async () => {
    const rel = "customtypes/frozen_page/index.json";
    await mkdir(join(dir, "customtypes/frozen_page"), { recursive: true });
    await writeFile(join(dir, rel), JSON.stringify({ id: "frozen_page", label: "Stale" }));
    const res = await writeModelFile(okSpawn(), dir, entry, LIB);
    expect(res.formatted).toBe(true);
    expect(JSON.parse(await readFile(join(dir, res.path), "utf-8"))).toEqual({
      id: "frozen_page",
      label: "Frozen",
    });
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
    const err = await refusalFrom(writeModelFile(okSpawn(), dir, entry, LIB));
    expect(await readFile(join(dir, rel), "utf-8")).toBe("{ not json");
    expect(err?.message).toMatch(/is not valid JSON/);
  });

  it("refuses to overwrite a JSON file that declares no id", async () => {
    const rel = "customtypes/frozen_page/index.json";
    await mkdir(join(dir, "customtypes/frozen_page"), { recursive: true });
    await writeFile(join(dir, rel), JSON.stringify({ label: "who am i" }));
    const err = await refusalFrom(writeModelFile(okSpawn(), dir, entry, LIB));
    expect(JSON.parse(await readFile(join(dir, rel), "utf-8"))).toEqual({ label: "who am i" });
    expect(err?.message).toMatch(/declares no string "id"/);
  });

  it("refuses when a DIRECTORY sits where the model file goes", async () => {
    await mkdir(join(dir, "customtypes/frozen_page/index.json"), { recursive: true });
    await expect(writeModelFile(okSpawn(), dir, entry, LIB)).rejects.toThrow();
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
    const err = await refusalFrom(writeModelFile(okSpawn(), dir, entry, LIB));
    expect(await present(join(dir, "nowhere.json"))).toBe(false);
    expect(err).toBeInstanceOf(Error);
  });

  // ABSENCE ASSERTION — mutation-proven: dropping the path-shape guard in
  // modelFilePath writes the model into `<tmp>/outside/Hero/model.json`, which is
  // a sibling of the repo — and every sibling of a repo in this fleet is another
  // LIVE CLIENT REPO.
  it("never writes outside the repo root", async () => {
    const repoRoot = join(dir, "repo");
    await mkdir(repoRoot, { recursive: true });
    const spawn = okSpawn();
    const err = await refusalFrom(writeModelFile(spawn, repoRoot, slice("hero"), "../outside"));
    expect(await present(join(dir, "outside"))).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    expect(err).toBeInstanceOf(Error);
  });

  // `entry.id` picks the PATH; `model.id` is what every reader of the file keys
  // on afterwards (local.ts reads the body, not the directory). If they
  // disagree, the pulled model reappears as remote-only on the very next run and
  // a second pull writes a second copy — a loop that never converges, in
  // silence. remote.ts's `sendModel` refuses the same mismatch at the other end
  // of the pipeline for the same reason.
  it("refuses an entry whose model body declares a different id", async () => {
    const spawn = okSpawn();
    const err = await refusalFrom(
      writeModelFile(
        spawn,
        dir,
        { kind: "customtype", id: "frozen_page", model: { id: "catalog_page" } },
        LIB,
      ),
    );
    expect(await present(join(dir, "customtypes"))).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    expect(err?.message).toMatch(/catalog_page/);
  });
});

// An ALLOW-LIST of filesystem verbs, not a "this file has no delete" check. The
// negative form of this test has already reported PASS in this codebase with a
// working DELETE sitting in the file, because it enumerated the names it feared
// instead of the names it permits.
//
// It matters here specifically: pull-down is the SAFE answer to a remote-only
// model — the alternative being deletion, which this design forbids — so the
// module that answers it must not itself grow the ability to remove things.
//
// Verified 2026-08-13 by mutation, one at a time, each applied to write.ts and
// reverted: adding `rm` to the fs import, and smuggling `node:fs` in through a
// dynamic `import()`. Both turn this test red.
describe("write.ts channels", () => {
  const source = readFileSync(
    new URL("../../../src/prismic/models/write.ts", import.meta.url),
    "utf-8",
  );
  const sf = ts.createSourceFile(
    "write.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const fsBindings: string[] = [];
  const specifiers: string[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteralLike(n.moduleSpecifier)) {
      const spec = n.moduleSpecifier.text;
      specifiers.push(spec);
      const clause = n.importClause;
      if (spec.startsWith("node:fs") && clause !== undefined && !clause.isTypeOnly) {
        // A default or namespace import would expose every verb under one name,
        // so it is recorded as a binding rather than ignored — the equality
        // below then fails, which is the intended answer.
        if (clause.name) fsBindings.push(`default as ${clause.name.text}`);
        const bound = clause.namedBindings;
        if (bound && ts.isNamespaceImport(bound)) fsBindings.push(`* as ${bound.name.text}`);
        if (bound && ts.isNamedImports(bound)) {
          for (const el of bound.elements) {
            if (!el.isTypeOnly) fsBindings.push((el.propertyName ?? el.name).text);
          }
        }
      }
    }
    if (
      ts.isExportDeclaration(n) &&
      n.moduleSpecifier &&
      ts.isStringLiteralLike(n.moduleSpecifier)
    ) {
      specifiers.push(n.moduleSpecifier.text);
    }
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const smuggler =
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && (callee.text === "require" || callee.text === "createRequire"));
      if (smuggler) {
        const arg = n.arguments[0];
        specifiers.push(arg !== undefined && ts.isStringLiteralLike(arg) ? arg.text : "<computed>");
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);

  it("imports exactly three filesystem verbs — none of them destructive", () => {
    expect([...fsBindings].sort()).toEqual(["mkdir", "readFile", "writeFile"]);
  });

  it("names only the modules on its allow-list, by any mechanism", () => {
    expect([...new Set(specifiers)].sort()).toEqual([
      "../../audits/util/spawn.js",
      "../../recipes/_prettier.js",
      "./types.js",
      "node:fs/promises",
      "node:path",
    ]);
  });
});
