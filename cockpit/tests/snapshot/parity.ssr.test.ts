import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../../../src/db/client.js";
import { writeDigestState, writeCockpitRollup } from "../../../src/db/digest-state.js";
import { createDeadLetter } from "../../../src/db/deadletter.js";
import { recordFleetEvent } from "../../../src/db/fleet-events.js";
import { recordScreenOut } from "../../../src/db/screenouts.js";
import {
  loadCockpitModel,
  loadFleetTableModel,
  loadSiteDashboard,
  loadSubmissionsPage,
  loadProspectAudits,
} from "../../../src/dashboard/page-data.js";
import type { SubmissionsPageLoad } from "../../../src/dashboard/page-data.js";
import type { CockpitModel } from "../../../src/dashboard/fleet-cockpit.js";
import { loadCockpitSnapshot, MAILCHIMP_KEY_REDACTED } from "../../../src/dashboard/snapshot.js";
import {
  auditsFromSnapshot,
  cockpitModelFromSnapshot,
  fleetTableModelFromSnapshot,
  siteDashboardFromSnapshot,
  submissionsPageFromSnapshot,
  type CockpitSnapshot,
} from "../../../src/dashboard/snapshot-views.js";
import { buildCockpitView, buildSitesView } from "../../src/lib/cockpit/view.js";
import { buildSiteView } from "../../src/lib/site/view.js";
import { auditsPageView } from "../../src/lib/audits/view.js";
import { buildSubmissionsPageData } from "../../src/routes/submissions/data.js";

/**
 * The snapshot changes where a page's data comes from, never what the page shows
 * (home base `briefs/2026-10-21-cockpit-one-snapshot.md`). So every page is derived
 * both ways from one seeded database, today's per-page loader and the snapshot, and
 * the two must agree: the model, and the view the page component is handed.
 *
 * The seed is generated, so the SQL the derivations restate (the `/submissions`
 * filters' LIKEs, the windows, the caps, the per-site aggregates) meets values on
 * both sides of each predicate: NULL columns, non-ASCII case, LIKE metacharacters,
 * `:N` reason suffixes, dates either side of every window.
 */

const NOW = new Date("2026-10-20T12:00:00.000Z");
const LATER = new Date("2026-11-05T09:30:00.000Z");
const BASE = "https://dash.example";

let dir: string;
let db: Db;

