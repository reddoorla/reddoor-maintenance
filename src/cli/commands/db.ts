export type DbCommandOptions = {
  /** Override the libSQL url (tests use ":memory:"); otherwise read from env. */
  url?: string;
  cwd?: string;
  verbose?: boolean;
};

/** `db <action>` — migrate | backfill | reconcile. The db/Airtable layers are
 *  imported dynamically so a non-db CLI invocation (and `--help`) never loads
 *  @libsql/client or the airtable SDK. Config is resolved inside each branch so
 *  an unknown action returns without needing any Turso/Airtable env. */
export async function runDbCommand(
  action: string,
  opts: DbCommandOptions,
): Promise<{ output: string; code: number }> {
  if (action === "migrate") {
    const { readDbConfig } = await import("../../db/client.js");
    const cfg = opts.url ? { url: opts.url } : readDbConfig();
    const { runMigrations } = await import("../../db/migrate.js");
    const { createClient } = await import("@libsql/client");
    const client = createClient(cfg.url === ":memory:" ? { url: ":memory:" } : cfg);
    const ran = await runMigrations(client);
    return {
      output: ran.length ? `Applied migrations: ${ran.join(", ")}` : "Already up to date.",
      code: 0,
    };
  }

  if (action === "backfill") {
    const { openDb, readDbConfig } = await import("../../db/client.js");
    const cfg = opts.url ? { url: opts.url } : readDbConfig();
    const { openBase, readAirtableConfig } = await import("../../reports/airtable/client.js");
    const { backfillSubmissions, backfillScreenouts } = await import("../../db/backfill.js");
    const base = openBase(readAirtableConfig());
    const db = await openDb(cfg);
    const subs = await backfillSubmissions(base, db);
    const buckets = await backfillScreenouts(base, db);
    return { output: `Backfilled ${subs} submissions, ${buckets} screen-out buckets.`, code: 0 };
  }

  if (action === "reconcile") {
    const { openDb, readDbConfig } = await import("../../db/client.js");
    const cfg = opts.url ? { url: opts.url } : readDbConfig();
    const { openBase, readAirtableConfig } = await import("../../reports/airtable/client.js");
    const { reconcile } = await import("../../db/backfill.js");
    const base = openBase(readAirtableConfig());
    const db = await openDb(cfg);
    const r = await reconcile(base, db);
    const lines = [
      `submissions: airtable=${r.submissions.airtable} libsql=${r.submissions.libsql}`,
      `screenouts:  airtable=${JSON.stringify(r.screenouts.airtable)} libsql=${JSON.stringify(r.screenouts.libsql)}`,
      r.ok ? "OK — parity confirmed." : "MISMATCH — do not cut over.",
    ];
    return { output: lines.join("\n"), code: r.ok ? 0 : 1 };
  }

  return {
    output: `unknown db action '${action}'. Use: migrate | backfill | reconcile.`,
    code: 1,
  };
}
