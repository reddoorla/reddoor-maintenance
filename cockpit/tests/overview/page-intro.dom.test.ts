import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { overviewFromSnapshot } from "../../src/lib/overview/view.js";
import { INTRO_MS } from "../../src/lib/overview/motion.js";
import { snapshot, NOW } from "./fixtures.js";

const nav = vi.hoisted(() => ({ invalidate: vi.fn(async () => undefined) }));
vi.mock("$app/navigation", () => ({ invalidate: nav.invalidate, afterNavigate: () => {} }));

/**
 * P1-87 minors, #2164: a page mounted hidden (a background tab) starts its intro when it is first
 * shown, and the intro runs INTRO_MS from the show. A re-read the cycle clock asks for while the
 * intro is on (a show with the view due, or the view falling due within the intro) waits for the
 * intro's end, so a refresh never plays the intro on what it inserts (P1-87 PR 8a, round 1, F2).
 *
 * The intro plays once per module load (`introPlayed`), so each test loads the page afresh.
 */
describe("the overview's intro in a page first shown late (#2164)", () => {
  let state: DocumentVisibilityState = "hidden";
  let target: HTMLDivElement;
  let unmountApp: (() => Promise<void>) | null = null;

  beforeEach(() => {
    state = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => state,
    });
    target = document.createElement("div");
    document.body.append(target);
    vi.useFakeTimers({ now: NOW.getTime() });
    vi.resetModules();
    nav.invalidate.mockClear();
  });
  afterEach(async () => {
    if (unmountApp) await unmountApp();
    unmountApp = null;
    target.remove();
    vi.useRealTimers();
  });

  /** The view, made at NOW, goes stale a minute later; its refresh window is long past. */
  const view = () => {
    const v = overviewFromSnapshot(snapshot(), NOW);
    const past = new Date(NOW.getTime() - 86_400_000).toISOString();
    return {
      ...v,
      cycle: {
        ...v.cycle,
        nowIso: NOW.toISOString(),
        staleAfterIso: new Date(NOW.getTime() + 60_000).toISOString(),
        refresh: { fromIso: past, untilIso: past },
      },
    };
  };
  const load = async () => {
    const { mount, unmount, flushSync } = await import("svelte");
    const { page: props } = await import("./page-props.svelte.js");
    props.data = { view: view() };
    const { default: Page } = await import("../../src/routes/+page.svelte");
    const app = mount(Page, { target, props: props as never });
    flushSync();
    unmountApp = () => unmount(app);
    return flushSync;
  };
  const show = (flush: () => void) => {
    state = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    flush();
  };
  const intro = () => target.querySelector(".ov-checks-list")!.hasAttribute("data-intro");

  it("shown while its view is fresh, it keeps its intro INTRO_MS from the show", async () => {
    const flush = await load();
    expect(intro(), "the intro is on at mount").toBe(true);
    vi.advanceTimersByTime(30_000);
    flush();
    expect(intro(), "a hidden page keeps its intro").toBe(true);
    show(flush);
    expect(intro(), "the intro is on when shown").toBe(true);
    vi.advanceTimersByTime(INTRO_MS - 1);
    flush();
    expect(intro(), "still on just before INTRO_MS").toBe(true);
    vi.advanceTimersByTime(1);
    flush();
    expect(intro(), "off INTRO_MS after the show").toBe(false);
  });

  it("shown when its view is due a re-read, it plays its intro whole and re-reads at its end", async () => {
    const flush = await load();
    vi.advanceTimersByTime(5 * 60_000);
    flush();
    expect(intro(), "a hidden page keeps its intro").toBe(true);
    expect(nav.invalidate, "no re-read while hidden").not.toHaveBeenCalled();
    show(flush);
    expect(intro(), "the intro is on when shown").toBe(true);
    expect(nav.invalidate, "the show's re-read waits for the intro").not.toHaveBeenCalled();
    vi.advanceTimersByTime(INTRO_MS - 1);
    flush();
    expect(intro()).toBe(true);
    expect(nav.invalidate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    flush();
    expect(intro(), "off INTRO_MS after the show").toBe(false);
    expect(nav.invalidate, "the held re-read runs at the intro's end").toHaveBeenCalledTimes(1);
  });

  it("shown just before its view falls due, the clock's tick inside the intro waits for its end", async () => {
    const flush = await load();
    // The view goes stale at +60 s, when the clock's first interval tick lands.
    vi.advanceTimersByTime(59_500);
    show(flush);
    vi.advanceTimersByTime(1_000);
    flush();
    expect(intro(), "the intro is on 1 s after the show").toBe(true);
    expect(nav.invalidate, "the tick's re-read waits").not.toHaveBeenCalled();
    vi.advanceTimersByTime(INTRO_MS - 1_000);
    flush();
    expect(intro()).toBe(false);
    expect(nav.invalidate).toHaveBeenCalledTimes(1);
  });

  it("a visible load keeps its intro until INTRO_MS from mount, as before (the control)", async () => {
    state = "visible";
    const flush = await load();
    vi.advanceTimersByTime(INTRO_MS - 1);
    flush();
    expect(intro(), "still on just before INTRO_MS").toBe(true);
    vi.advanceTimersByTime(1);
    flush();
    expect(intro()).toBe(false);
  });
});
