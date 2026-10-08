import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import yaml from "js-yaml";
import {
  CONDUCTOR,
  GUARD_HOURS,
  NIGHTLIES,
  conduct,
  parseArgs,
  parseOnly,
  type FetchLike,
} from "../../scripts/nightly-conductor.mjs";
import { workflowPath } from "../build/_helpers/workflow-source.js";

const T0 = Date.parse("2026-10-09T06:07:00Z");
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

type PriorRun = { id: number; created_at: string; conclusion: string; event: string };

function fakeGitHub(opts: {
  prior?: PriorRun[];
  pollsToComplete?: Record<string, number>;
  failDispatch?: string[];
  conclusion?: string;
}) {
  let now = T0;
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const runs = new Map<number, { file: string; polls: number }>();
  let nextId = 1000;
  const fetch: FetchLike = async (url, init) => {
    const path = url.replace("https://api.github.com/repos/reddoorla/reddoor-maintenance/", "");
    calls.push(`${init.method} ${path}`);
    const reply = (status: number, body: unknown) => ({
      ok: status < 300,
      status,
      text: async () => (body === undefined ? "" : JSON.stringify(body)),
    });
    if (init.method === "GET" && path.startsWith(`actions/workflows/${CONDUCTOR}/runs?`)) {
      const created = decodeURIComponent(new URL(url).searchParams.get("created") ?? "");
      const since = Date.parse(created.replace(/^>=/, ""));
      return reply(200, {
        workflow_runs: (opts.prior ?? []).filter((r) => Date.parse(r.created_at) >= since),
      });
    }
    const dispatch = /^actions\/workflows\/([^/]+)\/dispatches$/.exec(path);
    if (init.method === "POST" && dispatch) {
      bodies.push(JSON.parse(init.body ?? "{}"));
      if (opts.failDispatch?.includes(dispatch[1] ?? "")) return reply(422, { message: "nope" });
      const id = nextId++;
      runs.set(id, { file: dispatch[1] ?? "", polls: 0 });
      return reply(200, { workflow_run_id: id });
    }
    const get = /^actions\/runs\/(\d+)$/.exec(path);
    if (init.method === "GET" && get) {
      const r = runs.get(Number(get[1]))!;
      r.polls++;
      const need = opts.pollsToComplete?.[r.file] ?? 2;
      return reply(
        200,
        r.polls >= need
          ? { status: "completed", conclusion: opts.conclusion ?? "success" }
          : { status: "in_progress", conclusion: null },
      );
    }
    return reply(404, { message: `unexpected ${init.method} ${path}` });
  };
  const sleep = async (ms: number) => {
    now += ms;
  };
  return { fetch, sleep, now: () => now, calls, bodies };
}

async function run(
  gh: ReturnType<typeof fakeGitHub>,
  extra: Partial<{ only: string[]; force: boolean }> = {},
) {
  const lines: string[] = [];
  const r = await conduct({
    fetch: gh.fetch,
    token: "t",
    repo: "reddoorla/reddoor-maintenance",
    runId: "42",
    only: [],
    ref: "main",
    force: false,
    now: gh.now,
    sleep: gh.sleep,
    log: (l) => lines.push(l),
    ...extra,
  });
  return { ...r, lines };
}

const dispatched = (calls: string[]) =>
  calls
    .filter((c) => c.startsWith("POST "))
    .map((c) => /workflows\/([^/]+)\/dispatches/.exec(c)![1]);

describe("nightly-conductor — the order and the waits", () => {
  it("dispatches every nightly in order, each only after the one before it completed", async () => {
    const gh = fakeGitHub({});
    const r = await run(gh);
    expect(r.code).toBe(0);
    expect(dispatched(gh.calls)).toEqual(NIGHTLIES.map((n) => n.file));
    const posts = gh.calls.map((c, i) => [c, i] as const).filter(([c]) => c.startsWith("POST "));
    for (let k = 1; k < posts.length; k++) {
      const between = gh.calls.slice(posts[k - 1]![1] + 1, posts[k]![1]);
      expect(between.filter((c) => c.startsWith("GET actions/runs/")).length).toBe(2);
    }
    expect(r.lines.at(-1)).toBe(
      `NIGHTLY_CONDUCTOR_SUMMARY dispatched=6 completed=6 wait_exceeded=0 dispatch_failed=0 total=6`,
    );
  });

  it("asks for the run id and dispatches on the given ref", async () => {
    const gh = fakeGitHub({});
    await run(gh);
    for (const b of gh.bodies) expect(b).toEqual({ ref: "main", return_run_details: true });
  });

  it("moves on when a nightly outlives its wait, and does not fail the run for it", async () => {
    const gh = fakeGitHub({ pollsToComplete: { "fleet-lighthouse.yml": 10_000 } });
    const r = await run(gh);
    expect(r.code).toBe(0);
    expect(dispatched(gh.calls)).toEqual(NIGHTLIES.map((n) => n.file));
    const lh = r.results.find((x) => x.file === "fleet-lighthouse.yml")!;
    expect(lh.outcome).toBe("wait-exceeded");
    expect(
      r.lines.some((l) => /fleet-lighthouse\.yml .* still in_progress after 50 min/.test(l)),
    ).toBe(true);
  });

  it("a red nightly is reported and the rest still run", async () => {
    const gh = fakeGitHub({ conclusion: "failure" });
    const r = await run(gh);
    expect(r.code).toBe(0);
    expect(dispatched(gh.calls)).toHaveLength(NIGHTLIES.length);
    expect(r.lines.filter((l) => l.includes("conclusion=failure"))).toHaveLength(NIGHTLIES.length);
  });

  it("a failed dispatch fails the run but does not stop the others", async () => {
    const gh = fakeGitHub({ failDispatch: ["fleet-security.yml"] });
    const r = await run(gh);
    expect(r.code).toBe(1);
    expect(dispatched(gh.calls)).toEqual(NIGHTLIES.map((n) => n.file));
    expect(r.lines.at(-1)).toContain("dispatch_failed=1");
  });
});

