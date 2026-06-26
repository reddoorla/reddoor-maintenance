import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/recipes/selftest-email.js", () => ({
  selftestEmail: vi.fn(),
}));
import { selftestEmail } from "../../src/recipes/selftest-email.js";
import { runSelftestCommand } from "../../src/cli/commands/selftest.js";

describe("runSelftestCommand", () => {
  it("rejects an unknown kind (exit 2)", async () => {
    const res = await runSelftestCommand("forms", undefined, {});
    expect(res.code).toBe(2);
    expect(res.output).toContain("Unknown selftest kind");
  });

  it("rejects neither site nor --all (exit 2)", async () => {
    const res = await runSelftestCommand("email", undefined, {});
    expect(res.code).toBe(2);
    expect(res.output.toLowerCase()).toContain("site");
  });

  it("rejects both site and --all (exit 2)", async () => {
    const res = await runSelftestCommand("email", "acme", { all: true });
    expect(res.code).toBe(2);
  });

  it("rejects an unknown --type (exit 2)", async () => {
    const res = await runSelftestCommand("email", "acme", { type: "bogus" });
    expect(res.code).toBe(2);
    expect(res.output).toContain("type");
  });

  it("delegates to selftestEmail and formats per-site results", async () => {
    vi.mocked(selftestEmail).mockResolvedValue({
      results: [{ site: "Acme Co", status: "sent", subject: "S", recipients: ["me@x.com"] }],
    });
    const res = await runSelftestCommand("email", "acme", { to: "me@x.com" });
    expect(res.code).toBe(0);
    expect(res.output).toContain("Acme Co");
    expect(res.output).toContain("sent");
    expect(vi.mocked(selftestEmail)).toHaveBeenCalledWith(
      expect.objectContaining({ site: "acme", type: "Announcement", to: "me@x.com" }),
    );
  });

  it("returns exit 1 when any site errored", async () => {
    vi.mocked(selftestEmail).mockResolvedValue({
      results: [{ site: "Bad Co", status: "error", message: "boom" }],
    });
    const res = await runSelftestCommand("email", undefined, { all: true });
    expect(res.code).toBe(1);
  });
});
