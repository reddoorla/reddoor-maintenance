import { describe, it, expect, vi, afterEach } from "vitest";
import {
  runSearchConsoleRecheckCommand,
  NO_PROPERTY_CONTROL_URL,
  type SearchConsoleRecheckDeps,
  type RecheckLookup,
} from "../../src/cli/commands/search-console-recheck.js";
import type { WebsiteRow } from "../../src/fleet/site-row.js";
import { openDb } from "../../src/db/client.js";
import { listSites, mirrorHealthFields, mirrorSiteInsert } from "../../src/db/fleet-state.js";
import { makeHealthMirror } from "../../src/audits/health-mirror.js";
import { searchConsoleLookupFields } from "../../src/fleet/site-fields.js";
import { assignTier } from "../../src/dashboard/fleet-cockpit.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const NOW = new Date("2026-10-14T03:00:00.000Z");
const STALE = "2026-10-05T09:00:00.000Z";

type Write = { siteId: string; fields: Record<string, unknown> };

function recordingMirror(writes: Write[]) {
  return async () => async (siteId: string, fields: Record<string, unknown>) => {
    writes.push({ siteId, fields });
    return true;
  };
}

function row(id: string, over: Partial<WebsiteRow> = {}): WebsiteRow {
  return makeWebsiteRow({
    id,
    name: id,
    url: `https://www.${id}.example.org/`,
    status: "maintained",
    ga4PropertyId: "123",
    searchConsoleOutcome: "no-property",
    searchConsoleCheckedAt: STALE,
    ...over,
  });
}

const resolvedAs = (property: string): RecheckLookup => ({
  lookup: { outcome: "resolved", property },
});
const NO_PROPERTY: RecheckLookup = { lookup: { outcome: "no-property", property: null } };
const SOFT_FAIL: RecheckLookup = { lookup: { outcome: "soft-fail", property: null } };

function world(byUrl: Record<string, RecheckLookup>, calls: string[] = []) {
  return async (site: WebsiteRow) => {
    calls.push(site.url);
    if (site.url === NO_PROPERTY_CONTROL_URL) return NO_PROPERTY;
    const r = byUrl[site.url];
    if (!r) throw new Error(`unexpected lookup for ${site.url}`);
    return r;
  };
}

function deps(
  roster: WebsiteRow[],
  byUrl: Record<string, RecheckLookup>,
  over: Partial<SearchConsoleRecheckDeps> & { writes?: Write[]; calls?: string[] } = {},
): Partial<SearchConsoleRecheckDeps> {
  const { writes = [], calls = [], ...rest } = over;
  return {
    roster: async () => roster,
    makeMirror: recordingMirror(writes),
    search: world(byUrl, calls),
    gaConfigured: () => true,
    now: () => NOW,
    ...rest,
  };
}

const byId = (writes: Write[]) => Object.fromEntries(writes.map((w) => [w.siteId, w.fields]));

afterEach(() => vi.restoreAllMocks());

