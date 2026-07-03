import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/reports/preflight.js", () => ({
  preflight: vi.fn(),
}));
import { preflight } from "../../src/reports/preflight.js";
import { runPreflightCommand } from "../../src/cli/commands/preflight.js";

describe("runPreflightCommand", () => {
  it("rejects neither site nor --all (exit 2)", async () => {
    const res = await runPreflightCommand(undefined, {});
    expect(res.code).toBe(2);
    expect(res.output.toLowerCase()).toContain("site");
  });

  it("rejects both site and --all (exit 2)", async () => {
    const res = await runPreflightCommand("acme", { all: true });
    expect(res.code).toBe(2);
  });

  it("rejects an unknown --type (exit 2)", async () => {
    const res = await runPreflightCommand("acme", { type: "launch" });
    expect(res.code).toBe(2);
    expect(res.output).toContain("type");
  });

  it("prints ✓ clean and exits 0 when there are no findings", async () => {
    vi.mocked(preflight).mockResolvedValue({
      results: [{ site: "Acme Co", findings: [] }],
      fleet: [],
    });
    const res = await runPreflightCommand("acme", {});
    expect(res.code).toBe(0);
    expect(res.output).toContain("[Acme Co] ✓ clean");
    expect(res.output).toContain("Safe to send");
    expect(vi.mocked(preflight)).toHaveBeenCalledWith(
      expect.objectContaining({ site: "acme", type: "Announcement" }),
    );
  });

  it("exits 0 with warnings only, but prints them", async () => {
    vi.mocked(preflight).mockResolvedValue({
      results: [
        {
          site: "Acme Co",
          findings: [{ level: "warn", check: "pending-drafts", message: "1 unsent draft(s)" }],
        },
      ],
      fleet: [],
    });
    const res = await runPreflightCommand(undefined, { all: true });
    expect(res.code).toBe(0);
    expect(res.output).toContain("⚠ pending-drafts");
    expect(res.output).toContain("1 warn");
  });

  it("exits 1 on any hard failure, including fleet-level findings in output", async () => {
    vi.mocked(preflight).mockResolvedValue({
      results: [
        {
          site: "Acme Co",
          findings: [{ level: "fail", check: "recipients-missing", message: "no recipients" }],
        },
      ],
      fleet: [{ level: "warn", check: "column-possibly-renamed", message: "'x' empty everywhere" }],
    });
    const res = await runPreflightCommand(undefined, { all: true });
    expect(res.code).toBe(1);
    expect(res.output).toContain("✗ recipients-missing");
    expect(res.output).toContain("[fleet] ⚠ column-possibly-renamed");
    expect(res.output).toContain("NOT safe to send");
  });

  it("exits 1 when no sites match", async () => {
    vi.mocked(preflight).mockResolvedValue({ results: [], fleet: [] });
    const res = await runPreflightCommand("ghost", {});
    expect(res.code).toBe(1);
    expect(res.output).toContain("No matching sites");
  });
});
