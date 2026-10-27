import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { postAction, setOwnWrite } from "../../src/lib/post.js";
import { fromSnapshot, type SnapshotData } from "../../src/lib/snapshot.js";
import type { CockpitSnapshot } from "../../../src/dashboard/snapshot-views.js";

/**
 * Until PR 2 of the snapshot brief refreshes it, the snapshot is never kept past
 * a change or a failed read: the next navigation is a full page load, which reads
 * the store again, as every navigation did when each link reloaded the page.
 * SvelteKit's switch for that is `data-sveltekit-reload` on <body>.
 */

const reloads = () => document.body.hasAttribute("data-sveltekit-reload");

function snapshot(over: Partial<CockpitSnapshot> = {}): CockpitSnapshot {
  return {
    takenAt: "2026-10-20T12:00:00.000Z",
    version: 0,
    baseUrl: "https://dash.example",
    gaps: [],
    sites: [],
    slugById: new Map(),
    reports: [],
    digest: {},
    rollup: null,
    recentEvents: [],
    deadLetters: new Map(),
    deadLetterOldest: new Map(),
    submissions: [],
    rawSubmissionEnums: new Map(),
    screenOuts: [],
    audits: [],
    ...over,
  };
}

const parent = (d: Partial<SnapshotData>) => async (): Promise<SnapshotData> => ({
  snapshot: snapshot(),
  failure: null,
  clockOffsetMs: 0,
  ...d,
});

beforeEach(() => document.body.removeAttribute("data-sveltekit-reload"));
afterEach(() => {
  vi.unstubAllGlobals();
  setOwnWrite(null);
});

describe("the next navigation reloads", () => {
  it("sends each post through the page's own-write hook (#1700), and still reloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );
    const seen: string[] = [];
    setOwnWrite(async (write) => {
      seen.push("before");
      const r = await write();
      seen.push("after");
      return r;
    });
    const res = await postAction("/api/x", { body: "{}" });
    expect(res.status).toBe(200);
    expect(seen).toEqual(["before", "after"]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(reloads()).toBe(true);
  });

  it("after any change a page posts, whatever its answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 500 })),
    );
    expect(reloads()).toBe(false);
    const res = await postAction("/api/x", { body: "{}" });
    expect(res.status).toBe(500);
    expect(reloads()).toBe(true);
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: "{}" });
  });

  it("even when the post never answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("offline"))),
    );
    await expect(postAction("/api/x")).rejects.toThrow("offline");
    expect(reloads()).toBe(true);
  });

  it("after a page derives from a snapshot with a gap", async () => {
    await fromSnapshot("t", parent({ snapshot: snapshot({ gaps: ["events"] }) }), () => 1);
    expect(reloads()).toBe(true);
  });

  it("after the store failed", async () => {
    await expect(
      fromSnapshot(
        "t",
        parent({ snapshot: null, failure: { status: 502, message: "x" } }),
        () => 1,
      ),
    ).rejects.toMatchObject({ status: 502 });
    expect(reloads()).toBe(true);
  });

  it("but not after a clean snapshot (the positive control)", async () => {
    expect(await fromSnapshot("t", parent({}), () => 1)).toBe(1);
    expect(reloads()).toBe(false);
  });
});

describe("a page derives on the server's clock", () => {
  it("now is this machine's clock plus the offset the layout measured", async () => {
    let seen = 0;
    const before = Date.now();
    await fromSnapshot("t", parent({ clockOffsetMs: -3_600_000 }), (_s, now) => {
      seen = now.getTime();
    });
    expect(seen).toBeGreaterThanOrEqual(before - 3_600_000);
    expect(seen).toBeLessThanOrEqual(Date.now() - 3_600_000);
  });
});

describe("the layout measures the clock offset once per snapshot", () => {
  it("a navigation an hour later does not move the page's now back to takenAt", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-20T12:00:05.000Z"));
      const { load } = await import("../../src/routes/+layout.js");
      const data = { email: null, snapshot: snapshot(), failure: null };
      const run = (path: string) =>
        (load as unknown as (e: unknown) => { clockOffsetMs: number })({
          data,
          url: new URL(`https://x${path}`),
        });
      const first = run("/").clockOffsetMs;
      expect(first).toBe(-5_000);
      vi.setSystemTime(new Date("2026-10-20T13:00:05.000Z"));
      expect(run("/fleet").clockOffsetMs).toBe(first);
      // A new snapshot (a refresh) is measured afresh.
      const fresh = { ...data, snapshot: snapshot({ takenAt: "2026-10-20T13:00:02.000Z" }) };
      const again = (load as unknown as (e: unknown) => { clockOffsetMs: number })({
        data: fresh,
        url: new URL("https://x/"),
      });
      expect(again.clockOffsetMs).toBe(-3_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("every change goes through postAction", () => {
  // A component that posted with fetch itself would leave the snapshot stale.
  const LIB = join(import.meta.dirname, "../../src");
  const files = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)],
    );
  it("no browser code posts with fetch directly", () => {
    const direct = files(LIB)
      .filter((f) => /\.(svelte|ts)$/.test(f) && !f.includes("/server/") && !f.endsWith("post.ts"))
      .filter((f) => /method:\s*"POST"/.test(readFileSync(f, "utf8")))
      .map((f) => relative(LIB, f));
    expect(direct).toEqual([]);
  });
});
