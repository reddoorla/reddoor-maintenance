import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { render } from "svelte/server";
import { parse, type HTMLElement } from "node-html-parser";
import Page from "../../src/routes/fleet/+page.svelte";
import { load } from "../../src/routes/fleet/+page.js";
import { buildFleetTableModel, parseFleetTableQuery } from "../../../src/dashboard/fleet-table.js";
import type { Tier } from "../../../src/dashboard/fleet-cockpit.js";
import { makeWebsiteRow } from "../../../tests/_helpers/website-row.js";
import { makeSubmissionRow } from "../../../tests/_helpers/submission-row.js";
import { NOW, STALE, healthy, snapshot } from "../overview/fixtures.js";

/**
 * P1-87, PR 2: the overview's "Is every site live?" columns (Live, Certificate,
 * Deploy, Forms, Level) move to the Sites table. Every expected value below is a
 * literal from the fixture rows, read through the route's own load, so the
 * page is not checked against the model it was drawn from.
 */
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

/** Acme passes every check and had a lead 5 hours ago (a newer spam entry is
 *  not a lead); Bravo's page does not answer (Broken), its certificate is near
 *  its end, its deploy failed and its form test gave no verdict; Delta is live
 *  with a certificate near its end, so Live and Certificate disagree; Charlie
 *  is archived, so it has no card and no level. */
const SNAP = snapshot({
  sites: [
    healthy({ id: "recA", name: "Acme" }),
    healthy({ id: "recD", name: "Delta", certDaysRemaining: 9 }),
    healthy({
      id: "recB",
      name: "Bravo",
      reachableOk: "fail",
      certDaysRemaining: 9,
      formE2eOk: null,
      deployStatus: "error",
    }),
    makeWebsiteRow({ id: "recC", name: "Charlie", status: "archived" }),
  ],
  submissions: [
    makeSubmissionRow({
      id: "s0",
      siteId: "recA",
      status: "spam_auto",
      submittedAt: "2026-10-27T17:00:00.000Z",
    }),
    makeSubmissionRow({
      id: "s1",
      siteId: "recA",
      status: "read",
      submittedAt: "2026-10-27T13:00:00.000Z",
    }),
  ],
});

type Data = Parameters<typeof Page>[1]["data"];

async function page(href: string, snap = SNAP): Promise<HTMLElement> {
  const url = new URL(href, "https://dash.example");
  const data = (await (load as unknown as (e: unknown) => Promise<Data>)({
    url,
    parent: async () => ({ snapshot: snap, failure: null, clockOffsetMs: 0 }),
  })) as Data;
  return parse(render(Page, { props: { data } }).body);
}

const text = (el: HTMLElement) => el.textContent.replace(/\s+/g, " ").trim();
const rowOf = (doc: HTMLElement, name: string) =>
  doc.querySelectorAll("tr.fleet-row").find((tr) => text(tr.querySelector("td")!) === name)!;
const cell = (tr: HTMLElement, label: string) => tr.querySelector(`td[data-label="${label}"]`)!;

