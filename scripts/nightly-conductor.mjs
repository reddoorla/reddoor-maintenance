#!/usr/bin/env node
import { appendFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const CONDUCTOR = "fleet-nightly.yml";
export const NIGHTLIES = [
  { file: "fleet-db-backup.yml", waitMinutes: 15 },
  { file: "fleet-prismic-drift.yml", waitMinutes: 20 },
  { file: "fleet-security.yml", waitMinutes: 30 },
  { file: "fleet-lighthouse.yml", waitMinutes: 50 },
  { file: "fleet-smoke.yml", waitMinutes: 50 },
  { file: "fleet-form-e2e.yml", waitMinutes: 40 },
  { file: "daily-reports.yml", waitMinutes: 30, inputs: { mode: "draft" } },
];
export const GUARD_HOURS = 12;
export const POLL_SECONDS = 30;
export const FETCH_TIMEOUT_MS = 30_000;
export const DISPATCHER = "github-actions[bot]";
export const CLOCK_UTC = "06:07";

export function clockDeadline(ms) {
  const d = new Date(ms);
  const [h, m] = CLOCK_UTC.split(":").map(Number);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m) + 30 * 60_000;
}
const API = "https://api.github.com";

const isoZ = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

export function parseOnly(raw) {
  const names = String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.endsWith(".yml") ? s : `${s}.yml`));
  const known = new Set(NIGHTLIES.map((n) => n.file));
  const unknown = names.filter((n) => !known.has(n));
  if (unknown.length) throw new Error(`--only names no conducted nightly: ${unknown.join(", ")}`);
  return names;
}

export function parseArgs(argv) {
  const o = { only: [], ref: "main", force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--only") o.only = parseOnly(next());
    else if (a === "--ref") o.ref = next();
    else if (a === "--force") o.force = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

function client({ fetch, token, repo }) {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  return async (method, path, body) => {
    const res = await fetch(`${API}/repos/${repo}/${path}`, {
      method,
      headers: body ? { ...headers, "content-type": "application/json" } : headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  };
}

export async function alreadyConducted(api, file, { now }) {
  const since = isoZ(now - GUARD_HOURS * 3600_000);
  const body = await api(
    "GET",
    `actions/workflows/${file}/runs?event=workflow_dispatch&branch=main&created=${encodeURIComponent(`>=${since}`)}&per_page=50`,
  );
  if (!Array.isArray(body.workflow_runs))
    throw new Error(`${file} runs listing had no workflow_runs`);
  return (
    body.workflow_runs.find(
      (r) =>
        r.triggering_actor?.login === DISPATCHER &&
        Date.parse(r.created_at) >= now - GUARD_HOURS * 3600_000,
    ) ?? null
  );
}

export async function conduct({ fetch, token, repo, only, ref, force, event, now, sleep, log }) {
  const api = client({ fetch, token, repo });
  const clock = now ?? (() => Date.now());
  const say = log ?? ((l) => process.stdout.write(`${l}\n`));
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const startedAt = clock();
  const plan = only.length ? NIGHTLIES.filter((n) => only.includes(n.file)) : NIGHTLIES;
  const results = [];
  for (const n of plan) {
    if (!force && ref === "main") {
      let prior;
      try {
        prior = await alreadyConducted(api, n.file, { now: clock() });
      } catch (e) {
        say(`NIGHTLY ${n.file} guard error=${e.message}; dispatching anyway`);
      }
      if (prior) {
        say(
          `NIGHTLY ${n.file} skipped: run ${prior.id} (created ${prior.created_at}) was dispatched by the conductor within ${GUARD_HOURS} h`,
        );
        results.push({ file: n.file, outcome: "skipped", id: prior.id });
        continue;
      }
    }
    const started = clock();
    let id;
    try {
      const d = await api("POST", `actions/workflows/${n.file}/dispatches`, {
        ref,
        ...(n.inputs ? { inputs: n.inputs } : {}),
        return_run_details: true,
      });
      id = d.workflow_run_id;
      if (!id) throw new Error("dispatch returned no workflow_run_id");
    } catch (e) {
      say(`NIGHTLY ${n.file} dispatch=failed error=${e.message}`);
      results.push({ file: n.file, outcome: "dispatch-failed" });
      continue;
    }
    say(`NIGHTLY ${n.file} dispatched run=${id} at=${isoZ(started)}`);
    let run = null;
    for (;;) {
      try {
        run = await api("GET", `actions/runs/${id}`);
      } catch (e) {
        say(`NIGHTLY ${n.file} poll error=${e.message}`);
      }
      if (run?.status === "completed") break;
      if (clock() - started >= n.waitMinutes * 60_000) break;
      await wait(POLL_SECONDS * 1000);
    }
    const minutes = Math.round((clock() - started) / 6000) / 10;
    if (run?.status === "completed") {
      say(`NIGHTLY ${n.file} run=${id} conclusion=${run.conclusion} minutes=${minutes}`);
      results.push({ file: n.file, outcome: "completed", conclusion: run.conclusion, id });
    } else {
      say(
        `NIGHTLY ${n.file} run=${id} still ${run?.status ?? "unknown"} after ${n.waitMinutes} min; moving on, it files its own issue if it fails`,
      );
      results.push({ file: n.file, outcome: "wait-exceeded", id });
    }
  }
  const count = (o) => results.filter((r) => r.outcome === o).length;
  const dispatched = count("completed") + count("wait-exceeded");
  say(
    `NIGHTLY_CONDUCTOR_SUMMARY dispatched=${dispatched} completed=${count("completed")} wait_exceeded=${count("wait-exceeded")} skipped=${count("skipped")} dispatch_failed=${count("dispatch-failed")} total=${plan.length}`,
  );
  const clockMissed =
    event === "schedule" && dispatched === plan.length && startedAt >= clockDeadline(startedAt);
  if (clockMissed)
    say(
      `::error::NIGHTLY_CONDUCTOR clock-missed: the fallback cron dispatched ${dispatched} nightlies after ${CLOCK_UTC}Z, so the Netlify clock had not run them`,
    );
  return {
    skipped: count("skipped") === plan.length,
    clockMissed,
    results,
    code: count("dispatch-failed") > 0 || clockMissed ? 1 : 0,
  };
}

export function outputLines(r) {
  return `skipped=${r.skipped ? "yes" : "no"}\n`;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY must be set");
  const r = await conduct({
    fetch: globalThis.fetch,
    token,
    repo,
    event: process.env.GITHUB_EVENT_NAME ?? "",
    ...o,
  });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputLines(r));
  process.exitCode = r.code;
}

const self = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
if (process.argv[1] && self(process.argv[1]) === self(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    process.stderr.write(`nightly-conductor: ${e?.stack ?? e}\n`);
    process.exitCode = 1;
  });
}
