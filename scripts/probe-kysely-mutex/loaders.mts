// Probe (2026-10-21): the real page loaders end to end, `/` and `/s/:slug`, on a Db with
// Kysely's mutex (every read one after another, as before the parallel waves) and on a
// `concurrentReads` Db (as the cockpit's withDb opens it). SELECT-only against
// TURSO_DATABASE_URL: a plugin refuses any other query.
// Run: node_modules/.bin/tsx scripts/probe-kysely-mutex/loaders.mts [slug]
import { createClient } from "@libsql/client";
import type { KyselyPlugin } from "kysely";
import { kyselyOverClient } from "../../src/db/client.js";
import { loadCockpitModel, loadSiteDashboard } from "../../src/dashboard/page-data.js";

const selectOnly: KyselyPlugin = {
  transformQuery(args) {
    if (args.node.kind !== "SelectQueryNode") throw new Error(`refused ${args.node.kind}`);
    return args.node;
  },
  async transformResult(args) {
    return args.result;
  },
};
const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const serial = (await kyselyOverClient(client)).withPlugin(selectOnly);
const parallel = (await kyselyOverClient(client, { concurrentReads: true })).withPlugin(selectOnly);
const slug = process.argv[2] ?? "williamson-construction-co";
const now = new Date();
const base = "https://example.invalid";

const loads = {
  "/": (db: typeof serial) => loadCockpitModel(db, now, base),
  [`/s/${slug}`]: (db: typeof serial) => loadSiteDashboard(db, slug, now, base),
};
const time = async (f: () => Promise<unknown>) => {
  const s = performance.now();
  await f();
  return performance.now() - s;
};
for (const [name, load] of Object.entries(loads)) {
  const same = JSON.stringify(await load(serial)) === JSON.stringify(await load(parallel));
  for (let i = 0; i < 2; i++) await load(parallel); // warm the connection pool
  const S: number[] = [];
  const P: number[] = [];
  for (let i = 0; i < 7; i++) {
    S.push(await time(() => load(serial)));
    P.push(await time(() => load(parallel)));
  }
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[3].toFixed(0);
  const fmt = (a: number[]) => a.map((x) => x.toFixed(0)).join(", ");
  console.log(`${name}  identical: ${same}`);
  console.log(`  with mutex (before) ms: ${fmt(S)}  median ${med(S)}`);
  console.log(`  concurrentReads    ms: ${fmt(P)}  median ${med(P)}`);
}
client.close();
