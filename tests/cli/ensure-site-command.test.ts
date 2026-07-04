import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/reports/airtable/ensure-site.js", () => ({ ensureSite: vi.fn() }));
vi.mock("../../src/reports/airtable/client.js", () => ({
  openBase: vi.fn(() => "FAKE_BASE"),
  readAirtableConfig: vi.fn(() => ({ apiKey: "k", baseId: "b" })),
}));
import { ensureSite } from "../../src/reports/airtable/ensure-site.js";
import { runEnsureSiteCommand } from "../../src/cli/commands/ensure-site.js";

describe("runEnsureSiteCommand", () => {
  it("rejects a missing slug (exit 2)", async () => {
    const res = await runEnsureSiteCommand(undefined, {});
    expect(res.code).toBe(2);
    expect(res.output.toLowerCase()).toContain("slug");
  });

  it("reports a created row", async () => {
    vi.mocked(ensureSite).mockResolvedValue({
      status: "created",
      siteId: "recNEW",
      updatedFields: [],
      skippedMismatches: [],
    });
    const res = await runEnsureSiteCommand("roalson", {
      name: "Roalson",
      url: "https://roalson.netlify.app",
      contact: "owner@roalson.com",
      gitRepo: "reddoorla/custom",
    });
    expect(res.code).toBe(0);
    expect(res.output).toContain("created");
    expect(vi.mocked(ensureSite)).toHaveBeenCalledWith(
      "FAKE_BASE",
      expect.objectContaining({
        slug: "roalson",
        displayName: "Roalson",
        url: "https://roalson.netlify.app",
        pointOfContact: "owner@roalson.com",
        gitRepo: "reddoorla/custom",
      }),
    );
  });

  it("reports exists + which blanks were filled", async () => {
    vi.mocked(ensureSite).mockResolvedValue({
      status: "exists",
      siteId: "recEXIST",
      updatedFields: ["url"],
      skippedMismatches: [],
    });
    const res = await runEnsureSiteCommand("acme-co", {});
    expect(res.code).toBe(0);
    expect(res.output).toContain("exists");
    expect(res.output).toContain("url");
  });

  it("tells the operator when inputs differ from existing cells", async () => {
    vi.mocked(ensureSite).mockResolvedValue({
      status: "exists",
      siteId: "recEXIST",
      updatedFields: [],
      skippedMismatches: ["url"],
    });
    const res = await runEnsureSiteCommand("acme-co", { url: "https://x.example.com" });
    expect(res.output).toContain("left untouched");
    expect(res.output).toContain("url");
  });

  it("warns that a bare-slug create leaves a machine Name in client-facing copy", async () => {
    vi.mocked(ensureSite).mockResolvedValue({
      status: "created",
      siteId: "recNEW",
      updatedFields: [],
      skippedMismatches: [],
    });
    const res = await runEnsureSiteCommand("roalson", {});
    expect(res.output).toContain("retitle in Airtable");
  });

  it("surfaces errors as exit 1", async () => {
    vi.mocked(ensureSite).mockRejectedValue(new Error("boom"));
    const res = await runEnsureSiteCommand("bad", {});
    expect(res.code).toBe(1);
    expect(res.output).toContain("boom");
  });
});
