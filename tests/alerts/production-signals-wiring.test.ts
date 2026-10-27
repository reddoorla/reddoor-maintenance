/**
 * P1-78c review round 1 (tests lens): every path a production signal takes to the
 * operator, proven end to end — the scope filters, the far/behind split, the snapshot
 * the SvelteKit cockpit renders from, pm-cockpit and the fleet_daily writer's model,
 * the digest's own read of fleet_daily, the a11y stamp, and the a11y install.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectA11yAlerts,
  collectDepsAlerts,
  collectDomainAlerts,
  collectFunctionHealthAlerts,
  collectLinkAlerts,
  collectRenderAlerts,
  collectSearchConsoleAlerts,
  collectTitleMetaAlerts,
  collectUptimeAlerts,
  freshWithin,
  type LatestDeps,
} from "../../src/alerts/production-signals.js";
import { buildCockpitModel, buildSiteAlarmContext } from "../../src/dashboard/fleet-cockpit.js";
import { runDigest } from "../../src/reports/digest.js";
import { auditFields } from "../../src/fleet/site-fields.js";
import { browserStatus } from "../../src/audits/browser.js";
import { installSiteDeps } from "../../src/audits/util/install-site.js";
import { a11yAudit, A11Y_INSTALL_ENV } from "../../src/audits/a11y.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";
import { openDb, type Db } from "../../src/db/client.js";
import { writeDigestState } from "../../src/db/digest-state.js";
import { readLatestDeps } from "../../src/fleet-daily/read.js";
import { loadCockpitSnapshot } from "../../src/dashboard/snapshot.js";
import {
  cockpitModelFromSnapshot,
  siteDashboardFromSnapshot,
} from "../../src/dashboard/snapshot-views.js";
import {
  buildPmCockpit,
  cockpitFromInputs,
  formatPmCockpit,
  loadCockpitInputs,
} from "../../scripts/pm-cockpit.mjs";
import type { WebsiteRow } from "../../src/fleet/site-row.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { websiteRowsFrom, reportRowsFrom } from "../_helpers/raw-rows.js";
import type { ResendClient, ResendSendInput } from "../../src/reports/send/resend.js";

const BASE = "https://cockpit.test";
const NOW = new Date("2026-10-26T12:00:00.000Z");
const FRESH = "2026-10-26T06:30:00.000Z";
const STALE = "2026-10-23T11:00:00.000Z";

const site = (over: Partial<WebsiteRow> = {}): WebsiteRow =>
  makeWebsiteRow({ id: "recS", name: "Sonder", status: "maintained", ...over });

/** Every new signal failing, on one row. */
const failing: Partial<WebsiteRow> = {
  reachableOk: "fail",
  browserCheckedAt: FRESH,
  certDaysRemaining: null,
  domainCheckedAt: FRESH,
  functionHealth: "fail",
  cmsReachable: "fail",
  functionHealthCheckedAt: FRESH,
  crossbrowserOk: false,
  mobileOk: false,
  linksOk: false,
  brokenLinks: 2,
  titleMetaOk: "fail",
  a11yViolations: 2,
  a11yRoutesScanned: 3,
  a11yRoutesTotal: 3,
  a11yCheckedAt: FRESH,
  searchConsoleOutcome: "soft-fail",
  searchConsoleCheckedAt: FRESH,
  maintenanceFreq: "Monthly",
};
const reading = (firstSeen: Record<string, string>): LatestDeps => ({
  night: "2026-10-25",
  sites: { recS: { name: "Sonder", packages: Object.keys(firstSeen), at: FRESH, firstSeen } },
});

