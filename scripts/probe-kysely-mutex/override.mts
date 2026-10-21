// Probe (cockpit parallel reads, 2026-10-21; not for landing). Same six reads, Kysely told the libsql dialect supports multiple connections.
import { createClient } from "@libsql/client";
import { Kysely, SqliteAdapter } from "kysely";
import { LibsqlDialect } from "@libsql/kysely-libsql";
import type { Database } from "../../src/db/schema.js";
import { getSiteBySlug, listReportsForSite } from "../../src/db/fleet-state.js";
import { listSubmissionsForSite, countNotifyBouncedForSite } from "../../src/db/submissions.js";
import { screenOutTotalsForSite, screenOutsSince } from "../../src/db/screenouts.js";
import { countUnreplayedDeadLettersForSlug } from "../../src/db/deadletter.js";
import { readDigestState } from "../../src/db/digest-state.js";
class ConcurrentAdapter extends SqliteAdapter { override get supportsMultipleConnections() { return true; } }
class ConcurrentLibsqlDialect extends LibsqlDialect { override createAdapter() { return new ConcurrentAdapter(); } }
const selectOnly = {
  transformQuery(a: { node: { kind: string } }) { if (a.node.kind !== "SelectQueryNode") throw new Error("refused " + a.node.kind); return a.node as never; },
  async transformResult(a: { result: unknown }) { return a.result as never; },
};
const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
const mutexDb = new Kysely<Database>({ dialect: new LibsqlDialect({ client }) }).withPlugin(selectOnly as never);
const concDb = new Kysely<Database>({ dialect: new ConcurrentLibsqlDialect({ client }) }).withPlugin(selectOnly as never);
const slug = "williamson-construction-co", now = new Date();
const site = (await getSiteBySlug(mutexDb, slug))!;
const reads = (db: typeof mutexDb) => [
  () => listReportsForSite(db, site.id),
  () => listSubmissionsForSite(db, { id: site.id, name: site.name }),
  () => screenOutTotalsForSite(db, site.id, screenOutsSince(now, 30)),
  () => countNotifyBouncedForSite(db, site.id, screenOutsSince(now, 30)),
  () => countUnreplayedDeadLettersForSlug(db, slug),
  () => readDigestState(db),
];
const t = async (f: () => Promise<unknown>) => { const s = performance.now(); await f(); return performance.now() - s; };
const seq = (db: typeof mutexDb) => async () => { for (const r of reads(db)) await r(); };
const par = (db: typeof mutexDb) => () => Promise.all(reads(db).map((r) => r()));
// identical results either way (same rows)
const a = await Promise.all(reads(mutexDb).map((r) => r())), b = await Promise.all(reads(concDb).map((r) => r()));
console.log("results identical:", JSON.stringify(a) === JSON.stringify(b));
for (let i = 0; i < 3; i++) await par(concDb)(); // warm the connection pool
const R: Record<string, number[]> = { "today: seq, mutex": [], "par, mutex": [], "par, no mutex": [] };
for (let i = 0; i < 7; i++) {
  R["today: seq, mutex"].push(await t(seq(mutexDb)));
  R["par, mutex"].push(await t(par(mutexDb)));
  R["par, no mutex"].push(await t(par(concDb)));
}
for (const [k, v] of Object.entries(R)) console.log(`${k.padEnd(20)} ${v.map((x) => x.toFixed(0)).join(", ")}  median ${[...v].sort((x, y) => x - y)[3].toFixed(0)}`);
client.close();