/** Deterministic, so a failure reproduces. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const SITES = [
  { id: "recA", name: "Acme", slug: "acme", mailchimp: "us1-secret-key" },
  { id: "recB", name: "Beta Builders", slug: "beta-builders", mailchimp: null },
  // A stored slug that is not siteSlug(name): `/s/:slug` matches the column.
  { id: "recC", name: "Çedar & Co", slug: "cedar-co", mailchimp: null },
  { id: "recD", name: "Dormant", slug: "dormant", mailchimp: null },
];

const NAMES = ["Pat", "PAT O'Neil", "Émile", "émile", "Zoë_x", "100% Real", null];
const MESSAGES = [
  "line1\nline2",
  "Need a QUOTE for 50% off",
  "café au lait",
  "CAFÉ",
  "under_score here",
  null,
  "back\\slash",
];
const REASONS = [
  null,
  "",
  "links",
  "backlinks",
  "keywords:4,links",
  "Turnstile-Required-Absent",
  "turnstile-required-absent-failed",
  "links:2",
];
const STATUSES = ["new", "read", "archived", "spam", "spam_auto"];
const FORMS = ["contact", "inquiry", "newsletter"];
const BOUNCE_TYPES = [null, "Permanent", "permanent", "Transient"];

async function seed() {
  for (const s of SITES) {
    await db
      .insertInto("sites")
      .values({
        id: s.id,
        slug: s.slug,
        name: s.name,
        url: `https://${s.slug}.example.com`,
        status: s.id === "recD" ? "archived" : "maintained",
        mailchimp_api_key: s.mailchimp,
      } as never)
      .execute();
  }
  await db
    .insertInto("site_health")
    .values({ site_id: "recA", vulns_critical: 1 } as never)
    .execute();
  let n = 0;
  for (const [site, type, period, draft, approved, sent] of [
    ["recA", "Maintenance", "2026-09-01", 1, 0, null],
    ["recA", "Testing", "2026-08-01", 1, 1, "2026-08-10T16:00:00.000Z"],
    ["recB", "Maintenance", "2026-09-01", 1, 1, null],
    ["recC", "Maintenance", "2026-07-01", 0, 0, null],
  ] as const) {
    n++;
    await db
      .insertInto("reports")
      .values({
        id: `rep${n}`,
        site_id: site,
        report_id: `rep${n}-${period}`,
        report_type: type,
        draft_ready: draft,
        approved_to_send: approved,
        sent_at: sent,
        period_start: period,
        rendered_html: n % 2 === 0 ? "<p>body</p>" : null,
      } as never)
      .execute();
  }
  const r = rng(7);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  // 160 rows over the 70 days before LATER, one minute apart at least, so no two
  // share a `submitted_at` (the SQL's order among ties is unspecified).
  const start = LATER.getTime() - 70 * 86_400_000;
  for (let i = 0; i < 160; i++) {
    const at = new Date(start + i * 37_000_000 + Math.floor(r() * 60) * 60_000);
    const bounced = r() < 0.2;
    await db
      .insertInto("submissions")
      .values({
        id: `sub${i}`,
        submission_id: i + 1,
        site_id: pick(["recA", "recA", "recB", "recC"]),
        form_type: pick(FORMS),
        name: pick(NAMES) ?? "",
        email: pick(["pat@example.com", "ZOE@Example.COM", "x_y@ex.org"]),
        phone: pick([null, "555-0100", "+1 (555) 0199"]),
        message: pick(MESSAGES),
        status: pick(STATUSES),
        notify_status: bounced ? "bounced" : pick(["sent", "skipped", "failed"]),
        bounce_type: bounced ? pick(BOUNCE_TYPES) : null,
        bounce_ack_at: bounced && r() < 0.3 ? "2026-10-01T00:00:00.000Z" : null,
        spam_score: r() < 0.5 ? Math.floor(r() * 10) : null,
        spam_reason: pick(REASONS),
        submitted_at: at.toISOString(),
      } as never)
      .execute();
  }
  for (let d = 0; d < 45; d += 3) {
    const date = new Date(LATER.getTime() - d * 86_400_000).toISOString().slice(0, 10);
    await recordScreenOut(db, pick(["recA", "recB"]), pick(["honeypot", "too-fast"]), date);
  }
  await writeDigestState(db, { "vuln:recA": { metric: 1, firstFlaggedAt: "2026-10-19" } });
  await writeCockpitRollup(db, {
    spamTotals: { honeypot: 3, tooFast: 2, markedSpam: 1 },
    notifyBounces: { recA: { total: 2, permanent: 1 } },
    windowDays: { screenOuts: 7, bounces: 14 },
    computedAt: "2026-10-20T06:00:00.000Z",
  });
  for (let i = 0; i < 30; i++) {
    await recordFleetEvent(db, {
      id: `ev${i}`,
      ts: new Date(NOW.getTime() - i * 9 * 3_600_000).toISOString(),
      type: "pr_automerged",
      siteId: "recA",
      siteName: "Acme",
      summary: `Renovate merged PR ${i}`,
      data: null,
    } as never);
  }
  await createDeadLetter(db, {
    siteSlug: "acme",
    payload: { name: "Lost" },
    turnstile: null,
    error: "store down",
    receivedAt: new Date("2026-10-20T11:30:00.000Z"),
  } as never);
  await createDeadLetter(db, {
    siteSlug: "beta-builders",
    payload: { name: "Lost too" },
    turnstile: null,
    error: "store down",
    receivedAt: new Date("2026-10-16T09:00:00.000Z"),
  } as never);
  for (let i = 0; i < 30; i++) {
    await db
      .insertInto("prospect_audits")
      .values({
        id: `pa${i}`,
        token: `tok${i}`,
        url: `https://p${i}.example/`,
        business: i % 3 === 0 ? null : `Biz ${i}`,
        created_at: new Date(NOW.getTime() - i * 3_600_000).toISOString(),
        status: "complete",
        result_json: '{"big":"blob"}',
      } as never)
      .execute();
  }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "snapshot-parity-"));
  db = await openDb({ url: `file:${join(dir, "db.sqlite")}` });
  await seed();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The snapshot as the browser holds it: through a structured clone, as
 *  SvelteKit's serialisation hands Maps and plain data across. */
