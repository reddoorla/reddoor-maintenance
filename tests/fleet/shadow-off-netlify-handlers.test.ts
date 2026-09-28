import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Webhook } from "svix";

const h = vi.hoisted(() => ({ touched: [] as string[] }));

vi.mock("../../src/reports/airtable/client.js", async (importOriginal) => {
  const { untouchableBase } = await import("./_helpers/untouchable-airtable.js");
  return {
    ...(await importOriginal<typeof import("../../src/reports/airtable/client.js")>()),
    openBase: () => untouchableBase(h.touched),
  };
});

import approveReportHandler from "../../netlify/functions/approve-report.mjs";
import reportCommentaryHandler from "../../netlify/functions/report-commentary.mjs";
import siteDetailsHandler from "../../netlify/functions/site-details.mjs";
import resendWebhookHandler from "../../netlify/functions/resend-webhook.mjs";
import { openDb, type Db } from "../../src/db/client.js";
import { gatingFields } from "../../src/reports/checklist.js";
import { untouchableFetch } from "./_helpers/untouchable-airtable.js";

const AUTH = "Basic " + Buffer.from("op:s3cret").toString("base64");
const WEBHOOK_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const CLEAN_EVIDENCE = JSON.stringify(
  Object.fromEntries(
    gatingFields("Maintenance").map((f) => [
      f,
      { result: "pass", checkedAt: "2026-09-01T00:00:00.000Z", note: "seeded" },
    ]),
  ),
);

const DIR = mkdtempSync(join(tmpdir(), "shadow-off-handlers-"));
let dbSeq = 0;
let db: Db;
let logged: () => string;

beforeEach(async () => {
  h.touched.length = 0;
  vi.stubGlobal("fetch", untouchableFetch(h.touched));
  const url = `file:${join(DIR, `db-${++dbSeq}.sqlite`)}`;
  vi.stubEnv("TURSO_DATABASE_URL", url);
  vi.stubEnv("TURSO_AUTH_TOKEN", "");
  vi.stubEnv("AIRTABLE_PAT", "pat_test");
  vi.stubEnv("AIRTABLE_BASE_ID", "appTestBase");
  vi.stubEnv("DASHBOARD_PASSWORD", "s3cret");
  vi.stubEnv("RESEND_WEBHOOK_SECRET", WEBHOOK_SECRET);
  db = await openDb({ url });
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  logged = () => log.mock.calls.flat().join("\n");
});

afterEach(async () => {
  await db.destroy();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

async function seedSite(id: string, slug: string): Promise<void> {
  await db
    .insertInto("sites")
    .values({
      id,
      slug,
      name: `Site ${slug}`,
      url: "https://example.com",
      status: "Maintained",
      report_recipients_to: "client@example.com",
      header_image_filename: "header.png",
      header_image_type: "image/png",
    } as never)
    .execute();
}

async function seedReport(id: string, siteId: string, over: Record<string, unknown> = {}) {
  await db
    .insertInto("reports")
    .values({
      id,
      site_id: siteId,
      report_id: `${id}-2026-09`,
      report_type: "Maintenance",
      draft_ready: 1,
      approved_to_send: 0,
      sent_at: null,
      checklist_auto_evidence: CLEAN_EVIDENCE,
      lighthouse_performance: 98,
      lighthouse_accessibility: 100,
      lighthouse_best_practices: 96,
      lighthouse_seo: 100,
      ...over,
    } as never)
    .execute();
}

async function reportRow(id: string): Promise<Record<string, unknown> | undefined> {
  return (await db.selectFrom("reports").selectAll().where("id", "=", id).executeTakeFirst()) as
    Record<string, unknown> | undefined;
}

async function siteRow(id: string): Promise<Record<string, unknown> | undefined> {
  return (await db.selectFrom("sites").selectAll().where("id", "=", id).executeTakeFirst()) as
    Record<string, unknown> | undefined;
}

function operatorPost(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", authorization: AUTH },
  });
}

