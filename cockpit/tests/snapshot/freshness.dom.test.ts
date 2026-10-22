import { describe, it, expect, vi } from "vitest";
import {
  CHECK_EVERY_MS,
  checkFreshness,
  isEditingField,
  startFreshness,
  type FreshnessDeps,
} from "../../src/lib/freshness.js";

/**
 * The open cockpit's refresh (PR 2 of the snapshot brief): one read of the store's
 * change counter, and the full snapshot again only when it moved. The brief's
 * proof: where nothing changed, no full read happens; where a lead arrived, it does.
 */

function deps(answer: () => Promise<Response>) {
  return {
    fetch: vi.fn<FreshnessDeps["fetch"]>(answer),
    refresh: vi.fn<FreshnessDeps["refresh"]>(async () => {}),
    signedOut: vi.fn<FreshnessDeps["signedOut"]>(),
  };
}
const version =
  (v: unknown, status = 200) =>
  async () =>
    new Response(JSON.stringify({ ok: true, version: v }), { status });

describe("checkFreshness", () => {
  it("nothing changed: one counter read, no full read", async () => {
    const d = deps(version(41));
    expect(await checkFreshness({ version: 41, gaps: [] }, d)).toBe("unchanged");
    expect(d.fetch).toHaveBeenCalledTimes(1);
    expect(d.fetch.mock.calls[0]?.[0]).toBe("/api/cockpit/version");
    expect(d.refresh).not.toHaveBeenCalled();
  });

  it("a lead arrived (the counter moved): the snapshot is read again", async () => {
    const d = deps(version(42));
    expect(await checkFreshness({ version: 41, gaps: [] }, d)).toBe("refreshed");
    expect(d.refresh).toHaveBeenCalledTimes(1);
  });

  it("a snapshot with a gap, or with no version, is read again without asking", async () => {
    for (const s of [{ version: 41, gaps: ["events"] }, { version: null, gaps: [] }, null]) {
      const d = deps(version(41));
      expect(await checkFreshness(s, d)).toBe("refreshed");
      expect(d.fetch).not.toHaveBeenCalled();
      expect(d.refresh).toHaveBeenCalledTimes(1);
    }
  });

  it("a session that ended marks the next navigation for a full load, which signs it out", async () => {
    for (const status of [401, 403]) {
      const d = deps(async () => new Response("{}", { status }));
      expect(await checkFreshness({ version: 41, gaps: [] }, d)).toBe("signed-out");
      expect(d.signedOut).toHaveBeenCalledTimes(1);
      expect(d.refresh).not.toHaveBeenCalled();
    }
  });

  it("a blip changes nothing: no full read, no reload, try again next time", async () => {
    for (const answer of [
      async () => new Response("down", { status: 502 }),
      async () => Promise.reject(new TypeError("offline")),
      async () => new Response("not json", { status: 200 }),
      version("41"),
    ]) {
      const d = deps(answer);
      expect(await checkFreshness({ version: 41, gaps: [] }, d)).toBe("unknown");
      expect(d.refresh).not.toHaveBeenCalled();
      expect(d.signedOut).not.toHaveBeenCalled();
    }
  });
});