describe("only a maintained site's verdicts alarm", () => {
  it.each(["launching", "hosted-only", "building"] as const)(
    "a %s site raises nothing from any collector",
    (status) => {
      const s = [site({ ...failing, status })];
      const all = [
        ...collectUptimeAlerts(s, BASE, NOW),
        ...collectDomainAlerts(s, BASE, NOW),
        ...collectFunctionHealthAlerts(s, BASE, NOW),
        ...collectRenderAlerts(s, BASE, NOW),
        ...collectLinkAlerts(s, BASE, NOW),
        ...collectTitleMetaAlerts(s, BASE, NOW),
        ...collectA11yAlerts(s, BASE, NOW),
        ...collectSearchConsoleAlerts(s, BASE, NOW),
        ...Object.values(
          collectDepsAlerts(s, reading({ "svelte@4": "2026-01-01" }), BASE, NOW),
        ).flat(),
      ];
      expect(all).toEqual([]);
    },
  );

  it("the same row, maintained, raises each one (the control)", () => {
    const s = [site(failing)];
    expect(collectDomainAlerts(s, BASE, NOW)).toHaveLength(1);
    expect(collectFunctionHealthAlerts(s, BASE, NOW)).toHaveLength(2);
    expect(collectRenderAlerts(s, BASE, NOW)).toHaveLength(1);
    expect(collectLinkAlerts(s, BASE, NOW)).toHaveLength(1);
    expect(collectTitleMetaAlerts(s, BASE, NOW)).toHaveLength(1);
    expect(collectA11yAlerts(s, BASE, NOW)).toHaveLength(1);
    expect(collectSearchConsoleAlerts(s, BASE, NOW)).toHaveLength(1);
    expect(collectDepsAlerts(s, reading({ "svelte@4": "2026-01-01" }), BASE, NOW).far).toHaveLength(
      1,
    );
  });
});

describe("edges the main suite leaves open", () => {
  it("a stale links fail reads nothing", () => {
    expect(
      collectLinkAlerts(
        [site({ linksOk: false, brokenLinks: 2, browserCheckedAt: STALE })],
        BASE,
        NOW,
      ),
    ).toEqual([]);
  });

  it("one package past 90 days beside a fresh one: Attention naming only the old one, and no Watch item", () => {
    const d = collectDepsAlerts(
      [site()],
      reading({ "svelte@4": "2026-06-01", "vite@6": "2026-10-20" }),
      BASE,
      NOW,
    );
    expect(d.far.map((i) => i.title)).toEqual([
      "1 package a major behind for over 90 days: svelte@4; 2 packages a major behind in all",
    ]);
    expect(d.behind).toEqual([]);
  });

  it("a site with no package behind (an empty list) raises nothing", () => {
    const none: LatestDeps = {
      night: "2026-10-25",
      sites: { recS: { name: "Sonder", packages: [], at: FRESH, firstSeen: {} } },
    };
    expect(collectDepsAlerts([site()], none, BASE, NOW)).toEqual({ far: [], behind: [] });
  });

  it("an a11y run whose total is unknown is not measured", () => {
    expect(
      collectA11yAlerts(
        [
          site({
            a11yViolations: 2,
            a11yRoutesScanned: 3,
            a11yRoutesTotal: null,
            a11yCheckedAt: FRESH,
          }),
        ],
        BASE,
        NOW,
      ),
    ).toEqual([]);
  });

  it("a stamp in the future is fresh; an unparseable one is not", () => {
    expect(freshWithin("2026-10-27T00:00:00.000Z", 3, NOW)).toBe(true);
    expect(freshWithin("not a date", 3, NOW)).toBe(false);
  });

  it("the cockpit carries a site's dependencies behind as a Watch item", () => {
    const m = buildCockpitModel(
      [site()],
      [],
      {},
      BASE,
      NOW,
      [],
      null,
      [],
      0,
      new Map(),
      new Map(),
      new Map(),
      reading({ "svelte@4": "2026-10-01" }),
    );
    expect(m.cards[0]!.items.map((i) => i.key)).toContain("deps:recS");
  });

  it("a browser run that checked no link is a warn, never a pass", () => {
    const ok = { desktopOk: true, mobileOk: true, templateOk: true };
    expect(browserStatus({ ...ok, linksOk: true })).toBe("pass");
    expect(browserStatus({ ...ok, linksOk: null })).toBe("warn");
    expect(browserStatus({ ...ok, linksOk: false })).toBe("warn");
  });
});