describe("Sites carries the overview's live columns (P1-87, PR 2)", () => {
  it("heads them after Status, in the overview's order, with Level last", async () => {
    const doc = await page("/fleet");
    expect(doc.querySelectorAll("table.fleet thead th").map(text)).toEqual([
      "Site ↑",
      "URL",
      "Status",
      "Live",
      "Certificate",
      "Deploy",
      "Forms",
      "Level",
      "Perf",
      "Access",
      "BP",
      "SEO",
      "Next maint",
      "Next test",
      "Last audit",
      "Health",
    ]);
  });

  it("fills each site's row with that site's own checks", async () => {
    const doc = await page("/fleet");
    const acme = rowOf(doc, "Acme");
    expect(text(cell(acme, "Live"))).toBe("Live, checked Oct 26, 11:30pm PT");
    expect(text(cell(acme, "Certificate"))).toBe("60 days left");
    expect(text(cell(acme, "Deploy"))).toBe("Published 2 days ago");
    expect(text(cell(acme, "Level"))).toBe("ok");
    const bravo = rowOf(doc, "Bravo");
    expect(text(cell(bravo, "Live"))).toBe("A page not answering, checked Oct 26, 11:30pm PT");
    expect(text(cell(bravo, "Certificate"))).toBe("9 days left");
    expect(text(cell(bravo, "Deploy"))).toBe("Latest deploy failed");
    expect(text(cell(bravo, "Forms"))).toBe(
      "No result (no form, or the test skipped it); no real lead yet",
    );
    expect(text(cell(bravo, "Level"))).toBe("broken");
  });

  it("keeps the Forms column's last real lead beside the test's verdict", async () => {
    const acme = rowOf(await page("/fleet"), "Acme");
    expect(text(cell(acme, "Forms"))).toBe("Test passed; last real lead 5 hours ago");
  });

  it("styles a failed check bold and an unknown one muted, as the overview did", async () => {
    const doc = await page("/fleet");
    const bravo = rowOf(doc, "Bravo");
    expect(cell(bravo, "Live").classList.contains("bad")).toBe(true);
    expect(cell(bravo, "Certificate").classList.contains("bad")).toBe(true);
    expect(cell(bravo, "Forms").classList.contains("unknown")).toBe(true);
    expect(cell(bravo, "Deploy").classList.contains("bad")).toBe(true);
    expect(cell(rowOf(doc, "Acme"), "Live").classList.contains("ok")).toBe(true);
    // Live and Certificate disagree on Delta, so neither takes the other's class.
    const delta = rowOf(doc, "Delta");
    expect(cell(delta, "Live").classList.contains("ok")).toBe(true);
    expect(cell(delta, "Certificate").classList.contains("bad")).toBe(true);
    expect(text(cell(delta, "Certificate"))).toBe("9 days left");
  });

  it("lines each row's cells up under their headers", async () => {
    const doc = await page("/fleet?status=__all__");
    for (const tr of doc.querySelectorAll("tr.fleet-row"))
      expect(
        tr.querySelectorAll("td[data-label]").map((td) => td.getAttribute("data-label")),
      ).toEqual(["Live", "Certificate", "Deploy", "Forms", "Level"]);
  });

  it("says the last lead is not readable when the submissions read failed", async () => {
    const acme = rowOf(await page("/fleet", { ...SNAP, submissions: null }), "Acme");
    expect(text(cell(acme, "Forms"))).toBe("Test passed; last lead not readable");
  });

  it("lets a keyboard reach the table's sideways scroll", async () => {
    const wrap = (await page("/fleet")).querySelector(".fleet-table-wrap")!;
    expect(wrap.getAttribute("tabindex")).toBe("0");
    expect(wrap.getAttribute("role")).toBe("region");
    expect(wrap.getAttribute("aria-label")).toBe("Sites table");
  });

  it("gives a site with no card a dash in each, and no level", async () => {
    const charlie = rowOf(await page("/fleet?status=__all__"), "Charlie");
    for (const label of ["Live", "Certificate", "Deploy", "Forms", "Level"])
      expect(text(cell(charlie, label))).toBe("—");
  });

  it("moves the level out of Health, so a row says it once", async () => {
    const doc = await page("/fleet");
    expect(doc.querySelectorAll("td.health .pill")).toHaveLength(0);
    expect(rowOf(doc, "Bravo").querySelectorAll(".pill")).toHaveLength(1);
  });

  it("sorts by Level through the route's load, worst first", async () => {
    const doc = await page("/fleet?sort=level&dir=asc&status=__all__");
    expect(doc.querySelectorAll("tr.fleet-row").map((tr) => text(tr.querySelector("td")!))).toEqual(
      ["Bravo", "Delta", "Acme", "Charlie"],
    );
  });
});

