import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KyselyPlugin, PluginTransformQueryArgs, PluginTransformResultArgs } from "kysely";
import { openDb, type Db } from "../../src/db/client.js";
import { writeDigestState, writeCockpitRollup } from "../../src/db/digest-state.js";
import { createDeadLetter } from "../../src/db/deadletter.js";
import { recordFleetEvent } from "../../src/db/fleet-events.js";
import { recordScreenOut } from "../../src/db/screenouts.js";
import { loadCockpitModel, loadSiteDashboard } from "../../src/dashboard/page-data.js";

/**
 * The cockpit's page loaders run their independent reads together, so a load
 * costs as many Turso round trips as its longest chain of dependent reads, not
 * one per query. Two instruments:
 *
 * - **Waves.** A plugin holds every query's result for a fixed time and gives
 *   each query a wave: one more than the deepest wave that had finished when it
 *   started. The deepest wave is the load's critical path in round trips.
 *   (Kysely runs `transformResult` outside its connection mutex, so this
 *   measures the loader's structure; the mutex is pinned in
 *   tests/db/client-concurrency.test.ts.)
 * - **Faults.** A plugin fails the queries one matcher picks. Each defensive
 *   read must degrade the model exactly as the sequential loaders did: the
 *   snapshots were written against them, before the change.
 */

const NOW = new Date("2026-10-20T12:00:00.000Z");
const BASE = "https://dash.example";
const HOLD_MS = 15;

let dir: string;
let db: Db;

function waves(): { plugin: KyselyPlugin; depth: () => number; count: () => number } {
  const waveOf = new Map<unknown, number>();
  let finished = 0;
  let deepest = 0;
  return {
    plugin: {
      transformQuery(args: PluginTransformQueryArgs) {
        const wave = finished + 1;
        waveOf.set(args.queryId, wave);
        deepest = Math.max(deepest, wave);
        return args.node;
      },
      async transformResult(args: PluginTransformResultArgs) {
        await new Promise((r) => setTimeout(r, HOLD_MS));
        finished = Math.max(finished, waveOf.get(args.queryId) ?? 0);
        return args.result;
      },
    },
    depth: () => deepest,
    count: () => waveOf.size,
  };
}

type Matcher = (q: { sql: string; parameters: readonly unknown[] }) => boolean;

/** Fails every query `match` picks, and counts them, so a test can prove its
 *  matcher hit the read it names (an instrument that matched nothing would
 *  "degrade" nothing and pass). */
function fault(base: Db, match: Matcher): { plugin: KyselyPlugin; hits: () => number } {
  let hits = 0;
  return {
    plugin: {
      transformQuery(args: PluginTransformQueryArgs) {
        const q = base.getExecutor().compileQuery(args.node, args.queryId);
        if (match(q)) {
          hits++;
          throw new Error("injected Turso blip");
        }
        return args.node;
      },
      async transformResult(args: PluginTransformResultArgs) {
        return args.result;
      },
    },
    hits: () => hits,
  };
}

const has =
  (...parts: string[]): Matcher =>
  (q) =>
    parts.every((p) => q.sql.includes(p));
const param =
  (value: unknown): Matcher =>
  (q) =>
    q.parameters.includes(value);
const and =
  (...ms: Matcher[]): Matcher =>
  (q) =>
    ms.every((m) => m(q));
const not =
  (m: Matcher): Matcher =>
  (q) =>
    !m(q);

/** The defensive reads of `/`, each named by a matcher that picks only it. */
const COCKPIT_READS: Record<string, Matcher> = {
  listAllReports: has('from "reports"'),
  readDigestState: and(has('from "digest_state"'), param("default")),
  listNewSubmissions: and(has('from "submissions"'), param("new"), not(has("count("))),
  readCockpitRollup: and(has('from "digest_state"'), param("cockpit_rollup")),
  listFleetEvents: has('from "fleet_events"'),
  countAutoSpamSince: and(has('from "submissions"'), param("spam_auto")),
  countUnreplayedDeadLettersBySlug: and(has('from "submission_deadletter"'), has("count(")),
  oldestUnreplayedDeadLetterBySlug: and(has('from "submission_deadletter"'), has("min(")),
};

