import { describe, it, expect } from "vitest";
import { runLighthouse, type LighthouseDeps } from "../../src/prospect/lighthouse.js";
import type { AuditResult } from "../../src/types.js";

const HOME = "https://acme.example/";

const stubDeps = (result: AuditResult): LighthouseDeps => ({
  async audit() {
    return result;
  },
});

describe("runLighthouse", () => {
  it("maps the four category keys and rounds 0..1 to 0..100", async () => {
    const scores = await runLighthouse(
      HOME,
      stubDeps({
        audit: "lighthouse",
        site: "acme.example",
        status: "pass",
        summary: "lighthouse: all categories passing",
        details: {
          summary: { performance: 0.8, accessibility: 0.9, "best-practices": 0.7, seo: 1 },
        },
      }),
    );
    expect(scores).toEqual({
      performance: 80,
      accessibility: 90,
      bestPractices: 70,
      seo: 100,
      summary: "lighthouse: all categories passing",
      status: "pass",
    });
  });

  it("throws when the audit status is skip", async () => {
    await expect(
      runLighthouse(
        HOME,
        stubDeps({
          audit: "lighthouse",
          site: "acme.example",
          status: "skip",
          summary: "npx/@lhci/cli not available",
        }),
      ),
    ).rejects.toThrow("npx/@lhci/cli not available");
  });

  it("throws when the audit produced no details (no lhr-*.json written)", async () => {
    await expect(
      runLighthouse(
        HOME,
        stubDeps({
          audit: "lighthouse",
          site: "acme.example",
          status: "fail",
          summary: "lighthouse: no lhr-*.json written (exit 1)",
        }),
      ),
    ).rejects.toThrow("lighthouse: no lhr-*.json written (exit 1)");
  });

  it("returns real scores for a fail status rather than throwing", async () => {
    const scores = await runLighthouse(
      HOME,
      stubDeps({
        audit: "lighthouse",
        site: "acme.example",
        status: "fail",
        summary: "lighthouse: 1 assertion(s) failed",
        details: {
          summary: { performance: 0.4, accessibility: 0.9, "best-practices": 0.9, seo: 0.9 },
        },
      }),
    );
    expect(scores.status).toBe("fail");
    expect(scores.performance).toBe(40);
    expect(scores.accessibility).toBe(90);
  });
});
