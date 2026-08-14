import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { collectPrismicDriftAlerts } from "../../src/alerts/digest-collectors.js";
import { fromAirtableBase } from "../../src/inventory/airtable.js";
import type { Status, WebsiteRow } from "../../src/reports/airtable/websites.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";

/**
 * THE TWO SCOPE PREDICATES MUST AGREE — this file is the pin, and it exists
 * BECAUSE THE DUPLICATION IS DELIBERATE.
 *
 * `prismicSweepCovers` (src/alerts/digest-collectors.ts) answers "was the nightly
 * `prismic-models --fleet airtable` sweep OWED a verdict for this site?" and gates
 * the `prismic-stale:` escalation — the one alarm in that collector invented from
 * an ABSENCE rather than from a verdict some run established.
 *
 * `fromAirtableBase` (src/inventory/airtable.ts) decides which rows that sweep
 * actually visits. It is fleet-wide behaviour shared by nine commands, so the
 * alerts layer deliberately does NOT import it: the inventory builds `Site`
 * objects and needs a workdir, while the alert needs a pure predicate over a row.
 *
 * The cost of that duplication is drift, and drift is not symmetric:
 *
 *   - alarm WIDER than sweep → a site nobody sweeps is reported every morning as
 *     "the check has not run recently", forever. Attention items sit above the
 *     accepted-watch mute, so it is un-ackable and unfixable except by
 *     hand-clearing an Airtable cell. This is the exact defect the predicate was
 *     added to prevent.
 *   - sweep WIDER than alarm → a site IS swept and its verdict can go stale in
 *     silence, which is "I could not read X" rendered as "X is fine".
 *
 * So instead of a comment asking the next person to remember, every shape below is
 * put through BOTH real implementations and the two answers are required to match.
 * Nothing here re-states either filter's rules — a copy of the predicate would just
 * be a third thing to keep in step.
 *
 * If you widen one, this file goes red until you widen the other.
 */

const NOW = new Date("2026-08-13T09:00:00.000Z");
const DASH = "https://dash.example.com";
const WORKDIR = "/tmp/prismic-sweep-scope";

/** Every `Status` the code recognises, plus the two off-list values a real cell
 *  can hold: blank (`null`) and a typo, which `mapRow` casts through unchanged. */
const STATUSES: ReadonlyArray<Status | null> = [
  "maintenance",
  "launch period",
  "in development",
  "hosting",
  "probably not our problem",
  "deprecated",
  "legacy",
  null,
  "Maintenance " as Status, // operator typo: trailing space + capital
];

/** The `url` axis — the inventory requires a non-empty one, and a site with no
 *  URL is one no fleet command can reach. */
const URLS = ["https://acme.example.com", ""];

/** The `Name` axis, and the one that is easy to miss: the inventory drops a row
 *  whose Name yields an EMPTY slug, because an empty slug can neither form a
 *  checkout path nor be matched back to its Websites row on write-back. Both
 *  values below slug to "". */
const NAMES = ["Acme Co", "!!!", ""];

/** Was the nightly sweep EXPECTED to cover this row, per the alerts layer?
 *
 *  Read through the public collector rather than by exporting the private
 *  predicate, so this pins the OBSERVABLE behaviour — a refactor that keeps the
 *  predicate and stops consulting it is exactly as much of a regression.
 *
 *  The row carries a `pass` far older than PRISMIC_STALE_PASS_DAYS, so the
 *  staleness escalation is armed for every shape and the ONLY thing that can
 *  suppress the item is the scope gate. */
function alarmExpectsASweep(row: WebsiteRow): boolean {
  return collectPrismicDriftAlerts([row], DASH, NOW).some((i) =>
    i.key.startsWith("prismic-stale:"),
  );
}

/** Does the sweep's own inventory actually visit this row? The REAL provider —
 *  `--fleet airtable` resolves through exactly this function. */
async function sweepVisits(row: WebsiteRow): Promise<boolean> {
  const base = makeFakeBase({
    Websites: [
      {
        id: row.id,
        // Built FROM the row so one shape drives both sides. Status is omitted
        // rather than sent as null, because that is how a blank cell arrives.
        fields: { Name: row.name, url: row.url, ...(row.status ? { Status: row.status } : {}) },
      },
    ],
  });
  const sites = await fromAirtableBase(base, { workdir: WORKDIR })();
  return sites.length > 0;
}

beforeEach(() => {
  // The inventory warns (correctly) on an empty-slug row. Silence it so the
  // matrix does not bury the run's real output.
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the Prismic staleness gate and the sweep inventory cover the same sites", () => {
  it("agrees on every status × url × name shape", async () => {
    const disagreements: string[] = [];
    for (const status of STATUSES) {
      for (const url of URLS) {
        for (const name of NAMES) {
          const row = makeWebsiteRow({
            id: "rec1",
            name,
            url,
            status,
            // A green claim nobody has re-established for 400 days: the
            // staleness item fires for any covered site, and nothing else in
            // the collector does.
            prismicModels: "pass",
            prismicModelsCheckedAt: new Date(NOW.getTime() - 400 * 86_400_000).toISOString(),
          });
          const alarmed = alarmExpectsASweep(row);
          const swept = await sweepVisits(row);
          if (alarmed !== swept) {
            disagreements.push(
              `status=${JSON.stringify(status)} url=${JSON.stringify(url)} name=${JSON.stringify(name)}` +
                ` — staleness gate says ${alarmed ? "COVERED" : "not covered"},` +
                ` inventory says ${swept ? "SWEPT" : "not swept"}`,
            );
          }
        }
      }
    }
    // Collected rather than asserted in the loop, so one red run names EVERY
    // shape that drifted instead of only the first.
    expect(disagreements).toEqual([]);
  });

  // Guards the matrix itself. An assertion that a list is EMPTY is satisfied just
  // as well by a list nothing was ever added to — so prove the loop reaches both
  // answers, or the test above could pass with the predicates deleted.
  it("the matrix actually exercises both answers", async () => {
    const rows = STATUSES.flatMap((status) =>
      URLS.flatMap((url) => NAMES.map((name) => makeWebsiteRow({ id: "rec1", name, url, status }))),
    );
    const visited = await Promise.all(rows.map(sweepVisits));
    expect(visited).toContain(true);
    expect(visited).toContain(false);
  });

  it("covers a live, named, reachable site — the case the alarm exists for", async () => {
    const row = makeWebsiteRow({
      id: "rec1",
      name: "Espada",
      url: "https://espada.example.com",
      status: "maintenance",
      prismicModels: "pass",
      prismicModelsCheckedAt: new Date(NOW.getTime() - 400 * 86_400_000).toISOString(),
    });
    expect(alarmExpectsASweep(row)).toBe(true);
    expect(await sweepVisits(row)).toBe(true);
  });
});