describe("the a11y stamp travels with its counts", () => {
  it("written whenever the counts are", () => {
    const cells = auditFields({ a11y: { violations: 0, routesScanned: 4, routesTotal: 4 } });
    expect(typeof cells["A11y Checked At"]).toBe("string");
    expect(Number.isFinite(Date.parse(cells["A11y Checked At"] as string))).toBe(true);
  });
});

describe("the a11y install on a fresh clone", () => {
  function recorder(codes: Record<string, number>) {
    const calls: string[] = [];
    const spawn: SpawnFn = async (cmd, args) => {
      const line = [cmd, ...args].join(" ");
      calls.push(line);
      return { code: codes[line] ?? 0, stdout: "", stderr: "" };
    };
    return { calls, spawn };
  }

  it("a frozen install that fails and an unfrozen retry that works is ready", async () => {
    const dir = await mkdtemp(join(tmpdir(), "install-site-"));
    const r = recorder({ "pnpm install --frozen-lockfile": 1 });
    expect(await installSiteDeps(dir, r.spawn, { browser: false })).toBeNull();
  });

  it("the fleet sweep installs the site's own chromium, and a failure there is a skip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "install-site-"));
    const r = recorder({ "pnpm exec playwright install chromium": 1 });
    const before = process.env[A11Y_INSTALL_ENV];
    process.env[A11Y_INSTALL_ENV] = "1";
    try {
      const res = await a11yAudit({ site: { name: "s", path: dir }, spawn: r.spawn } as never);
      expect(res.status).toBe("skip");
      expect(res.summary).toBe("a11y: playwright install chromium failed (exit 1)");
    } finally {
      if (before === undefined) delete process.env[A11Y_INSTALL_ENV];
      else process.env[A11Y_INSTALL_ENV] = before;
    }
  });
});

