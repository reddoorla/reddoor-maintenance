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
  {
    id: "0003_add_spam_score",
    // SQLite `ADD COLUMN` has no `IF NOT EXISTS`, so it is NOT self-idempotent: if the
    // `_migrations` marker is lost after the column is added (crash between statement
    // and marker write), a re-run would throw `duplicate column name`. `migrate.ts`
    // recognizes that error as already-applied and records the marker, keeping the
    // runner idempotent (see `isAlreadyAppliedError`).
    sql: `ALTER TABLE submissions ADD COLUMN spam_score REAL;`,
  },
  {
    id: "0004_add_spam_reason",
    sql: `ALTER TABLE submissions ADD COLUMN spam_reason TEXT;`,
  },
  {
    // Outcome of the newsletter fan-out (site webhook + Mailchimp). Before this the
    // results were console.error-only, so a rotated Mailchimp key or an outage would
    // silently stop signups reaching the audience with no trace anywhere the operator
    // looks — the row still read `notify=sent`, healthy. Same non-idempotent
    // ADD COLUMN caveat as 0003.
    id: "0005_add_fanout_status",
    sql: `ALTER TABLE submissions ADD COLUMN fanout_status TEXT;`,
  },
  {
    // Phase 0 of the Airtable → Turso migration (#539): a lead whose SITE LOOKUP
    // fails must still land somewhere durable. On 2026-08-17 the Airtable quota
    // outage made `getWebsiteBySlug` throw before `createSubmission` ran, so every
    // lead in the window 502'd away unrecorded — while THIS store (which holds
    // submissions) was healthy the whole time. Rows here are written only on that
    // path and replayed through the normal pipeline once the lookup recovers
    // (`db replay-deadletters`), producing an ordinary submissions row with real
    // spam classification and notify. Deliberately a separate table rather than a
    // nullable `submissions.site_id`: site_id is NOT NULL, every reader assumes a
    // real rec id, and a sentinel would collapse dashboard grouping (the "" key
    // hazard audit.ts already documents).
    //
    // `turnstile` stores the verification COMPUTED AT RECEIPT ({outcome, hostname}
    // JSON) — tokens expire in 300s, so replay could never re-verify; it replays
    // with the answer we already had.
    id: "0006_submission_deadletter",
    sql: `
      CREATE TABLE IF NOT EXISTS submission_deadletter (
        id TEXT PRIMARY KEY,
        site_slug TEXT NOT NULL,
        payload TEXT NOT NULL,
        turnstile TEXT NOT NULL,
        error TEXT NOT NULL,
        received_at TEXT NOT NULL,
        replayed_at TEXT,
        replay_outcome TEXT,
        replay_submission_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_deadletter_unreplayed
        ON submission_deadletter (replayed_at);
    `,
  },
];
