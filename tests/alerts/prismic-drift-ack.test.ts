import { describe, it, expect } from "vitest";
import { collectPrismicDriftAlerts } from "../../src/alerts/digest-collectors.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const NOW = new Date("2026-08-16T09:00:00.000Z");
const DASH = "https://dash";

/** ISO timestamp `days` after NOW (negative = before). */
const daysFromNow = (days: number): string =>
  new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

/** A drifting, freshly-swept, in-scope site — the shape that raises an item today. */
const drifting = (over: Partial<WebsiteRow> = {}): WebsiteRow =>
  makeWebsiteRow({
    id: "rec1",
    name: "Reddoor",
    prismicModels: "fail",
    prismicModelsCheckedAt: "2026-08-16T05:23:13.816Z",
    prismicModelsDrift: "CHANGED  slice accordion",
    ...over,
  });

/**
 * THE ACK, AND WHY IT EXPIRES.
 *
 * A `fail` is sometimes expected: the operator is modelling in Prismic on a branch
 * that has not landed, so Prismic is legitimately AHEAD of `main` and the nightly
 * is correctly reporting a real divergence the operator already knows about. That
 * deserves to stop nagging — but only for as long as the operator said, and never
 * a day longer.
 *
 * A permanent ack would be the failure this whole feature exists to prevent, just
 * slower: once the branch lands, the SAME acked cell would silently swallow real
 * drift, and "nobody is looking at this" would render as "this is fine". So the
 * ack carries an expiry and nothing else can extend it. When it lapses the alarm
 * comes back on its own.
 *
 * It is also deliberately narrow. It mutes ONE verdict — `fail`, the finding the
 * operator actually reviewed. It never mutes `unknown` (the check could not run —
 * a dead token is a different problem with a different fix) and never mutes the
 * staleness escalation (a verdict nobody has re-established is not a verdict).
 */
describe("collectPrismicDriftAlerts — an acknowledged, expected divergence", () => {
  it("mutes a fail while the ack is live", () => {
    const items = collectPrismicDriftAlerts(
      [drifting({ prismicAckUntil: daysFromNow(7) })],
      DASH,
      NOW,
    );
    expect(items).toEqual([]);
  });

  it("raises it again the moment the ack expires", () => {
    const items = collectPrismicDriftAlerts(
      [drifting({ prismicAckUntil: daysFromNow(-1) })],
      DASH,
      NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.key).toBe("prismic-drift:rec1");
  });

  it("treats an ack that expires exactly now as expired", () => {
    // The boundary belongs to the alarm, not the ack. An ack "until 09:00" has
    // nothing left to say at 09:00.
    const items = collectPrismicDriftAlerts(
      [drifting({ prismicAckUntil: NOW.toISOString() })],
      DASH,
      NOW,
    );
    expect(items).toHaveLength(1);
  });

  it("ignores an unparseable ack rather than honouring it — fails toward the alarm", () => {
    // A typo'd cell must not mute a real finding. `Date.parse` yields NaN and every
    // comparison against NaN is false, but that is a property of the implementation,
    // not a decision — assert the decision.
    const items = collectPrismicDriftAlerts(
      [drifting({ prismicAckUntil: "next tuesday-ish" })],
      DASH,
      NOW,
    );
    expect(items).toHaveLength(1);
  });

  it("leaves an un-acked site exactly as it was", () => {
    const items = collectPrismicDriftAlerts([drifting({ prismicAckUntil: null })], DASH, NOW);
    expect(items).toHaveLength(1);
  });

  it("NEVER mutes `unknown` — the check could not run, which the operator has not accepted", () => {
    // Accepting "Prismic is ahead of main" says nothing about a dead write token.
    // Muting this would send the operator to fix a model when the job is a secret.
    const items = collectPrismicDriftAlerts(
      [
        drifting({
          prismicModels: "unknown",
          prismicModelsDrift: "401 from the Custom Types API",
          prismicAckUntil: daysFromNow(7),
        }),
      ],
      DASH,
      NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.key).toBe("prismic-unknown:rec1");
  });

  it("NEVER mutes the staleness escalation — an ack cannot outlive the evidence", () => {
    // The sweep stopped running for this site days ago. The last thing it said was
    // "fail", and the operator acked that. If the ack also suppressed staleness, a
    // site whose check had silently died would look accepted-and-fine indefinitely.
    const items = collectPrismicDriftAlerts(
      [
        drifting({
          prismicModelsCheckedAt: daysFromNow(-30),
          prismicAckUntil: daysFromNow(7),
        }),
      ],
      DASH,
      NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.key).toBe("prismic-stale:rec1");
  });

  it("mutes only the acked site, not its neighbours", () => {
    const items = collectPrismicDriftAlerts(
      [
        drifting({ prismicAckUntil: daysFromNow(7) }),
        drifting({ id: "rec2", name: "Espada", prismicAckUntil: null }),
      ],
      DASH,
      NOW,
    );
    expect(items.map((i) => i.key)).toEqual(["prismic-drift:rec2"]);
  });
});
