import { describe, it, expect } from "vitest";
import {
  triggerRenovateForSite,
  type TriggerRenovateDeps,
} from "../../src/dashboard/trigger-renovate.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

function deps(over: Partial<TriggerRenovateDeps> = {}): TriggerRenovateDeps {
  return {
    getSite: async () => makeWebsiteRow({ id: "recA", name: "Acme", gitRepo: "reddoorla/acme" }),
    dispatch: async () => {},
    ...over,
  };
}

describe("triggerRenovateForSite", () => {
  it("dispatches for a repo-backed site and returns the repo", async () => {
    const calls: string[] = [];
    const r = await triggerRenovateForSite(
      deps({
        dispatch: async (repo) => {
          calls.push(repo);
        },
      }),
      "acme",
    );
    expect(r).toEqual({ status: "dispatched", slug: "acme", repo: "reddoorla/acme" });
    expect(calls).toEqual(["reddoorla/acme"]);
  });

  it("returns not-found when the slug resolves to no site", async () => {
    const r = await triggerRenovateForSite(deps({ getSite: async () => null }), "ghost");
    expect(r).toEqual({ status: "not-found", slug: "ghost" });
  });

  it("returns no-repo when the site has no Git repo (blank/null)", async () => {
    const r = await triggerRenovateForSite(
      deps({ getSite: async () => makeWebsiteRow({ id: "r", name: "X", gitRepo: "  " }) }),
      "x",
    );
    expect(r).toEqual({ status: "no-repo", slug: "x" });
  });

  it("returns failed (never throws) when dispatch throws", async () => {
    const r = await triggerRenovateForSite(
      deps({
        dispatch: async () => {
          throw new Error("403 no actions:write");
        },
      }),
      "acme",
    );
    expect(r).toEqual({
      status: "failed",
      slug: "acme",
      repo: "reddoorla/acme",
      error: "403 no actions:write",
    });
  });

  it("trims the repo before dispatching", async () => {
    const calls: string[] = [];
    await triggerRenovateForSite(
      deps({
        getSite: async () => makeWebsiteRow({ id: "r", name: "X", gitRepo: " reddoorla/x " }),
        dispatch: async (repo) => {
          calls.push(repo);
        },
      }),
      "x",
    );
    expect(calls).toEqual(["reddoorla/x"]);
  });
});
