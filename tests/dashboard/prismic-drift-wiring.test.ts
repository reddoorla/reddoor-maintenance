import { describe, it, expect } from "vitest";
import {
  buildCockpitModel,
  buildSiteAlarmContext,
  buildNeedsYouFeed,
} from "../../src/dashboard/fleet-cockpit.js";
import { collectAttention, runDigest } from "../../src/reports/digest.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import type { ResendClient, ResendSendInput } from "../../src/reports/send/resend.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { makeFakeBase, type FakeRecord } from "../reports/_helpers/fake-airtable-base.js";

const NOW = new Date("2026-08-12T09:00:00.000Z");
const BASE_URL = "https://reddoor-maintenance.netlify.app";
const FRESH = "2026-08-12T06:00:00.000Z";
/** Past the 7-day pass window — the "nobody re-established this" escalation. */
const ANCIENT = "2026-07-01T06:00:00.000Z";

const site = (over: Partial<WebsiteRow> = {}): WebsiteRow =>
  makeWebsiteRow({
    id: "rec_espada",
    name: "Espada",
    status: "maintenance",
    url: "https://espada.example.com",
    prismicModels: "fail",
    prismicModelsCheckedAt: FRESH,
    prismicModelsDrift: "CHANGED  slice hero",
    ...over,
  });

/** The same row as the Airtable API returns it — the fake base runs it back through
 *  the real `mapRow`, so this also proves the three column-name magic strings
 *  ("Prismic Models", "Prismic Models Checked At", "Prismic Models Drift") survive
 *  the trip. A collector wired to fields nothing populates is wired to nothing. */
const siteRecord = (over: Partial<FakeRecord["fields"]> = {}): FakeRecord => ({
  id: "rec_espada",
  fields: {
    Name: "Espada",
    url: "https://espada.example.com",
    Status: "maintenance",
    "point of contact": "owner@espada.example.com",
    "Header image": [{ url: "https://x/h.png", filename: "h.png", type: "image/png" }],
    "Prismic Models": "fail",
    "Prismic Models Checked At": FRESH,
    "Prismic Models Drift": "CHANGED  slice hero",
    ...over,
  },
});

function captureClient(): { client: ResendClient; captured: ResendSendInput[] } {
  const captured: ResendSendInput[] = [];
  const client: ResendClient = {
    send: async (input: ResendSendInput) => {
      captured.push(input);
      return { messageId: "msg_1" };
    },
  };
  return { client, captured };
}

// The alarm-inversion failure this whole column exists to close is a nightly
// verdict that reaches the operator NOWHERE. A collector wired into one surface
// and not the other is a signal that exists in code and not in anyone's morning,
// so each of these asserts on real output, not on the source text.
describe("prismic drift wiring — the cockpit", () => {
  it("puts a drifting site's item on its card and tiers it attention", () => {
    const model = buildCockpitModel([site()], [], {}, BASE_URL, NOW);
    const card = model.cards.find((c) => c.site.name === "Espada")!;
    expect(card.items.map((i) => i.key)).toContain("prismic-drift:rec_espada");
    expect(card.tier).toBe("attention");
  });

  it("carries the unknown flavor too — a dead token is not a diverging model", () => {
    const model = buildCockpitModel(
      [site({ prismicModels: "unknown", prismicModelsDrift: "write token rejected (403)" })],
      [],
      {},
      BASE_URL,
      NOW,
    );
    const card = model.cards.find((c) => c.site.name === "Espada")!;
    expect(card.items.map((i) => i.key)).toContain("prismic-unknown:rec_espada");
    expect(card.items.find((i) => i.key === "prismic-unknown:rec_espada")!.title).toMatch(
      /could not run/i,
    );
  });

  it("carries the staleness flavor — a pass nobody has re-established", () => {
    const model = buildCockpitModel(
      [site({ prismicModels: "pass", prismicModelsCheckedAt: ANCIENT, prismicModelsDrift: null })],
      [],
      {},
      BASE_URL,
      NOW,
    );
    const card = model.cards.find((c) => c.site.name === "Espada")!;
    expect(card.items.map((i) => i.key)).toContain("prismic-stale:rec_espada");
    expect(card.tier).toBe("attention");
  });

  it("reaches the Needs-you feed, which is what the operator actually reads", () => {
    const model = buildCockpitModel([site()], [], {}, BASE_URL, NOW);
    const feed = buildNeedsYouFeed(model);
    const entry = feed.find((f) => f.siteName === "Espada")!;
    expect(entry.group).toBe("broken");
    expect(entry.reasons.join(" ")).toMatch(/Prismic models diverge/);
  });

  it("reaches the /s/<slug> page header through buildSiteAlarmContext", () => {
    const ctx = buildSiteAlarmContext(site(), [], BASE_URL, NOW);
    expect(ctx.items.map((i) => i.key)).toContain("prismic-drift:rec_espada");
    expect(ctx.tier).toBe("attention");
  });

  it("stays quiet on the cockpit for a clean, freshly-swept site", () => {
    const model = buildCockpitModel(
      [site({ prismicModels: "pass", prismicModelsDrift: null })],
      [],
      {},
      BASE_URL,
      NOW,
    );
    const card = model.cards.find((c) => c.site.name === "Espada")!;
    expect(card.items.filter((i) => i.kind === "prismic-drift")).toEqual([]);
  });
});

