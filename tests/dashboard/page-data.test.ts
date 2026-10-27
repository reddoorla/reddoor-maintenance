import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../../src/db/client.js";
import {
  loadCockpitModel,
  loadFleetTableModel,
  loadSiteDashboard,
  loadSubmissionsPage,
  markSubmissionsRead,
  loadProspectAudits,
} from "../../src/dashboard/page-data.js";

/**
 * The page loaders the Netlify page functions and the SvelteKit cockpit share
 * (#582). Real libSQL in a temp `file:` database per test: what each page reads,
 * and the two refusals the functions turn into a 404 and a 400.
 */

const NOW = new Date("2026-10-20T12:00:00.000Z");
let dir: string;
let db: Db;

async function seedSite(id: string, name: string, slug: string, status = "maintained") {
  await db
    .insertInto("sites")
    .values({ id, slug, name, url: `https://${slug}.example.com`, status } as never)
    .execute();
}

async function seedSubmission(id: string, siteId: string, status = "new") {
  await db
    .insertInto("submissions")
    .values({
      id,
      site_id: siteId,
      form_type: "contact",
      name: "Pat",
      email: "pat@example.com",
      status,
      notify_status: "sent",
      submitted_at: "2026-10-19T10:00:00.000Z",
    } as never)
    .execute();
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "page-data-"));
  db = await openDb({ url: `file:${join(dir, "db.sqlite")}` });
  await seedSite("recA", "Acme", "acme");
  await seedSite("recB", "Beta", "beta");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("page loaders", () => {
  it("loadCockpitModel builds the cockpit from the stored fleet", async () => {
    const model = await loadCockpitModel(db, NOW, "https://dash.example");
    expect(model.cards.map((c) => c.site.name).sort()).toEqual(["Acme", "Beta"]);
  });

  it("loadFleetTableModel applies the query", async () => {
    const model = await loadFleetTableModel(db, new URLSearchParams("q=acm"));
    expect(model.rows.map((r) => r.name)).toEqual(["Acme"]);
    expect(model.totalSites).toBe(2);
  });

  it("loadSiteDashboard returns the site's data, and null for an unknown slug", async () => {
    await seedSubmission("sub1", "recA");
    const data = await loadSiteDashboard(db, "acme", NOW, "https://dash.example");
    expect(data?.site.name).toBe("Acme");
    expect(data?.submissions.map((s) => s.id)).toEqual(["sub1"]);
    expect(await loadSiteDashboard(db, "nope", NOW, "https://dash.example")).toBeNull();
  });

  it("loadSubmissionsPage scopes ?site= to that site, and reports an unknown slug", async () => {
    await seedSubmission("sub1", "recA");
    await seedSubmission("sub2", "recB");
    const scoped = await loadSubmissionsPage(db, new URLSearchParams("site=beta"));
    expect(scoped.kind).toBe("ok");
    if (scoped.kind === "ok") expect(scoped.model.total).toBe(1);
    expect(await loadSubmissionsPage(db, new URLSearchParams("site=nope"))).toEqual({
      kind: "no-site",
      slug: "nope",
    });
  });

  it("markSubmissionsRead flips only the filtered bucket and redirects back to it", async () => {
    await seedSubmission("sub1", "recA");
    await seedSubmission("sub2", "recB");
    const result = await markSubmissionsRead(db, new URLSearchParams("action=mark-read&site=acme"));
    expect(result).toEqual({ kind: "marked", count: 1, location: "/submissions?site=acme" });
    const rows = await db.selectFrom("submissions").select(["id", "status"]).execute();
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({
      sub1: "read",
      sub2: "new",
    });
  });

  it("markSubmissionsRead refuses an unknown action without writing", async () => {
    await seedSubmission("sub1", "recA");
    expect(await markSubmissionsRead(db, new URLSearchParams("action=delete"))).toEqual({
      kind: "unknown-action",
    });
    const row = await db.selectFrom("submissions").select("status").executeTakeFirstOrThrow();
    expect(row.status).toBe("new");
  });

  it("loadProspectAudits reads the recent audits", async () => {
    expect(await loadProspectAudits(db)).toEqual([]);
  });
});