describe("the Level sort (P1-87, PR 2)", () => {
  // Each name sorts differently by name, by level word and by severity.
  const TIERS: Array<[string, Tier | null]> = [
    ["Alpha", "healthy"],
    ["Bravo", "broken"],
    ["Charlie", "watch"],
    ["Delta", "attention"],
    ["Echo", "pre-launch"],
    ["Foxtrot", null],
  ];
  const sites = TIERS.map(([name]) =>
    makeWebsiteRow({ id: `rec${name}`, name, status: "maintained" }),
  );
  const tiers = new Map(
    TIERS.flatMap(([name, t]) => (t === null ? [] : [[`rec${name}`, t] as const])),
  );
  const order = (dir: string) =>
    buildFleetTableModel(
      sites,
      parseFleetTableQuery(new URLSearchParams(`sort=level&dir=${dir}`)),
      tiers,
    ).rows.map((r) => r.name);

  it("puts Broken first, then Attention, Watch, OK and Launching; no level last", () => {
    expect(order("asc")).toEqual(["Bravo", "Delta", "Charlie", "Alpha", "Echo", "Foxtrot"]);
  });

  it("reverses the levels, not the site with none", () => {
    expect(order("desc")).toEqual(["Echo", "Alpha", "Charlie", "Delta", "Bravo", "Foxtrot"]);
  });

  it("offers Level as a sortable header", () => {
    expect(parseFleetTableQuery(new URLSearchParams("sort=level")).sort).toBe("level");
  });
});

/** Review round 2 (P1-87, PR 2). A separate fixture, so SNAP and its assertions
 *  stay as they were. Constructor is archived and named for an Object.prototype
 *  key; Lantern is launching, so it has a card and its own checks; Stale's URL and
 *  page checks are older than the window; Nodeploy has no deploy status; Echo has
 *  two real leads, the older one last in the array. */
const SNAP_R2 = snapshot({
  sites: [
    makeWebsiteRow({ id: "recK", name: "Constructor", status: "archived" }),
    healthy({ id: "recL", name: "Lantern", status: "launching", reachableOk: "fail" }),
    healthy({ id: "recS", name: "Stale", urlCheckedAt: STALE, browserCheckedAt: STALE }),
    healthy({ id: "recN", name: "Nodeploy", deployStatus: null }),
    healthy({ id: "recE", name: "Echo" }),
  ],
  submissions: [
    makeSubmissionRow({
      id: "e1",
      siteId: "recE",
      status: "read",
      submittedAt: "2026-10-27T15:00:00.000Z",
    }),
    makeSubmissionRow({
      id: "e0",
      siteId: "recE",
      status: "read",
      submittedAt: "2026-10-27T09:00:00.000Z",
    }),
  ],
});

describe("the live columns, review round 2 (P1-87, PR 2)", () => {
  it("gives an archived site named Constructor dashes, not an inherited key's facts", async () => {
    const k = rowOf(await page("/fleet?status=__all__", SNAP_R2), "Constructor");
    for (const label of ["Live", "Certificate", "Deploy", "Forms"])
      expect(text(cell(k, label))).toBe("—");
  });

  it("shows a launching site's own checks, not the dash", async () => {
    const lantern = rowOf(await page("/fleet?status=__all__", SNAP_R2), "Lantern");
    expect(text(cell(lantern, "Live"))).toBe("A page not answering, checked Oct 26, 11:30pm PT");
    expect(cell(lantern, "Live").classList.contains("bad")).toBe(true);
  });

  it("shows exactly 'Not checked lately' for a Live check past its window, with no stamp", async () => {
    const stale = rowOf(await page("/fleet?status=__all__", SNAP_R2), "Stale");
    expect(text(cell(stale, "Live"))).toBe("Not checked lately");
  });

  it("styles an unknown Deploy muted, never as ok", async () => {
    const deploy = cell(rowOf(await page("/fleet?status=__all__", SNAP_R2), "Nodeploy"), "Deploy");
    expect(text(deploy)).toBe("No deploy recorded");
    expect(deploy.classList.contains("unknown")).toBe(true);
    expect(deploy.classList.contains("ok")).toBe(false);
  });

  it("names the newer of two real leads, though the older one comes last", async () => {
    const echo = rowOf(await page("/fleet?status=__all__", SNAP_R2), "Echo");
    expect(text(cell(echo, "Forms"))).toBe("Test passed; last real lead 3 hours ago");
  });
});

