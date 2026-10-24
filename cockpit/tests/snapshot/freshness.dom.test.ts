import { describe, it, expect, vi } from "vitest";
import {
  CHECK_EVERY_MS,
  CHECK_TIMEOUT_MS,
  VERSION_AFTER_HEADER,
  VERSION_BEFORE_HEADER,
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

  describe("the page's own changes (#1700)", () => {
    /** A store whose counter the test moves, answering every read with its value. */
    function store(start: number) {
      const s = { n: start };
      const d = deps(async () => new Response(JSON.stringify({ ok: true, version: s.n })));
      return { s, d };
    }
    /** A post's answer as the cockpit's endpoint wrapper sends it (route.ts). */
    const answered = (before: number, after: number, status = 200) =>
      new Response("{}", {
        status,
        headers: {
          [VERSION_BEFORE_HEADER]: String(before),
          [VERSION_AFTER_HEADER]: String(after),
        },
      });
    /** One of the page's own posts: the store moves by `by` while its handler runs. */
    const post =
      (s: { n: number }, by = 1) =>
      async () => {
        const before = s.n;
        s.n += by;
        return answered(before, s.n);
      };

    it("a post the page makes does not raise the notice, however far it moves the counter", () =>
      withTimers(async () => {
        const { s, d } = store(41);
        const e = env();
        const onNewer = vi.fn();
        const c = startFreshness(() => snapshot, d, e.env, onNewer);
        await c.aroundOwnWrite(post(s, 3));
        e.fire("focus");
        await flush();
        expect(d.fetch).toHaveBeenCalledTimes(1);
        expect(onNewer).not.toHaveBeenCalled();
        c.stop();
      }));

    it("sends the post at once, reading nothing in front of it", () =>
      withTimers(async () => {
        const { s, d } = store(41);
        const c = startFreshness(() => snapshot, d, env().env, vi.fn());
        const write = vi.fn(post(s));
        await c.aroundOwnWrite(write);
        expect(write).toHaveBeenCalledTimes(1);
        expect(d.fetch).not.toHaveBeenCalled();
        c.stop();
      }));

    it("someone else's write before the post still raises it", () =>
      withTimers(async () => {
        const { s, d } = store(41);
        const e = env();
        const onNewer = vi.fn();
        const c = startFreshness(() => snapshot, d, e.env, onNewer);
        s.n = 42; // another session, after this snapshot was read
        await c.aroundOwnWrite(post(s));
        e.fire("focus");
        await flush();
        expect(onNewer).toHaveBeenCalledTimes(1);
        c.stop();
      }));

    it("someone else's write after the post still raises it", () =>
      withTimers(async () => {
        const { s, d } = store(41);
        const e = env();
        const onNewer = vi.fn();
        const c = startFreshness(() => snapshot, d, e.env, onNewer);
        await c.aroundOwnWrite(post(s));
        e.fire("focus");
        await flush();
        expect(onNewer).not.toHaveBeenCalled();
        s.n += 1;
        e.fire("focus");
        await flush();
        expect(onNewer).toHaveBeenCalledTimes(1);
        c.stop();
      }));

    it("two overlapping posts, answered in either order, are both the page's own", () =>
      withTimers(async () => {
        for (const order of ["in order", "reversed"]) {
          const { s, d } = store(41);
          const e = env();
          const onNewer = vi.fn();
          const c = startFreshness(() => snapshot, d, e.env, onNewer);
          const first = answered(41, 42);
          const second = answered(42, 43);
          s.n = 43;
          let a: (r: Response) => void = () => undefined;
          let b: (r: Response) => void = () => undefined;
          const pa = c.aroundOwnWrite(() => new Promise<Response>((r) => (a = r)));
          const pb = c.aroundOwnWrite(() => new Promise<Response>((r) => (b = r)));
          if (order === "in order") {
            a(first);
            b(second);
          } else {
            b(second);
            a(first);
          }
          await Promise.all([pa, pb]);
          e.fire("focus");
          await flush();
          expect(onNewer, order).not.toHaveBeenCalled();
          c.stop();
        }
      }));

    it("two posts that both read the counter before either wrote are both the page's own", () =>
      withTimers(async () => {
        const { s, d } = store(43);
        const e = env();
        const onNewer = vi.fn();
        const c = startFreshness(() => snapshot, d, e.env, onNewer);
        await c.aroundOwnWrite(async () => answered(41, 42));
        await c.aroundOwnWrite(async () => answered(41, 43));
        e.fire("focus");
        await flush();
        expect(s.n).toBe(43);
        expect(onNewer).not.toHaveBeenCalled();
        c.stop();
      }));

    it("three overlapping posts whose reads fall inside each other's runs are all the page's own", () =>
      withTimers(async () => {
        // A reads 41 and writes 42; B and C read 42; B writes 43 and A reads 43;
        // C writes 44 and B and C read 44. No one else writes.
        const { d } = store(44);
        const e = env();
        const onNewer = vi.fn();
        const c = startFreshness(() => snapshot, d, e.env, onNewer);
        for (const [before, after] of [
          [41, 43],
          [42, 44],
          [42, 44],
        ] as const) {
          await c.aroundOwnWrite(async () => answered(before, after));
        }
        e.fire("focus");
        await flush();
        expect(onNewer).not.toHaveBeenCalled();
        c.stop();
      }));

    it("a check asking when the page starts a post says nothing, even before the post answers", () =>
      withTimers(async () => {
        const s = { n: 41 };
        let reply: (r: Response) => void = () => undefined;
        const d = deps(() => new Promise<Response>((r) => (reply = r)));
        const e = env();
        const onNewer = vi.fn();
        const c = startFreshness(() => snapshot, d, e.env, onNewer);
        e.fire("focus"); // the check asks while the counter is 41
        await flush();
        let answer: (r: Response) => void = () => undefined;
        const posting = c.aroundOwnWrite(() => new Promise<Response>((r) => (answer = r)));
        s.n = 42; // the post's write lands; the check's read sees it
        reply(new Response(JSON.stringify({ ok: true, version: s.n })));
        await flush();
        expect(onNewer).not.toHaveBeenCalled();
        answer(answered(41, 42));
        await posting;
        c.stop();
      }));

    it("no check runs while the page's own post is in flight", () =>
      withTimers(async () => {
        const { s, d } = store(41);
        const e = env();
        const onNewer = vi.fn();
        const c = startFreshness(() => snapshot, d, e.env, onNewer);
        let finish: (r: Response) => void = () => undefined;
        const posting = c.aroundOwnWrite(
          () =>
            new Promise<Response>((r) => {
              s.n = 42; // the write has landed; its answer has not
              finish = r;
            }),
        );
        e.fire("focus");
        await flush();
        expect(d.fetch).not.toHaveBeenCalled();
        finish(answered(41, 42));
        await posting;
        e.fire("focus");
        await flush();
        expect(onNewer).not.toHaveBeenCalled();
        c.stop();
      }));

    it("a post that never answers holds checks off for at most CHECK_TIMEOUT_MS", () =>
      withTimers(async () => {
        const { s, d } = store(41);
        const e = env();
        const onNewer = vi.fn();
        const c = startFreshness(() => snapshot, d, e.env, onNewer);
        void c.aroundOwnWrite(() => new Promise<Response>(() => undefined));
        s.n = 99; // someone else writes while the page's post hangs
        await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS - 1);
        e.fire("focus");
        await flush();
        expect(d.fetch).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        e.fire("focus");
        await flush();
        expect(onNewer).toHaveBeenCalledTimes(1);
        c.stop();
      }));

    it("an answer without the counter (a refusal, an older server) leaves the notice as it was", () =>
      withTimers(async () => {
        const { s, d } = store(41);
        const e = env();
        const onNewer = vi.fn();
        const c = startFreshness(() => snapshot, d, e.env, onNewer);
        await c.aroundOwnWrite(async () => {
          s.n += 1;
          return new Response("{}", { status: 200 });
        });
        e.fire("focus");
        await flush();
        expect(onNewer).toHaveBeenCalledTimes(1);
        c.stop();
      }));

    it("a check already asking when the post's answer lands says nothing", () =>
      withTimers(async () => {
        const s = { n: 41 };
        let reply: (r: Response) => void = () => undefined;
        const d = deps(() => new Promise<Response>((r) => (reply = r)));
        const e = env();
        const onNewer = vi.fn();
        const c = startFreshness(() => snapshot, d, e.env, onNewer);
        e.fire("focus"); // the check asks while the counter is 41
        await flush();
        // The page's post lands and is answered before the check's reply comes back,
        // which the server read after the post had committed.
        s.n = 42;
        reply(new Response(JSON.stringify({ ok: true, version: s.n })));
        await c.aroundOwnWrite(async () => answered(41, 42));
        await flush();
        expect(onNewer).not.toHaveBeenCalled();
        c.stop();
      }));

    it("the post's own answer and error come back unchanged", () =>
      withTimers(async () => {
        const { d } = store(41);
        const c = startFreshness(() => snapshot, d, env().env, vi.fn());
        const res = answered(41, 42, 201);
        await expect(c.aroundOwnWrite(async () => res)).resolves.toBe(res);
        await expect(
          c.aroundOwnWrite(async () => Promise.reject(new Error("refused"))),
        ).rejects.toThrow("refused");
        c.stop();
      }));
  });

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
