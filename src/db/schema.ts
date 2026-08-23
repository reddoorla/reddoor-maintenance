// The hand-written shape Kysely types every query from. SQLite stores TEXT/INTEGER
// only, so these are the column *shapes* — the value domains (form_type, status,
// notify_status) are still narrowed at read time by the validators in
// src/reports/submission-row.ts. Keep this in lockstep with src/db/migrations.ts;
// drift is caught by the in-memory tests in tests/db/, not by codegen.

export interface SubmissionsTable {
  id: string;
  submission_id: number | null;
  site_id: string;
  form_type: string;
  name: string;
  email: string;
  phone: string | null;
  message: string | null;
  extra_fields: string | null;
  source_url: string | null;
  utm: string | null;
  submitted_at: string | null;
  status: string;
  notify_status: string;
  resend_message_id: string | null;
  spam_score: number | null;
  spam_reason: string | null;
  fanout_status: string | null;
}

export interface SpamScreenoutsTable {
  site_id: string;
  date: string;
  honeypot: number;
  too_fast: number;
  marked_spam: number;
}

export interface FleetEventsTable {
  id: string;
  ts: string;
  type: string;
  site_id: string | null;
  site_name: string | null;
  summary: string;
  data: string | null;
  created_at: string;
}

export interface MigrationsTable {
  id: string;
  applied_at: string;
}

/** A lead whose site lookup threw mid-ingest (migration 0006). `payload` and
 *  `turnstile` are JSON — the raw wire body and the verification computed at
 *  receipt — exactly what `db replay-deadletters` feeds back through
 *  `ingestSubmission` once the lookup recovers. */
export interface SubmissionDeadletterTable {
  id: string;
  site_slug: string;
  payload: string;
  turnstile: string;
  error: string;
  received_at: string;
  replayed_at: string | null;
  replay_outcome: string | null;
  replay_submission_id: string | null;
}

export interface Database {
  submissions: SubmissionsTable;
  spam_screenouts: SpamScreenoutsTable;
  fleet_events: FleetEventsTable;
  _migrations: MigrationsTable;
  submission_deadletter: SubmissionDeadletterTable;
}