/** Review round 3 (P1-87, PR 2). A separate fixture, so SNAP, SNAP_R2 and their
 *  assertions stay as they were. Foo (maintained, its page not answering) and FOO
 *  (archived) share the slug "foo", so a row must take its checks by site id.
 *  Acme Corp is a two-word name whose slug is "acme-corp". Hotel's one submission
 *  is accepted but has no submittedAt, so it is no real lead. The archived
 *  ToString has the id "constructor", an Object.prototype key, so a facts read
 *  without its own-property guard would find an inherited function. */
const SNAP_R3 = snapshot({
  sites: [
    healthy({ id: "recV", name: "Foo", reachableOk: "fail" }),
    makeWebsiteRow({ id: "recX", name: "FOO", status: "archived" }),
    healthy({ id: "recM", name: "Acme Corp" }),
    healthy({ id: "recH", name: "Hotel" }),
    makeWebsiteRow({ id: "constructor", name: "ToString", status: "archived" }),
  ],
  submissions: [
    makeSubmissionRow({
      id: "u0",
      siteId: "recH",
      status: "read",
      submittedAt: null,
    }),
  ],
});

describe("the live columns, review round 3 (P1-87, PR 2)", () => {
  it("gives an archived FOO no checks and no level beside a maintained namesake Foo", async () => {
    const doc = await page("/fleet?sort=level&dir=asc&status=__all__", SNAP_R3);
    const foo = rowOf(doc, "FOO");
    for (const label of ["Live", "Certificate", "Deploy", "Forms", "Level"])
      expect(text(cell(foo, label))).toBe("—");
    expect(foo.querySelectorAll(".pill")).toHaveLength(0);
    expect(text(cell(rowOf(doc, "Foo"), "Live"))).toBe(
      "A page not answering, checked Oct 26, 11:30pm PT",
    );
    expect(rowOf(doc, "Foo").querySelectorAll(".pill")).toHaveLength(1);
  });

  it("gives an archived site whose id is an Object.prototype key dashes, not an inherited value", async () => {
    const ts = rowOf(await page("/fleet?status=__all__", SNAP_R3), "ToString");
    for (const label of ["Live", "Certificate", "Deploy", "Forms", "Level"])
      expect(text(cell(ts, label))).toBe("—");
  });

  it("finds a two-word site's checks by its id (slug 'acme-corp')", async () => {
    const acme = rowOf(await page("/fleet?status=__all__", SNAP_R3), "Acme Corp");
    expect(text(cell(acme, "Live"))).toBe("Live, checked Oct 26, 11:30pm PT");
  });

  it("sorts a launching site by its level: pre-launch after OK, before the no-level site", async () => {
    // Lantern's failing page is muted to pre-launch (a launching site's calm
    // state), so it ranks after the OK sites and before Constructor, which has
    // no level.
    const doc = await page("/fleet?sort=level&dir=asc&status=__all__", SNAP_R2);
    expect(doc.querySelectorAll("tr.fleet-row").map((tr) => text(tr.querySelector("td")!))).toEqual(
      ["Echo", "Nodeploy", "Stale", "Lantern", "Constructor"],
    );
  });

  it("says no real lead yet for an accepted submission with no submittedAt", async () => {
    const hotel = rowOf(await page("/fleet?status=__all__", SNAP_R3), "Hotel");
    expect(text(cell(hotel, "Forms"))).toBe("Test passed; no real lead yet");
  });

  it("styles Bravo's Level pill as broken, and Charlie's fact cells as muted", async () => {
    const doc = await page("/fleet?status=__all__");
    const pill = rowOf(doc, "Bravo").querySelector(".pill")!;
    expect(pill.classList.contains("broken")).toBe(true);
    for (const label of ["Live", "Certificate", "Deploy", "Forms"])
      expect(cell(rowOf(doc, "Charlie"), label).classList.contains("muted")).toBe(true);
  });
});

/** Review round 4 (P1-87, PR 2). Separate fixtures, so SNAP, SNAP_R2, SNAP_R3 and
 *  their assertions stay as they were. Acme passes every check (its tier is
 *  healthy); Delta's certificate is 9 days from its end (attention); Lantern is
 *  launching (pre-launch). A site whose id is `__proto__` is maintained and its
 *  page does not answer, so its facts and Level must come from its own id, not
 *  from the prototype of a plain record. */
