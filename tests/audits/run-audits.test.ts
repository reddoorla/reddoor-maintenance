import { describe, it, expect, vi } from "vitest";
import { resolve } from "node:path";

// run-audits is an ORCHESTRATION layer: it validates the requested audit names,
// dispatches each to its registered runner, and aggregates the results. The
// behavior of the individual audits is covered by their own test files
// (deps.test.ts, lint.test.ts, security.test.ts, lighthouse.test.ts,
// a11y.test.ts). So we mock the five audit modules to fast stubs and assert only
// the dispatch/validation/aggregation behavior.
//
// This used to invoke the real lhci + playwright audits against a fixture — a
// single 124s test that *was* the whole suite (morning brief 2026-06-09,
// MEDIUM-5). Mocking the registry keeps the exact same assertions while
// reclaiming ~2 min per `pnpm test`.
function stubAudit(name: string) {
  return vi.fn(async (ctx: { site: { name?: string; path: string } }) => ({
    audit: name,
    site: ctx.site.name ?? ctx.site.path,
    status: "pass",
    summary: "",
  }));
}

vi.mock("../../src/audits/deps.js", () => ({ depsAudit: stubAudit("deps") }));
vi.mock("../../src/audits/lint.js", () => ({ lintAudit: stubAudit("lint") }));
vi.mock("../../src/audits/security.js", () => ({ securityAudit: stubAudit("security") }));
vi.mock("../../src/audits/lighthouse.js", () => ({ lighthouseAudit: stubAudit("lighthouse") }));
vi.mock("../../src/audits/a11y.js", () => ({ a11yAudit: stubAudit("a11y") }));
vi.mock("../../src/audits/domain.js", () => ({ domainAudit: stubAudit("domain") }));
vi.mock("../../src/audits/browser.js", () => ({ browserAudit: stubAudit("browser") }));

import { runAudits, runAuditsAcross } from "../../src/audits/index.js";

describe("runAudits", () => {
  it("dispatches only the requested audit when `which` is restricted", async () => {
    const results = await runAudits({ path: "/fixtures/pristine-starter" }, ["deps"]);
    expect(results).toHaveLength(1);
    expect(results[0]?.audit).toBe("deps");
  });

  it("dispatches all nine audits when `which` is undefined", async () => {
    const results = await runAudits({ path: "/fixtures/pristine-starter" });
    const names = results.map((r) => r.audit).sort();
    expect(names).toEqual([
      "a11y",
      "browser",
      "deps",
      "domain",
      "function-health",
      "lighthouse",
      "lint",
      "netlify-deploy",
      "security",
    ]);
  });

  it("rejects an unknown audit name with a usage error", async () => {
    await expect(() =>
      runAudits({ path: "/fixtures/pristine-starter" }, ["nope" as never]),
    ).rejects.toThrow(/unknown audit/i);
  });
});

describe("runAuditsAcross", () => {
  it("aggregates results from multiple sites", async () => {
    const results = await runAuditsAcross(
      [
        { path: resolve("/fixtures/pristine-starter"), name: "a" },
        { path: resolve("/fixtures/drifted-configs"), name: "b" },
      ],
      ["deps"],
    );
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.site).sort()).toEqual(["a", "b"]);
  });
});
