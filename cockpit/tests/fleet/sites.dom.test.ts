import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import Page from "../../src/routes/fleet/+page.svelte";
import { buildSitesView } from "../../src/lib/cockpit/view.js";
import { buildFleetTableModel, parseFleetTableQuery } from "../../../src/dashboard/fleet-table.js";
import { cases, NOW } from "../home/fixtures.js";

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
        parseFleetTableQuery(new URLSearchParams()),
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
