import { describe, it, expect, vi } from "vitest";
import { loadBacklogPanel } from "../../src/dashboard/backlog-source.js";

/** P1-111: the request-time read of the workspace's BACKLOG.md. The text is invented. */
const MD = [
  "**Last full re-rank: 2026-11-23 ~13:20Z**",
  "## P1 — next",
  "| # | Item | Tier |",
  "| --- | --- | --- |",
  "| P1-901 | **Secret-sounding first title** | 🟢 |",
  "| P1-902 | **Second** | 🟡 |",
].join("\n");

type Call = { url: string; init: RequestInit | undefined };

function stub(contents: Response | Error, commits: Response = Response.json([])) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/commits?")) return commits;
    if (contents instanceof Error) throw contents;
    return contents;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("loadBacklogPanel", () => {
  it("reads BACKLOG.md raw from the workspace's default branch with the token, and its last commit time", async () => {
    const { fetch, calls } = stub(
      new Response(MD),
      Response.json([{ commit: { committer: { date: "2026-11-23T17:35:00Z" } } }]),
    );
    const panel = await loadBacklogPanel({ token: " tok ", fetch, log: () => {} });
    expect(panel).toEqual({
      kind: "ok",
      rerankedAt: "2026-11-23T13:20:00.000Z",
      writtenAt: "2026-11-23T17:35:00Z",
      items: [
        { rank: 1, id: "P1-901", title: "Secret-sounding first title", tier: "🟢", status: null },
        { rank: 2, id: "P1-902", title: "Second", tier: "🟡", status: null },
      ],
    });
    const read = calls.find((c) => c.url.includes("/contents/"))!;
    expect(read.url).toBe(
      "https://api.github.com/repos/reddoorla/reddoor-workspace/contents/BACKLOG.md",
    );
    const headers = read.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok");
    expect(headers.accept).toBe("application/vnd.github.raw+json");
  });

  it("shows the items without a write time when the commits read fails", async () => {
    const { fetch } = stub(new Response(MD), new Response("nope", { status: 500 }));
    const panel = await loadBacklogPanel({ token: "tok", fetch, log: () => {} });
    expect(panel.kind === "ok" && panel.writtenAt).toBeNull();
  });

  it("says so, without a request, when no token is set", async () => {
    const { fetch } = stub(new Response(MD));
    expect(await loadBacklogPanel({ token: undefined, fetch })).toEqual({
      kind: "unavailable",
      reason: "The dashboard has no GH_TOKEN set.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("names a token that cannot read the private repo, without GitHub's body", async () => {
    const log = vi.fn();
    const { fetch } = stub(new Response("body-text-from-github", { status: 404 }));
    const panel = await loadBacklogPanel({ token: "tok", fetch, log });
    expect(panel).toEqual({
      kind: "unavailable",
      reason:
        "GitHub answered 404: the dashboard's GH_TOKEN cannot read reddoorla/reddoor-workspace's contents.",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("body-text-from-github");
  });

  it("shows a parse failure by row ID, and neither shows nor logs the row's text", async () => {
    const log = vi.fn();
    const broken = MD.replace("**Second**", "**Status: soon, Second** **Hidden title**");
    const { fetch } = stub(new Response(broken));
    const panel = await loadBacklogPanel({ token: "tok", fetch, log });
    expect(panel.kind).toBe("unavailable");
    const shown = panel.kind === "unavailable" ? panel.reason : "";
    expect(shown).toMatch(/^The backlog could not be read: P1-902: /);
    for (const text of [shown, JSON.stringify(log.mock.calls)]) {
      expect(text).not.toMatch(/Secret-sounding|Hidden title|soon/);
    }
  });

  it("logs a network failure by its name only", async () => {
    const log = vi.fn();
    const err = new TypeError("fetch failed: Secret-sounding detail");
    const { fetch } = stub(err);
    const panel = await loadBacklogPanel({ token: "tok", fetch, log });
    expect(panel).toEqual({
      kind: "unavailable",
      reason: "Reading the backlog from GitHub failed (TypeError).",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("Secret-sounding");
  });
});