describe("prismic drift wiring — the digest", () => {
  it("collectAttention surfaces the item, mapped from the real Airtable columns", async () => {
    const base = makeFakeBase({ Reports: [], Websites: [siteRecord()] });
    const items = await collectAttention({
      base,
      baseUrl: BASE_URL,
      now: NOW,
      notifyBounces: new Map(),
    });
    expect(items.map((i) => i.key)).toContain("prismic-drift:rec_espada");
  });

  it("collectAttention surfaces the unknown and staleness flavors", async () => {
    const unknownBase = makeFakeBase({
      Reports: [],
      Websites: [siteRecord({ "Prismic Models": "unknown" })],
    });
    const unknownItems = await collectAttention({
      base: unknownBase,
      baseUrl: BASE_URL,
      now: NOW,
      notifyBounces: new Map(),
    });
    expect(unknownItems.map((i) => i.key)).toContain("prismic-unknown:rec_espada");

    const staleBase = makeFakeBase({
      Reports: [],
      Websites: [
        siteRecord({
          "Prismic Models": "pass",
          "Prismic Models Checked At": ANCIENT,
          "Prismic Models Drift": undefined,
        }),
      ],
    });
    const staleItems = await collectAttention({
      base: staleBase,
      baseUrl: BASE_URL,
      now: NOW,
      notifyBounces: new Map(),
    });
    expect(staleItems.map((i) => i.key)).toContain("prismic-stale:rec_espada");
  });

  it("a broken collector can never blank the section — it runs isolated", async () => {
    // runCollector's try/catch is the contract; passing a row array whose site
    // shape is intact proves the OTHER collectors still return alongside it.
    const base = makeFakeBase({ Reports: [], Websites: [siteRecord({ pScore: 40 })] });
    const items = await collectAttention({
      base,
      baseUrl: BASE_URL,
      now: NOW,
      notifyBounces: new Map(),
    });
    const keys = items.map((i) => i.key);
    expect(keys).toContain("prismic-drift:rec_espada");
    expect(keys).toContain("lighthouse:rec_espada:performance");
  });

  // `now: NOW` is load-bearing, exactly as it is in every sibling test above.
  //
  // These two were the only tests in this file that let `runDigest` fall back to
  // `new Date()`, while asserting on a fixture stamped FRESH (2026-08-12). They
  // passed the day they were written and went red four days later, on 2026-08-16,
  // when wall-clock time walked past PRISMIC_DRIFT_STALE_DAYS = 3: the verdict
  // stopped being a fresh `fail` and became an unverified one, so the digest
  // correctly said "has not run recently" instead of "diverge from the repo".
  //
  // The production code was right in both readings; only the test was
  // time-dependent. A test whose outcome depends on the day it runs does not
  // describe the behaviour it names, and this one would have failed CI on the
  // next push to main with a message pointing at drift wording rather than at a
  // clock.
  it("the drift item actually lands in the operator's digest EMAIL", async () => {
    const base = makeFakeBase({ Reports: [], Websites: [siteRecord()] });
    const { client, captured } = captureClient();
    const result = await runDigest({
      base,
      resend: client,
      baseUrl: BASE_URL,
      submissionCounts: null,
      now: NOW,
    });
    expect(result.code).toBe(0);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.html).toContain("Prismic models diverge from the repo");
    expect(captured[0]!.html).toContain("Espada");
  });

  it("the unknown item lands in the email with SECRET-shaped wording, not model-shaped", async () => {
    const base = makeFakeBase({
      Reports: [],
      Websites: [
        siteRecord({
          "Prismic Models": "unknown",
          "Prismic Models Drift": "write token rejected (403)",
        }),
      ],
    });
    const { client, captured } = captureClient();
    await runDigest({ base, resend: client, baseUrl: BASE_URL, submissionCounts: null, now: NOW });
    const html = captured[0]!.html;
    expect(html).toContain("Prismic model check could not run");
    expect(html).toContain("write token rejected (403)");
    expect(html).not.toContain("diverge from the repo");
  });

  it("a clean fleet still skips — the collector adds no noise of its own", async () => {
    const base = makeFakeBase({
      Reports: [],
      Websites: [siteRecord({ "Prismic Models": "pass", "Prismic Models Drift": undefined })],
    });
    const { client, captured } = captureClient();
    const result = await runDigest({
      base,
      resend: client,
      baseUrl: BASE_URL,
      submissionCounts: null,
    });
    expect(result.output).toContain("skipped");
    expect(captured).toHaveLength(0);
  });
});
