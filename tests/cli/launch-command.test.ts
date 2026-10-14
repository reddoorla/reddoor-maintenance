import { describe, it, expect } from "vitest";
import { formatStep, runLaunchCommand } from "../../src/cli/commands/launch.js";

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

describe("cli/launch readiness", () => {
  it("renders the readiness step with one line per check and the allow hint", () => {
    const out = formatStep("readiness", {
      kind: "readiness",
      ready: false,
      allowMissing: new Set(["privacy"]),
      lines: [
        { step: "url", state: "ok", detail: "answers 200" },
        { step: "ga-tag", state: "missing", detail: "no tag" },
        { step: "privacy", state: "missing", detail: "404" },
      ],
    });
    expect(out.split("\n").slice(0, 4)).toEqual([
      "readiness            NOT READY",
      "  url             ok         answers 200",
      "  ga-tag          missing    no tag",
      "  privacy         missing    404 (allowed)",
    ]);
    expect(out).toContain("--allow-missing");
  });

  it("refuses an unknown --allow-missing step before touching anything", async () => {
    const r = await runLaunchCommand("acme", { allowMissing: "privcy", cwd: "/nonexistent" });
    expect(r.code).toBe(2);
    expect(r.output).toContain("not a launch-check step");
  });
});
