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
