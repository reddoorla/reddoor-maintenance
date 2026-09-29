import { describe, it, expect } from "vitest";
import { formatStep } from "../../src/cli/commands/launch.js";

describe("cli/launch formatStep", () => {
  it("renders a probe step as an ok line carrying its evidence", () => {
    expect(formatStep("dev-guard", { kind: "probe", message: "404 (site error page)" })).toBe(
      "dev-guard            ok — 404 (site error page)",
    );
  });

  const scores = { performance: 72, accessibility: 100, bestPractices: 100, seo: 100 };

  it("names the deployed url an audit measured", () => {
    expect(
      formatStep("audit", {
        kind: "audit",
        results: [],
        scores,
        deployedUrl: "https://vidalegacy.org/",
      }),
    ).toBe(
      "audit                audited (deployed https://vidalegacy.org/): P=72 A=100 BP=100 SEO=100",
    );
  });

  it("flags an audit measured on the local dev server", () => {
    expect(formatStep("audit", { kind: "audit", results: [], scores, deployedUrl: null })).toBe(
      "audit                audited (local dev server — not a production baseline): P=72 A=100 BP=100 SEO=100",
    );
  });

  it("still renders an error step as an error line", () => {
    expect(formatStep("dev-guard", { kind: "error", message: "live in production" })).toBe(
      "dev-guard            error: live in production",
    );
  });
});