describe("review round 2 (P1-78c, tests lens)", () => {
  const prior = { "vuln:other": { metric: 1, firstFlaggedAt: "2026-10-01" } };
  const sc = site({
    searchConsoleOutcome: "soft-fail",
    searchConsoleCheckedAt: FRESH,
    maintenanceFreq: "Monthly",
  });

  it("a Search Console soft-fail is standing and undated, on the card and the site page", () => {
    const m = buildCockpitModel([sc], [], prior, BASE, NOW);
    const onCard = m.cards[0]!.items.find((i) => i.key === "search-console:recS")!;
    expect(onCard.status).toBe("standing");
    expect(onCard.firstFlaggedAt).toBeUndefined();
    const page = buildSiteAlarmContext(sc, [], BASE, NOW, new Map(), new Map(), prior);
    const onPage = page.items.find((i) => i.key === "search-console:recS")!;
    expect(onPage.firstFlaggedAt).toBeUndefined();
  });

  it("pm-cockpit never counts a Search Console soft-fail new", () => {
    const out = formatPmCockpit(
      buildPmCockpit(
        {
          websites: [sc],
          reports: [],
          prior,
          baseUrl: BASE,
          newSubmissions: [],
          spamTotals: null,
          recentEvents: [],
          autoFilteredCount: 0,
          notifyBounces: new Map(),
          deadLetters: new Map(),
          deadLetterOldest: new Map(),
        },
        NOW,
        "2026-10-26T00:00:00Z",
      ),
    );
    expect(out).toContain("the Search Console lookup is failing (undated)");
    expect(out).toContain("new=0");
  });

  it("a browser run with a desktop or a mobile fail is a warn", () => {
    const ok = { desktopOk: true, mobileOk: true, linksOk: true, templateOk: true };
    expect(browserStatus({ ...ok, desktopOk: false })).toBe("warn");
    expect(browserStatus({ ...ok, mobileOk: false })).toBe("warn");
    expect(browserStatus({ ...ok, templateOk: false })).toBe("warn");
  });

  it("a certificate stamp in the future is not aged backwards", () => {
    const [it] = collectDomainAlerts(
      [site({ certDaysRemaining: 6, domainCheckedAt: "2026-10-28T12:00:00.000Z" })],
      BASE,
      NOW,
    );
    expect(it!.key).toBe("cert-expiring:recS");
    expect(it!.title).toBe("TLS certificate expires in 6 days");
  });

  it("cockpitFromInputs threads every input it is given", () => {
    const inputs = {
      websites: [site({ name: "Sonder" })],
      reports: [],
      prior,
      baseUrl: "https://elsewhere.test",
      newSubmissions: [
        {
          id: "sub1",
          siteId: "recS",
          formType: "contact",
          status: "new",
          submittedAt: "2026-10-26T10:00:00.000Z",
        } as never,
      ],
      spamTotals: { honeypot: 3, tooFast: 2, markedSpam: 1 },
      recentEvents: [
        {
          id: "ev1",
          ts: "2026-10-26T09:00:00.000Z",
          type: "pr_automerged",
          siteId: "recS",
          siteName: "Sonder",
          summary: "Renovate merged a PR",
          data: null,
        } as never,
      ],
      autoFilteredCount: 4,
      notifyBounces: new Map([["recS", { total: 3, permanent: 2 }]]),
      deadLetters: new Map(),
      deadLetterOldest: new Map(),
      deps: reading({ "svelte@4": "2026-06-01" }),
    };
    const expected = buildCockpitModel(
      inputs.websites,
      inputs.reports,
      inputs.prior,
      inputs.baseUrl,
      NOW,
      inputs.newSubmissions,
      inputs.spamTotals,
      inputs.recentEvents,
      inputs.autoFilteredCount,
      inputs.notifyBounces,
      inputs.deadLetters,
      inputs.deadLetterOldest,
      inputs.deps,
    );
    expect(cockpitFromInputs(inputs, NOW)).toEqual(expected);
    // and the fixture is not all defaults: the bounce alarm and the base url show
    const keys = expected.cards.flatMap((c) => c.items.map((i) => i.key));
    expect(keys).toContain("notify-bounce:recS");
    expect(JSON.stringify(expected)).toContain("https://elsewhere.test");
  });
});

describe("readLatestDeps carries a night whose deps measure failed (review round 2)", () => {
  let dir: string;
  let db: Db;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "deps-latest-"));
    db = await openDb({ url: `file:${join(dir, "db.sqlite")}` });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const put = (night: string, deps: unknown) =>
    db
      .insertInto("fleet_daily")
      .values({ night, counts: JSON.stringify({ deps }), written_at: `${night}T07:00:00.000Z` })
      .execute();

  it("the newest reading, aged to the newest night", async () => {
    await put("2026-10-25", { value: { ...reading({ "vite@5": "2026-06-01" }), behind: 1 } });
    await put("2026-10-26", { value: null, reason: "deps: read failed" });
    const got = await readLatestDeps(db);
    expect(got?.night).toBe("2026-10-26");
    expect(got?.sites.recS?.packages).toEqual(["vite@5"]);
    expect(collectDepsAlerts([site()], got, BASE, NOW).far).toHaveLength(1);
  });

  it("of two nights with a reading, the newer one is served", async () => {
    await put("2026-10-24", { value: { ...reading({ "old@1": "2026-06-01" }), behind: 1 } });
    await put("2026-10-25", { value: { ...reading({ "vite@5": "2026-06-01" }), behind: 1 } });
    await put("2026-10-26", { value: null, reason: "deps: read failed" });
    expect((await readLatestDeps(db))?.sites.recS?.packages).toEqual(["vite@5"]);
  });

  it("no reading in any row is null", async () => {
    await put("2026-10-26", { value: null, reason: "deps: read failed" });
    expect(await readLatestDeps(db)).toBeNull();
  });
});

