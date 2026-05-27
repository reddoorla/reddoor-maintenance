import { describe, it, expect, beforeEach } from "vitest";
import { runReportCommand } from "../../src/cli/commands/report.js";

beforeEach(() => {
  process.env.AIRTABLE_PAT = "";
  process.env.AIRTABLE_BASE_ID = "";
});

describe("runReportCommand", () => {
  it("throws a usage error when no slug, no --due, no --send-ready", async () => {
    await expect(runReportCommand(undefined, {})).rejects.toThrow(/Usage:/);
  });

  it("attaches exitCode=2 to the usage error", async () => {
    try {
      await runReportCommand(undefined, {});
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { exitCode?: number }).exitCode).toBe(2);
    }
  });

  it("requires AIRTABLE_PAT for --due", async () => {
    await expect(runReportCommand(undefined, { due: true })).rejects.toThrow(/AIRTABLE_PAT/);
  });

  it("requires AIRTABLE_PAT for <slug>", async () => {
    await expect(runReportCommand("some-site", {})).rejects.toThrow(/AIRTABLE_PAT/);
  });

  it("requires AIRTABLE_PAT for <slug> --preview (still reads Airtable for scores)", async () => {
    await expect(runReportCommand("some-site", { preview: true })).rejects.toThrow(/AIRTABLE_PAT/);
  });

  it("requires AIRTABLE_PAT for --send-ready", async () => {
    await expect(runReportCommand(undefined, { sendReady: true })).rejects.toThrow(/AIRTABLE_PAT/);
  });
});
