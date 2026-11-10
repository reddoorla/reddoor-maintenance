import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CompiledQuery } from "kysely";
import { openDb, type Db } from "../../src/db/client.js";
import { mirrorSiteInsert } from "../../src/db/fleet-state.js";
import { loadCockpitSnapshot } from "../../src/dashboard/snapshot.js";
import { cockpitModelFromSnapshot } from "../../src/dashboard/snapshot-views.js";
import { PRISMIC_ACK_UPDATE_SQL, prismicAckCovers } from "../../src/alerts/digest-collectors.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

/**
 * #1679, the payload half. The cockpit snapshot sent every site row whole, so an
 * acked site carried its drift report twice: tonight's (`prismicModelsDrift`) and
 * the one the ack names (`prismicAckDrift`), each up to 50,000 characters. The
 * browser needs only "is the acked report tonight's report?", so the server
 * answers that and nulls the text. The ack's expiry is still read in the browser,
 * against the browser's clock.
 */
const NOW = new Date("2026-11-09T16:00:00.000Z");
const UNTIL = "2026-12-31T00:00:00.000Z";
const REVIEWED = "REMOTE-ONLY — present in Prismic\n    customtype press_release";
const CHIP = "Prismic drift accepted until 2026-12-31";

describe("loadCockpitSnapshot — the Prismic ack crosses as a flag, not as text", () => {
  let db: Db;
  beforeEach(async () => {
    db = await openDb({ url: ":memory:" });
    await mirrorSiteInsert(
      db,
      {
        id: "rec1",
        fields: {
          Name: "Reddoor",
          Status: "maintained",
          "Prismic Models": "fail",
          "Prismic Models Checked At": NOW.toISOString(),
          "Prismic Models Drift": REVIEWED,
        },
      },
      NOW.toISOString(),
    );
    // The documented ack: the expiry and tonight's report, in one statement.
    await db.executeQuery(CompiledQuery.raw(PRISMIC_ACK_UPDATE_SQL, [UNTIL, "Reddoor"]));
  });
  afterEach(() => db.destroy());

  const card = (snap: Awaited<ReturnType<typeof loadCockpitSnapshot>>, now = NOW) =>
    cockpitModelFromSnapshot(snap, now).cards.find((c) => c.site.name === "Reddoor")!;

  it("sends no acked text, and the chip still shows for the report the ack names", async () => {
    const snap = await loadCockpitSnapshot(db, NOW, "https://dash");
    const row = snap.sites!.find((s) => s.name === "Reddoor")!;
    expect(row.prismicAckDrift).toBeNull();
    expect(row.prismicModelsDrift).toBe(REVIEWED);
    expect(row.prismicAckNamesReport).toBe(true);
    expect(card(snap).acceptedReasons).toEqual([CHIP]);
    expect(card(snap).items.map((i) => i.key)).not.toContain("prismic-drift:rec1");
  });

  it("an acked site with a new finding tonight gets the alert and no chip", async () => {
    await db
      .updateTable("site_health")
      .set({ prismic_models_drift: `${REVIEWED}\nREMOVED field hero.subtitle` })
      .where("site_id", "=", "rec1")
      .execute();
    const snap = await loadCockpitSnapshot(db, NOW, "https://dash");
    const row = snap.sites!.find((s) => s.name === "Reddoor")!;
    expect(row.prismicAckDrift).toBeNull();
    expect(row.prismicAckNamesReport).toBe(false);
    expect(card(snap).acceptedReasons).toEqual([]);
    expect(card(snap).items.map((i) => i.key)).toContain("prismic-drift:rec1");
  });

  it("an ack that expires after the snapshot was taken stops covering in the browser", async () => {
    // An ack running out two hours after the snapshot, read three hours after it:
    // the same night's check, so only the expiry differs.
    await db
      .updateTable("sites")
      .set({ prismic_ack_until: "2026-11-09T18:00:00.000Z" })
      .where("id", "=", "rec1")
      .execute();
    const snap = await loadCockpitSnapshot(db, NOW, "https://dash");
    expect(card(snap).acceptedReasons).toEqual(["Prismic drift accepted until 2026-11-09"]);
    const later = new Date("2026-11-09T19:00:00.000Z");
    expect(card(snap, later).acceptedReasons).toEqual([]);
    expect(card(snap, later).items.map((i) => i.key)).toContain("prismic-drift:rec1");
  });
});

describe("prismicAckCovers — the snapshot's flag", () => {
  const acked = makeWebsiteRow({
    prismicModels: "fail",
    prismicModelsDrift: REVIEWED,
    prismicAckUntil: UNTIL,
    prismicAckDrift: REVIEWED,
  });

  it("with no flag, compares the text, as the digest does", () => {
    expect(prismicAckCovers(acked, NOW)).toBe(true);
    expect(prismicAckCovers({ ...acked, prismicModelsDrift: "other" }, NOW)).toBe(false);
  });

  it("a flag present is the answer, whatever text the row carries", () => {
    expect(prismicAckCovers({ ...acked, prismicAckNamesReport: false }, NOW)).toBe(false);
    expect(
      prismicAckCovers({ ...acked, prismicAckDrift: null, prismicAckNamesReport: true }, NOW),
    ).toBe(true);
  });

  it("a true flag never outlives the ack's expiry", () => {
    const row = { ...acked, prismicAckDrift: null, prismicAckNamesReport: true };
    expect(prismicAckCovers(row, new Date("2027-01-01T00:00:00.000Z"))).toBe(false);
  });
});
