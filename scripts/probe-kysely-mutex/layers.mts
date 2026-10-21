// Probe (2026-10-21): where one libSQL client's concurrent reads serialise, raw client vs Kysely vs
// the real /s/:slug loaders, with each fetch's start and end. SELECT-only against TURSO_DATABASE_URL:
// a plugin refuses any other query. Run: node_modules/.bin/tsx scripts/probe-kysely-mutex/layers.mts
import { createClient } from "@libsql/client";
import { Kysely, sql } from "kysely";
import { LibsqlDialect } from "@libsql/kysely-libsql";
import type { Database } from "../../src/db/schema.js";
import { getSiteBySlug, listReportsForSite } from "../../src/db/fleet-state.js";
import { listSubmissionsForSite, countNotifyBouncedForSite } from "../../src/db/submissions.js";
import { screenOutTotalsForSite, screenOutsSince } from "../../src/db/screenouts.js";
import { countUnreplayedDeadLettersForSlug } from "../../src/db/deadletter.js";
import { readDigestState } from "../../src/db/digest-state.js";
const selectOnly = {
  transformQuery(a: { node: { kind: string } }) {
    if (a.node.kind !== "SelectQueryNode" && a.node.kind !== "RawNode")
      throw new Error("refused " + a.node.kind);
    return a.node as never;
  },
  async transformResult(a: { result: unknown }) {
    return a.result as never;
  },
};
let T = 0;
const ev: string[] = [];
const f = async (req: Request) => {
  const s = performance.now() - T;
  const r = await fetch(req);
  ev.push(`${s.toFixed(0)}-${(performance.now() - T).toFixed(0)}`);
  return r;
};
const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
  fetch: f as never,
});
const db = new Kysely<Database>({ dialect: new LibsqlDialect({ client }) }).withPlugin(
  selectOnly as never,
);
const slug = "williamson-construction-co",
  now = new Date();
const site = (await getSiteBySlug(db, slug))!;
const loaders = [
  () => listReportsForSite(db, site.id),
  () => listSubmissionsForSite(db, { id: site.id, name: site.name }),
  () => screenOutTotalsForSite(db, site.id, screenOutsSince(now, 30)),
  () => countNotifyBouncedForSite(db, site.id, screenOutsSince(now, 30)),
  () => countUnreplayedDeadLettersForSlug(db, slug),
  () => readDigestState(db),
];
const kysely1 = Array.from({ length: 6 }, () => () => sql`select 1`.execute(db));
const raw1 = Array.from({ length: 6 }, () => () => client.execute("select 1"));
async function go(label: string, fs: (() => Promise<unknown>)[], mode: "par" | "seq") {
  ev.length = 0;
  T = performance.now();
  if (mode === "par") await Promise.all(fs.map((x) => x()));
  else for (const x of fs) await x();
  return `${label} ${mode} ${(performance.now() - T).toFixed(0)}ms [${ev.join(" ")}]`;
}
for (let i = 0; i < 2; i++) await go("warm", raw1, "par");
for (let r = 0; r < 4; r++) {
  console.log(await go("raw select1   ", raw1, "par"));
  console.log(await go("kysely select1", kysely1, "par"));
  console.log(await go("real loaders  ", loaders, "par"));
  console.log(await go("real loaders  ", loaders, "seq"));
}
client.close();