describe("fleet_daily's dependency readings reach every surface", () => {
  let dir: string;
  let db: Db;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "deps-wiring-"));
    db = await openDb({ url: `file:${join(dir, "db.sqlite")}` });
    await db
      .insertInto("sites")
      .values({
        id: "recS",
        slug: "sonder",
        name: "Sonder",
        url: "https://sonder.example.com",
        status: "maintained",
      } as never)
      .execute();
    await db
      .insertInto("fleet_daily")
      .values({
        night: "2026-10-25",
        counts: JSON.stringify({
          deps: { value: { ...reading({ "svelte@4": "2026-06-01" }), behind: 1 } },
        }),
        written_at: "2026-10-26T07:00:00.000Z",
      })
      .execute();
    await writeDigestState(db, { "vuln:other": { metric: 1, firstFlaggedAt: "2026-10-01" } });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("the snapshot the SvelteKit cockpit renders from: the fleet page and the site page", async () => {
    const snap = await loadCockpitSnapshot(db, NOW, BASE);
    const m = cockpitModelFromSnapshot(snap, NOW);
    expect(m.cards.flatMap((c) => c.items.map((i) => i.key))).toContain("deps-far:recS");
    const page = siteDashboardFromSnapshot(snap, "sonder", NOW);
    expect(page!.alarm!.items.map((i) => i.key)).toContain("deps-far:recS");
  });

  it("pm-cockpit and the fleet_daily writer's model", async () => {
    const inputs = await loadCockpitInputs(db, NOW);
    const m = cockpitFromInputs(inputs, NOW);
    expect(m.cards.flatMap((c) => c.items.map((i) => i.key))).toContain("deps-far:recS");
    expect(formatPmCockpit(buildPmCockpit(inputs, NOW))).toContain(
      "1 package a major behind for over 90 days: svelte@4",
    );
  });
});

describe("the digest reads fleet_daily itself", () => {
  function world() {
    let snap: Record<string, { metric: number; firstFlaggedAt: string }> = {};
    const captured: ResendSendInput[] = [];
    const client = {
      send: async (input: ResendSendInput) => {
        captured.push(input);
        return { messageId: `m${captured.length}` };
      },
    } as unknown as ResendClient;
    return {
      captured,
      digestState: { read: async () => snap, write: async (n: typeof snap) => void (snap = n) },
      client,
    };
  }
  const rows = () =>
    websiteRowsFrom([
      {
        id: "recS",
        fields: {
          Name: "Sonder",
          url: "https://sonder.example.com",
          Status: "maintained",
          "URL Resolves": "pass",
          "URL Checked At": FRESH,
        },
      },
    ]);
  beforeEach(() => {
    process.env.OPERATOR_EMAIL = "tucker@reddoorla.com";
  });

  it("a package past 90 days is mailed through runDigest's own read", async () => {
    const w = world();
    await runDigest({
      digestState: w.digestState,
      roster: async () => rows(),
      allReports: async () => reportRowsFrom([]),
      resend: w.client,
      baseUrl: BASE,
      submissionCounts: null,
      now: NOW,
      latestDeps: async () => reading({ "svelte@4": "2026-06-01" }),
    });
    expect(w.captured).toHaveLength(1);
    expect(w.captured[0]!.html).toContain("a major behind for over 90 days");
  });

  it("a failed fleet_daily read drops that signal, never the digest", async () => {
    const w = world();
    const r = await runDigest({
      digestState: w.digestState,
      roster: async () => rows(),
      allReports: async () => reportRowsFrom([]),
      resend: w.client,
      baseUrl: BASE,
      submissionCounts: null,
      now: NOW,
      latestDeps: async () => {
        throw new Error("fleet_daily unreachable");
      },
    });
    expect(r.code).toBe(0);
  });
});
