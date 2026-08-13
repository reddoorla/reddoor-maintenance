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

  // The `your-prismic-repo-name` sentinel ships in the starter and three fleet
  // repos still carry it. Treating it as a real repository name would send a
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

  it("throws when repositoryName is missing or not a string", async () => {
    await mkdir(join(dir, "sub"), { recursive: true });
    await writeFile(
      join(dir, "sub", "slicemachine.config.json"),
      JSON.stringify({ libraries: [] }),
    );
    await expect(readPrismicConfig(join(dir, "sub"))).rejects.toThrow(/repositoryName/);
  });
});
