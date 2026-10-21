/**
 * The cockpit snapshot against a real store (home base
 * `briefs/2026-10-21-cockpit-one-snapshot.md`): how long one batched snapshot
 * takes, how big it is as SvelteKit sends it, and what the per-page loads it
 * replaces cost on the same connection. SELECT-only: it builds its own client
 * and never calls `openDb`, whose migration check could write.
 *
 *   TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… node_modules/.bin/tsx \
 *     scripts/probe-cockpit-snapshot/measure.mts [rounds] [slug]
 */
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { createClient } from "@libsql/client";
import { batchingReadClient, kyselyOverClient } from "../../src/db/client.js";
import { loadCockpitSnapshot } from "../../src/dashboard/snapshot.js";
import { loadCockpitModel, loadSiteDashboard } from "../../src/dashboard/page-data.js";

// devalue is how SvelteKit serialises load data; it is SvelteKit's dependency, not ours.
const kit = createRequire(import.meta.url).resolve("@sveltejs/kit/package.json");
const devalue = (await import(createRequire(kit).resolve("devalue"))) as {
  stringify(v: unknown): string;
};

const rounds = Number(process.argv[2] ?? 5);
const slug = process.argv[3] ?? "williamson-construction-co";
const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error("TURSO_DATABASE_URL not set");
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const batched = await kyselyOverClient(batchingReadClient(client), { concurrentReads: true });
const concurrent = await kyselyOverClient(client, { concurrentReads: true });

async function time(f: () => Promise<unknown>): Promise<number> {
  const t = performance.now();
  await f();
  return Math.round(performance.now() - t);
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// Warm the connection, so no row pays the first TLS handshake.
await client.execute("select 1");

const rows: Record<string, number[]> = {
  "snapshot, one batch": [],
  "snapshot, concurrent reads, no batch": [],
  "/ today (loadCockpitModel, concurrent reads)": [],
  [`/s/${slug} today (loadSiteDashboard, concurrent reads)`]: [],
};
const keys = Object.keys(rows);
for (let i = 0; i < rounds; i++) {
  const now = new Date();
  rows[keys[0]!]!.push(await time(() => loadCockpitSnapshot(batched, now, "https://x")));
  rows[keys[1]!]!.push(await time(() => loadCockpitSnapshot(concurrent, now, "https://x")));
  rows[keys[2]!]!.push(await time(() => loadCockpitModel(concurrent, now, "https://x")));
  rows[keys[3]!]!.push(await time(() => loadSiteDashboard(concurrent, slug, now, "https://x")));
}
for (const [k, v] of Object.entries(rows)) console.log(`${k}: ${v.join(", ")} ms; median ${median(v)}`);

const s = await loadCockpitSnapshot(batched, new Date(), "https://x");
const wire = devalue.stringify(s);
console.log(
  `size as SvelteKit serialises it (devalue): ${wire.length} bytes, ${gzipSync(wire).length} gzipped`,
);
console.log(
  `rows: ${s.sites.length} sites, ${s.reports?.length ?? "failed"} reports, ${
    s.submissions?.length ?? "failed"
  } submissions, ${s.screenOuts?.length ?? "failed"} screen-out buckets, ${
    s.audits?.length ?? "failed"
  } audits, ${s.recentEvents.length} events`,
);
client.close();
