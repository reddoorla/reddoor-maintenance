import { describe, it, expect, vi } from "vitest";
import { checkFreshness, type FreshnessDeps } from "../../src/lib/freshness.js";

/**
 * The open cockpit's refresh (PR 2 of the snapshot brief): one read of the store's
 * change counter, and the full snapshot again only when it moved. The brief's
 * proof: where nothing changed, no full read happens; where a lead arrived, it does.
 */

function deps(answer: () => Promise<Response>): FreshnessDeps & {
  refresh: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  fetch: ReturnType<typeof vi.fn>;
} {
  return {
    fetch: vi.fn(answer),
    refresh: vi.fn(async () => {}),
    reload: vi.fn(),
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

  it("a session that ended loads the page in full, which signs it out", async () => {
    for (const status of [401, 403]) {
      const d = deps(async () => new Response("{}", { status }));
      expect(await checkFreshness({ version: 41, gaps: [] }, d)).toBe("signed-out");
      expect(d.reload).toHaveBeenCalledTimes(1);
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
      expect(d.reload).not.toHaveBeenCalled();
    }
  });
});