async function snapshotAt(now: Date): Promise<CockpitSnapshot> {
  return structuredClone(await loadCockpitSnapshot(db, now, BASE));
}

/** The loader's site row carries the real key; the snapshot's a marker. */
function unredacted<T extends { site: { mailchimpApiKey: string | null } }>(
  d: T,
  key: string | null,
): T {
  return { ...d, site: { ...d.site, mailchimpApiKey: key } };
}

/** The cockpit model carries the site rows; put the real keys back to compare. */
function withKeys(m: CockpitModel): CockpitModel {
  const key = new Map(SITES.map((x) => [x.id, x.mailchimp]));
  return JSON.parse(JSON.stringify(m), (k, v: unknown) => {
    if (v && typeof v === "object" && "mailchimpApiKey" in v && "id" in v) {
      const row = v as { id: string; mailchimpApiKey: unknown };
      return { ...row, mailchimpApiKey: key.get(row.id) ?? null };
    }
    return v;
  }) as CockpitModel;
}

/** `listSpamReasonsFiltered` has no ORDER BY, and the page only tallies the reasons
 *  (`spamFacets`), so the model's list compares as a bag; the page data, which holds
 *  the tally, still compares exactly below. */
function facetsAsBag(r: SubmissionsPageLoad): SubmissionsPageLoad {
  if (r.kind !== "ok") return r;
  return { ...r, model: { ...r.model, facetReasons: [...r.model.facetReasons].sort() } };
}

const SUBMISSION_QUERIES = [
  "",
  "site=acme",
  "site=beta-builders&status=new",
  "site=cedar-co", // siteSlug("Çedar & Co") is not the stored slug
  "site=nope",
  ...STATUSES.map((s) => `status=${s}`),
  ...FORMS.map((f) => `type=${f}`),
  "q=pat",
  "q=PAT",
  "q=%25",
  "q=_",
  "q=%5C",
  "q=caf%C3%A9",
  "q=CAF%C3%89",
  "q=%C3%A9mile",
  "q=%C3%89mile",
  "q=0100",
  "q=example.com",
  "q=line1",
  "q=%20%20",
  "status=spam_auto&reason=links",
  "status=spam&reason=LINKS",
  "status=spam_auto&reason=keywords",
  "reason=turnstile-required-absent",
  "reason=link",
  "from=2026-10-01&to=2026-10-15",
  "from=2026-10-10T05:00:00.000Z",
  "to=2026-09-01",
  "page=2",
  "page=3&status=read",
  "page=99",
  "status=spam&site=acme&q=pat&type=contact",
];

