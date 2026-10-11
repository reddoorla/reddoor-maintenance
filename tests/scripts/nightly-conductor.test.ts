import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import yaml from "js-yaml";
import {
  CLOCK_UTC,
  CONDUCTOR,
  DISPATCHER,
  GUARD_HOURS,
  NIGHTLIES,
  POLL_SECONDS,
  FETCH_TIMEOUT_MS,
  conduct,
  outputLines,
  parseArgs,
  parseOnly,
  type FetchLike,
} from "../../scripts/nightly-conductor.mjs";
import { workflowPath } from "../build/_helpers/workflow-source.js";

const T0 = Date.parse("2026-10-09T06:07:00Z");
const HOUR = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

type Run = {
  id: number;
  file: string;
  created_at: string;
  event: string;
  head_branch: string;
  triggering_actor: { login: string };
};

function fakeGitHub(
  opts: {
    prior?: Omit<Run, "id">[];
    pollsToComplete?: Record<string, number>;
    failDispatch?: string[];
    failPollOnce?: string[];
    conclusion?: string;
    start?: number;
  } = {},
) {
  let now = opts.start ?? T0;
  const calls: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const sleeps: number[] = [];
  const listed: Run[] = (opts.prior ?? []).map((r, i) => ({ ...r, id: 500 + i }));
  const polls = new Map<number, number>();
  const failedOnce = new Set<number>();
  let nextId = 1000;
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const path = u.pathname.replace("/repos/reddoorla/reddoor-maintenance/", "");
    calls.push(`${init.method} ${path}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const reply = (status: number, body?: unknown) => ({
      ok: status < 300,
      status,
      text: async () => (body === undefined ? "" : JSON.stringify(body)),
    });
    const list = /^actions\/workflows\/([^/]+)\/runs$/.exec(path);
    if (init.method === "GET" && list) {
      const q = u.searchParams;
      const since = Date.parse((q.get("created") ?? "").replace(/^>=/, ""));
      return reply(200, {
        workflow_runs: listed.filter(
          (r) =>
            r.file === list[1] &&
            (!q.get("event") || r.event === q.get("event")) &&
            (!q.get("branch") || r.head_branch === q.get("branch")) &&
            Date.parse(r.created_at) >= since,
        ),
      });
    }
    const dispatch = /^actions\/workflows\/([^/]+)\/dispatches$/.exec(path);
    if (init.method === "POST" && dispatch) {
      const file = dispatch[1] ?? "";
      const body = JSON.parse(init.body ?? "{}") as Record<string, unknown>;
      bodies.push({ file, ...body });
      if (opts.failDispatch?.includes(file)) return reply(422, { message: "nope" });
      const id = nextId++;
      listed.push({
        id,
        file,
        created_at: iso(now),
        event: "workflow_dispatch",
        head_branch: String(body.ref),
        triggering_actor: { login: DISPATCHER },
      });
      polls.set(id, 0);
      return body.return_run_details === true ? reply(200, { workflow_run_id: id }) : reply(204);
    }
    const get = /^actions\/runs\/(\d+)$/.exec(path);
    if (init.method === "GET" && get) {
      const id = Number(get[1]);
      const run = listed.find((r) => r.id === id)!;
      if (opts.failPollOnce?.includes(run.file) && !failedOnce.has(id)) {
        failedOnce.add(id);
        return reply(502, { message: "bad gateway" });
      }
      polls.set(id, (polls.get(id) ?? 0) + 1);
      const need = opts.pollsToComplete?.[run.file] ?? 2;
      return reply(
        200,
        polls.get(id)! >= need
          ? { status: "completed", conclusion: opts.conclusion ?? "success" }
          : { status: "in_progress", conclusion: null },
      );
    }
    return reply(404, { message: `unexpected ${init.method} ${path}` });
  };
  const sleep = async (ms: number) => {
    sleeps.push(ms);
    now += ms;
  };
  return { fetch, sleep, now: () => now, calls, bodies, sleeps };
}

async function run(
  gh: ReturnType<typeof fakeGitHub>,
  extra: Partial<{ only: string[]; force: boolean; ref: string; event: string }> = {},
) {
  const lines: string[] = [];
  const r = await conduct({
    fetch: gh.fetch,
    token: "t",
    repo: "reddoorla/reddoor-maintenance",
    only: [],
    ref: "main",
    force: false,
    event: "workflow_dispatch",
    now: gh.now,
    sleep: gh.sleep,
    log: (l) => lines.push(l),
    ...extra,
  });
  return { ...r, lines };
}

const dispatched = (gh: ReturnType<typeof fakeGitHub>) => gh.bodies.map((b) => b.file);
const ALL = NIGHTLIES.map((n) => n.file);
const conductedRun = (file: string, created: number, over: Partial<Run> = {}) => ({
  file,
  created_at: iso(created),
  event: "workflow_dispatch",
  head_branch: "main",
  triggering_actor: { login: DISPATCHER },
  ...over,
});

describe("nightly-conductor — the order and the waits", () => {
  it("dispatches every nightly in order, each only after the one before it completed", async () => {
    const gh = fakeGitHub();
    const r = await run(gh);
    expect(r.code).toBe(0);
    expect(dispatched(gh)).toEqual(ALL);
    const posts = gh.calls.map((c, i) => [c, i] as const).filter(([c]) => c.startsWith("POST "));
    for (let k = 1; k < posts.length; k++) {
      const between = gh.calls.slice(posts[k - 1]![1] + 1, posts[k]![1]);
      expect(between.filter((c) => c.startsWith("GET actions/runs/")).length).toBe(2);
    }
    expect(gh.sleeps.every((ms) => ms === POLL_SECONDS * 1000)).toBe(true);
    expect(POLL_SECONDS).toBe(30);
    expect(r.lines.at(-1)).toBe(
      `NIGHTLY_CONDUCTOR_SUMMARY dispatched=${ALL.length} completed=${ALL.length} wait_exceeded=0 skipped=0 dispatch_failed=0 total=${ALL.length}`,
    );
  });

  it("asks for the run id, dispatches on the given ref, and drafts daily-reports without sending", async () => {
    const gh = fakeGitHub();
    await run(gh);
    for (const b of gh.bodies) {
      const { file, ...rest } = b;
      expect(rest).toEqual(
        file === "daily-reports.yml"
          ? { ref: "main", inputs: { mode: "draft" }, return_run_details: true }
          : { ref: "main", return_run_details: true },
      );
    }
  });

  it("daily-reports drafts last, after every evidence sweep it reads", () => {
    expect(ALL.at(-1)).toBe("daily-reports.yml");
    for (const f of [
      "fleet-security.yml",
      "fleet-lighthouse.yml",
      "fleet-smoke.yml",
      "fleet-form-e2e.yml",
    ])
      expect(ALL.indexOf(f)).toBeLessThan(ALL.indexOf("daily-reports.yml"));
  });

  it("waits out a slow nightly's whole budget, no less and not a poll more, then moves on", async () => {
    const gh = fakeGitHub({ pollsToComplete: { "fleet-lighthouse.yml": 10_000 } });
    const r = await run(gh);
    expect(r.code).toBe(0);
    expect(dispatched(gh)).toEqual(ALL);
    expect(r.results.find((x) => x.file === "fleet-lighthouse.yml")!.outcome).toBe("wait-exceeded");
    const lh = NIGHTLIES.find((n) => n.file === "fleet-lighthouse.yml")!;
    const i = gh.calls.findIndex((c) => c.includes("fleet-lighthouse.yml/dispatches"));
    const j = gh.calls.findIndex((c) => c.includes("fleet-smoke.yml/runs"));
    const polled = gh.calls.slice(i, j).filter((c) => c.startsWith("GET actions/runs/")).length;
    expect(polled).toBe((lh.waitMinutes * 60) / POLL_SECONDS + 1);
  });

  it("one failed poll is retried, not fatal", async () => {
    const gh = fakeGitHub({ failPollOnce: ["fleet-security.yml"] });
    const r = await run(gh);
    expect(r.code).toBe(0);
    expect(r.results.find((x) => x.file === "fleet-security.yml")!.outcome).toBe("completed");
    expect(r.lines.some((l) => /fleet-security\.yml poll error=.*502/.test(l))).toBe(true);
  });

  it("a red nightly is reported and the rest still run", async () => {
    const gh = fakeGitHub({ conclusion: "failure" });
    const r = await run(gh);
    expect(r.code).toBe(0);
    expect(r.lines.filter((l) => l.includes("conclusion=failure"))).toHaveLength(ALL.length);
  });

  it("a failed dispatch fails the run but does not stop the others", async () => {
    const gh = fakeGitHub({ failDispatch: ["fleet-security.yml"] });
    const r = await run(gh);
    expect(r.code).toBe(1);
    expect(dispatched(gh)).toEqual(ALL);
    expect(r.lines.at(-1)).toContain("dispatch_failed=1");
  });
});

describe("nightly-conductor — each nightly at most once a day", () => {
  it("the window is 12 h: a conducted run 11 h ago is skipped, one 13 h ago is not", async () => {
    expect(GUARD_HOURS).toBe(12);
    const gh = fakeGitHub({
      prior: [
        conductedRun("fleet-db-backup.yml", T0 - 11 * HOUR),
        conductedRun("fleet-prismic-drift.yml", T0 - 13 * HOUR),
      ],
    });
    const r = await run(gh);
    expect(dispatched(gh)).toEqual(ALL.filter((f) => f !== "fleet-db-backup.yml"));
    expect(r.results.find((x) => x.file === "fleet-db-backup.yml")!.outcome).toBe("skipped");
  });

  it("a second fire the same morning dispatches nothing, and says it skipped everything", async () => {
    const gh = fakeGitHub();
    await run(gh);
    const again = await run(gh);
    expect(dispatched(gh)).toEqual(ALL);
    expect(again.skipped).toBe(true);
    expect(again.code).toBe(0);
  });

  it("after a pass with one failed dispatch, the next fire dispatches only that one", async () => {
    const first = fakeGitHub({ failDispatch: ["fleet-security.yml"] });
    await run(first);
    const gh = fakeGitHub({
      prior: first.bodies
        .filter((b) => b.file !== "fleet-security.yml")
        .map((b) => conductedRun(String(b.file), T0)),
      start: T0 + 3 * HOUR,
    });
    const r = await run(gh);
    expect(dispatched(gh)).toEqual(["fleet-security.yml"]);
    expect(r.skipped).toBe(false);
  });

  it("a partial --only run suppresses only what it ran", async () => {
    const gh = fakeGitHub({ prior: [conductedRun("fleet-smoke.yml", T0 - HOUR)] });
    await run(gh);
    expect(dispatched(gh)).toEqual(ALL.filter((f) => f !== "fleet-smoke.yml"));
  });

  it("runs on a branch, by a person, or on a schedule do not count as conducted", async () => {
    const gh = fakeGitHub({
      prior: [
        conductedRun("fleet-db-backup.yml", T0 - HOUR, { head_branch: "claude/x" }),
        conductedRun("fleet-security.yml", T0 - HOUR, {
          triggering_actor: { login: "tucksravin" },
        }),
        conductedRun("fleet-smoke.yml", T0 - HOUR, { event: "schedule" }),
      ],
    });
    await run(gh);
    expect(dispatched(gh)).toEqual(ALL);
  });

  it("a conductor on a branch never consults main's guard", async () => {
    const gh = fakeGitHub({ prior: ALL.map((f) => conductedRun(f, T0 - HOUR)) });
    await run(gh, { ref: "claude/x", only: ["fleet-smoke.yml"] });
    expect(dispatched(gh)).toEqual(["fleet-smoke.yml"]);
    expect(gh.bodies[0]!.ref).toBe("claude/x");
  });

  it("--force dispatches what the guard would skip", async () => {
    const gh = fakeGitHub({ prior: ALL.map((f) => conductedRun(f, T0 - HOUR)) });
    await run(gh, { force: true, only: ["fleet-smoke.yml"] });
    expect(dispatched(gh)).toEqual(["fleet-smoke.yml"]);
  });
});

describe("nightly-conductor — the fallback cron says when the clock missed", () => {
  const warned = (lines: string[]) => lines.some((l) => l.includes("clock-missed"));

  it("warns when a scheduled run had to dispatch after the clock's time", async () => {
    expect(CLOCK_UTC).toBe("06:07");
    const gh = fakeGitHub({ start: Date.parse("2026-10-09T09:30:00Z") });
    const r = await run(gh, { event: "schedule" });
    expect(warned(r.lines)).toBe(true);
    expect(r.clockMissed).toBe(true);
    expect(r.code).toBe(1);
  });

  it("a late run that re-dispatches only what the clock's pass failed to start is not a clock miss", async () => {
    const gh = fakeGitHub({
      start: Date.parse("2026-10-09T09:30:00Z"),
      prior: ALL.filter((f) => f !== "fleet-smoke.yml").map((f) =>
        conductedRun(f, Date.parse("2026-10-09T06:08:00Z")),
      ),
    });
    const r = await run(gh, { event: "schedule" });
    expect(dispatched(gh)).toEqual(["fleet-smoke.yml"]);
    expect(r.clockMissed).toBe(false);
    expect(r.code).toBe(0);
  });

  it("the clock gets 30 minutes: 06:36Z is still its window, 06:38Z is a miss", async () => {
    const at = async (t: string) =>
      warned((await run(fakeGitHub({ start: Date.parse(t) }), { event: "schedule" })).lines);
    expect(await at("2026-10-09T06:36:00Z")).toBe(false);
    expect(await at("2026-10-09T06:38:00Z")).toBe(true);
  });

  it("does not warn when the fallback simply fired first, found nothing to do, or a person ran it", async () => {
    const early = fakeGitHub({ start: Date.parse("2026-10-09T04:10:00Z") });
    expect(warned((await run(early, { event: "schedule" })).lines)).toBe(false);
    const late = fakeGitHub({
      start: Date.parse("2026-10-09T09:30:00Z"),
      prior: ALL.map((f) => conductedRun(f, Date.parse("2026-10-09T06:08:00Z"))),
    });
    expect(warned((await run(late, { event: "schedule" })).lines)).toBe(false);
    const byHand = fakeGitHub({ start: Date.parse("2026-10-09T09:30:00Z") });
    expect(warned((await run(byHand)).lines)).toBe(false);
  });
});

describe("nightly-conductor — what the workflow reads back", () => {
  it("writes the skipped key the close step's if: reads", async () => {
    expect(outputLines({ skipped: true })).toBe("skipped=yes\n");
    expect(outputLines({ skipped: false })).toBe("skipped=no\n");
    const src = await readFile(workflowPath(CONDUCTOR), "utf-8");
    expect(src).toContain("steps.conduct.outputs.skipped != 'yes'");
  });

  it("gives every API call 30 s", () => {
    expect(FETCH_TIMEOUT_MS).toBe(30_000);
  });
});

describe("nightly-conductor — arguments", () => {
  it("reads names with or without .yml and refuses one it does not conduct", () => {
    expect(parseOnly("fleet-smoke, fleet-prismic-drift.yml")).toEqual([
      "fleet-smoke.yml",
      "fleet-prismic-drift.yml",
    ]);
    expect(parseOnly("")).toEqual([]);
    expect(() => parseOnly("release-health")).toThrow(/release-health\.yml/);
    expect(parseArgs(["--only", "fleet-smoke", "--ref", "x", "--force"])).toEqual({
      only: ["fleet-smoke.yml"],
      ref: "x",
      force: true,
    });
    expect(() => parseArgs(["--bogus"])).toThrow();
  });
});

type Step = {
  name?: string;
  id?: string;
  "timeout-minutes": number;
  if?: string;
  env?: Record<string, string>;
  run?: string;
};
type Workflow = {
  on: {
    schedule?: { cron: string }[];
    workflow_dispatch?: { inputs?: Record<string, { options?: string[] }> };
  };
  permissions: Record<string, string>;
  concurrency: unknown;
  jobs: Record<string, { "timeout-minutes": number; steps: Step[] }>;
};
const load = async (f: string) => yaml.load(await readFile(workflowPath(f), "utf-8")) as Workflow;

describe("nightly-conductor — the workflows it drives", () => {
  it("every conducted fleet nightly can be dispatched and has no cron of its own to run it twice", async () => {
    for (const n of NIGHTLIES.filter((x) => x.file !== "daily-reports.yml")) {
      const on = (await load(n.file)).on;
      expect(on, n.file).toHaveProperty("workflow_dispatch");
      expect(on.schedule, n.file).toBeUndefined();
    }
  });

  it("every input the conductor sends is one the workflow declares", async () => {
    for (const n of NIGHTLIES.filter((x) => x.inputs)) {
      const declared = (await load(n.file)).on.workflow_dispatch?.inputs ?? {};
      for (const [k, v] of Object.entries(n.inputs!)) {
        expect(declared, `${n.file} ${k}`).toHaveProperty(k);
        expect(declared[k]!.options ?? [v]).toContain(v);
      }
    }
  });

  it("the conductor can dispatch, has one daily fallback cron, and outlasts every wait", async () => {
    const wf = await load(CONDUCTOR);
    expect(wf.permissions.actions).toBe("write");
    expect(wf.on.schedule).toHaveLength(1);
    expect(wf.on.schedule?.[0]?.cron).toMatch(/^\d+ \d+ \* \* \*$/);
    expect(wf.on).toHaveProperty("workflow_dispatch");
    expect(wf.concurrency).toEqual({ group: "fleet-nightly", "cancel-in-progress": false });
    const job = wf.jobs.conduct!;
    const step = job.steps.find((s) => s.id === "conduct")!;
    const waits = NIGHTLIES.reduce((a, n) => a + n.waitMinutes, 0);
    expect(waits + NIGHTLIES.length * 2).toBeLessThan(step["timeout-minutes"]);
    expect(step["timeout-minutes"]).toBeLessThan(job["timeout-minutes"]);
    const close = job.steps.find((s) => s.name?.startsWith("Close the nightly-conductor"))!;
    expect(close.if).toContain("steps.conduct.outputs.skipped != 'yes'");
  });
});

describe("daily-reports — drafts early, sends at a fixed hour (Operator decisions 98)", () => {
  const step = async (name: string) =>
    (await load("daily-reports.yml")).jobs.daily!.steps.find((s) => s.name === name)!;
  const head = (s: Step) => (s.run ?? "").split("\n").slice(0, 4).join("\n");

  it("offers all, draft and send, and a scheduled run (no inputs) only sends", async () => {
    const wf = await load("daily-reports.yml");
    expect(wf.on.workflow_dispatch?.inputs?.mode?.options).toEqual(["all", "draft", "send"]);
    for (const n of ["Draft due reports", "Send approved reports", "Email the operator digest"])
      expect((await step(n)).env?.MODE, n).toBe("${{ inputs.mode || 'send' }}");
  });

  it("a send run skips drafting and the digest; a draft run skips the send", async () => {
    expect(head(await step("Draft due reports"))).toMatch(
      /^if \[ "\$MODE" = "send" \] && \[ -z "\$PREVIEW_SITE" \]; then\n.*\n\s+exit 0\n/,
    );
    expect(head(await step("Send approved reports"))).toMatch(
      /^if \[ "\$MODE" = "draft" \]; then\n.*\n\s+exit 0\n/,
    );
    expect(head(await step("Email the operator digest"))).toMatch(
      /^if \[ "\$\{MODE:-\}" = "send" \]; then\n.*\n\s+exit 0\n/,
    );
  });

  it("keeps one daily fallback cron (its send gating is run in nightly-shell-steps.test.ts)", async () => {
    const cron = (await load("daily-reports.yml")).on.schedule ?? [];
    expect(cron).toHaveLength(1);
    expect(cron[0]?.cron).toMatch(/^\d+ \d+ \* \* \*$/);
  });
});
