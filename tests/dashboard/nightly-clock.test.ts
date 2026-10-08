import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import yaml from "js-yaml";
import {
  fireNightlyConductor,
  NIGHTLY_CONDUCTOR_WORKFLOW,
} from "../../src/dashboard/nightly-clock.js";
import { CONDUCTOR, NIGHTLIES } from "../../scripts/nightly-conductor.mjs";

function fakeFetch(dispatchStatus = 204) {
  const calls: {
    method: string;
    url: string;
    body: string | undefined;
    auth: string | undefined;
  }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      method: init?.method ?? "GET",
      url,
      body: init?.body as string | undefined,
      auth: headers.authorization,
    });
    if (url.endsWith("/repos/reddoorla/reddoor-maintenance"))
      return new Response(JSON.stringify({ default_branch: "main" }), { status: 200 });
    if (url.endsWith("/dispatches")) return new Response(null, { status: dispatchStatus });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { f, calls };
}

describe("nightly-clock — the fixed-time trigger for the conductor", () => {
  it("dispatches the conductor on the default branch with the dashboard's token", async () => {
    const { f, calls } = fakeFetch();
    const r = await fireNightlyConductor({
      token: "pat",
      repo: "reddoorla/reddoor-maintenance",
      fetch: f,
    });
    expect(r).toEqual({ ok: true });
    const d = calls.find((c) => c.url.endsWith("/dispatches"))!;
    expect(d.url).toBe(
      `https://api.github.com/repos/reddoorla/reddoor-maintenance/actions/workflows/${CONDUCTOR}/dispatches`,
    );
    expect(JSON.parse(d.body!)).toEqual({ ref: "main" });
    expect(d.auth).toBe("Bearer pat");
    expect(NIGHTLY_CONDUCTOR_WORKFLOW).toBe(CONDUCTOR);
  });

  it("reports a refused dispatch instead of passing silently", async () => {
    const { f } = fakeFetch(403);
    const r = await fireNightlyConductor({
      token: "pat",
      repo: "reddoorla/reddoor-maintenance",
      fetch: f,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/403/);
  });

  it("refuses to run without a token and calls nothing", async () => {
    const { f, calls } = fakeFetch();
    const r = await fireNightlyConductor({
      token: "  ",
      repo: "reddoorla/reddoor-maintenance",
      fetch: f,
    });
    expect(r).toEqual({ ok: false, error: "GH_TOKEN is not configured" });
    expect(calls).toEqual([]);
  });

  it("fires early enough that every wait still ends before 12:00Z, and before daily-reports' cron", async () => {
    const src = await readFile("netlify/functions/nightly-clock.mts", "utf-8");
    const m = /^\s*schedule:\s*"(\d+) (\d+) \* \* \*",?\s*$/m.exec(src);
    expect(m, "nightly-clock.mts must carry its schedule as a string literal").not.toBeNull();
    const fires = Number(m![2]) * 60 + Number(m![1]);
    const waits = NIGHTLIES.reduce((a, n) => a + n.waitMinutes, 0);
    expect(fires + waits).toBeLessThan(12 * 60);
    const reports = yaml.load(await readFile(".github/workflows/daily-reports.yml", "utf-8")) as {
      on: { schedule: { cron: string }[] };
    };
    const [rm = NaN, rh = NaN] = (reports.on.schedule[0]?.cron ?? "").split(" ").map(Number);
    expect(fires).toBeLessThan(rh * 60 + rm);
    expect(/^\s*path:/m.test(src)).toBe(false);
  });
});
