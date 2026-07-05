import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  whenPageReady,
  prefersReducedMotion,
  type PageReadyEnv,
} from "../../src/client/page-ready.js";

type Listener = () => void;

function fakeImage(complete = false) {
  const listeners = new Map<string, Listener[]>();
  return {
    complete,
    addEventListener(type: string, cb: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), cb]);
    },
    fire(type: string) {
      this.complete = true;
      for (const cb of listeners.get(type) ?? []) cb();
    },
  };
}

function fakeWindow(matches = false) {
  const listeners = new Map<string, Listener[]>();
  return {
    addEventListener(type: string, cb: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), cb]);
    },
    fire(type: string) {
      for (const cb of listeners.get(type) ?? []) cb();
    },
    matchMedia: (query: string) => ({ matches: query.includes("reduce") && matches }),
  };
}

function fakeDocument(readyState = "loading", images: ReturnType<typeof fakeImage>[] = []) {
  return {
    readyState,
    querySelectorAll: vi.fn(() => images),
    addEventListener() {},
  };
}

function env(over: Partial<PageReadyEnv> = {}): PageReadyEnv {
  return { document: fakeDocument("complete"), window: fakeWindow(), ...over };
}

/** Start the call, capture its resolution, and return a probe for assertions. */
function probe(promise: Promise<string>) {
  const state = { resolved: undefined as string | undefined };
  void promise.then((reason) => (state.resolved = reason));
  return state;
}

describe("whenPageReady", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves no-dom immediately when there is no document/window (SSR)", async () => {
    // vitest runs in a node environment, so the globalThis fallback finds no DOM.
    await expect(whenPageReady()).resolves.toBe("no-dom");
  });

  it("holds until minMs even when everything is already ready", async () => {
    const p = probe(whenPageReady({ minMs: 400 }, env()));
    await vi.advanceTimersByTimeAsync(399);
    expect(p.resolved).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(p.resolved).toBe("ready");
  });

  it("resolves at minMs=0 without waiting when there is nothing to wait for", async () => {
    const p = probe(whenPageReady({ minMs: 0 }, env()));
    await vi.advanceTimersByTimeAsync(0);
    expect(p.resolved).toBe("ready");
  });

  it("waits for eager images to load", async () => {
    const img = fakeImage(false);
    const p = probe(
      whenPageReady({ minMs: 0 }, env({ document: fakeDocument("complete", [img]) })),
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(p.resolved).toBeUndefined();
    img.fire("load");
    await vi.advanceTimersByTimeAsync(0);
    expect(p.resolved).toBe("ready");
  });

  it("counts a failed image as settled — a broken hero can't wedge the splash open", async () => {
    const img = fakeImage(false);
    const p = probe(
      whenPageReady({ minMs: 0 }, env({ document: fakeDocument("complete", [img]) })),
    );
    img.fire("error");
    await vi.advanceTimersByTimeAsync(0);
    expect(p.resolved).toBe("ready");
  });

  it("treats already-complete (cache-hit) images as settled synchronously", async () => {
    const doc = fakeDocument("complete", [fakeImage(true), fakeImage(true)]);
    const p = probe(whenPageReady({ minMs: 0 }, env({ document: doc })));
    await vi.advanceTimersByTimeAsync(0);
    expect(p.resolved).toBe("ready");
  });

  it("skips image tracking when waitForImages is false", async () => {
    const doc = fakeDocument("complete", [fakeImage(false)]);
    const p = probe(whenPageReady({ minMs: 0, waitForImages: false }, env({ document: doc })));
    await vi.advanceTimersByTimeAsync(0);
    expect(p.resolved).toBe("ready");
    expect(doc.querySelectorAll).not.toHaveBeenCalled();
  });

  it("passes a custom selector through to querySelectorAll", async () => {
    const doc = fakeDocument("complete");
    probe(whenPageReady({ minMs: 0, waitForImages: "img.hero" }, env({ document: doc })));
    expect(doc.querySelectorAll).toHaveBeenCalledWith("img.hero");
  });

  it("does not wait for document load by default", async () => {
    const p = probe(whenPageReady({ minMs: 0 }, env({ document: fakeDocument("loading") })));
    await vi.advanceTimersByTimeAsync(0);
    expect(p.resolved).toBe("ready");
  });

  it("waits for the window load event when waitForDocument is set", async () => {
    const win = fakeWindow();
    const p = probe(
      whenPageReady(
        { minMs: 0, waitForDocument: true },
        env({ document: fakeDocument("loading"), window: win }),
      ),
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(p.resolved).toBeUndefined();
    win.fire("load");
    await vi.advanceTimersByTimeAsync(0);
    expect(p.resolved).toBe("ready");
  });

  it("short-circuits waitForDocument when readyState is already complete", async () => {
    const p = probe(
      whenPageReady(
        { minMs: 0, waitForDocument: true },
        env({ document: fakeDocument("complete") }),
      ),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(p.resolved).toBe("ready");
  });

  it("caps a never-loading page at maxMs with reason timeout", async () => {
    const img = fakeImage(false);
    const p = probe(
      whenPageReady({ minMs: 0, maxMs: 2000 }, env({ document: fakeDocument("complete", [img]) })),
    );
    await vi.advanceTimersByTimeAsync(1999);
    expect(p.resolved).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(p.resolved).toBe("timeout");
  });

  it("never caps when maxMs is Infinity", async () => {
    const img = fakeImage(false);
    const p = probe(
      whenPageReady(
        { minMs: 0, maxMs: Infinity },
        env({ document: fakeDocument("complete", [img]) }),
      ),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(p.resolved).toBeUndefined();
    img.fire("load");
    await vi.advanceTimersByTimeAsync(0);
    expect(p.resolved).toBe("ready");
  });

  it("enforces the minMs floor even when the maxMs cap fires first", async () => {
    const img = fakeImage(false);
    const p = probe(
      whenPageReady({ minMs: 500, maxMs: 100 }, env({ document: fakeDocument("complete", [img]) })),
    );
    await vi.advanceTimersByTimeAsync(499);
    expect(p.resolved).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(p.resolved).toBe("timeout");
  });

  it("waits for extra signals", async () => {
    let release!: () => void;
    const signal = new Promise<void>((r) => (release = r));
    const p = probe(whenPageReady({ minMs: 0, signals: [signal] }, env()));
    await vi.advanceTimersByTimeAsync(100);
    expect(p.resolved).toBeUndefined();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(p.resolved).toBe("ready");
  });

  it("treats a rejected signal as settled instead of propagating the rejection", async () => {
    let reject!: (e: Error) => void;
    const signal = new Promise<void>((_r, rj) => (reject = rj));
    const p = probe(whenPageReady({ minMs: 0, signals: [signal] }, env()));
    reject(new Error("poster decode failed"));
    await vi.advanceTimersByTimeAsync(0);
    expect(p.resolved).toBe("ready");
  });
});

describe("prefersReducedMotion", () => {
  it("reflects the media query result", () => {
    expect(prefersReducedMotion({ window: fakeWindow(true) })).toBe(true);
    expect(prefersReducedMotion({ window: fakeWindow(false) })).toBe(false);
  });

  it("is false with no window (SSR) or no matchMedia", () => {
    expect(prefersReducedMotion()).toBe(false);
    expect(prefersReducedMotion({ window: { addEventListener() {} } })).toBe(false);
  });
});