describe("startFreshness: when the open cockpit checks", () => {
  function env(over: Partial<{ visible: boolean; editing: boolean }> = {}) {
    const state = { visible: true, editing: false, ...over };
    const handlers = new Map<string, Set<() => void>>();
    return {
      state,
      fire: (event: string) => {
        for (const h of handlers.get(event) ?? []) h();
      },
      listeners: () => [...handlers.values()].reduce((n, s) => n + s.size, 0),
      env: {
        isVisible: () => state.visible,
        isEditing: () => state.editing,
        listen: (event: "visibilitychange" | "focus" | "focusout", handler: () => void) => {
          const set = handlers.get(event) ?? new Set();
          set.add(handler);
          handlers.set(event, set);
          return () => set.delete(handler);
        },
      },
    };
  }
  const flush = () => vi.advanceTimersByTimeAsync(0);
  const snapshot = { version: 41, gaps: [] as string[] };

  it("asks about every 60 s while visible, and not while hidden", async () => {
    vi.useFakeTimers();
    try {
      const d = deps(version(41));
      const e = env();
      const c = startFreshness(() => snapshot, d, e.env);
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
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks on focus, one check at a time", async () => {
    let answer!: (r: Response) => void;
    const d = deps(() => new Promise<Response>((r) => (answer = r)));
    const e = env();
    const c = startFreshness(() => snapshot, d, e.env);
    e.fire("focus");
    e.fire("focus");
    e.fire("visibilitychange");
    expect(d.fetch).toHaveBeenCalledTimes(1);
    answer(new Response(JSON.stringify({ version: 41 })));
    await vi.waitFor(() => expect(d.fetch).toHaveBeenCalledTimes(1));
    c.stop();
  });

  it("while the operator is in a field, a check and a refresh wait until they leave it", async () => {
    vi.useFakeTimers();
    try {
      const d = deps(version(42));
      const e = env({ editing: true });
      const c = startFreshness(() => snapshot, d, e.env);
      e.fire("focus");
      c.requestRefresh(true);
      await flush();
      expect(d.fetch).not.toHaveBeenCalled();
      expect(d.refresh).not.toHaveBeenCalled();
      // Moving to another field is still editing.
      e.fire("focusout");
      await flush();
      expect(d.refresh).not.toHaveBeenCalled();
      // Leaving the fields runs the waiting refresh.
      e.state.editing = false;
      e.fire("focusout");
      await flush();
      expect(d.refresh).toHaveBeenCalledTimes(1);
      c.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a check whose answer comes back once the operator is in a field waits for them", async () => {
    // Review round 3: `isEditing` was asked only before the counter read, so a
    // check under way when the operator clicked into a field remounted the page.
    vi.useFakeTimers();
    try {
      let answer: (r: Response) => void = () => undefined;
      const d = deps(() => new Promise<Response>((r) => (answer = r)));
      const e = env();
      const c = startFreshness(() => snapshot, d, e.env);
      e.fire("focus");
      await flush();
      expect(d.fetch).toHaveBeenCalledTimes(1);
      e.state.editing = true;
      answer(new Response(JSON.stringify({ ok: true, version: 42 })));
      await flush();
      expect(d.refresh).not.toHaveBeenCalled();
      e.state.editing = false;
      e.fire("focusout");
      await flush();
      expect(d.refresh).toHaveBeenCalledTimes(1);
      c.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("once a check finds the session ended, it never checks again", async () => {
    // Review round 4: a reload at once took what the operator had typed; the page
    // now stays as it is and the next navigation is a full load (signedOut).
    vi.useFakeTimers();
    try {
      const d = deps(async () => new Response("{}", { status: 401 }));
      const e = env();
      const c = startFreshness(() => snapshot, d, e.env);
      e.fire("focus");
      await flush();
      expect(d.signedOut).toHaveBeenCalledTimes(1);
      e.fire("focus");
      await vi.advanceTimersByTimeAsync(60_000 * 3);
      expect(d.fetch).toHaveBeenCalledTimes(1);
      c.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a post's refresh is the page's own; one a check starts is not; a waiting pair runs as own", async () => {
    vi.useFakeTimers();
    try {
      const d = deps(version(42));
      const e = env();
      const c = startFreshness(() => snapshot, d, e.env);
      c.requestRefresh(true);
      expect(d.refresh).toHaveBeenLastCalledWith(true);
      e.fire("focus");
      await flush();
      expect(d.refresh).toHaveBeenLastCalledWith(false);
      // Both waiting for the operator: the post's control must keep what it shows.
      e.state.editing = true;
      c.requestRefresh(true);
      c.requestRefresh(false);
      e.state.editing = false;
      e.fire("focusout");
      await flush();
      expect(d.refresh).toHaveBeenCalledTimes(3);
      // The post's, though the check's came later.
      expect(d.refresh).toHaveBeenLastCalledWith(true);
      c.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a refresh asked for outside a field runs at once", () => {
    const d = deps(version(41));
    const c = startFreshness(() => snapshot, d, env().env);
    c.requestRefresh(true);
    expect(d.refresh).toHaveBeenCalledTimes(1);
    c.stop();
  });
});

describe("isEditingField", () => {
  it("is a field that takes typing or a choice, not a button or a box", () => {
    const make = (html: string) => {
      const div = document.createElement("div");
      div.innerHTML = html;
      return div.firstElementChild;
    };
    expect(isEditingField(make("<input>"))).toBe(true);
    expect(isEditingField(make('<input type="date">'))).toBe(true);
    expect(isEditingField(make("<textarea></textarea>"))).toBe(true);
    expect(isEditingField(make("<select></select>"))).toBe(true);
    expect(isEditingField(make('<input type="checkbox">'))).toBe(false);
    expect(isEditingField(make("<button></button>"))).toBe(false);
    expect(isEditingField(null)).toBe(false);
  });
});