for (const [label, now] of [
  ["now", NOW],
  ["sixteen days on", LATER],
] as const) {
  describe(`every page, derived from the snapshot, equals its loader (${label})`, () => {
    it("/", async () => {
      const s = await snapshotAt(now);
      const loaded = await loadCockpitModel(db, now, BASE);
      expect(withKeys(cockpitModelFromSnapshot(s, now))).toEqual(loaded);
      expect(buildCockpitView(cockpitModelFromSnapshot(s, now), now)).toEqual(
        buildCockpitView(loaded, now),
      );
    });

    for (const q of ["", "sort=name&dir=desc", "status=archived", "q=bet"]) {
      it(`/fleet?${q}`, async () => {
        const s = await snapshotAt(now);
        const params = new URLSearchParams(q);
        expect(fleetTableModelFromSnapshot(s, params)).toEqual(
          await loadFleetTableModel(db, params),
        );
        expect(buildSitesView(cockpitModelFromSnapshot(s, now), now)).toEqual(
          buildSitesView(await loadCockpitModel(db, now, BASE), now),
        );
      });
    }

    for (const site of [...SITES.map((x) => x.slug), "nope", "cedar-&-co"]) {
      it(`/s/${site}`, async () => {
        const s = await snapshotAt(now);
        const loaded = await loadSiteDashboard(db, site, now, BASE);
        const derived = siteDashboardFromSnapshot(s, site, now);
        if (loaded === null) {
          expect(derived).toBeNull();
          return;
        }
        expect(derived).not.toBeNull();
        if (derived === null) return;
        expect(unredacted(derived, loaded.site.mailchimpApiKey)).toEqual(loaded);
        const view = (d: typeof loaded) =>
          buildSiteView(d.site, d.reports, d.submissions, d.spamTotals, now, d.alarm);
        expect(view(derived)).toEqual(view(loaded));
      });
    }

    for (const q of SUBMISSION_QUERIES) {
      it(`/submissions?${q}`, async () => {
        const s = await snapshotAt(now);
        const params = new URLSearchParams(q);
        const loaded = await loadSubmissionsPage(db, params);
        const derived = submissionsPageFromSnapshot(s, params);
        expect(facetsAsBag(derived)).toEqual(facetsAsBag(loaded));
        if (loaded.kind === "ok" && derived.kind === "ok") {
          expect(buildSubmissionsPageData(derived.model)).toEqual(
            buildSubmissionsPageData(loaded.model),
          );
        }
      });
    }

    it("/audits", async () => {
      const s = await snapshotAt(now);
      const loaded = await loadProspectAudits(db);
      expect(auditsFromSnapshot(s)).toEqual(loaded);
      expect(auditsPageView(auditsFromSnapshot(s), now)).toEqual(auditsPageView(loaded, now));
    });
  });
}

describe("the parity instrument", () => {
  // It must be able to fail: a seed where every predicate is vacuous would pass any
  // derivation. Each of these buckets is non-empty and smaller than the table.
  it("seeds every /submissions filter with rows on both sides", async () => {
    const all = (await loadSubmissionsPage(db, new URLSearchParams(""))).kind === "ok";
    expect(all).toBe(true);
    for (const q of ["q=caf%C3%A9", "q=%25", "q=_", "status=spam_auto&reason=links", "site=acme"]) {
      const r = await loadSubmissionsPage(db, new URLSearchParams(q));
      expect(r.kind).toBe("ok");
      if (r.kind !== "ok") continue;
      expect(r.model.total, q).toBeGreaterThan(0);
      expect(r.model.total, q).toBeLessThan(160);
    }
  });

  it("sees a derivation that drops one row", async () => {
    const s = await snapshotAt(NOW);
    const params = new URLSearchParams("site=acme");
    const loaded = await loadSubmissionsPage(db, params);
    const firstAcme = (s.submissions ?? []).findIndex((r) => r.siteId === "recA");
    const short = { ...s, submissions: (s.submissions ?? []).filter((_, i) => i !== firstAcme) };
    expect(submissionsPageFromSnapshot(short, params)).not.toEqual(loaded);
  });
});

describe("what the snapshot holds", () => {
  it("never a Mailchimp key, only whether one is set", async () => {
    const s = await snapshotAt(NOW);
    const acme = s.sites.find((w) => w.id === "recA");
    expect(acme?.mailchimpApiKey).toBe(MAILCHIMP_KEY_REDACTED);
    expect(s.sites.find((w) => w.id === "recB")?.mailchimpApiKey).toBeNull();
    expect(JSON.stringify(s.sites)).not.toContain("us1-secret-key");
  });
});
