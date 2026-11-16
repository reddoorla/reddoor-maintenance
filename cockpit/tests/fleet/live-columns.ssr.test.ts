import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { render } from "svelte/server";
import { parse, type HTMLElement } from "node-html-parser";
import Page from "../../src/routes/fleet/+page.svelte";
import { load } from "../../src/routes/fleet/+page.js";
import { buildFleetTableModel, parseFleetTableQuery } from "../../../src/dashboard/fleet-table.js";
import type { Tier } from "../../../src/dashboard/fleet-cockpit.js";
import { makeWebsiteRow } from "../../../tests/_helpers/website-row.js";
import { makeSubmissionRow } from "../../../tests/_helpers/submission-row.js";
import { NOW, healthy, snapshot } from "../overview/fixtures.js";

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

/** Acme passes every check and had a lead 5 hours ago; Bravo's page does not
 *  answer (Broken), its certificate is near its end and its form test gave no
 *  verdict; Charlie is archived, so it has no card and no level. */
const SNAP = snapshot({
  sites: [
    healthy({ id: "recA", name: "Acme" }),
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
      id: "s1",
      siteId: "recA",
      status: "read",
      submittedAt: "2026-10-27T13:00:00.000Z",
    }),
  ],
});

type Data = Parameters<typeof Page>[1]["data"];

async function page(href: string): Promise<HTMLElement> {
  const url = new URL(href, "https://dash.example");
  const data = (await (load as unknown as (e: unknown) => Promise<Data>)({
    url,
    parent: async () => ({ snapshot: SNAP, failure: null, clockOffsetMs: 0 }),
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
    expect(cell(rowOf(doc, "Acme"), "Live").classList.contains("ok")).toBe(true);
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
      ["Bravo", "Acme", "Charlie"],
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