/** The defensive reads of `/s/:slug`. */
const SITE_READS: Record<string, Matcher> = {
  listSubmissionsForSite: and(has('from "submissions"'), has("select *")),
  screenOutBuckets: has('from "spam_screenouts"'),
  screenOutMarkedSpam: and(has('from "submissions"'), param("spam")),
  countNotifyBouncedForSite: and(has('from "submissions"'), param("bounced")),
  countUnreplayedDeadLettersForSlug: and(has('from "submission_deadletter"'), has("count(")),
  oldestUnreplayedDeadLetterForSlug: and(has('from "submission_deadletter"'), has("min(")),
  readDigestState: and(has('from "digest_state"'), param("default")),
};

async function seedSite(
  id: string,
  name: string,
  slug: string,
  over: Record<string, unknown> = {},
) {
  await db
    .insertInto("sites")
    .values({
      id,
      slug,
      name,
      url: `https://${slug}.example.com`,
      status: "maintained",
      ...over,
    } as never)
    .execute();
}

async function seedSubmission(id: string, siteId: string, over: Record<string, unknown> = {}) {
  await db
    .insertInto("submissions")
    .values({
      id,
      site_id: siteId,
      form_type: "contact",
      name: "Pat",
      email: "pat@example.com",
      status: "new",
      notify_status: "sent",
      submitted_at: "2026-10-19T10:00:00.000Z",
      ...over,
    } as never)
    .execute();
}

/** Every read has something to say, so failing any one of them shows. */
async function seedEverything() {
  await seedSite("recA", "Acme", "acme");
  await seedSite("recB", "Beta", "beta");
  await db
    .insertInto("site_health")
    .values({ site_id: "recA", vulns_critical: 1 } as never)
    .execute();
  await db
    .insertInto("reports")
    .values({
      id: "rep1",
      site_id: "recA",
      report_id: "rep1-2026-09",
      report_type: "Maintenance",
      draft_ready: 1,
      approved_to_send: 0,
      sent_at: null,
      period_start: "2026-09-01",
    } as never)
    .execute();
  await seedSubmission("sub-new", "recA");
  await seedSubmission("sub-spam", "recA", { status: "spam" });
  await seedSubmission("sub-auto", "recA", { status: "spam_auto" });
  // NOTIFY_BOUNCE_THRESHOLD is 2.
  for (const id of ["sub-bounce1", "sub-bounce2"]) {
    await seedSubmission(id, "recA", {
      status: "read",
      notify_status: "bounced",
      bounce_type: "Permanent",
    });
  }
  await recordScreenOut(db, "recA", "honeypot", "2026-10-18");
  await writeDigestState(db, { "vuln:recA": { metric: 1, firstFlaggedAt: "2026-10-19" } });
  await writeCockpitRollup(db, {
    spamTotals: { honeypot: 3, tooFast: 2, markedSpam: 1 },
    notifyBounces: { recA: { total: 1, permanent: 1 } },
    windowDays: { screenOuts: 7, bounces: 14 },
    computedAt: "2026-10-20T06:00:00.000Z",
  });
  await recordFleetEvent(db, {
    id: "ev1",
    ts: "2026-10-19T09:00:00.000Z",
    type: "pr_automerged",
    siteId: "recA",
    siteName: "Acme",
    summary: "Renovate merged a PR",
    data: null,
  } as never);
  await createDeadLetter(db, {
    siteSlug: "acme",
    payload: { name: "Lost" },
    turnstile: null,
    error: "store down",
    receivedAt: new Date("2026-10-20T11:30:00.000Z"),
  } as never);
  // Acme's dead letter is fresh, so it is held (OD 87) and only the oldest read
  // shows it; Beta's is days old and alarms, so only the count shows it.
  await createDeadLetter(db, {
    siteSlug: "beta",
    payload: { name: "Lost too" },
    turnstile: null,
    error: "store down",
    receivedAt: new Date("2026-10-16T09:00:00.000Z"),
  } as never);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "page-data-waves-"));
  db = await openDb({ url: `file:${join(dir, "db.sqlite")}` });
  await seedEverything();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("round trips per load", () => {
  it("/ reads everything in one wave", async () => {
    const w = waves();
    await loadCockpitModel(db.withPlugin(w.plugin), NOW, BASE);
    expect(w.count()).toBe(9);
    expect(w.depth()).toBe(1);
  });

  it("/s/:slug reads the site, then everything else in one more wave", async () => {
    const w = waves();
    const data = await loadSiteDashboard(db.withPlugin(w.plugin), "acme", NOW, BASE);
    expect(data?.site.name).toBe("Acme");
    expect(w.count()).toBe(9);
    expect(w.depth()).toBe(2);
  });

  it("/s/:slug for an unknown slug makes exactly one query", async () => {
    const w = waves();
    expect(await loadSiteDashboard(db.withPlugin(w.plugin), "nope", NOW, BASE)).toBeNull();
    expect(w.count()).toBe(1);
  });
});

