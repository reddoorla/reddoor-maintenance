import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CompiledQuery } from "kysely";
import { openDb } from "../../src/db/client.js";
import { listSites, mirrorSiteInsert } from "../../src/db/fleet-state.js";
import {
  collectPrismicDriftAlerts,
  prismicAckCovers,
  PRISMIC_ACK_UPDATE_SQL,
} from "../../src/alerts/digest-collectors.js";
import { prismicModelsFields } from "../../src/fleet/site-fields.js";
import { renderModelReport } from "../../src/cli/commands/prismic-models-report.js";
import type { ModelDiff } from "../../src/prismic/models/index.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const NOW = new Date("2026-10-21T16:00:00.000Z");
const UNTIL = "2026-12-31T00:00:00.000Z";

/** What the nightly sweep stores for a report: `prismicModelsFields`, the same
 *  write path, so truncation and its notice are the real ones. */
const stored = (report: string): string =>
  prismicModelsFields({ verdict: "fail", checkedAt: NOW.toISOString(), detail: report })[
    "Prismic Models Drift"
  ] as string;

/**
 * THE ACK HAS TO BE SETTABLE (#1608 review round 1). The first draft documented
 * `prismic_ack_drift = prismic_models_drift` in an UPDATE of `sites`, but the
 * report lives in `site_health`: the documented statement failed with "no such
 * column". The statement is now one constant, run here against a schema built by
 * the real migrations, then read back through the real fleet-state reader.
 */
describe("PRISMIC_ACK_UPDATE_SQL — the documented ack, run against a migrated schema", () => {
  async function seeded(drift: string) {
    const db = await openDb({ url: ":memory:" });
    await mirrorSiteInsert(
      db,
      {
        id: "rec1",
        fields: {
          Name: "Reddoor",
          Status: "maintained",
          "Prismic Models": "fail",
          "Prismic Models Checked At": NOW.toISOString(),
          "Prismic Models Drift": drift,
        },
      },
      NOW.toISOString(),
    );
    return db;
  }
  const site = async (db: Awaited<ReturnType<typeof openDb>>) =>
    (await listSites(db)).find((s) => s.name === "Reddoor")!;

  it("sets the expiry and copies tonight's report, and the ack then mutes that report", async () => {
    const db = await seeded("REMOTE-ONLY — present in Prismic\n    customtype press_release");
    try {
      await db.executeQuery(CompiledQuery.raw(PRISMIC_ACK_UPDATE_SQL, [UNTIL, "Reddoor"]));
      const row = await site(db);
      expect(row.prismicAckUntil).toBe(UNTIL);
      expect(row.prismicAckDrift).toBe(row.prismicModelsDrift);
      expect(prismicAckCovers(row, NOW)).toBe(true);
      expect(collectPrismicDriftAlerts([row], "https://dash", NOW)).toEqual([]);
    } finally {
      await db.destroy();
    }
  });

  it("a report that changes after the ack rings again, read through the same path", async () => {
    const db = await seeded("REMOTE-ONLY — present in Prismic\n    customtype press_release");
    try {
      await db.executeQuery(CompiledQuery.raw(PRISMIC_ACK_UPDATE_SQL, [UNTIL, "Reddoor"]));
      await db
        .updateTable("site_health")
        .set({ prismic_models_drift: "CHANGED — page\n    - field hero_image" })
        .where("site_id", "=", "rec1")
        .execute();
      const items = collectPrismicDriftAlerts([await site(db)], "https://dash", NOW);
      expect(items.map((i) => i.key)).toEqual(["prismic-drift:rec1"]);
    } finally {
      await db.destroy();
    }
  });

  it("acks only the named site, and copies that site's own report", async () => {
    // Two sites with different reports. Ack the second: the first must keep no
    // ack, and the second must get its own report, not the first's (a subquery
    // missing its site_id correlation would hand it the first row's).
    const db = await seeded("DRIFT A");
    try {
      await mirrorSiteInsert(
        db,
        {
          id: "rec2",
          fields: {
            Name: "Espada",
            Status: "maintained",
            "Prismic Models": "fail",
            "Prismic Models Checked At": NOW.toISOString(),
            "Prismic Models Drift": "DRIFT B",
          },
        },
        NOW.toISOString(),
      );
      await db.executeQuery(CompiledQuery.raw(PRISMIC_ACK_UPDATE_SQL, [UNTIL, "Espada"]));
      const rows = await listSites(db);
      const reddoor = rows.find((r) => r.name === "Reddoor")!;
      const espada = rows.find((r) => r.name === "Espada")!;
      expect(reddoor.prismicAckUntil).toBeNull();
      expect(reddoor.prismicAckDrift).toBeNull();
      expect(espada.prismicAckUntil).toBe(UNTIL);
      expect(espada.prismicAckDrift).toBe("DRIFT B");
      expect(collectPrismicDriftAlerts(rows, "https://dash", NOW).map((i) => i.key)).toEqual([
        "prismic-drift:rec1",
      ]);
    } finally {
      await db.destroy();
    }
  });

  it("the continuity runbook carries the statement verbatim", async () => {
    const runbook = await readFile(
      fileURLToPath(new URL("../../docs/runbooks/continuity.md", import.meta.url)),
      "utf-8",
    );
    expect(runbook).toContain(PRISMIC_ACK_UPDATE_SQL);
  });
});

