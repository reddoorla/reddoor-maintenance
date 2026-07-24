import { describe, it, expect, afterEach, vi } from "vitest";
import { runMigration } from "../../../src/blux/emit/run-migration.js";
import type { MigrationPlan } from "../../../src/blux/emit/plan.js";

function jsonRes(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => "",
  } as unknown as Response;
}
function errRes(status: number, body: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  } as unknown as Response;
}

describe("runMigration — update targets the right-typed doc", () => {
  const saved: Record<string, string | undefined> = {};
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ["PRISMIC_REPOSITORY_NAME", "PRISMIC_WRITE_TOKEN", "PRISMIC_ACCESS_TOKEN"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  // Regression for the re-migrate uid clobber: a repo can hold the SAME uid
  // under two types (the starter `page:home` and the migration's
  // `catalog_page:home`). Keying the update-lookup by uid alone let one clobber
  // the other and PUT a doc's data onto the wrong-typed id.
  it("PUTs a catalog_page update onto the catalog_page id, not a same-uid page doc", async () => {
    for (const k of ["PRISMIC_REPOSITORY_NAME", "PRISMIC_WRITE_TOKEN", "PRISMIC_ACCESS_TOKEN"])
      saved[k] = process.env[k];
    process.env.PRISMIC_REPOSITORY_NAME = "repo";
    process.env.PRISMIC_WRITE_TOKEN = "tok";
    delete process.env.PRISMIC_ACCESS_TOKEN;

    let putUrl = "";
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      // empty media library → skip the asset loop
      if (url.startsWith("https://asset-api.prismic.io/assets?")) return jsonRes({ items: [] });
      // create POST → "already exists" so the update (PUT) path runs
      if (url === "https://migration.prismic.io/documents" && init?.method === "POST")
        return errRes(409, "document already exists");
      // Document API root → master ref
      if (url === "https://repo.prismic.io/api/v2")
        return jsonRes({ refs: [{ id: "master", ref: "MASTERREF" }] });
      // search → same uid under two types; the WRONG (page) doc is LAST so a
      // uid-only map would clobber the lookup to page-id.
      if (url.startsWith("https://repo.prismic.io/api/v2/documents/search"))
        return jsonRes({
          results: [
            { id: "cat-id", uid: "home", type: "catalog_page" },
            { id: "page-id", uid: "home", type: "page" },
          ],
          next_page: null,
        });
      // the update PUT — capture which id it targets
      if (url.startsWith("https://migration.prismic.io/documents/") && init?.method === "PUT") {
        putUrl = url;
        return jsonRes({});
      }
      throw new Error(`unexpected fetch ${url} ${init?.method ?? ""}`);
    });
    vi.stubGlobal("fetch", mockFetch as unknown as typeof fetch);

    const plan: MigrationPlan = {
      customTypes: [],
      documents: [{ type: "catalog_page", uid: "home", data: {} }],
      assets: [],
      stylesManifest: [],
      diagnostics: [],
    };

    const result = await runMigration(plan, () => {});
    expect(result.docsUpdated).toBe(1);
    expect(putUrl).toBe("https://migration.prismic.io/documents/cat-id");
  });
});
