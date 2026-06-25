/** Ordered, append-only list of standard-SQL migration scripts. Each runs once,
 *  tracked by `id` in the `_migrations` table (see migrate.ts). Statements use
 *  IF NOT EXISTS so even a partial re-apply is safe. Never edit a shipped script —
 *  add a new one. Every statement in a script MUST be independently idempotent:
 *  `migrate.ts` runs each script via `executeMultiple`, which is NOT transactional,
 *  so a mid-script failure can leave earlier statements applied and the id unrecorded
 *  — a re-run then re-executes the whole script. Standard SQLite SQL only (no
 *  Turso-specific syntax) so the host stays a connection-string swap. */
export type Migration = { id: string; sql: string };

export const MIGRATIONS: Migration[] = [
  {
    id: "0001_init",
    sql: `
      CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY,
        submission_id INTEGER,
        site_id TEXT NOT NULL,
        form_type TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        message TEXT,
        extra_fields TEXT,
        source_url TEXT,
        utm TEXT,
        submitted_at TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        notify_status TEXT NOT NULL DEFAULT 'skipped',
        resend_message_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_submissions_site_submitted
        ON submissions (site_id, submitted_at DESC);
      CREATE INDEX IF NOT EXISTS idx_submissions_status
        ON submissions (status);
      CREATE TABLE IF NOT EXISTS spam_screenouts (
        site_id TEXT NOT NULL,
        date TEXT NOT NULL,
        honeypot INTEGER NOT NULL DEFAULT 0,
        too_fast INTEGER NOT NULL DEFAULT 0,
        marked_spam INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (site_id, date)
      );
    `,
  },
  {
    id: "0002_fleet_events",
    sql: `
      CREATE TABLE IF NOT EXISTS fleet_events (
        id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        type TEXT NOT NULL,
        site_id TEXT,
        site_name TEXT,
        summary TEXT NOT NULL,
        data TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_events_ts ON fleet_events (ts);
    `,
  },
];
