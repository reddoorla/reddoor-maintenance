import { describe, it, expect, vi } from "vitest";

// The dual-write tests drive the writeAirtable branch — stub the real upload.
vi.mock("../../src/reports/airtable/attachments.js", () => ({
  uploadAttachment: vi.fn(async () => undefined),
}));
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

describe("cli/header-image dual-write (#539 D5)", () => {
  const gen = async () => ({
    bytes: new Uint8Array([9, 9, 9]),
    domain: "acme.com",
    filename: "acmeHeader.jpg",
    contentType: "image/jpeg" as const,
  });

  it("writeAirtable also lands the bytes in the injected Turso store, stamped as a generation", async () => {
    const stores: Array<{ siteId: string; filename: string; generatedAt: string | null }> = [];
    const res = await generateForTargets(
      [row({ name: "Acme" })],
      {
        writeAirtable: true,
        storeDb: async (siteId, img) => {
          stores.push({ siteId, filename: img.filename, generatedAt: img.generatedAt });
        },
      },
      gen,
    );
    expect(res.code).toBe(0);
    expect(stores).toHaveLength(1);
    expect(stores[0]!.filename).toBe("acmeHeader.jpg");
    expect(stores[0]!.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.output).toContain("+ turso");
  });

  it("a Turso store failure is VISIBLE but does not void the Airtable upload", async () => {
    const res = await generateForTargets(
      [row({ name: "Acme" })],
      {
        writeAirtable: true,
        storeDb: async () => {
          throw new Error("turso down");
        },
      },
      gen,
    );
    expect(res.code).toBe(0); // the Airtable upload succeeded
    expect(res.output).toContain("turso store FAILED: turso down");
  });
});
