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
];
export const GUARD_HOURS = 12;
export const POLL_SECONDS = 30;
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
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  };
}

export async function priorSuccess(api, { now, runId }) {
  const since = isoZ(now - GUARD_HOURS * 3600_000);
  const body = await api(
    "GET",
    `actions/workflows/${CONDUCTOR}/runs?status=success&created=${encodeURIComponent(`>=${since}`)}&per_page=20`,
  );
  if (!Array.isArray(body.workflow_runs)) throw new Error("runs listing had no workflow_runs");
  return (
    body.workflow_runs.find((r) => String(r.id) !== String(runId) && r.conclusion === "success") ??
    null
  );
}

export async function conduct({ fetch, token, repo, runId, only, ref, force, now, sleep, log }) {
  const api = client({ fetch, token, repo });
  const clock = now ?? (() => Date.now());
  const say = log ?? ((l) => process.stdout.write(`${l}\n`));
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  if (only.length === 0 && !force) {
    const prior = await priorSuccess(api, { now: clock(), runId });
    if (prior) {
      say(
        `NIGHTLY_CONDUCTOR skipped: run ${prior.id} (${prior.event}, created ${prior.created_at}) already conducted the nightlies within ${GUARD_HOURS} h`,
      );
      return { skipped: true, results: [], code: 0 };
    }
  }
  const plan = only.length ? NIGHTLIES.filter((n) => only.includes(n.file)) : NIGHTLIES;
  const results = [];
  for (const n of plan) {
    const started = clock();
    let id;
    try {
      const d = await api("POST", `actions/workflows/${n.file}/dispatches`, {
        ref,
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
  say(
    `NIGHTLY_CONDUCTOR_SUMMARY dispatched=${results.length - count("dispatch-failed")} completed=${count("completed")} wait_exceeded=${count("wait-exceeded")} dispatch_failed=${count("dispatch-failed")} total=${plan.length}`,
  );
  return { skipped: false, results, code: count("dispatch-failed") > 0 ? 1 : 0 };
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
    runId: process.env.GITHUB_RUN_ID ?? "",
    ...o,
  });
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `skipped=${r.skipped ? "yes" : "no"}\n`);
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