describe("runSearchConsoleRecheckCommand", () => {
  it("rejects anything but --fleet --write-back with exit 2 and touches nothing", async () => {
    const roster = vi.fn(async () => [row("lahi")]);
    for (const opts of [{}, { fleet: true }, { writeBack: true }]) {
      const r = await runSearchConsoleRecheckCommand(opts, { roster });
      expect(r.code).toBe(2);
    }
    expect(roster).not.toHaveBeenCalled();
  });

  it("flips a no-property site whose lookup now resolves to resolved, with all three cells", async () => {
    const writes: Write[] = [];
    const lahi = row("lahi");
    const r = await runSearchConsoleRecheckCommand(
      { fleet: true, writeBack: true },
      deps([lahi], { [lahi.url]: resolvedAs("https://www.lahi.example.org/") }, { writes }),
    );
    expect(r.code).toBe(0);
    expect(byId(writes)).toEqual({
      lahi: {
        "Search Console Outcome": "resolved",
        "Search Console Resolved": "https://www.lahi.example.org/",
        "Search Console Checked At": NOW.toISOString(),
      },
    });
    expect(r.output).toContain(
      "SEARCH_CONSOLE_RECHECK_SUMMARY checked=1 resolved=1 no_property=0 soft_fail=0 skipped=0 mirrored=1 mirror_failed=0",
    );
  });

  it("keeps a site with truly no property at no-property, and re-stamps when it was checked", async () => {
    const writes: Write[] = [];
    const gone = row("gone");
    const r = await runSearchConsoleRecheckCommand(
      { fleet: true, writeBack: true },
      deps([gone], { [gone.url]: NO_PROPERTY }, { writes }),
    );
    expect(r.code).toBe(0);
    expect(byId(writes)).toEqual({
      gone: {
        "Search Console Outcome": "no-property",
        "Search Console Resolved": null,
        "Search Console Checked At": NOW.toISOString(),
      },
    });
    expect(r.output).toContain(`::warning::search-console-recheck: gone ${gone.url} no-property`);
  });

  it("writes nothing for a lookup that soft-fails, so the stored no-property stands", async () => {
    const writes: Write[] = [];
    const flaky = row("flaky");
    const r = await runSearchConsoleRecheckCommand(
      { fleet: true, writeBack: true },
      deps([flaky], { [flaky.url]: SOFT_FAIL }, { writes }),
    );
    expect(r.code).toBe(0);
    expect(writes).toEqual([]);
    expect(r.output).toContain("soft_fail=1");
    expect(r.output).toContain(`::warning::search-console-recheck: flaky ${flaky.url} soft-fail`);
  });

  it("re-checks only maintained sites whose stored outcome is no-property", async () => {
    const writes: Write[] = [];
    const calls: string[] = [];
    const roster = [
      row("target"),
      row("ok", { searchConsoleOutcome: "resolved" }),
      row("unknown", { searchConsoleOutcome: "soft-fail" }),
      row("blank", { searchConsoleOutcome: null, searchConsoleCheckedAt: null }),
      row("building", { status: "building" }),
      row("hosted", { status: "hosted-only" }),
      row("archived", { status: "archived" }),
    ];
    const r = await runSearchConsoleRecheckCommand(
      { fleet: true, writeBack: true },
      deps(
        roster,
        { [roster[0]!.url]: resolvedAs("sc-domain:target.example.org") },
        {
          writes,
          calls,
        },
      ),
    );
    expect(r.code).toBe(0);
    expect(calls).toEqual([NO_PROPERTY_CONTROL_URL, roster[0]!.url]);
    expect(Object.keys(byId(writes))).toEqual(["target"]);
  });

  it("counts a site the lookup did not run for as skipped and writes nothing", async () => {
    const writes: Write[] = [];
    const optedOut = row("opted");
    const r = await runSearchConsoleRecheckCommand(
      { fleet: true, writeBack: true },
      deps([optedOut], { [optedOut.url]: { lookup: null } }, { writes }),
    );
    expect(r.code).toBe(0);
    expect(writes).toEqual([]);
    expect(r.output).toContain("skipped=1");
  });

  it("does nothing, and exits 0, when no site holds a no-property outcome", async () => {
    const search = vi.fn();
    const makeMirror = vi.fn();
    const r = await runSearchConsoleRecheckCommand(
      { fleet: true, writeBack: true },
      deps([row("ok", { searchConsoleOutcome: "resolved" })], {}, { search, makeMirror }),
    );
    expect(r.code).toBe(0);
    expect(search).not.toHaveBeenCalled();
    expect(makeMirror).not.toHaveBeenCalled();
    expect(r.output).toContain("SEARCH_CONSOLE_RECHECK_SUMMARY checked=0");
  });

  it("fails and writes nothing when this environment has no Search Console credentials", async () => {
    const writes: Write[] = [];
    const lahi = row("lahi");
    const r = await runSearchConsoleRecheckCommand(
      { fleet: true, writeBack: true },
      deps([lahi], { [lahi.url]: resolvedAs("x") }, { writes, gaConfigured: () => false }),
    );
    expect(r.code).toBe(1);
    expect(writes).toEqual([]);
    expect(r.output).toMatch(/::error::search-console-recheck: .*GA_SUBJECT/);
  });

  it.each([
    ["resolves", resolvedAs("sc-domain:no-such-property-zz9q.invalid")],
    ["soft-fails", SOFT_FAIL],
  ])("fails and writes nothing when the no-property control %s", async (_, control) => {
    const writes: Write[] = [];
    const lahi = row("lahi");
    const search = async (site: WebsiteRow) =>
      site.url === NO_PROPERTY_CONTROL_URL ? control : resolvedAs("x");
    const r = await runSearchConsoleRecheckCommand(
      { fleet: true, writeBack: true },
      deps([lahi], {}, { writes, search }),
    );
    expect(r.code).toBe(1);
    expect(writes).toEqual([]);
    expect(r.output).toContain("::error::search-console-recheck: no-property control");
  });

  it("runs the control through the target's own lookup path, with no pinned property", async () => {
    const seen: WebsiteRow[] = [];
    const lahi = row("lahi", {
      searchConsoleProperty: "sc-domain:lahi.example.org",
      acceptedWatchConditions: ["stale repo"],
    });
    await runSearchConsoleRecheckCommand(
      { fleet: true, writeBack: true },
      deps(
        [lahi],
        {},
        {
          search: async (site) => {
            seen.push(site);
            return site.url === NO_PROPERTY_CONTROL_URL ? NO_PROPERTY : resolvedAs("x");
          },
        },
      ),
    );
    const control = seen[0]!;
    expect(control.url).toBe(NO_PROPERTY_CONTROL_URL);
    expect(control.searchConsoleProperty).toBeNull();
    expect(control.searchQuery).toBeTruthy();
    expect(control.acceptedWatchConditions).toEqual([]);
  });

  it("fails when there is no store, and when mirror failures outnumber writes", async () => {
    const lahi = row("lahi");
    const noStore = await runSearchConsoleRecheckCommand(
      { fleet: true, writeBack: true },
      deps([lahi], { [lahi.url]: resolvedAs("x") }, { makeMirror: async () => null }),
    );
    expect(noStore.code).toBe(1);
    expect(noStore.output).toContain("::error::search-console-recheck: no store configured");

    vi.spyOn(console, "error").mockImplementation(() => {});
    const throwing = await runSearchConsoleRecheckCommand(
      { fleet: true, writeBack: true },
      deps(
        [lahi],
        { [lahi.url]: resolvedAs("x") },
        {
          makeMirror: async () => async () => {
            throw new Error("boom");
          },
        },
      ),
    );
    expect(throwing.code).toBe(1);
    expect(throwing.output).toContain("mirrored=0 mirror_failed=1");
  });
});

