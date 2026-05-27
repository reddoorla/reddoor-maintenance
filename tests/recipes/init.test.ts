import { describe, it, expect } from "vitest";
import { init, type InitStep } from "../../src/recipes/init.js";
import type { RecipeResult, AuditResult, Site } from "../../src/types.js";

function siteOf(): Site {
  return { path: "/fake/site", name: "test-site" };
}

function ok(recipeName: RecipeResult["recipe"], commits: string[] = ["abc123"]): InitStep {
  return {
    name: recipeName,
    run: async () => ({
      kind: "recipe",
      result: {
        recipe: recipeName,
        site: "test-site",
        status: "applied",
        commits,
        notes: "branch: maint/foo-1",
      },
    }),
  };
}

function noop(recipeName: RecipeResult["recipe"]): InitStep {
  return {
    name: recipeName,
    run: async () => ({
      kind: "recipe",
      result: { recipe: recipeName, site: "test-site", status: "noop", commits: [] },
    }),
  };
}

function failed(recipeName: RecipeResult["recipe"], notes: string): InitStep {
  return {
    name: recipeName,
    run: async () => ({
      kind: "recipe",
      result: { recipe: recipeName, site: "test-site", status: "failed", commits: [], notes },
    }),
  };
}

function thrower(name: string, message: string): InitStep {
  return {
    name,
    run: async () => {
      throw new Error(message);
    },
  };
}

function auditStep(name: string, results: AuditResult[]): InitStep {
  return { name, run: async () => ({ kind: "audit", results }) };
}

describe("recipes/init", () => {
  it("runs every step in order and reports complete=true when all succeed", async () => {
    const calls: string[] = [];
    const tracker = (name: string): InitStep => ({
      name,
      run: async () => {
        calls.push(name);
        return {
          kind: "recipe",
          result: { recipe: "onboard", site: "test-site", status: "applied", commits: ["s"] },
        };
      },
    });

    const result = await init(siteOf(), { steps: [tracker("a"), tracker("b"), tracker("c")] });

    expect(calls).toEqual(["a", "b", "c"]);
    expect(result.complete).toBe(true);
    expect(result.steps.map((s) => s.name)).toEqual(["a", "b", "c"]);
  });

  it("continues through noop results without breaking the chain", async () => {
    const result = await init(siteOf(), {
      steps: [ok("convert-to-pnpm"), noop("onboard"), noop("sync-configs"), ok("svelte-codemods")],
    });
    expect(result.complete).toBe(true);
    expect(result.steps).toHaveLength(4);
    const statuses = result.steps.map((s) =>
      s.result.kind === "recipe" ? s.result.result.status : "other",
    );
    expect(statuses).toEqual(["applied", "noop", "noop", "applied"]);
  });

  it("short-circuits on the first failed recipe and marks complete=false", async () => {
    const result = await init(siteOf(), {
      steps: [
        ok("convert-to-pnpm"),
        failed("onboard", "no pnpm-lock.yaml"),
        ok("sync-configs"), // should NOT run
      ],
    });
    expect(result.complete).toBe(false);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[1]?.name).toBe("onboard");
    const onboardResult = result.steps[1]?.result;
    if (onboardResult?.kind !== "recipe") throw new Error("expected recipe result");
    expect(onboardResult.result.status).toBe("failed");
    expect(onboardResult.result.notes).toBe("no pnpm-lock.yaml");
  });

  it("captures uncaught errors as an error step and stops the chain", async () => {
    const result = await init(siteOf(), {
      steps: [
        ok("convert-to-pnpm"),
        thrower("onboard", "git not found"),
        ok("sync-configs"), // should NOT run
      ],
    });
    expect(result.complete).toBe(false);
    expect(result.steps).toHaveLength(2);
    const errResult = result.steps[1]?.result;
    if (errResult?.kind !== "error") throw new Error("expected error result");
    expect(errResult.message).toBe("git not found");
  });

  it("attaches audit results inline so the CLI can render them in the summary", async () => {
    const audits: AuditResult[] = [
      { audit: "deps", site: "test-site", status: "pass", summary: "all baseline" },
      { audit: "lint", site: "test-site", status: "warn", summary: "1 prettier diff" },
    ];
    const result = await init(siteOf(), {
      steps: [ok("sync-configs"), auditStep("audit", audits)],
    });
    expect(result.complete).toBe(true);
    const last = result.steps[1]?.result;
    if (last?.kind !== "audit") throw new Error("expected audit result");
    expect(last.results).toEqual(audits);
  });

  it("uses siteLabel(site) to populate result.site (name preferred over path)", async () => {
    const result = await init(
      { path: "/fake/path", name: "caltex-landing" },
      { steps: [ok("onboard")] },
    );
    expect(result.site).toBe("caltex-landing");
  });

  it("falls back to site.path when no name is provided", async () => {
    const result = await init({ path: "/abs/no/name" }, { steps: [ok("onboard")] });
    expect(result.site).toBe("/abs/no/name");
  });
});