const SNAP_R4 = snapshot({
  sites: [
    healthy({ id: "recA", name: "Acme" }),
    healthy({ id: "recD", name: "Delta", certDaysRemaining: 9 }),
    healthy({ id: "recL", name: "Lantern", status: "launching", reachableOk: "fail" }),
    healthy({ id: "__proto__", name: "Proto", reachableOk: "fail" }),
  ],
});

describe("the live columns, review round 4 (P1-87, PR 2)", () => {
  it("shows a site whose id is __proto__ its own checks and Level, not dashes", async () => {
    const proto = rowOf(await page("/fleet?status=__all__", SNAP_R4), "Proto");
    expect(text(cell(proto, "Live"))).toBe("A page not answering, checked Oct 26, 11:30pm PT");
    expect(cell(proto, "Live").classList.contains("bad")).toBe(true);
    expect(text(cell(proto, "Level"))).toBe("broken");
    expect(cell(proto, "Level").querySelector(".pill")!.classList.contains("broken")).toBe(true);
  });

  it("keeps the facts' own-property guard when the record is a plain object", async () => {
    // The route's record is null-prototype now, so a plain record (the browser's
    // JSON round trip) is what the page's own guard must still handle: the
    // archived ToString's id "constructor" must not read Object.prototype's function.
    const url = new URL("/fleet?status=__all__", "https://dash.example");
    const data = (await (load as unknown as (e: unknown) => Promise<Data>)({
      url,
      parent: async () => ({ snapshot: SNAP_R3, failure: null, clockOffsetMs: 0 }),
    })) as Data;
    const plain = { ...data, facts: JSON.parse(JSON.stringify(data.facts)) } as Data;
    const doc = parse(render(Page, { props: { data: plain } }).body);
    const ts = rowOf(doc, "ToString");
    for (const label of ["Live", "Certificate", "Deploy", "Forms"])
      expect(text(cell(ts, label))).toBe("—");
  });

  it("gives Acme's Level pill its tier class, healthy, not its label", async () => {
    const pill = rowOf(await page("/fleet", SNAP_R4), "Acme").querySelector(".pill")!;
    expect(pill.classList.contains("healthy")).toBe(true);
    expect(pill.classList.contains("ok")).toBe(false);
    expect(text(pill)).toBe("ok");
  });

  it("gives Delta's Level pill its tier class, attention, and its word", async () => {
    const pill = rowOf(await page("/fleet", SNAP_R4), "Delta").querySelector(".pill")!;
    expect(pill.classList.contains("attention")).toBe(true);
    expect(text(pill)).toBe("attention");
  });

  it("gives Lantern's pre-launch pill its literal word, not ok", async () => {
    const pill = rowOf(await page("/fleet?status=__all__", SNAP_R4), "Lantern").querySelector(
      ".pill",
    )!;
    expect(text(pill)).toBe("pre-launch");
    expect(pill.classList.contains("pre-launch")).toBe(true);
  });
});

/** Review round 5 (P1-87, PR 2). Separate fixtures, so SNAP through SNAP_R4 and their
 *  assertions stay as they were. The levels map is a record too: round-trip the
 *  whole data (the browser's JSON copy), so the page's own-property guard on
 *  levels must hold for a plain object. ToString's id "constructor" is an
 *  Object.prototype key that no level belongs to. */
describe("the Level guard, review round 5 (P1-87, PR 2)", () => {
  it("gives the archived constructor-id site a dash and no pill, with the whole data round-tripped", async () => {
    const url = new URL("/fleet?status=__all__", "https://dash.example");
    const data = (await (load as unknown as (e: unknown) => Promise<Data>)({
      url,
      parent: async () => ({ snapshot: SNAP_R3, failure: null, clockOffsetMs: 0 }),
    })) as Data;
    const wire = JSON.parse(JSON.stringify(data)) as Data;
    const doc = parse(render(Page, { props: { data: wire } }).body);
    const ts = rowOf(doc, "ToString");
    expect(text(cell(ts, "Level"))).toBe("—");
    expect(ts.querySelectorAll(".pill")).toHaveLength(0);
  });
});
