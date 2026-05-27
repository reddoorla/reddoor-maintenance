import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSiteConfig } from "../../../src/audits/util/site-config.js";

describe("readSiteConfig", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "reddoor-site-config-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns {} when no package.json exists", async () => {
    expect(await readSiteConfig(dir)).toEqual({});
  });

  it("returns {} when package.json is malformed JSON", async () => {
    await writeFile(join(dir, "package.json"), "{ not valid json");
    expect(await readSiteConfig(dir)).toEqual({});
  });

  it("returns {} when package.json has no reddoor key", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "x" }));
    expect(await readSiteConfig(dir)).toEqual({});
  });

  it("returns {} when reddoor is the wrong type (string instead of object)", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ reddoor: "nope" }));
    expect(await readSiteConfig(dir)).toEqual({});
  });

  it("extracts lighthouseUrl when present", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ reddoor: { lighthouseUrl: "http://localhost:5173/" } }),
    );
    expect(await readSiteConfig(dir)).toEqual({ lighthouseUrl: "http://localhost:5173/" });
  });

  // Guard against an operator clearing the field but leaving the key (`""`)
  // and expecting fallback — empty strings produce no useful URL.
  it("ignores empty-string lighthouseUrl (falls back to default)", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ reddoor: { lighthouseUrl: "" } }));
    expect(await readSiteConfig(dir)).toEqual({});
  });

  it("ignores non-string lighthouseUrl values", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ reddoor: { lighthouseUrl: 42 } }));
    expect(await readSiteConfig(dir)).toEqual({});
  });
});