/**
 * A REPORT PAST THE STORAGE CAP (#1608 review round 1). The sweep keeps the first
 * ~50k characters and a notice. The notice used to record only the full length,
 * so two reports differing past the cut at the same length stored identical text
 * and an ack of one muted the other.
 */
describe("prismicAckCovers — a report cut at the storage cap", () => {
  const head = "CHANGED — page\n" + "    - field filler\n".repeat(2_900);
  const reviewed = head + "    + Main.subtitle";
  const tonight = head + "    + Main.subtytle";

  it("the fixture really is past the cap, same length, differing only past the cut", () => {
    expect(reviewed.length).toBe(tonight.length);
    expect(reviewed.length).toBeGreaterThan(50_000);
    expect(stored(reviewed).slice(0, 49_000)).toBe(stored(tonight).slice(0, 49_000));
  });

  it("does not mute a different finding that differs only past the cut", () => {
    const row = makeWebsiteRow({
      prismicModels: "fail",
      prismicModelsDrift: stored(tonight),
      prismicAckUntil: UNTIL,
      prismicAckDrift: stored(reviewed),
    });
    expect(prismicAckCovers(row, NOW)).toBe(false);
  });

  it("still mutes the same cut report (pass control)", () => {
    const row = makeWebsiteRow({
      prismicModels: "fail",
      prismicModelsDrift: stored(reviewed),
      prismicAckUntil: UNTIL,
      prismicAckDrift: stored(reviewed),
    });
    expect(prismicAckCovers(row, NOW)).toBe(true);
  });

  it("a notice that mentions sha256 without a 64-hex hash covers nothing either", () => {
    const fake =
      head.slice(0, 49_000) +
      `\n…[truncated: this report is ${reviewed.length} characters (sha256 pending) and only the first 50000 are kept here.]`;
    const row = makeWebsiteRow({
      prismicModels: "fail",
      prismicModelsDrift: fake,
      prismicAckUntil: UNTIL,
      prismicAckDrift: fake,
    });
    expect(prismicAckCovers(row, NOW)).toBe(false);
  });

  it("an ack of a cut report stored before the notice carried a hash covers nothing", () => {
    const oldCut =
      head.slice(0, 49_000) +
      `\n…[truncated: this report is ${reviewed.length} characters and only the first 50000 are kept here.]`;
    const row = makeWebsiteRow({
      prismicModels: "fail",
      prismicModelsDrift: oldCut,
      prismicAckUntil: UNTIL,
      prismicAckDrift: oldCut,
    });
    expect(prismicAckCovers(row, NOW)).toBe(false);
  });
});

/** The identity, on the text the sweep actually writes (`renderModelReport`
 *  through `prismicModelsFields`), not a hand-written stand-in. */
describe("prismicAckCovers — on real rendered reports", () => {
  const entry = (
    kind: "customtype" | "slice",
    id: string,
    model: Record<string, unknown> = {},
  ) => ({
    kind,
    id,
    model: { ...model, id },
    path: `${kind}/${id}`,
  });
  const remote = (
    kind: "customtype" | "slice",
    id: string,
    model: Record<string, unknown> = {},
  ) => ({
    kind,
    id,
    model: { ...model, id },
  });
  const reviewedDiff = (): ModelDiff => ({
    toCreate: [],
    toUpdate: [],
    unchanged: [entry("slice", "hero")],
    remoteOnly: [remote("customtype", "press_release")],
  });
  const rowFor = (tonight: ModelDiff) =>
    makeWebsiteRow({
      prismicModels: "fail",
      prismicModelsDrift: stored(renderModelReport("reddoor", tonight, { apply: false })),
      prismicAckUntil: UNTIL,
      prismicAckDrift: stored(renderModelReport("reddoor", reviewedDiff(), { apply: false })),
    });

  it("the same diff re-rendered tonight is the same finding", () => {
    expect(prismicAckCovers(rowFor(reviewedDiff()), NOW)).toBe(true);
  });

  it("the issue's case: a field dropped from another model tonight rings", () => {
    const tonight = reviewedDiff();
    tonight.unchanged = [];
    tonight.toUpdate.push({
      local: entry("slice", "hero", { fields: { title: {} } }),
      remote: remote("slice", "hero", { fields: { title: {}, subtitle: {} } }),
    });
    expect(prismicAckCovers(rowFor(tonight), NOW)).toBe(false);
  });
});
