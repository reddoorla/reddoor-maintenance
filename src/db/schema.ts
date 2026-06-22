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
}

export interface SpamScreenoutsTable {
  site_id: string;
  date: string;
  honeypot: number;
  too_fast: number;
  marked_spam: number;
}

export interface MigrationsTable {
  id: string;
  applied_at: string;
}

export interface Database {
  submissions: SubmissionsTable;
  spam_screenouts: SpamScreenoutsTable;
  _migrations: MigrationsTable;
}
