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

// a11yRoutes (2026-08-01): the per-site opt-in that lets the a11y audit scan real
// routes instead of only the two synthetic fixtures. Absent key MUST behave exactly
// as before — 11 of the 12 fleet sites carry pre-existing a11y debt, so turning this
// on centrally would red every one of them at once.
describe("readSiteConfig — a11yRoutes", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "reddoor-site-config-a11y-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const write = (reddoor: unknown) =>
    writeFile(join(dir, "package.json"), JSON.stringify({ name: "site", reddoor }));

  it("reads a list of route paths", async () => {
    await write({ a11yRoutes: ["/", "/about", "/rsvp/euphorbia"] });
    expect(await readSiteConfig(dir)).toEqual({ a11yRoutes: ["/", "/about", "/rsvp/euphorbia"] });
  });

  it("omits the key entirely when it is absent", async () => {
    await write({ lighthouseUrl: "https://example.com" });
    expect(await readSiteConfig(dir)).toEqual({ lighthouseUrl: "https://example.com" });
  });

  it("ignores a non-array value", async () => {
    await write({ a11yRoutes: "/about" });
    expect(await readSiteConfig(dir)).toEqual({});
  });

  it("drops non-string and blank entries rather than passing them through", async () => {
    await write({ a11yRoutes: ["/about", "", "   ", 42, null, "/contact"] });
    expect(await readSiteConfig(dir)).toEqual({ a11yRoutes: ["/about", "/contact"] });
  });

  it("omits the key when every entry is junk (never an empty list)", async () => {
    await write({ a11yRoutes: ["", 7] });
    expect(await readSiteConfig(dir)).toEqual({});
  });

  it("trims surrounding whitespace", async () => {
    await write({ a11yRoutes: ["  /about  "] });
    expect(await readSiteConfig(dir)).toEqual({ a11yRoutes: ["/about"] });
  });

  it("coexists with lighthouseUrl", async () => {
    await write({ lighthouseUrl: "https://example.com", a11yRoutes: ["/"] });
    expect(await readSiteConfig(dir)).toEqual({
      lighthouseUrl: "https://example.com",
      a11yRoutes: ["/"],
    });
  });
});
