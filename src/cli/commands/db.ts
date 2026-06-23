export type DbCommandOptions = {
  /** Override the libSQL url (tests use ":memory:"); otherwise read from env. */
  url?: string;
  cwd?: string;
  verbose?: boolean;
};

/** `db <action>` — migrate. The db layer is imported dynamically so a non-db
 *  CLI invocation (and `--help`) never loads @libsql/client. Config is resolved
 *  inside each branch so an unknown action returns without needing any Turso env. */
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

  return {
    output: `unknown db action '${action}'. Use: migrate.`,
    code: 1,
  };
}
