import { describe, it, expect } from "vitest";
import { runRecipeOverSites } from "../../../src/cli/fleet/run-recipe-over-sites.js";
import type { RecipeResult, Site } from "../../../src/types.js";

function applied(site: Site): RecipeResult {
  return {
    recipe: "self-updating",
    site: site.name || site.path,
    status: "applied",
    commits: ["abc"],
  };
}

describe("runRecipeOverSites", () => {
  it("runs every site sequentially and returns results in site order", async () => {
    const order: string[] = [];
    const sites: Site[] = [
      { path: "/a", name: "a" },
      { path: "/b", name: "b" },
      { path: "/c", name: "c" },
    ];
    const out = await runRecipeOverSites("self-updating", sites, async (s) => {
      order.push(s.name || s.path);
      return applied(s);
    });
    expect(order).toEqual(["a", "b", "c"]); // sequential, in order
    expect(out.map((r) => r.site)).toEqual(["a", "b", "c"]);
    expect(out.every((r) => r.status === "applied")).toBe(true);
  });

  it("isolates a per-site throw: the bad site becomes a failed result, the rest STILL run", async () => {
    // The core regression — the bare for-loop aborted the whole batch on one throw.
    const ran: string[] = [];
    const sites: Site[] = [
      { path: "/a", name: "a" },
      { path: "/bad", name: "bad" },
      { path: "/c", name: "c" },
    ];
    const out = await runRecipeOverSites("sync-configs", sites, async (s) => {
      ran.push(s.name || s.path);
      if (s.name === "bad") throw new Error("working tree not clean");
      return { recipe: "sync-configs", site: s.name || s.path, status: "applied", commits: [] };
    });

    expect(ran).toEqual(["a", "bad", "c"]); // every site was attempted — c was NOT skipped
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ site: "a", status: "applied" });
    expect(out[1]).toMatchObject({
      recipe: "sync-configs",
      site: "bad",
      status: "failed",
      commits: [],
    });
    expect(out[1]?.notes).toContain("working tree not clean");
    expect(out[2]).toMatchObject({ site: "c", status: "applied" });
  });

  it("labels the failed site with siteLabel (name || path) and stringifies a non-Error throw", async () => {
    const sites: Site[] = [{ path: "/only/path/no/name", name: "" }];
    const out = await runRecipeOverSites("bump-deps", sites, async () => {
      throw "boom"; // non-Error throw
    });
    expect(out[0]).toMatchObject({
      recipe: "bump-deps",
      site: "/only/path/no/name", // falls back to path when name is empty
      status: "failed",
    });
    expect(out[0]?.notes).toContain("boom");
  });

  it("returns an empty array for no sites", async () => {
    const out = await runRecipeOverSites("onboard", [], async () => {
      throw new Error("should never be called");
    });
    expect(out).toEqual([]);
  });
});