describe("search-console-recheck against a real store and the cockpit", () => {
  async function storeWith(sites: Array<{ id: string; url: string }>) {
    const db = await openDb({ url: ":memory:" });
    for (const s of sites) {
      await mirrorSiteInsert(
        db,
        {
          id: s.id,
          fields: {
            Name: s.id,
            Status: "maintained",
            url: s.url,
            "GA4 property ID": "1",
            "Git repo": `reddoorla/${s.id}`,
            "Netlify ID": `n-${s.id}`,
          },
        },
        STALE,
      );
      await mirrorHealthFields(
        db,
        s.id,
        searchConsoleLookupFields({ outcome: "no-property", property: null, checkedAt: STALE }),
      );
    }
    return db;
  }

  const watchOf = (site: WebsiteRow) => assignTier(site, [], NOW).watchSignals;

  it("a site whose lookup now resolves drops its watch; a site with truly no property keeps it", async () => {
    const lahi = "https://www.lahomelessnessawareness.org";
    const none = "https://www.no-property.example.org";
    const db = await storeWith([
      { id: "recLAHI", url: lahi },
      { id: "recNONE", url: none },
    ]);

    const before = await listSites(db);
    expect(before.map(watchOf)).toEqual([
      ["search-console-no-property"],
      ["search-console-no-property"],
    ]);

    const r = await runSearchConsoleRecheckCommand(
      { fleet: true, writeBack: true },
      {
        roster: () => listSites(db),
        makeMirror: () => makeHealthMirror(async () => db),
        search: world({
          [lahi]: resolvedAs("https://www.lahomelessnessawareness.org/"),
          [none]: NO_PROPERTY,
        }),
        gaConfigured: () => true,
        now: () => NOW,
      },
    );
    expect(r.code).toBe(0);

    const after = Object.fromEntries((await listSites(db)).map((s) => [s.id, s]));
    expect(after.recLAHI).toMatchObject({
      searchConsoleOutcome: "resolved",
      searchConsoleResolved: "https://www.lahomelessnessawareness.org/",
      searchConsoleCheckedAt: NOW.toISOString(),
    });
    expect(watchOf(after.recLAHI!)).not.toContain("search-console-no-property");

    expect(after.recNONE).toMatchObject({
      searchConsoleOutcome: "no-property",
      searchConsoleResolved: null,
      searchConsoleCheckedAt: NOW.toISOString(),
    });
    expect(watchOf(after.recNONE!)).toEqual(["search-console-no-property"]);
    await db.destroy();
  });
});
