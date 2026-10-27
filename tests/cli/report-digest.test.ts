import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("runReportCommand --digest routing", () => {
  it("routes --digest to runDigest with the dashboard base URL and returns its result", async () => {
    const runDigest = vi.fn(async () => ({ output: "Digest sent to ops@reddoorla.com", code: 0 }));
    vi.doMock("../../src/reports/digest.js", () => ({ runDigest }));
    const { runReportCommand } = await import("../../src/cli/commands/report.js");

    const res = await runReportCommand(undefined, { digest: true });

    expect(runDigest).toHaveBeenCalledTimes(1);
    // baseUrl must be passed through (the digest links to /s/<slug>).
    expect(runDigest).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: expect.any(String) }),
    );
    expect(res).toEqual({ output: "Digest sent to ops@reddoorla.com", code: 0 });
  });

  it("takes precedence over --due so the daily workflow can run both as separate invocations", async () => {
    const runDigest = vi.fn(async () => ({ output: "ok", code: 0 }));
    vi.doMock("../../src/reports/digest.js", () => ({ runDigest }));
    const { runReportCommand } = await import("../../src/cli/commands/report.js");
    await runReportCommand(undefined, { digest: true, due: true });
    expect(runDigest).toHaveBeenCalledTimes(1);
  });

  it("uses DASHBOARD_BASE_URL env override when set", async () => {
    process.env.DASHBOARD_BASE_URL = "https://custom.example.com";
    try {
      const runDigest = vi.fn(async () => ({ output: "ok", code: 0 }));
      vi.doMock("../../src/reports/digest.js", () => ({ runDigest }));
      const { runReportCommand } = await import("../../src/cli/commands/report.js");

      await runReportCommand(undefined, { digest: true });

      expect(runDigest).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: "https://custom.example.com" }),
      );
    } finally {
      delete process.env.DASHBOARD_BASE_URL;
    }
  });

  it("usage error mentions --digest", async () => {
    vi.doMock("../../src/reports/digest.js", () => ({ runDigest: vi.fn() }));
    const { runReportCommand } = await import("../../src/cli/commands/report.js");
    await expect(runReportCommand(undefined, {})).rejects.toThrow(/--digest/);
  });
});