describe("shipped shadow-off: approve-report with Airtable env present never touches Airtable", () => {
  it("approves a rec report: 200, and the approval lands in Turso", async () => {
    await seedSite("recSiteA", "acme");
    await seedReport("recREP1", "recSiteA");
    const res = await approveReportHandler(
      operatorPost("https://x/api/reports/recREP1/approve", {}),
      // @ts-expect-error minimal Netlify Context
      { params: { id: "recREP1" } },
    );
    expect(h.touched).toEqual([]);
    expect(await res.json()).toEqual({ status: "approved", reportId: "recREP1" });
    expect(res.status).toBe(200);
    const row = await reportRow("recREP1");
    expect(row?.approved_to_send).toBe(1);
    expect(row?.approved_by).toBe("dashboard");
    expect(logged()).toContain(
      "AIRTABLE_SHADOW skipped=shadow-off writer=approveReportRow id=recREP1",
    );
  });

  it("overrides a rec report: 200, and the full audit trail lands in Turso", async () => {
    await seedSite("recSiteB", "beta");
    await seedReport("recREP2", "recSiteB");
    const res = await approveReportHandler(
      operatorPost("https://x/api/reports/recREP2/approve?override=1", { reason: "deadline" }),
      // @ts-expect-error minimal Netlify Context
      { params: { id: "recREP2" } },
    );
    expect(h.touched).toEqual([]);
    expect(res.status).toBe(200);
    const row = await reportRow("recREP2");
    expect(row?.send_override).toBe(1);
    expect(row?.override_reason).toBe("deadline");
    expect(row?.approved_to_send).toBe(1);
    expect(logged()).toContain(
      "AIRTABLE_SHADOW skipped=shadow-off writer=overrideReportRow id=recREP2",
    );
  });
});

describe("shipped shadow-off: report-commentary with Airtable env present never touches Airtable", () => {
  it("saves a rec report's commentary: 200, and it lands in Turso", async () => {
    await seedReport("recREP3", "recSiteC", { commentary: null });
    const res = await reportCommentaryHandler(
      operatorPost("https://x/api/reports/recREP3/commentary", { text: "Traffic is up." }),
      // @ts-expect-error minimal Netlify Context
      { params: { id: "recREP3" } },
    );
    expect(h.touched).toEqual([]);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.status).toBe(200);
    expect((await reportRow("recREP3"))?.commentary).toBe("Traffic is up.");
    expect(logged()).toContain(
      "AIRTABLE_SHADOW skipped=shadow-off writer=updateReportCommentary id=recREP3",
    );
  });
});

describe("shipped shadow-off: site-details with Airtable env present never touches Airtable", () => {
  it("saves a rec site's field: 200, and it lands in Turso", async () => {
    await seedSite("recSiteD", "delta");
    const res = await siteDetailsHandler(
      operatorPost("https://x/api/sites/delta/details", {
        field: "searchQuery",
        value: "delta dentist",
      }),
      // @ts-expect-error minimal Netlify Context
      { params: { slug: "delta" } },
    );
    expect(h.touched).toEqual([]);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.status).toBe(200);
    expect((await siteRow("recSiteD"))?.search_query).toBe("delta dentist");
    expect(logged()).toContain(
      "AIRTABLE_SHADOW skipped=shadow-off writer=updateSiteField id=recSiteD",
    );
  });
});

describe("shipped shadow-off: resend-webhook with Airtable env present never touches Airtable", () => {
  function signed(type: string, emailId: string): Request {
    const body = JSON.stringify({
      type,
      created_at: new Date().toISOString(),
      data: { email_id: emailId },
    });
    const timestamp = new Date();
    return new Request("https://x/webhook", {
      method: "POST",
      body,
      headers: {
        "svix-id": "msg_shadow_off",
        "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
        "svix-signature": new Webhook(WEBHOOK_SECRET).sign("msg_shadow_off", timestamp, body),
        "content-type": "application/json",
      },
    });
  }

  it("records a rec report's delivery: 200, and the status lands in Turso", async () => {
    await seedReport("recREP5", "recSiteE", {
      resend_message_id: "msg_delivered_5",
      delivery_status: "pending",
    });
    // @ts-expect-error minimal Netlify Context
    const res = await resendWebhookHandler(signed("email.delivered", "msg_delivered_5"), {});
    expect(h.touched).toEqual([]);
    expect(await res.text()).toBe("OK");
    expect(res.status).toBe(200);
    expect((await reportRow("recREP5"))?.delivery_status).toBe("delivered");
    expect(logged()).toContain(
      "AIRTABLE_SHADOW skipped=shadow-off writer=setDeliveryStatus id=recREP5",
    );
  });

  it("records a rec report's bounce: 200, and the status lands in Turso", async () => {
    await seedReport("recREP6", "recSiteF", {
      resend_message_id: "msg_bounce_6",
      delivery_status: "delivered",
    });
    // @ts-expect-error minimal Netlify Context
    const res = await resendWebhookHandler(signed("email.bounced", "msg_bounce_6"), {});
    expect(h.touched).toEqual([]);
    expect(res.status).toBe(200);
    expect((await reportRow("recREP6"))?.delivery_status).toBe("bounced");
  });
});
