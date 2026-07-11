import { describe, it, expect, afterEach, vi } from "vitest";
import { runMigration, type MigrationResult } from "../../../src/blux/emit/run-migration.js";
import type { MigrationPlan } from "../../../src/blux/emit/plan.js";

/** Minimal Response-like whose only used members are `.ok`, `.json`, `.blob`. */
function jsonRes(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => "" } as unknown as Response;
}
function blobRes(): Response {
  return { ok: true, status: 200, blob: async () => new Blob(["x"]) } as unknown as Response;
}

describe("runMigration assetUrlByCdn", () => {
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ["PRISMIC_REPOSITORY_NAME", "PRISMIC_WRITE_TOKEN"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("maps each plan asset's CDN url → its resolved Prismic url (reuse + upload paths)", async () => {
    for (const k of ["PRISMIC_REPOSITORY_NAME", "PRISMIC_WRITE_TOKEN"]) saved[k] = process.env[k];
    process.env.PRISMIC_REPOSITORY_NAME = "repo";
    process.env.PRISMIC_WRITE_TOKEN = "tok";

    // `reused.png` is already in the library; `new.png` must be uploaded.
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://asset-api.prismic.io/assets?")) {
        return jsonRes({
          items: [{ id: "existing-id", filename: "reused.png", url: "https://images.prismic.io/repo/reused" }],
        });
      }
      if (url === "https://asset-api.prismic.io/assets" && init?.method === "POST") {
        return jsonRes({ id: "new-id", url: "https://images.prismic.io/repo/new" });
      }
      if (url.startsWith("https://cdn/")) return blobRes(); // asset blob fetch before upload
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", mockFetch as unknown as typeof fetch);

    const plan: MigrationPlan = {
      customTypes: [],
      documents: [], // skip the doc-push loop; asset resolution is what we assert
      assets: [
        { id: "a1", url: "https://cdn/f/reused.png", alt: "" },
        { id: "a2", url: "https://cdn/f/new.png", alt: "hi" },
      ],
      stylesManifest: [],
      diagnostics: [],
    };

    const result: MigrationResult = await runMigration(plan, () => {});

    expect(result.assetsReused).toBe(1);
    expect(result.assetsUploaded).toBe(1);
    expect(result.assetUrlByCdn.get("https://cdn/f/reused.png")).toBe("https://images.prismic.io/repo/reused");
    expect(result.assetUrlByCdn.get("https://cdn/f/new.png")).toBe("https://images.prismic.io/repo/new");
  });
});
