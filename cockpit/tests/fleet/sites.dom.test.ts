import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import Page from "../../src/routes/fleet/+page.svelte";
import { buildSitesView } from "../../src/lib/cockpit/view.js";
import {
  ALL_STATUSES_FILTER,
  buildFleetTableModel,
  parseFleetTableQuery,
} from "../../../src/dashboard/fleet-table.js";
import { cases, NOW } from "../home/fixtures.js";
import { navigate } from "../_helpers/app-navigation.js";

/**
 * Sites (`/fleet`) with the browse panel merged in (#672 step 3), run in a DOM:
 * the signal chips filter the table's rows as the panel filtered its cards.
 * The page is mounted with data that crossed the server/browser boundary.
 */

let target: HTMLElement;
let app: ReturnType<typeof mount> | null = null;

/** The four-card model the browse panel's filter test used. */
function render(model = cases()[10]![1]) {
  const data = {
    model: buildFleetTableModel(
      model.cards.map((c) => c.site),
      parseFleetTableQuery(new URLSearchParams()),
    ),
    sites: buildSitesView(model, NOW),
  };
  const wire = JSON.parse(JSON.stringify(data));
  expect(wire).toStrictEqual(data);
  app = mount(Page, { target, props: { data: wire } });
  flushSync();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  target.remove();
  vi.useRealTimers();
});

const rowsShown = () =>
  [...target.querySelectorAll<HTMLElement>("table.fleet tr.fleet-row")]
    .filter((r) => r.style.display !== "none")
    .map((r) => r.querySelector("td a")!.textContent);
const chip = (f: string) =>
  target.querySelector<HTMLButtonElement>(`.signal-filters button[data-filter="${f}"]`)!;

describe("Sites — the signal filters", () => {
  it("shows only the rows carrying the chosen signal, and all again on 'all'", () => {
    render();
    expect(rowsShown()).toHaveLength(4);
    chip("vulns").click();
    flushSync();
    expect(rowsShown()).toEqual([expect.stringContaining("<script>")]);
    expect(chip("vulns").getAttribute("aria-pressed")).toBe("true");
    expect(chip("all").getAttribute("aria-pressed")).toBe("false");
    chip("lighthouse").click();
    flushSync();
    expect(rowsShown()).toEqual(["Beta"]);
    chip("auto-fix-failed").click();
    flushSync();
    expect(rowsShown()).toHaveLength(1);
    chip("url-unresolved").click();
    flushSync();
    expect(rowsShown()).toEqual([]);
    chip("all").click();
    flushSync();
    expect(rowsShown()).toHaveLength(4);
    expect(
      [...target.querySelectorAll(".signal-filters button")].filter(
        (b) => b.getAttribute("aria-pressed") === "true",
      ),
    ).toHaveLength(1);
  });

  it("leaves a row with no card (an archived site) visible only under 'all'", () => {
    const model = cases()[10]![1];
    const archived = {
      ...model.cards[0]!.site,
      id: "recZ",
      name: "Zed Archived",
      status: "archived" as const,
    };
    const data = {
      model: buildFleetTableModel(
        [...model.cards.map((c) => c.site), archived],
        // "All statuses": the default view hides archived sites (2026-10-21).
        parseFleetTableQuery(new URLSearchParams({ status: ALL_STATUSES_FILTER })),
      ),
      sites: buildSitesView(model, NOW),
    };
    app = mount(Page, { target, props: { data: JSON.parse(JSON.stringify(data)) } });
    flushSync();
    expect(rowsShown()).toContain("Zed Archived");
    chip("vulns").click();
    flushSync();
    expect(rowsShown()).not.toContain("Zed Archived");
  });
});

describe("Sites — what the signal filters say (#1589)", () => {
  const meta = () => target.querySelector(".meta")!.textContent!.replace(/\s+/g, " ").trim();
  const empty = () =>
    [...target.querySelectorAll<HTMLElement>(".empty")].map((e) => e.textContent!.trim());

  it("counts the rows a chip leaves shown, and only while a chip is on", () => {
    render();
    expect(meta()).toBe("4 of 4 sites");
    chip("vulns").click();
    flushSync();
    expect(rowsShown()).toHaveLength(1);
    expect(meta()).toBe("4 of 4 sites · 1 shown");
    chip("all").click();
    flushSync();
    expect(meta()).toBe("4 of 4 sites");
  });

  it("says so when a chip hides every row", () => {
    render();
    expect(empty()).toEqual([]);
    chip("url-unresolved").click();
    flushSync();
    expect(rowsShown()).toEqual([]);
    expect(empty()).toEqual(["No sites carry this signal."]);
    chip("vulns").click();
    flushSync();
    expect(empty()).toEqual([]);
  });

  it("drops the chip when a navigation (the GET form, Clear) lands on the page", () => {
    render();
    chip("vulns").click();
    flushSync();
    expect(rowsShown()).toHaveLength(1);
    // SvelteKit keeps this component across client navigations, so only an
    // explicit reset puts the chip back to "all".
    navigate("/fleet?q=a");
    flushSync();
    expect(rowsShown()).toHaveLength(4);
    expect(chip("all").getAttribute("aria-pressed")).toBe("true");
    expect(chip("vulns").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("Sites — the chip count reaches a screen reader (#1636)", () => {
  // The visible "· K shown" sits in `.meta`, which is not a live region. A
  // visually hidden status region that is always in the page carries the count,
  // so pressing a chip changes its text and the change is announced.
  const live = () => target.querySelectorAll<HTMLElement>('.visually-hidden[role="status"]');

  it("is always present and its text follows each chip press", () => {
    render();
    expect(live()).toHaveLength(1);
    expect(live()[0]!.textContent!.trim()).toBe("4 sites shown");
    chip("vulns").click();
    flushSync();
    expect(live()[0]!.textContent!.trim()).toBe("1 site shown");
    chip("url-unresolved").click();
    flushSync();
    expect(live()[0]!.textContent!.trim()).toBe("0 sites shown");
    chip("all").click();
    flushSync();
    expect(live()).toHaveLength(1);
    expect(live()[0]!.textContent!.trim()).toBe("4 sites shown");
  });
});

describe("Sites — when the default view hides every site (#1619)", () => {
  const empty = () =>
    [...target.querySelectorAll<HTMLElement>(".empty")].map((e) => e.textContent!.trim());

  function mountWith(statuses: Array<"archived" | "external" | "maintained">, query = "") {
    const model = cases()[10]![1];
    const rows = statuses.map((status, i) => ({
      ...model.cards[0]!.site,
      id: `recH${i}`,
      name: `Hidden ${i}`,
      status,
      statusRaw: status,
    }));
    const data = {
      model: buildFleetTableModel(rows, parseFleetTableQuery(new URLSearchParams(query))),
      sites: buildSitesView(model, NOW),
    };
    app = mount(Page, { target, props: { data: JSON.parse(JSON.stringify(data)) } });
    flushSync();
  }

  it("says every site is archived or external, not that a filter matched nothing", () => {
    mountWith(["archived", "external"]);
    expect(empty()).toEqual(["Every site is archived or external."]);
    // The meta line still offers the way to see them.
    expect(target.querySelector(".meta a")!.textContent).toBe("Show all");
  });

  it("keeps the filter message when a filter the operator chose matches nothing", () => {
    mountWith(["archived", "external"], "q=zzz");
    expect(empty()).toEqual(["No sites match these filters."]);
  });
});
