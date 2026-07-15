import { describe, it, expect, vi } from "vitest";
import { parseScreenOut, ingestScreenOut } from "../../src/forms/ingest.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

describe("parseScreenOut", () => {
  it("accepts the two valid reasons on the _screenOut key, rejects anything else", () => {
    expect(parseScreenOut({ _screenOut: "honeypot" })).toBe("honeypot");
    expect(parseScreenOut({ _screenOut: "too-fast" })).toBe("too-fast");
    expect(parseScreenOut({ _screenOut: "nope" })).toBeNull();
    expect(parseScreenOut({ name: "Jane" })).toBeNull();
    expect(parseScreenOut(null)).toBeNull();
  });

  it("still accepts the deprecated bare screenOut key (older package versions on sites)", () => {
    // Sites run older @reddoorla/maintenance versions for a while; the central
    // receiver must keep honoring the pre-namespacing wire shape.
    expect(parseScreenOut({ screenOut: "honeypot" })).toBe("honeypot");
    expect(parseScreenOut({ screenOut: "too-fast" })).toBe("too-fast");
    expect(parseScreenOut({ screenOut: "nope" })).toBeNull();
  });

  it("prefers _screenOut when both keys are present", () => {
    expect(parseScreenOut({ _screenOut: "too-fast", screenOut: "honeypot" })).toBe("too-fast");
  });
});

describe("ingestScreenOut", () => {
  it("resolves the site and records the screen-out", async () => {
    const recorded: Array<{ siteId: string; reason: string }> = [];
    const site = makeWebsiteRow({ id: "recSITE" });
    const res = await ingestScreenOut(
      {
        getWebsiteBySlug: async (_s: string): Promise<WebsiteRow | null> => site,
        recordScreenOut: async (siteId, reason) => {
          recorded.push({ siteId, reason });
        },
      },
      "acme",
      "honeypot",
    );
    expect(res.status).toBe("recorded");
    expect(recorded).toEqual([{ siteId: "recSITE", reason: "honeypot" }]);
  });

  it("returns unknown-site without throwing when the slug is unmatched", async () => {
    const res = await ingestScreenOut(
      { getWebsiteBySlug: async () => null, recordScreenOut: vi.fn() },
      "ghost",
      "honeypot",
    );
    expect(res.status).toBe("unknown-site");
  });
});
