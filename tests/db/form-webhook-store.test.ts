/**
 * The form webhook setting (2026-11-09, Gallery Sonder) round-trips through the
 * store ingest reads: the editor's write (`mirrorSiteField`, through the
 * importer's `siteValueFor`) and back out through `getSiteBySlug`, the exact
 * lookup the form-ingest function uses. A site that never set it reads as
 * "no form webhook", which is what keeps every other site's fan-out unchanged.
 */
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import type { RawRecord } from "../../src/db/field-map.js";
import { getSiteBySlug, mirrorSiteField, mirrorSiteInsert } from "../../src/db/fleet-state.js";
import { EDITABLE_SITE_FIELDS, normalizeFieldValue } from "../../src/dashboard/site-details.js";

const SITE: RawRecord = { id: "recSONDER", fields: { Name: "Gallery Sonder" } };

async function dbWithSite() {
  const db = await openDb({ url: ":memory:" });
  await mirrorSiteInsert(db, SITE, "2026-11-09T12:00:00.000Z");
  const slug = (await db.selectFrom("sites").select("slug").executeTakeFirstOrThrow()).slug;
  return { db, slug };
}

describe("form webhook setting — store round trip", () => {
  it("an untouched site reads as no form webhook and every type", async () => {
    const { db, slug } = await dbWithSite();
    const site = await getSiteBySlug(db, slug);
    expect(site?.formWebhook).toBeNull();
    expect(site?.formWebhookTypes).toEqual([]);
  });

  it("the editor's write reads back as the site row ingest sees", async () => {
    const { db, slug } = await dbWithSite();
    const url = normalizeFieldValue(EDITABLE_SITE_FIELDS.formWebhook!, " https://hook.example/x ");
    const types = normalizeFieldValue(EDITABLE_SITE_FIELDS.formWebhookTypes!, "inquiry, rsvp");
    expect(url).toBe("https://hook.example/x");
    expect(types).toEqual(["inquiry", "rsvp"]);
    await mirrorSiteField(db, "recSONDER", "Form Webhook", url!);
    await mirrorSiteField(db, "recSONDER", "Form Webhook Types", types!);

    const site = await getSiteBySlug(db, slug);
    expect(site?.formWebhook).toBe("https://hook.example/x");
    expect(site?.formWebhookTypes).toEqual(["inquiry", "rsvp"]);
  });

  it("clearing the URL turns forwarding off", async () => {
    const { db, slug } = await dbWithSite();
    await mirrorSiteField(db, "recSONDER", "Form Webhook", "https://hook.example/x");
    await mirrorSiteField(db, "recSONDER", "Form Webhook", "");
    expect((await getSiteBySlug(db, slug))?.formWebhook).toBeNull();
  });

  it("the editor refuses an unknown form type and a non-http URL", () => {
    expect(
      normalizeFieldValue(EDITABLE_SITE_FIELDS.formWebhookTypes!, "inquiry, bogus"),
    ).toBeNull();
    expect(normalizeFieldValue(EDITABLE_SITE_FIELDS.formWebhook!, "file:///etc/passwd")).toBeNull();
  });
});
