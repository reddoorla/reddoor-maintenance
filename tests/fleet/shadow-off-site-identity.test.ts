import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateForTargets } from "../../src/cli/commands/header-image.js";
import type { StoredHeaderImage } from "../../src/db/header-images.js";
import { formsNotifyTarget, VERIFY_STATUS } from "../../src/recipes/forms-notify-target.js";
import { canonicalizeStatus } from "../../src/reports/airtable/site-status.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import {
  ensureSite,
  type SiteStore,
  type LegacyAirtableSites,
} from "../../src/fleet/ensure-site.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { untouchableBase, untouchableFetch } from "./_helpers/untouchable-airtable.js";

let touched: string[] = [];
let logged: () => string;

beforeEach(() => {
  touched = [];
  vi.stubGlobal("fetch", untouchableFetch(touched));
  vi.stubEnv("TURSO_DATABASE_URL", "");
  vi.stubEnv("TURSO_AUTH_TOKEN", "");
  vi.stubEnv("AIRTABLE_PAT", "pat_test");
  vi.stubEnv("AIRTABLE_BASE_ID", "app_test");
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  logged = () => log.mock.calls.flat().join("\n");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("shipped shadow-off: header-image --write-back never uploads to Airtable", () => {
  it("stores the plate in Turso and the run is green", async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    const stored: Array<{ siteId: string; img: StoredHeaderImage }> = [];
    const res = await generateForTargets(
      [makeWebsiteRow({ id: "recAcme", name: "Acme" })],
      {
        writeBack: true,
        storeDb: async (siteId, img) => {
          stored.push({ siteId, img });
        },
      },
      async () => ({
        bytes,
        domain: "acme.com",
        filename: "acmeHeader.jpg",
        contentType: "image/jpeg" as const,
      }),
    );
    expect(touched).toEqual([]);
    expect(res.code).toBe(0);
    expect(res.output).toContain("+ turso");
    expect(stored).toEqual([
      {
        siteId: "recAcme",
        img: expect.objectContaining({ bytes, filename: "acmeHeader.jpg" }),
      },
    ]);
    expect(logged()).toContain(
      "AIRTABLE_SHADOW skipped=shadow-off writer=uploadAttachment id=recAcme",
    );
  });
});

describe("shipped shadow-off: forms-notify-target never touches Airtable", () => {
  it("flips the rec site's Status in Turso and the read-back confirms it", async () => {
    let rows: WebsiteRow[] = [
      makeWebsiteRow({ id: "recSite", name: "1836dig", status: "maintained" }),
    ];
    const turso: Array<{ id: string; fields: Record<string, unknown> }> = [];
    const r = await formsNotifyTarget({
      base: untouchableBase(touched),
      site: "1836dig",
      set: "on",
      roster: async () => rows.map((row) => ({ ...row })),
      siteMirror: {
        created: async () => {},
        hasRow: async () => true,
        health: async () => {},
        site: async (id, fields) => {
          turso.push({ id, fields });
          const cell = String(fields.Status);
          rows = rows.map((row) =>
            row.id === id ? { ...row, status: canonicalizeStatus(cell), statusRaw: cell } : row,
          );
        },
      },
    });
    expect(touched).toEqual([]);
    expect(turso).toEqual([{ id: "recSite", fields: { Status: "launching" } }]);
    expect(r.flip).toEqual({ from: "maintained", to: VERIFY_STATUS, confirmed: true });
    expect(logged()).toContain(
      "AIRTABLE_SHADOW skipped=shadow-off writer=updateSiteField id=recSite",
    );
  });
});

describe("shipped shadow-off: ensureSite never touches the legacy Airtable sites", () => {
  it("fills a rec site's blanks in Turso and reports the shadow skipped", async () => {
    const patch = { url: "https://acme.example.com", pointOfContact: "owner@acme.example.com" };
    const turso: Array<{ id: string; patch: unknown }> = [];
    const store: SiteStore = {
      findBySlug: async () => ({
        id: "recEXIST",
        name: "acme-co",
        url: null,
        pointOfContact: null,
        gitRepo: "reddoorla/acme-co",
      }),
      create: async () => {
        throw new Error("create must not run on the exists path");
      },
      updateIdentity: async (id, p) => {
        turso.push({ id, patch: p });
        return true;
      },
    };
    const legacy: LegacyAirtableSites = {
      findBySlug: async () => {
        touched.push("Airtable touched: legacy.findBySlug");
        throw new Error("Airtable touched: legacy.findBySlug");
      },
      adopt: async () => {
        touched.push("Airtable touched: legacy.adopt");
        throw new Error("Airtable touched: legacy.adopt");
      },
      update: async () => {
        touched.push("Airtable touched: legacy.update");
        throw new Error("Airtable touched: legacy.update");
      },
    };
    const result = await ensureSite({ slug: "acme-co", ...patch }, { store, airtable: legacy });
    expect(touched).toEqual([]);
    expect(turso).toEqual([{ id: "recEXIST", patch }]);
    expect(result).toMatchObject({ status: "exists", airtableShadow: "skipped" });
    expect(logged()).toContain(
      "AIRTABLE_SHADOW skipped=shadow-off writer=ensureSite.update id=recEXIST",
    );
  });
});
