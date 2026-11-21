import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import { overviewFromSnapshot } from "../../src/lib/overview/view.js";
import { FEED_MS } from "../../src/lib/overview/motion.js";
import { snapshot, night, event, NOW } from "./fixtures.js";
import { page as props } from "./page-props.svelte.js";

vi.mock("$app/navigation", () => ({ invalidate: async () => undefined, afterNavigate: () => {} }));

/**
 * P1-87 minors: what a data refresh keeps. A feed line's slide is its own (#2166), and a focused
 * trend chart stays on its night when the window moves on (#2174). The page is mounted once and
 * given new views, as a re-read gives it one.
 */
describe("the overview across a data refresh (P1-87 minors)", () => {
  let target: HTMLDivElement;
  let app: ReturnType<typeof mount> | null = null;
  const DAY = 86_400_000;

  beforeEach(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    target = document.createElement("div");
    document.body.append(target);
  });
  afterEach(async () => {
    if (app) await unmount(app);
    app = null;
    target.remove();
    vi.useRealTimers();
  });

  async function mountWith(view: ReturnType<typeof overviewFromSnapshot>) {
    props.data = { view };
    const { default: Page } = await import("../../src/routes/+page.svelte");
    app = mount(Page, { target, props });
    flushSync();
  }
  const show = (view: ReturnType<typeof overviewFromSnapshot>) => {
    props.data = { view };
    flushSync();
  };

  /** The feed's lines marked new, by their words. */
  const marked = () =>
    [...target.querySelectorAll(".ov-lately li[data-new]")].map((li) =>
      li.textContent!.replace(/\s+/g, " ").trim(),
    );

  it("a second refresh within FEED_MS keeps the first one's new line marked until its own slide ends (#2166)", async () => {
    vi.useFakeTimers({ now: NOW.getTime() });
    // Each event keeps its own stamp across the views, as a stored event does.
    const hoursAgo = { old: 3, x: 2, y: 1 } as Record<string, number>;
    const at = (id: string) => new Date(NOW.getTime() - hoursAgo[id]! * 3_600_000).toISOString();
    const feed = (...ids: string[]) =>
      overviewFromSnapshot(
        snapshot({
          feedEvents: ids.map((id) =>
            event({ id, ts: at(id), type: id === "old" ? "pr_automerged" : "vuln_cleared" }),
          ),
        }),
        NOW,
      );
    await mountWith(feed("old"));
    expect(marked(), "the first render marks nothing").toEqual([]);
    show(feed("x", "old"));
    expect(marked()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    show(feed("y", "x", "old"));
    expect(marked(), "both new lines slide: the second refresh adds to the first").toHaveLength(2);
    await vi.advanceTimersByTimeAsync(FEED_MS - 100);
    flushSync();
    expect(marked(), "the first line's slide is over; the second's is not").toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    flushSync();
    expect(marked(), "each mark ends with its own slide").toEqual([]);
  });

  /** The first trend chart's slider. */
  const slider = () => target.querySelector<SVGElement>("figure.ov-trend svg.ov-chart")!;
  const key = (k: string) => {
    slider().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    flushSync();
  };
  /** Twenty nights (the charts draw from 14) ending the night before `now`, newest first, as the
   *  reader returns them. */
  const nightsTo = (now: Date) =>
    Array.from({ length: 20 }, (_, i) =>
      night(new Date(now.getTime() - (i + 1) * DAY).toISOString().slice(0, 10)),
    );
  const viewAt = (now: Date) => overviewFromSnapshot(snapshot({ nights: nightsTo(now) }), now);

  it("a refresh that moves the window on keeps a focused chart on the same night, and a night that left reads as none (#2174)", async () => {
    vi.useFakeTimers({ now: NOW.getTime() });
    await mountWith(viewAt(NOW));
    const n = Number(slider().getAttribute("aria-valuemax"));
    expect(n, "the chart has nights to step through").toBeGreaterThan(3);
    key("Home");
    key("ArrowRight");
    key("ArrowRight");
    expect(slider().getAttribute("aria-valuenow")).toBe("3");
    const night3 = slider().getAttribute("aria-valuetext")!.split(":")[0]!;
    const later = new Date(NOW.getTime() + DAY);
    vi.setSystemTime(later);
    show(viewAt(later));
    expect(
      slider().getAttribute("aria-valuetext")!.split(":")[0],
      "the same night after the window moved on",
    ).toBe(night3);
    expect(slider().getAttribute("aria-valuenow"), "one place earlier now").toBe("2");

    key("Home");
    const oldest = slider().getAttribute("aria-valuetext")!.split(":")[0]!;
    const next = new Date(later.getTime() + DAY);
    vi.setSystemTime(next);
    show(viewAt(next));
    expect(slider().getAttribute("aria-valuetext")!.split(":")[0]).not.toBe(oldest);
    expect(
      slider().getAttribute("aria-valuenow"),
      "the chosen night left the window: no night is chosen, so the slider reports the newest",
    ).toBe(slider().getAttribute("aria-valuemax"));
  });
});
