import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import {
  fireWorkflow,
  NIGHTLY_CONDUCTOR_WORKFLOW,
  SEND_INPUTS,
  SEND_WORKFLOW,
} from "../../src/dashboard/nightly-clock.js";
import { CLOCK_UTC, CONDUCTOR, NIGHTLIES } from "../../scripts/nightly-conductor.mjs";
import { config as conductorClock } from "../../netlify/functions/nightly-clock.mjs";
import { config as sendClock } from "../../netlify/functions/nightly-send-clock.mjs";

function fakeFetch(dispatchStatus = 204) {
  const calls: { url: string; body: string | undefined; auth: string | undefined }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, body: init?.body as string | undefined, auth: headers.authorization });
    if (url.endsWith("/repos/reddoorla/reddoor-maintenance"))
      return new Response(JSON.stringify({ default_branch: "main" }), { status: 200 });
    if (url.endsWith("/dispatches")) return new Response(null, { status: dispatchStatus });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { f, calls };
}

const minutesOf = (cron: unknown) => {
  const m = /^(\d+) (\d+) \* \* \*$/.exec(String(cron));
  expect(m, `daily cron, got ${String(cron)}`).not.toBeNull();
  return Number(m![2]) * 60 + Number(m![1]);
};

describe("fireWorkflow — what both clocks call", () => {
  it("dispatches on the default branch with the dashboard's token and the given inputs", async () => {
    const { f, calls } = fakeFetch();
    const r = await fireWorkflow({
      token: "pat",
      repo: "reddoorla/reddoor-maintenance",
      workflow: SEND_WORKFLOW,
      inputs: { ...SEND_INPUTS },
      fetch: f,
    });
    expect(r).toEqual({ ok: true });
    const d = calls.find((c) => c.url.endsWith("/dispatches"))!;
    expect(d.url).toBe(
      "https://api.github.com/repos/reddoorla/reddoor-maintenance/actions/workflows/daily-reports.yml/dispatches",
    );
    expect(JSON.parse(d.body!)).toEqual({ ref: "main", inputs: { mode: "send" } });
    expect(d.auth).toBe("Bearer pat");
  });

  it("reports a refused dispatch instead of passing silently", async () => {
    const { f } = fakeFetch(403);
    const r = await fireWorkflow({
      token: "pat",
      repo: "reddoorla/reddoor-maintenance",
      workflow: NIGHTLY_CONDUCTOR_WORKFLOW,
      fetch: f,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/403/);
  });

  it("refuses to run without a token and calls nothing", async () => {
    const { f, calls } = fakeFetch();
    const r = await fireWorkflow({
      token: "  ",
      repo: "reddoorla/reddoor-maintenance",
      workflow: NIGHTLY_CONDUCTOR_WORKFLOW,
      fetch: f,
    });
    expect(r).toEqual({ ok: false, error: "GH_TOKEN is not configured" });
    expect(calls).toEqual([]);
  });
});

describe("the two Netlify clocks", () => {
  it("the conductor clock fires the conductor at CLOCK_UTC, early enough that every wait ends before 12:00Z", () => {
    expect(NIGHTLY_CONDUCTOR_WORKFLOW).toBe(CONDUCTOR);
    const fires = minutesOf(conductorClock.schedule);
    const [h = NaN, m = NaN] = CLOCK_UTC.split(":").map(Number);
    expect(fires).toBe(h * 60 + m);
    const waits = NIGHTLIES.reduce((a, n) => a + n.waitMinutes, 0);
    expect(fires + waits).toBeLessThan(12 * 60);
  });

  it("the send clock fires daily-reports in send mode at 16:07Z, after the drafts can finish", () => {
    expect(SEND_WORKFLOW).toBe("daily-reports.yml");
    expect(SEND_INPUTS).toEqual({ mode: "send" });
    const sends = minutesOf(sendClock.schedule);
    expect(sends).toBe(16 * 60 + 7);
    const waits = NIGHTLIES.reduce((a, n) => a + n.waitMinutes, 0);
    expect(minutesOf(conductorClock.schedule) + waits).toBeLessThan(sends);
  });

  it("neither is routed, and netlify.toml schedules nothing over them", async () => {
    for (const c of [conductorClock, sendClock])
      expect(Object.keys(c).sort()).toEqual(["schedule"]);
    expect(await readFile("netlify.toml", "utf-8")).not.toMatch(/schedule/);
  });
});
