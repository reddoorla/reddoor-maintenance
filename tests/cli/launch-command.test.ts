import { describe, it, expect } from "vitest";
import { formatStep } from "../../src/cli/commands/launch.js";

describe("cli/launch formatStep", () => {
  it("renders a probe step as an ok line carrying its evidence", () => {
    expect(formatStep("dev-guard", { kind: "probe", message: "404 (site error page)" })).toBe(
      "dev-guard            ok — 404 (site error page)",
    );
  });

  it("still renders an error step as an error line", () => {
    expect(formatStep("dev-guard", { kind: "error", message: "live in production" })).toBe(
      "dev-guard            error: live in production",
    );
  });
});