describe("/ : a failed read degrades as the sequential loader did", () => {
  it("each matcher picks exactly its own read", async () => {
    for (const [name, match] of Object.entries(COCKPIT_READS)) {
      const seen: string[] = [];
      const probe = fault(db, (q) => (match(q) ? (seen.push(q.sql), false) : false));
      await loadCockpitModel(db.withPlugin(probe.plugin), NOW, BASE);
      expect(seen, name).toHaveLength(1);
    }
  });

  for (const [name, match] of Object.entries(COCKPIT_READS)) {
    it(`${name} fails: the page still renders, degraded as before`, async () => {
      const whole = await loadCockpitModel(db, NOW, BASE);
      const f = fault(db, match);
      const model = await loadCockpitModel(db.withPlugin(f.plugin), NOW, BASE);
      expect(f.hits()).toBe(1);
      expect(model).not.toEqual(whole);
      expect(model).toMatchSnapshot();
    });
  }

  it("a failed listSites throws, rather than rendering an empty fleet", async () => {
    const f = fault(db, has('from "sites"'));
    await expect(loadCockpitModel(db.withPlugin(f.plugin), NOW, BASE)).rejects.toThrow(
      "injected Turso blip",
    );
  });

  it("the whole model, unfaulted", async () => {
    expect(await loadCockpitModel(db, NOW, BASE)).toMatchSnapshot();
  });
});

describe("/s/:slug : a failed read degrades as the sequential loader did", () => {
  it("each matcher picks exactly its own read", async () => {
    for (const [name, match] of Object.entries(SITE_READS)) {
      const seen: string[] = [];
      const probe = fault(db, (q) => (match(q) ? (seen.push(q.sql), false) : false));
      await loadSiteDashboard(db.withPlugin(probe.plugin), "acme", NOW, BASE);
      expect(seen, name).toHaveLength(1);
    }
  });

  for (const [name, match] of Object.entries(SITE_READS)) {
    it(`${name} fails: the page still renders, degraded as before`, async () => {
      const whole = await loadSiteDashboard(db, "acme", NOW, BASE);
      const f = fault(db, match);
      const data = await loadSiteDashboard(db.withPlugin(f.plugin), "acme", NOW, BASE);
      expect(f.hits()).toBe(1);
      expect(data).not.toEqual(whole);
      expect(data).toMatchSnapshot();
    });
  }

  it("a failed listReportsForSite throws", async () => {
    const f = fault(db, has('from "reports"'));
    await expect(loadSiteDashboard(db.withPlugin(f.plugin), "acme", NOW, BASE)).rejects.toThrow(
      "injected Turso blip",
    );
  });

  it("the whole page data, unfaulted", async () => {
    expect(await loadSiteDashboard(db, "acme", NOW, BASE)).toMatchSnapshot();
  });
});
