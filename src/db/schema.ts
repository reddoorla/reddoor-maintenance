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

/** Operator-owned fleet config (migration 0007). PK = Airtable rec id (D1).
 *  `legacy` holds the 33 populated-but-code-unreferenced Airtable columns as a
 *  JSON object keyed by original column name; the plaintext DNS/cms credential
 *  cells never migrate (operator ruling 2026-08-23). */
export interface SitesTable {
  id: string;
  slug: string;
  name: string;
  url: string | null;
  status: string | null;
  point_of_contact: string | null;
  maintenance_freq: string | null;
  testing_freq: string | null;
  maintenance_day: string | null;
  testing_day: string | null;
  ga4_property_id: string | null;
  search_query: string | null;
  search_console_property: string | null;
  git_repo: string | null;
  netlify_id: string | null;
  report_recipients_to: string | null;
  report_recipients_cc: string | null;
  copy_intro: string | null;
  copy_contact: string | null;
  copy_footer: string | null;
  newsletter_webhook: string | null;
  mailchimp_api_key: string | null;
  mailchimp_audience_id: string | null;
  notify_routing: string | null;
  require_turnstile: number;
  accepted_watch_conditions: string | null;
  prismic_ack_until: string | null;
  launched_at: string | null;
  header_image: Uint8Array | null;
  header_image_filename: string | null;
  header_image_type: string | null;
  header_image_generated_at: string | null;
  legacy: string | null;
}

/** Nightly-cron-owned health/telemetry (migration 0007) — one row per site,
 *  written as one batched upsert per sweep family. `analytics_soft_fail_at` is
 *  the "Analytics soft-fail at" column code always wrote best-effort but no
 *  operator ever created in Airtable. */
export interface SiteHealthTable {
  site_id: string;
  p_score: number | null;
  r_score: number | null;
  bp_score: number | null;
  seo_score: number | null;
  lighthouse_at: string | null;
  a11y_violations: number | null;
  deps_drifted: number | null;
  deps_major_behind: number | null;
  deps_outdated: number | null;
  deps_major_outdated: number | null;
  vulns_critical: number | null;
  vulns_high: number | null;
  vulns_moderate: number | null;
  vulns_low: number | null;
  security_audit_at: string | null;
  security_advisories: string | null;
  auto_fix_attempts: number | null;
  analytics_soft_fail_at: string | null;
  cert_days_remaining: number | null;
  domain_checked_at: string | null;
  deploy_status: string | null;
  last_deploy_at: string | null;
  deploy_log_url: string | null;
  deploy_checked_at: string | null;
  function_health: string | null;
  cms_reachable: string | null;
  turnstile_widget: string | null;
  function_health_checked_at: string | null;
  crossbrowser_ok: number | null;
  mobile_ok: number | null;
  links_ok: number | null;
  broken_links: number | null;
  browser_checked_at: string | null;
  uptime_reachable: string | null;
  titles_meta_ok: string | null;
  smoke_ok: string | null;
  last_smoke_at: string | null;
  form_e2e_ok: string | null;
  form_e2e_checked_at: string | null;
  renovate_failing_cis: number | null;
  default_branch_ci: string | null;
  last_commit_at: string | null;
  github_signals_at: string | null;
  prismic_models: string | null;
  prismic_models_checked_at: string | null;
  prismic_models_drift: string | null;
}

/** Code-derived schedule (migration 0007) — written by updateNextDueDates. */
export interface SiteScheduleTable {
  site_id: string;
  next_maintenance_at: string | null;
  next_testing_at: string | null;
  computed_at: string | null;
}

/** Report rows (migration 0007). PK = Airtable rec id. `checklist` is JSON
 *  keyed by the STABLE checklist key (src/reports/checklist.ts), not the
 *  Airtable column name; `rendered_html` is the downloaded attachment body. */
export interface ReportsTable {
  id: string;
  site_id: string | null;
  report_id: string | null;
  report_type: string | null;
  period: string | null;
  period_start: string | null;
  period_end: string | null;
  completed_on: string | null;
  lighthouse_performance: number | null;
  lighthouse_accessibility: number | null;
  lighthouse_best_practices: number | null;
  lighthouse_seo: number | null;
  ga_users_current: number | null;
  ga_users_previous: number | null;
  search_found_page1: number | null;
  search_position: number | null;
  last_tested_date: string | null;
  commentary: string | null;
  subject_override: string | null;
  draft_ready: number;
  approved_to_send: number;
  approved_at: string | null;
  approved_by: string | null;
  send_override: number;
  override_reason: string | null;
  override_by: string | null;
  override_at: string | null;
  sent_at: string | null;
  delivery_status: string | null;
  resend_message_id: string | null;
  checklist: string | null;
  checklist_auto_evidence: string | null;
  rendered_html: string | null;
}

/** One prospect-audit run (migration 0009). `token` is the 128-bit unguessable
 *  public handle for GET /r/{token}; `result_json` holds the full
 *  ProspectAuditResult (src/prospect/types.ts). */
export interface ProspectAuditsTable {
  id: string;
  token: string;
  url: string;
  business: string | null;
  created_at: string;
  status: string;
  result_json: string;
}

export interface Database {
  submissions: SubmissionsTable;
  spam_screenouts: SpamScreenoutsTable;
  fleet_events: FleetEventsTable;
  _migrations: MigrationsTable;
  submission_deadletter: SubmissionDeadletterTable;
  sites: SitesTable;
  site_health: SiteHealthTable;
  site_schedule: SiteScheduleTable;
  reports: ReportsTable;
  prospect_audits: ProspectAuditsTable;
}
