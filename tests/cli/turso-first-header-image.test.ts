import { describe, it, expect, beforeEach, vi } from "vitest";

const shared = vi.hoisted(() => ({ log: [] as string[], uploadFails: false }));

vi.mock("../../src/reports/airtable/attachments.js", () => ({
  uploadAttachment: vi.fn(async (recordId: string, field: string) => {
    shared.log.push(`airtable:${recordId}:${field}`);
    if (shared.uploadFails) {
      throw new Error("Airtable upload failed: 429 Too Many Requests quota exhausted");
    }
  }),
}));

import { generateForTargets } from "../../src/cli/commands/header-image.js";
import { uploadAttachment } from "../../src/reports/airtable/attachments.js";
import type { StoredHeaderImage } from "../../src/db/header-images.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

vi.mock("../../src/db/freeze.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/freeze.js")>()),
  AIRTABLE_SHADOW_WRITES: true,
}));

const BYTES = new Uint8Array([9, 9, 9]);
const gen = async () => ({
  bytes: BYTES,
  domain: "acme.com",
  filename: "acmeHeader.jpg",
  contentType: "image/jpeg" as const,
});

beforeEach(() => {
  shared.log = [];
  shared.uploadFails = false;
  vi.mocked(uploadAttachment).mockClear();
});

async function writeBack() {
  const stored: Array<{ siteId: string; img: StoredHeaderImage }> = [];
  const res = await generateForTargets(
    [makeWebsiteRow({ id: "recAcme", name: "Acme" })],
    {
      writeBack: true,
      storeDb: async (siteId, img) => {
        shared.log.push(`turso:${siteId}`);
        stored.push({ siteId, img });
      },
    },
    gen,
  );
  return { res, stored };
}

describe("header-image --write-back stores the plate in Turso before the Airtable upload", () => {
  it("Turso first, then the same bytes to Airtable (known-good control)", async () => {
    const { res, stored } = await writeBack();
    expect(shared.log).toEqual(["turso:recAcme", "airtable:recAcme:Header image"]);
    expect(stored[0]!.img).toMatchObject({
      bytes: BYTES,
      filename: "acmeHeader.jpg",
      contentType: "image/jpeg",
    });
    expect(uploadAttachment).toHaveBeenCalledWith(
      "recAcme",
      "Header image",
      BYTES,
      "acmeHeader.jpg",
      "image/jpeg",
      { replaceIn: "Websites" },
    );
    expect(res).toMatchObject({ code: 0 });
    expect(res.output).toContain("+ turso");
  });

  it("a failed upload still lands the plate in Turso, and still fails the site and the run", async () => {
    shared.uploadFails = true;
    const { res, stored } = await writeBack();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.siteId).toBe("recAcme");
    expect(stored[0]!.img.bytes).toBe(BYTES);
    expect(res.code).toBe(1);
    expect(res.output).toContain(
      "✖ Acme — Airtable upload failed: 429 Too Many Requests quota exhausted",
    );
    expect(res.output).toContain("0/1 generated.");
  });
});
