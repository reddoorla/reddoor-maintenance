/**
 * #646 step 4, the whole point of the decision: a site that exists ONLY in Turso
 * — created by `ensure-site` with a minted `site_<ULID>` id and no Airtable
 * record anywhere — can receive a report end to end, drafting through send.
 *
 * Before this, it could not. `createDraft` minted the report id from Airtable's
 * record id and refused a `site_` id by name, so every such site was
 * un-reportable; the roster reads could not see it either.
 *
 * Driven against a REAL migrated libSQL database in a temp `file:` — never
 * `:memory:` (a libSQL transaction hands its connection away and the next
 * statement sees an empty database; `ensure-site`'s create is a transaction) and
 * never a `TURSO_*` url from the environment. The Airtable side is a fake base
 * that records every call, plus a `fetch` that THROWS: if any Airtable write
 * were attempted rather than skipped, this test fails loudly instead of quietly
 * reaching the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { openDb, type Db } from "../../src/db/client.js";
import { makeSiteStore } from "../../src/db/site-create.js";
import { ensureSite } from "../../src/fleet/ensure-site.js";
import { isMintedSiteId } from "../../src/fleet/site-id.js";
import { isMintedReportId, isReportId } from "../../src/fleet/report-id.js";
import {
  getSiteBySlug,
  listSendableReports,
  listSites,
  mirrorHealthFields,
  mirrorReportPatch,
  getReportHtml,
  listReportsForSite,
} from "../../src/db/fleet-state.js";
import { makeReportMirror } from "../../src/reports/report-mirror.js";
import { draftReportForSite } from "../../src/reports/draft.js";
import { sendApprovedReports } from "../../src/reports/send/orchestrate.js";
import { makeFakeBase, type FakeAirtableBase } from "./_helpers/fake-airtable-base.js";

let dir: string;
let db: Db;
let base: FakeAirtableBase;

const FRESH = new Date().toISOString();

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "turso-report-e2e-"));
  db = await openDb({ url: `file:${join(dir, "fleet.db")}` });
  base = makeFakeBase({ Websites: [], Reports: [] });
  // Any Airtable HTTP call fails the test rather than reaching the network: the
  // attachment upload and the content API go through fetch, not the SDK fake.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("no network in this test — an Airtable call was attempted");
    }),
  );
  // `openBase` inside the send needs these present; no call is expected to use them.
  vi.stubEnv("AIRTABLE_PAT", "pat_e2e");
  vi.stubEnv("AIRTABLE_BASE_ID", "app_e2e");
  // Enrichment off: GA/Search are not what this proves, and they talk to Google.
  vi.stubEnv("GA_SUBJECT", "");
});

afterEach(async () => {
  await db.destroy();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** The health signals the Maintenance gate reads, all fresh and passing — the
 *  state the nightly audit writes. Without them the send's health gate blocks,
 *  which is correct behaviour and a different test's subject. */
async function seedPassingHealth(siteId: string): Promise<void> {
  await mirrorHealthFields(db, siteId, {
    pScore: 87,
    rScore: 91,
    bpScore: 100,
    seoScore: 95,
    "Deploy status": "ready",
    "Deploy checked at": FRESH,
    "Function health": "pass",
    "Function health checked at": FRESH,
    "CMS Reachable": "pass",
    "Domain checked at": FRESH,
    "Cert days remaining": 80,
    "Security Vulns Critical": 0,
    "Security Vulns High": 0,
    "Last security audit at": FRESH,
    "Uptime Reachable": "pass",
    "Browser checked at": FRESH,
  });
}

describe("a Turso-only site receives a report end to end (#646 step 4)", () => {
  it("drafts, queues, approves and sends — with no Airtable record anywhere", async () => {
    // 1. The site: created in Turso, no Airtable client wired at all.
    const created = await ensureSite(
      { slug: "e2e-co", displayName: "E2E Co", url: "https://e2e.example.com" },
      { store: makeSiteStore(db) },
    );
    expect(created.status).toBe("created");
    expect(isMintedSiteId(created.siteId)).toBe(true);
    expect(created.airtableShadow).toBe("skipped");
    await seedPassingHealth(created.siteId);
    await db
      .updateTable("sites")
      .set({ report_recipients_to: "client@e2e.example.com" })
      .where("id", "=", created.siteId)
      .execute();

    // 2. The draft. The site row is READ from Turso (the roster read step 4
    //    moved); the report row is MINTED and written there too.
    const siteRow = await getSiteBySlug(db, "e2e-co");
    expect(siteRow).not.toBeNull();
    const writer = await makeReportMirror(async () => db, true);
    const draft = await draftReportForSite(base, siteRow!, "Maintenance", {
      refreshHeader: false,
      reportMirror: writer,
    });

    const reportId = draft.reportRow!.id;
    expect(isMintedReportId(reportId)).toBe(true);
    // The three request routes can address it — the widened validator.
    expect(isReportId(reportId)).toBe(true);
    expect(draft.queued).toBe(true);

    // The row, its body and its queue flag are all in Turso.
    const [stored] = await listReportsForSite(db, created.siteId);
    expect(stored?.id).toBe(reportId);
    expect(stored?.siteId).toBe(created.siteId);
    expect(stored?.draftReady).toBe(true);
    expect(stored?.deliveryStatus).toBe("pending");
    expect((await getReportHtml(db, reportId))?.html).toBe(draft.html);

    // 3. The approve stamp (what the console's POST writes through).
    await mirrorReportPatch(db, reportId, {
      approved_to_send: 1,
      approved_at: FRESH,
      approved_by: "operator",
    });
    const queue = await listSendableReports(db);
    expect(queue.map((r) => r.id)).toEqual([reportId]);

    // 4. The send: queue, roster and header plate all read from Turso.
    const plate = await sharp({
      create: { width: 40, height: 20, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const sent: Array<{ to: string[]; subject: string }> = [];
    const result = await sendApprovedReports({
      sendable: () => listSendableReports(db),
      roster: () => listSites(db),
      loadHeaderPlate: async () => new Uint8Array(plate),
      resend: {
        send: async (msg: { to: string[]; subject: string }) => {
          sent.push({ to: msg.to, subject: msg.subject });
          return { messageId: "msg_e2e" };
        },
      } as never,
      reportSentMirror: async (id, sentAt, messageId) => {
        await mirrorReportPatch(db, id, {
          sent_at: sentAt.toISOString(),
          ...(messageId !== null ? { resend_message_id: messageId } : {}),
        });
      },
    });

    expect(result.code).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(["client@e2e.example.com"]);

    // 5. The stamp landed in Turso, so the report leaves the queue for good.
    const [after] = await listReportsForSite(db, created.siteId);
    expect(after?.sentAt).not.toBeNull();
    expect(after?.resendMessageId).toBe("msg_e2e");
    expect(await listSendableReports(db)).toEqual([]);

    // 6. Airtable was never written to, and never even reached for.
    expect(base.__calls).toEqual([]);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });
});
