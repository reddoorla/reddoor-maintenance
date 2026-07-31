import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveTargets,
  generateForTargets,
  parseSettleMs,
} from "../../src/cli/commands/header-image.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";

function row(over: Partial<WebsiteRow>): WebsiteRow {
  return {
    id: "rec1",
    name: "Acme",
    url: "https://acme.com/",
    status: "maintenance",
    headerImage: null,
    ...over,
  } as WebsiteRow;
}

describe("cli/header-image resolveTargets", () => {
  it("selects one site by slug", () => {
    const rows = [row({ name: "Acme" }), row({ id: "rec2", name: "Other" })];
    expect(resolveTargets(rows, { site: "acme" }).map((r) => r.name)).toEqual(["Acme"]);
  });

  it("with --all, selects only live sites missing a header image", () => {
    const rows = [
      row({
        id: "a",
        name: "HasOne",
        headerImage: { url: "u", filename: "f", type: "image/jpeg" },
      }),
      row({ id: "b", name: "NeedsOne" }),
      row({ id: "c", name: "Archived", status: "deprecated" }),
      row({ id: "d", name: "NoUrl", url: "" }),
    ];
    expect(resolveTargets(rows, { all: true }).map((r) => r.name)).toEqual(["NeedsOne"]);
  });

  it("with --all --force, includes sites that already have one", () => {
    const rows = [
      row({
        id: "a",
        name: "HasOne",
        headerImage: { url: "u", filename: "f", type: "image/jpeg" },
      }),
      row({ id: "b", name: "NeedsOne" }),
    ];
    expect(resolveTargets(rows, { all: true, force: true }).map((r) => r.name)).toEqual([
      "HasOne",
      "NeedsOne",
    ]);
  });

  it("returns nothing for an unknown slug", () => {
    expect(resolveTargets([row({ name: "Acme" })], { site: "nope" })).toEqual([]);
  });
});

describe("cli/header-image parseSettleMs", () => {
  it("rejects a non-numeric --settle-ms instead of passing NaN through", () => {
    expect(() => parseSettleMs("abc")).toThrow(/--settle-ms must be a non-negative number/);
  });

  it("accepts a number and passes undefined through", () => {
    expect(parseSettleMs("2500")).toBe(2500);
    expect(parseSettleMs(undefined)).toBeUndefined();
  });
});

describe("cli/header-image generateForTargets", () => {
  it("creates the output directory — a fresh checkout has no reports/", async () => {
    const dir = await mkdtemp(join(tmpdir(), "header-image-out-"));
    const outDir = join(dir, "reports");
    expect(existsSync(outDir)).toBe(false);

    const res = await generateForTargets([row({ name: "Acme" })], { outDir }, async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      domain: "acme.com",
      filename: "acmeHeader.jpg",
      contentType: "image/jpeg",
    }));

    expect(res.code).toBe(0);
    expect(await readFile(join(outDir, "acmeHeader.jpg"))).toEqual(Buffer.from([1, 2, 3]));
    await rm(dir, { recursive: true, force: true });
  });
});
