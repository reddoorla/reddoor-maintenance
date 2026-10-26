#!/usr/bin/env -S pnpm tsx
// P1-78a: write tonight's `fleet_daily` row. Run by .github/workflows/fleet-daily.yml on
// `workflow_run` of fleet-nightly; every decision is src/fleet-daily/write.ts's. This file
// is only the IO: the GitHub REST reads (GITHUB_TOKEN, `actions: read` and `contents: read`)
// and the Turso connection (the nightly steps' existing TURSO_* secrets).
import { openDb, readDbConfig } from "../src/db/client.js";
import { buildCockpitModel } from "../src/dashboard/fleet-cockpit.js";
import { writeFleetDaily, type GitHubReads } from "../src/fleet-daily/write.js";
import { loadCredentialsIntoEnv } from "../src/util/credentials.js";
import { isMain } from "./lib/cli.mjs";
import { NIGHTLIES } from "./nightly-conductor.mjs";
import { loadCockpitInputs } from "./pm-cockpit.mjs";

const API = "https://api.github.com";
const TIMEOUT_MS = 30_000;

type Fetch = typeof globalThis.fetch;

export function githubReads(fetch: Fetch, token: string, repo: string): GitHubReads {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  const get = async (path: string): Promise<Response> => {
    const res = await fetch(`${API}/repos/${repo}/${path}`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res;
  };
  return {
    async conductorLog(runId) {
      const jobs = (await (await get(`actions/runs/${runId}/jobs?per_page=10`)).json()) as {
        jobs?: Array<{ id: number; name: string }>;
      };
      const job = jobs.jobs?.find((j) => j.name === "conduct") ?? jobs.jobs?.[0];
      if (!job) throw new Error(`run ${runId} has no jobs`);
      return (await get(`actions/jobs/${job.id}/logs`)).text();
    },
    async runConclusion(runId) {
      const run = (await (await get(`actions/runs/${runId}`)).json()) as {
        status?: string;
        conclusion?: string | null;
      };
      return run.status === "completed" ? (run.conclusion ?? "unknown") : null;
    },
    async mergesSince(sinceIso) {
      // First-parent walk from main's head: a squash merge is one first-parent commit,
      // and a merge commit's second parent brings commits that are not merges of their own.
      const bySha = new Map<string, { parents: string[]; message: string }>();
      let head: string | null = null;
      for (let page = 1; page <= 10; page++) {
        const list = (await (
          await get(
            `commits?sha=main&since=${encodeURIComponent(sinceIso)}&per_page=100&page=${page}`,
          )
        ).json()) as Array<{
          sha: string;
          parents: Array<{ sha: string }>;
          commit: { message: string };
        }>;
        if (!Array.isArray(list)) throw new Error("commits listing was not an array");
        if (list.length === 0) break;
        head ??= list[0]!.sha;
        for (const c of list)
          bySha.set(c.sha, { parents: c.parents.map((p) => p.sha), message: c.commit.message });
        if (list.length < 100) break;
        if (page === 10) throw new Error("more than 1000 commits since the last row");
      }
      return countFirstParentMerges(head, bySha);
    },
  };
}

/** Walk first parents from `head` through the commits fetched, counting the ones a
 *  PR landed: `… (#123)` (squash) or `Merge pull request #123` (merge commit). */
export function countFirstParentMerges(
  head: string | null,
  bySha: ReadonlyMap<string, { parents: string[]; message: string }>,
): number {
  let n = 0;
  let at = head;
  const seen = new Set<string>();
  while (at !== null && bySha.has(at) && !seen.has(at)) {
    seen.add(at);
    const c = bySha.get(at)!;
    const subject = c.message.split("\n")[0] ?? "";
    if (/\(#\d+\)\s*$/.test(subject) || /^Merge pull request #\d+/.test(subject)) n++;
    at = c.parents[0] ?? null;
  }
  return n;
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set`);
  return v;
}

async function main(): Promise<void> {
  loadCredentialsIntoEnv();
  const repo = need("GITHUB_REPOSITORY");
  const github = githubReads(globalThis.fetch, need("GITHUB_TOKEN"), repo);
  const db = await openDb(readDbConfig());
  try {
    const now = new Date();
    const out = await writeFleetDaily({
      db,
      github,
      run: {
        id: Number(need("RUN_ID")),
        attempt: Number(process.env.RUN_ATTEMPT ?? "1"),
        event: process.env.RUN_EVENT ?? "",
        createdAt: need("RUN_CREATED_AT"),
        startedAt: need("RUN_STARTED_AT"),
        conclusion: process.env.RUN_CONCLUSION || null,
        headBranch: need("RUN_HEAD_BRANCH"),
      },
      planned: NIGHTLIES.map((n) => n.file),
      cockpit: async () => {
        const inp = await loadCockpitInputs(db, now);
        return buildCockpitModel(
          inp.websites,
          inp.reports,
          inp.prior,
          inp.baseUrl,
          now,
          inp.newSubmissions,
          inp.spamTotals,
          inp.recentEvents,
          inp.autoFilteredCount,
          inp.notifyBounces,
          inp.deadLetters,
          inp.deadLetterOldest,
        );
      },
      now,
      log: (l) => process.stdout.write(`${l}\n`),
    });
    process.stdout.write(
      `FLEET_DAILY_RESULT action=${out.action} ${"night" in out ? `night=${out.night}` : `why=${JSON.stringify(out.why)}`}\n`,
    );
  } finally {
    await db.destroy();
  }
}

if (isMain(import.meta.url)) {
  main().catch((e) => {
    process.stderr.write(`fleet-daily: ${(e as Error)?.stack ?? String(e)}\n`);
    process.exitCode = 1;
  });
}