describe("nightly-conductor — at most one full conduct a day", () => {
  it("skips when another conductor run succeeded within the guard window", async () => {
    const gh = fakeGitHub({
      prior: [
        { id: 7, created_at: iso(T0 - 5 * 3600_000), conclusion: "success", event: "schedule" },
      ],
    });
    const r = await run(gh);
    expect(r.skipped).toBe(true);
    expect(dispatched(gh.calls)).toEqual([]);
  });

  it("conducts when the last success is older than the window", async () => {
    const gh = fakeGitHub({
      prior: [
        {
          id: 7,
          created_at: iso(T0 - (GUARD_HOURS + 1) * 3600_000),
          conclusion: "success",
          event: "schedule",
        },
      ],
    });
    const r = await run(gh);
    expect(r.skipped).toBe(false);
    expect(dispatched(gh.calls)).toHaveLength(NIGHTLIES.length);
  });

  it("does not count its own run as the prior one", async () => {
    const gh = fakeGitHub({
      prior: [{ id: 42, created_at: iso(T0), conclusion: "success", event: "workflow_dispatch" }],
    });
    expect((await run(gh)).skipped).toBe(false);
  });

  it("--only and --force bypass the guard, and --only conducts just what it names", async () => {
    const prior = [
      { id: 7, created_at: iso(T0 - 3600_000), conclusion: "success", event: "schedule" },
    ];
    const only = fakeGitHub({ prior });
    await run(only, { only: ["fleet-smoke.yml"] });
    expect(dispatched(only.calls)).toEqual(["fleet-smoke.yml"]);
    expect(only.calls.some((c) => c.includes(`workflows/${CONDUCTOR}/runs`))).toBe(false);
    const forced = fakeGitHub({ prior });
    await run(forced, { force: true });
    expect(dispatched(forced.calls)).toHaveLength(NIGHTLIES.length);
  });
});

describe("nightly-conductor — arguments", () => {
  it("reads names with or without .yml and refuses one it does not conduct", () => {
    expect(parseOnly("fleet-smoke, fleet-prismic-drift.yml")).toEqual([
      "fleet-smoke.yml",
      "fleet-prismic-drift.yml",
    ]);
    expect(parseOnly("")).toEqual([]);
    expect(() => parseOnly("daily-reports")).toThrow(/daily-reports\.yml/);
    expect(parseArgs(["--only", "fleet-smoke", "--ref", "x", "--force"])).toEqual({
      only: ["fleet-smoke.yml"],
      ref: "x",
      force: true,
    });
    expect(() => parseArgs(["--bogus"])).toThrow();
  });
});

type Workflow = {
  on: { schedule?: { cron: string }[]; workflow_dispatch?: unknown };
  permissions: Record<string, string>;
  concurrency: unknown;
  jobs: {
    conduct: { "timeout-minutes": number; steps: { name?: string; "timeout-minutes": number }[] };
  };
};

describe("nightly-conductor — the workflows it drives", () => {
  const load = async (f: string) => yaml.load(await readFile(workflowPath(f), "utf-8")) as Workflow;

  it("every conducted nightly can be dispatched and has no cron of its own to run it twice", async () => {
    for (const n of NIGHTLIES) {
      const on = (await load(n.file)).on;
      expect(on, n.file).toHaveProperty("workflow_dispatch");
      expect(on.schedule, n.file).toBeUndefined();
    }
  });

  it("daily-reports keeps its own cron until the operator decides when client email goes out", async () => {
    expect(NIGHTLIES.map((n) => n.file)).not.toContain("daily-reports.yml");
    expect((await load("daily-reports.yml")).on.schedule).toBeDefined();
  });

  it("the conductor can dispatch, has one daily fallback cron, and outlasts every wait", async () => {
    const wf = await load(CONDUCTOR);
    expect(wf.permissions.actions).toBe("write");
    expect(wf.on.schedule).toHaveLength(1);
    expect(wf.on.schedule?.[0]?.cron).toMatch(/^\d+ \d+ \* \* \*$/);
    expect(wf.on).toHaveProperty("workflow_dispatch");
    expect(wf.concurrency).toEqual({ group: "fleet-nightly", "cancel-in-progress": false });
    const step = wf.jobs.conduct.steps.find((s) => s.name === "Dispatch the nightlies in order")!;
    const waits = NIGHTLIES.reduce((a, n) => a + n.waitMinutes, 0);
    expect(waits + NIGHTLIES.length).toBeLessThan(step["timeout-minutes"]);
    expect(step["timeout-minutes"]).toBeLessThan(wf.jobs.conduct["timeout-minutes"]);
  });
});
