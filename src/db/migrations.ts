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
  {
    // Phase 1.2 of the Airtable → Turso migration (#539): the fleet-state tables.
    // Split by WRITER, not topic (design D2, confirmed by the 2026-08-23 writer
    // map — every code-written column has exactly one writer):
    //   sites         — operator (dashboard editor / console / launch flow)
    //   site_health   — the nightly audit write-back, one batched upsert
    //   site_schedule — updateNextDueDates (report cron, derived)
    //   reports       — report drafting + the operator approve flow
    // PKs are the Airtable `rec…` ids (design D1): 278+ submissions rows already
    // reference them, and the parity harness diffs the two stores row-for-row.
    //
    // Naming: snake_case throughout; Airtable's misspellings ("maintenence") and
    // display quirks die here. `sites.legacy` is a JSON object holding the 33
    // populated-but-code-unreferenced columns (launch-era checklist, hosting
    // reference cells) keyed by their original Airtable column name — data kept,
    // schema not fossilized. The plaintext DNS/cms credential cells deliberately
    // do NOT migrate at all (operator ruling 2026-08-23); they live on only in
    // the frozen base. `site_health.analytics_soft_fail_at` is the column code
    // always wanted ("Analytics soft-fail at") but no operator ever created in
    // Airtable — it ships real here.
    //
    // reports.checklist is JSON keyed by the STABLE checklist key ("deploy",
    // "cms", …, from src/reports/checklist.ts), not the Airtable column name —
    // the importer translates, so "Test: Verified After Updates" stops leaking
    // its legacy name into a second store.
    id: "0007_fleet_state",
    sql: `
      CREATE TABLE IF NOT EXISTS sites (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        url TEXT,
        status TEXT,
        point_of_contact TEXT,
        maintenance_freq TEXT,
        testing_freq TEXT,
        maintenance_day TEXT,
        testing_day TEXT,
        ga4_property_id TEXT,
        search_query TEXT,
        search_console_property TEXT,
        git_repo TEXT,
        netlify_id TEXT,
        report_recipients_to TEXT,
        report_recipients_cc TEXT,
        copy_intro TEXT,
        copy_contact TEXT,
        copy_footer TEXT,
        newsletter_webhook TEXT,
        mailchimp_api_key TEXT,
        mailchimp_audience_id TEXT,
        notify_routing TEXT,
        require_turnstile INTEGER NOT NULL DEFAULT 0,
        accepted_watch_conditions TEXT,
        prismic_ack_until TEXT,
        launched_at TEXT,
        header_image BLOB,
        header_image_filename TEXT,
        header_image_type TEXT,
        header_image_generated_at TEXT,
        legacy TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sites_status ON sites (status);

      CREATE TABLE IF NOT EXISTS site_health (
        site_id TEXT PRIMARY KEY,
        p_score INTEGER,
        r_score INTEGER,
        bp_score INTEGER,
        seo_score INTEGER,
        lighthouse_at TEXT,
        a11y_violations INTEGER,
        deps_drifted INTEGER,
        deps_major_behind INTEGER,
        deps_outdated INTEGER,
        deps_major_outdated INTEGER,
        vulns_critical INTEGER,
        vulns_high INTEGER,
        vulns_moderate INTEGER,
        vulns_low INTEGER,
        security_audit_at TEXT,
        security_advisories TEXT,
        auto_fix_attempts INTEGER,
        analytics_soft_fail_at TEXT,
        cert_days_remaining INTEGER,
        domain_checked_at TEXT,
        deploy_status TEXT,
        last_deploy_at TEXT,
        deploy_log_url TEXT,
        deploy_checked_at TEXT,
        function_health TEXT,
        cms_reachable TEXT,
        turnstile_widget TEXT,
        function_health_checked_at TEXT,
        crossbrowser_ok INTEGER,
        mobile_ok INTEGER,
        links_ok INTEGER,
        broken_links INTEGER,
        browser_checked_at TEXT,
        uptime_reachable TEXT,
        titles_meta_ok TEXT,
        smoke_ok TEXT,
        last_smoke_at TEXT,
        form_e2e_ok TEXT,
        form_e2e_checked_at TEXT,
        renovate_failing_cis INTEGER,
        default_branch_ci TEXT,
        last_commit_at TEXT,
        github_signals_at TEXT,
        prismic_models TEXT,
        prismic_models_checked_at TEXT,
        prismic_models_drift TEXT
      );

      CREATE TABLE IF NOT EXISTS site_schedule (
        site_id TEXT PRIMARY KEY,
        next_maintenance_at TEXT,
        next_testing_at TEXT,
        computed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        site_id TEXT,
        report_id TEXT,
        report_type TEXT,
        period TEXT,
        period_start TEXT,
        period_end TEXT,
        completed_on TEXT,
        lighthouse_performance INTEGER,
        lighthouse_accessibility INTEGER,
        lighthouse_best_practices INTEGER,
        lighthouse_seo INTEGER,
        ga_users_current INTEGER,
        ga_users_previous INTEGER,
        search_found_page1 INTEGER,
        search_position REAL,
        last_tested_date TEXT,
        commentary TEXT,
        subject_override TEXT,
        draft_ready INTEGER NOT NULL DEFAULT 0,
        approved_to_send INTEGER NOT NULL DEFAULT 0,
        approved_at TEXT,
        approved_by TEXT,
        send_override INTEGER NOT NULL DEFAULT 0,
        override_reason TEXT,
        override_by TEXT,
        override_at TEXT,
        sent_at TEXT,
        delivery_status TEXT,
        resend_message_id TEXT,
        checklist TEXT,
        checklist_auto_evidence TEXT,
        rendered_html TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_reports_site ON reports (site_id, period_start DESC);
    `,
  },
  {
    // Indexes the EXPLAIN-query-plan gate (tests/db/query-plans.test.ts) proved the
    // hot paths need — each serves a named query shape that otherwise full-scans
    // submissions, the one unbounded-growth table:
    //   submitted_at    — every windowed read (/submissions default page, digest
    //                     per-site counts, duplicate/repeat-sender scans)
    //   resend_message_id — the resend-webhook bounce lookup (markNotifyBouncedByMessageId)
    //   submission_id   — createSubmission's MAX(submission_id)+1 display number,
    //                     O(1) off the index instead of a scan per insert
    //   spam_reason (partial, covering) — listSpamReasonsFiltered's facet tally
    //                     reads ONLY spam_reason WHERE spam_reason IS NOT NULL;
    //                     partial keeps it to the spam subset
    //   spam_screenouts(date) — listScreenOutsSince windows on date, which the
    //                     (site_id, date) PK can't serve
    id: "0008_query_plan_indexes",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_submissions_submitted
        ON submissions (submitted_at DESC);
      CREATE INDEX IF NOT EXISTS idx_submissions_spam_reason
        ON submissions (spam_reason) WHERE spam_reason IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_submissions_resend_message
        ON submissions (resend_message_id);
      CREATE INDEX IF NOT EXISTS idx_submissions_display_number
        ON submissions (submission_id);
      CREATE INDEX IF NOT EXISTS idx_screenouts_date
        ON spam_screenouts (date);
    `,
  },
  {
    // Prospect audits (spec 2026-08-24): one row per `prospect-audit` CLI run.
    // `token` is the unguessable public handle for GET /r/{token}; `result_json`
    // is the full ProspectAuditResult, re-rendered on every request so report
    // styling updates apply to already-shared links.
    id: "0009_prospect_audits",
    sql: `
      CREATE TABLE IF NOT EXISTS prospect_audits (
        id TEXT PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        url TEXT NOT NULL,
        business TEXT,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'complete',
        result_json TEXT NOT NULL
      );
    `,
  },
  {
    // Cockpit /audits listing page (spec 2026-08-25, Piece 5):
    // listRecentProspectAudits orders by created_at DESC with no WHERE clause —
    // without this index that's a raw SCAN of prospect_audits followed by a temp
    // b-tree sort, which the EXPLAIN-query-plan gate (tests/db/query-plans.test.ts)
    // fails the build on. DESC matches the query's own ORDER BY so SQLite can walk
    // the index directly instead of sorting.
    id: "0010_prospect_audits_created_index",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_prospect_audits_created
        ON prospect_audits (created_at DESC);
    `,
  },
  {
    // #609 (#539 Phase 5): the digest's prior-run snapshot moves off Airtable.
    // Unlike the rest of Phase 5 this is a MIGRATION, not a dual-write — there
    // is no Airtable counterpart left afterwards, so parity does not cover it.
    //
    // A single row holding the whole snapshot as JSON, keyed by a constant id.
    // Both readers (runDigest's diff and the fleet homepage's NEW badges) need
    // the ENTIRE map, so a keyed table would buy nothing on reads and its
    // "give me everything" query would be a raw scan needing a justified entry
    // in the EXPLAIN gate's allowlist. One row by primary key needs neither.
    id: "0011_digest_state",
    sql: `
      CREATE TABLE IF NOT EXISTS digest_state (
        id TEXT PRIMARY KEY,
        snapshot TEXT NOT NULL,
        updated_at TEXT
      );
    `,
  },
  {
    // form_type was the one SubmissionFilter key with an equality predicate and no
    // index — countSubmissionsFiltered({formType}) raw-scanned `submissions`, twice
    // per load of the submissions page. It shipped green because the EXPLAIN gate
    // named its scenarios by hand and never wrote one for this shape; the gate is
    // now driven by a filter matrix, which is what surfaced it.
    //
    // `submissions` is the one unbounded-growth table in the schema — append-only,
    // one row per fleet lead forever — and Turso meters ROW SCANS, so this is the
    // cost that grows without a ceiling.
    id: "0012_submissions_form_type_index",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_submissions_form_type
        ON submissions (form_type);
    `,
  },
];
