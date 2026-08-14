// tests/prismic/models/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPrismicConfig } from "../../../src/prismic/models/config.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "prismic-config-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readPrismicConfig", () => {
  it("reads repositoryName and libraries from slicemachine.config.json", async () => {
    await writeFile(
      join(dir, "slicemachine.config.json"),
      JSON.stringify({ repositoryName: "gallerysonder", libraries: ["./src/lib/slices"] }),
    );
    expect(await readPrismicConfig(dir)).toEqual({
      repositoryName: "gallerysonder",
      libraries: ["./src/lib/slices"],
    });
  });

  it("also accepts prismic.config.json (the CLI's renamed file)", async () => {
    await writeFile(
      join(dir, "prismic.config.json"),
      JSON.stringify({ repositoryName: "espada", libraries: ["./src/lib/slices"] }),
    );
    expect((await readPrismicConfig(dir))?.repositoryName).toBe("espada");
  });

  it("prefers slicemachine.config.json when both exist (the fleet's live file)", async () => {
    await writeFile(join(dir, "slicemachine.config.json"), JSON.stringify({ repositoryName: "a" }));
    await writeFile(join(dir, "prismic.config.json"), JSON.stringify({ repositoryName: "b" }));
    expect((await readPrismicConfig(dir))?.repositoryName).toBe("a");
  });

  it("returns null when the repo has no Prismic config (data-dynamiq, non-CMS sites)", async () => {
    expect(await readPrismicConfig(dir)).toBeNull();
  });

  it("defaults libraries to ./src/lib/slices when the key is absent", async () => {
    await writeFile(join(dir, "slicemachine.config.json"), JSON.stringify({ repositoryName: "x" }));
    expect((await readPrismicConfig(dir))?.libraries).toEqual(["./src/lib/slices"]);
  });

  // Silently defaulting a malformed value would make every slice on the site
  // invisible, and the sweep would report "this site has no slices" as fact
  // rather than "we could not tell".
  it("THROWS when libraries is present but is not an array of strings", async () => {
    for (const libraries of ["./src/lib/slices", [1, 2], null, { a: 1 }, ["ok", 7]]) {
      await writeFile(
        join(dir, "slicemachine.config.json"),
        JSON.stringify({ repositoryName: "x", libraries }),
      );
      await expect(readPrismicConfig(dir)).rejects.toThrow(
        /slicemachine\.config\.json: libraries is present but is not an array of strings/,
      );
    }
  });

  // An explicitly empty array is a STATEMENT ("no slice libraries here"), not a
  // malformation — it must survive as [] and never be helpfully defaulted.
  it("accepts an explicitly empty libraries array as-is", async () => {
    await writeFile(
      join(dir, "slicemachine.config.json"),
      JSON.stringify({ repositoryName: "x", libraries: [] }),
    );
    expect((await readPrismicConfig(dir))?.libraries).toEqual([]);
  });

  // Untrimmed, " espada " goes into the Types API `repository` header verbatim
  // and 404s — which reads as "that Prismic repo does not exist" and sends the
  // operator hunting the wrong problem.
  it("trims whitespace off repositoryName on the way out", async () => {
    await writeFile(
      join(dir, "slicemachine.config.json"),
      JSON.stringify({ repositoryName: "  espada  " }),
    );
    expect((await readPrismicConfig(dir))?.repositoryName).toBe("espada");
  });

  // The `your-prismic-repo-name` sentinel ships in the starter; measured
  // 2026-08-12, 2 of the 17 local checkouts that carry a Prismic config still
  // have it. Treating it as a real repository name would send a
  // sweep at a repo that does not exist and report the 404 as drift.
  it("returns null for the unreplaced starter sentinel", async () => {
    await writeFile(
      join(dir, "slicemachine.config.json"),
      JSON.stringify({ repositoryName: "your-prismic-repo-name" }),
    );
    expect(await readPrismicConfig(dir)).toBeNull();
  });

  // The Prismic CLI's migration RENAMES slicemachine.config.json to
  // prismic.config.json, so a half-migrated repo holds a stale sentinel in the
  // first file and its real configuration in the second. Stopping at the first
  // sentinel would drop a LIVE site from the sweep on the strength of a file
  // nobody uses any more.
  it("keeps looking when the first candidate holds the sentinel", async () => {
    await writeFile(
      join(dir, "slicemachine.config.json"),
      JSON.stringify({ repositoryName: "your-prismic-repo-name" }),
    );
    await writeFile(
      join(dir, "prismic.config.json"),
      JSON.stringify({ repositoryName: "b", libraries: ["./src/lib/blux"] }),
    );
    expect(await readPrismicConfig(dir)).toEqual({
      repositoryName: "b",
      libraries: ["./src/lib/blux"],
    });
  });

  it("returns null only once EVERY candidate holds the sentinel", async () => {
    for (const f of ["slicemachine.config.json", "prismic.config.json"]) {
      await writeFile(join(dir, f), JSON.stringify({ repositoryName: "your-prismic-repo-name" }));
    }
    expect(await readPrismicConfig(dir)).toBeNull();
  });

  // Trim happens before the sentinel comparison, or a stray space would turn an
  // unconfigured starter into a "real" repository name and point a sweep at it.
  it("treats a whitespace-padded sentinel as the sentinel", async () => {
    await writeFile(
      join(dir, "slicemachine.config.json"),
      JSON.stringify({ repositoryName: "  your-prismic-repo-name  " }),
    );
    expect(await readPrismicConfig(dir)).toBeNull();
  });

  it("throws on malformed JSON rather than silently treating the repo as non-Prismic", async () => {
    await writeFile(join(dir, "slicemachine.config.json"), "{ not json");
    await expect(readPrismicConfig(dir)).rejects.toThrow(/slicemachine\.config\.json/);
  });

  // Losing one model file loses one model; losing the CONFIG makes a live
  // Prismic site read as "not a Prismic site" and drop out of the sweep, which
  // then reports success. Only a proven absence (ENOENT) may return null.
  it("THROWS when the config is present but unreadable", async () => {
    await mkdir(join(dir, "slicemachine.config.json"), { recursive: true });
    await expect(readPrismicConfig(dir)).rejects.toThrow(/present but unreadable/);
  });

  // An unreadable first candidate must not fall through to a readable second one,
  // or the site is swept against whichever file happened to be readable.
  it("does not fall through to prismic.config.json when the first is unreadable", async () => {
    await mkdir(join(dir, "slicemachine.config.json"), { recursive: true });
    await writeFile(join(dir, "prismic.config.json"), JSON.stringify({ repositoryName: "b" }));
    await expect(readPrismicConfig(dir)).rejects.toThrow(/present but unreadable/);
  });

  // Same class as the unreadable case: it already threw, but with a bare
  // TypeError naming neither the file nor the repo — useless mid-fleet-sweep.
  it("throws NAMING THE FILE when the config parses to null or an array", async () => {
    for (const raw of ["null", "[]", '"a string"']) {
      await writeFile(join(dir, "slicemachine.config.json"), raw);
      await expect(readPrismicConfig(dir)).rejects.toThrow(
        /slicemachine\.config\.json: not a JSON object/,
      );
    }
  });

  it("throws when repositoryName is missing or not a string", async () => {
    await mkdir(join(dir, "sub"), { recursive: true });
    await writeFile(
      join(dir, "sub", "slicemachine.config.json"),
      JSON.stringify({ libraries: [] }),
    );
    await expect(readPrismicConfig(join(dir, "sub"))).rejects.toThrow(/repositoryName/);
  });
});
