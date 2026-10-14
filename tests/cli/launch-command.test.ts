import { describe, it, expect } from "vitest";
import { formatStep, readinessDeps, runLaunchCommand } from "../../src/cli/commands/launch.js";
import type { LaunchCheckDeps } from "../../src/recipes/launch-check.js";
import { websiteRowsFrom } from "../_helpers/raw-rows.js";

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

describe("cli/launch readinessDeps", () => {
  it("wires the live check and passes the allowed steps through unchanged", async () => {
    const seen: string[] = [];
    const check: LaunchCheckDeps = {
      subjects: () => null,
      readProperty: async () => ({ ok: true, users: 0 }),
      readStreams: async () => ({ ok: true, measurementIds: [] }),
      probeTag: null,
      fetchPage: async (url) => {
        seen.push(url);
        return { status: 200, url, body: "" };
      },
      readSearch: async () => ({ ok: true, propertyFound: true, property: null }),
    };
    const allow = new Set(["privacy"] as const);
    const d = readinessDeps(check, allow);
    expect(d.allowMissing).toBe(allow);
    const row = websiteRowsFrom([
      { id: "r", fields: { Name: "Acme", url: "https://acme.example.com/" } },
    ])[0]!;
    const lines = await d.readiness(row);
    expect(lines).toHaveLength(8);
    expect(seen).toContain("https://acme.example.com/");
  });
});
