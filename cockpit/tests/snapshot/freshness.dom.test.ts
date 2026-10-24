import { describe, it, expect, vi } from "vitest";
import {
  CHECK_EVERY_MS,
  CHECK_TIMEOUT_MS,
  checkFreshness,
  startFreshness,
  type FreshnessDeps,
} from "../../src/lib/freshness.js";

/**
 * The cockpit's "has the store changed?" check (the snapshot brief's PR 2, cut
 * down to a notice by the operator's decision 2026-10-22-1541): one read of the
 * change counter, never the snapshot; a notice when it moved; nothing on the page
 * changes under the operator.
 */

function deps(answer: () => Promise<Response>) {
  return {
    fetch: vi.fn<FreshnessDeps["fetch"]>(answer),
    signedOut: vi.fn<FreshnessDeps["signedOut"]>(),
  };
}
const version =
  (v: unknown, status = 200) =>
  async () =>
    new Response(JSON.stringify({ ok: true, version: v }), { status });

describe("checkFreshness", () => {
  it("nothing changed: one counter read, uncached", async () => {
    const d = deps(version(41));
    expect(await checkFreshness({ version: 41 }, d)).toBe("unchanged");
    expect(d.fetch).toHaveBeenCalledTimes(1);
    expect(d.fetch.mock.calls[0]).toEqual([
      "/api/cockpit/version",
      {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: expect.any(AbortSignal),
      },
    ]);
  });

  it("the counter moved: newer", async () => {
    const d = deps(version(42));
    expect(await checkFreshness({ version: 41 }, d)).toBe("newer");
  });

  it("a snapshot with no counter cannot be compared, but the session is still checked", async () => {
    for (const s of [{ version: null }, null]) {
      const d = deps(version(42));
      expect(await checkFreshness(s, d)).toBe("unknown");
      expect(d.fetch).toHaveBeenCalledTimes(1);
    }
    const d = deps(async () => new Response("{}", { status: 401 }));
    expect(await checkFreshness({ version: null }, d)).toBe("signed-out");
  });

  it("a session that ended marks the next navigation for a full load, which signs it out", async () => {
    for (const status of [401, 403]) {
      const d = deps(async () => new Response("{}", { status }));
      expect(await checkFreshness({ version: 41 }, d)).toBe("signed-out");
      expect(d.signedOut).toHaveBeenCalledTimes(1);
    }
  });

  it("a blip says nothing: try again next time", async () => {
    for (const answer of [
      async () => new Response("down", { status: 502 }),
      async () => Promise.reject(new TypeError("offline")),
      async () => new Response("not json", { status: 200 }),
      version("41"),
    ]) {
      const d = deps(answer);
      expect(await checkFreshness({ version: 41 }, d)).toBe("unknown");
      expect(d.signedOut).not.toHaveBeenCalled();
    }
  });
});

describe("startFreshness: when the open cockpit checks", () => {
  function env(over: Partial<{ visible: boolean }> = {}) {
    const state = { visible: true, ...over };
    const handlers = new Map<string, Set<() => void>>();
    return {
      state,
      fire: (event: string) => {
        for (const h of handlers.get(event) ?? []) h();
      },
      listeners: () => [...handlers.values()].reduce((n, s) => n + s.size, 0),
      env: {
        isVisible: () => state.visible,
        listen: (event: "visibilitychange" | "focus", handler: () => void) => {
          const set = handlers.get(event) ?? new Set();
          set.add(handler);
          handlers.set(event, set);
          return () => set.delete(handler);
        },
      },
    };
  }
  const flush = () => vi.advanceTimersByTimeAsync(0);
  const snapshot = { version: 41 };

  async function withTimers(f: () => Promise<void>): Promise<void> {
    vi.useFakeTimers();
    try {
      await f();
    } finally {
      vi.useRealTimers();
    }
  }

  it("asks about every 60 s while visible, and not while hidden", () =>
    withTimers(async () => {
      const d = deps(version(41));
      const e = env();
      const c = startFreshness(() => snapshot, d, e.env, vi.fn());
      // The period itself, not the constant: a slower cadence must fail here.
      await vi.advanceTimersByTimeAsync(59_999);
      expect(d.fetch).toHaveBeenCalledTimes(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(d.fetch).toHaveBeenCalledTimes(1);
      e.state.visible = false;
      await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 3);
      expect(d.fetch).toHaveBeenCalledTimes(1);
      // Coming back to the tab asks at once.
      e.state.visible = true;
      e.fire("visibilitychange");
      await flush();
      expect(d.fetch).toHaveBeenCalledTimes(2);
      c.stop();
      await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 3);
      expect(d.fetch).toHaveBeenCalledTimes(2);
      expect(e.listeners()).toBe(0);
    }));

  it("asks on focus, one check at a time", () =>
    withTimers(async () => {
      let answer: (r: Response) => void = () => undefined;
      const d = deps(() => new Promise<Response>((r) => (answer = r)));
      const e = env();
      const c = startFreshness(() => snapshot, d, e.env, vi.fn());
      e.fire("focus");
      e.fire("focus");
      await flush();
      expect(d.fetch).toHaveBeenCalledTimes(1);
      answer(new Response(JSON.stringify({ ok: true, version: 41 })));
      await flush();
      e.fire("focus");
      await flush();
      expect(d.fetch).toHaveBeenCalledTimes(2);
      c.stop();
    }));

  it("once the store is newer, says so once and asks no more", () =>
    withTimers(async () => {
      const d = deps(version(42));
      const e = env();
      const onNewer = vi.fn();
      const c = startFreshness(() => snapshot, d, e.env, onNewer);
      e.fire("focus");
      await flush();
      expect(onNewer).toHaveBeenCalledTimes(1);
      e.fire("focus");
      await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 3);
      expect(d.fetch).toHaveBeenCalledTimes(1);
      expect(onNewer).toHaveBeenCalledTimes(1);
      c.stop();
    }));

  it("a check that never answers is abandoned, and the next one still runs (#1701)", () =>
    withTimers(async () => {
      // A dropped connection: the request settles only when its signal aborts,
      // as a real fetch does.
      let calls = 0;
      const d = deps(async () => Promise.reject(new Error("unused")));
      d.fetch.mockImplementation((_url, init) => {
        calls++;
        if (calls > 1) return version(42)();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        });
      });
      const e = env();
      const onNewer = vi.fn();
      const c = startFreshness(() => snapshot, d, e.env, onNewer);
      e.fire("focus");
      await flush();
      expect(d.fetch).toHaveBeenCalledTimes(1);
      // Within the timeout the hung check still holds the slot.
      await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS - 1);
      e.fire("focus");
      await flush();
      expect(d.fetch).toHaveBeenCalledTimes(1);
      // Past it, the hung check counts as "unknown" and frees the slot.
      await vi.advanceTimersByTimeAsync(1);
      e.fire("focus");
      await flush();
      expect(d.fetch).toHaveBeenCalledTimes(2);
      expect(onNewer).toHaveBeenCalledTimes(1);
      c.stop();
    }));

  it("once the session has ended, asks no more", () =>
    withTimers(async () => {
      const d = deps(async () => new Response("{}", { status: 401 }));
      const e = env();
      const onNewer = vi.fn();
      const c = startFreshness(() => snapshot, d, e.env, onNewer);
      e.fire("focus");
      await flush();
      expect(d.signedOut).toHaveBeenCalledTimes(1);
      e.fire("focus");
      await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 3);
      expect(d.fetch).toHaveBeenCalledTimes(1);
      expect(onNewer).not.toHaveBeenCalled();
      c.stop();
    }));
});
