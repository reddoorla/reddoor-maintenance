export type DbCommandOptions = {
  /** Override the libSQL url (tests use ":memory:"); otherwise read from env. */
  url?: string;
  /** verify-dump: path to the dump file to load into a scratch engine. */
  file?: string;
  cwd?: string;
  verbose?: boolean;
};

/** `db <action>` — migrate | replay-deadletters | import-airtable | parity | sync | dump | verify-dump. The db layer is imported
 *  dynamically so a non-db CLI invocation (and `--help`) never loads
 *  @libsql/client. Config is resolved inside each branch so an unknown action
 *  returns without needing any Turso env. */
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

  // Re-run every lead that dead-lettered during a site-lookup outage (#539
  // Phase 0) through the normal ingest pipeline. Exit 1 while any row is STILL
  // failing — the store hasn't recovered and the operator should not read the
  // run as "all leads landed". Zero rows is a clean 0: nothing owed.
  if (action === "replay-deadletters") {
    const { readDbConfig, openDb } = await import("../../db/client.js");
    const db = await openDb(opts.url ? { url: opts.url } : readDbConfig());
    const { openBase, readAirtableConfig } = await import("../../reports/airtable/client.js");
    const { getWebsiteBySlug } = await import("../../reports/airtable/websites.js");
    const base = openBase(readAirtableConfig());
    const {
      createSubmission,
      stampNotified,
      stampFanout,
      findRecentDuplicateSubmissions,
      listRecentSubmissionsForEmail,
      markSubmissionsSpamRetro,
    } = await import("../../db/submissions.js");
    const { makeNotify } = await import("../../forms/notify.js");
    const { classifySpam } = await import("../../forms/spam-classifier.js");
    const { forwardNewsletterToWebhook } = await import("../../forms/webhook.js");
    const { addMailchimpMember, mailchimpTagsFor } = await import("../../forms/mailchimp.js");
    const { defaultResendClient } = await import("../../reports/send/resend.js");
    const { replayDeadLetters } = await import("../../forms/replay.js");

    // Same degradation as the ingest handler: an unconfigured Resend key means
    // replayed leads land un-emailed (notify=failed) rather than blocking replay.
    let send = null;
    try {
      send = defaultResendClient().send;
    } catch (err) {
      console.error(`[db] Resend unconfigured; replaying without email: ${String(err)}`);
    }

    // Mirrors the production handler's deps minus `deadLetter` (replayDeadLetters
    // forbids and strips it — a throwing lookup must retry, not duplicate) and
    // minus `defer` (a CLI has no post-response phase; the inline tail is fine).
    const result = await replayDeadLetters(db, {
      getWebsiteBySlug: (s) => getWebsiteBySlug(base, s),
      createSubmission: (input) => createSubmission(db, input),
      notify: makeNotify(send),
      stampNotified: (id, status, messageId) => stampNotified(db, id, status, messageId),
      now: () => new Date(),
      classifySpam: (n, outcome) =>
        classifySpam({
          name: n.name,
          email: n.email,
          ...(n.message !== undefined ? { message: n.message } : {}),
          formType: n.formType,
          extraFields: n.extraFields,
          turnstile: outcome,
        }),
      findRecentDuplicates: (message, since) =>
        findRecentDuplicateSubmissions(db, message, since.toISOString()),
      listRecentSubmissionsForEmail: (email, since) =>
        listRecentSubmissionsForEmail(db, email, since.toISOString()),
      retroBucket: (ids, reason) => markSubmissionsSpamRetro(db, ids, reason),
      forwardNewsletter: (url, submission, site) =>
        forwardNewsletterToWebhook(url, submission, site),
      addToMailchimp: (site, submission) =>
        addMailchimpMember({
          apiKey: site.mailchimpApiKey ?? "",
          audienceId: site.mailchimpAudienceId ?? "",
          email: submission.email,
          name: submission.name,
          tags: mailchimpTagsFor(submission.formType),
        }),
      stampFanout: (id, fanoutStatus) => stampFanout(db, id, fanoutStatus),
    });

    const lines = [
      ...result.replayed.map(
        (r) => `replayed ${r.id} → ${r.outcome}${r.submissionId ? ` (${r.submissionId})` : ""}`,
      ),
      ...result.stillFailing.map((r) => `still failing ${r.id}: ${r.error}`),
      `DEADLETTER_REPLAY replayed=${result.replayed.length} still_failing=${result.stillFailing.length}`,
    ];
    return { output: lines.join("\n"), code: result.stillFailing.length > 0 ? 1 : 0 };
  }

  // Phase 1.3/1.4 of #539. Both read the same two Airtable tables raw (id +
  // fields, no mapRow coercion — the importer's mapping is the authority) and
  // share that mapping, so parity is definitionally checked against what the
  // importer writes.
  if (action === "import-airtable" || action === "parity" || action === "sync") {
    const { readDbConfig, openDb } = await import("../../db/client.js");
    const db = await openDb(opts.url ? { url: opts.url } : readDbConfig());
    const { openBase, readAirtableConfig } = await import("../../reports/airtable/client.js");
    const base = openBase(readAirtableConfig());
    const listRaw = async (table: string) =>
      (await base(table).select().all()).map((r) => ({
        id: r.id,
        fields: r.fields as Record<string, unknown>,
      }));
    const io = {
      listWebsiteRecords: () => listRaw("Websites"),
      listReportRecords: () => listRaw("Reports"),
      now: () => new Date(),
    };

    if (action === "import-airtable") {
      const { importFleetState, formatReapSummary } = await import("../../db/import-airtable.js");
      const summary = await importFleetState(db, {
        ...io,
        // Attachment bodies ride expiring signed URLs; a failed fetch imports the
        // row with rendered_html null and is NAMED in the summary, never silent.
        fetchAttachment: async (url) => {
          try {
            const res = await fetch(url);
            return res.ok ? await res.text() : null;
          } catch {
            return null;
          }
        },
      });
      const lines = [
        `imported ${summary.sites} site(s) → sites/site_health/site_schedule`,
        `imported ${summary.reports} report(s)`,
      ];
      if (summary.renderedHtmlMisses.length > 0) {
        lines.push(
          `⚠ ${summary.renderedHtmlMisses.length} report(s) imported WITHOUT Rendered HTML ` +
            `(fetch failed / URL expired): ${summary.renderedHtmlMisses.join(", ")}`,
        );
      }
      // The import deletes rows Airtable no longer has, so this one-shot path
      // reports the reap exactly as `db sync` does — same formatter, no second
      // copy to fall out of step.
      lines.push(...formatReapSummary(summary.reaped));
      return { output: lines.join("\n"), code: 0 };
    }

    // Phase 2 backbone (#539): one hourly pass = import (attachment fetches
    // only where the stored row lacks a body) + parity + one retry to absorb
    // the import-read/parity-read race. Exit 1 on persistent mismatch.
    if (action === "sync") {
      const { syncFleetState, formatSyncResult } = await import("../../db/sync.js");
      const result = await syncFleetState(db, {
        ...io,
        fetchAttachment: async (url) => {
          try {
            const res = await fetch(url);
            return res.ok ? await res.text() : null;
          } catch {
            return null;
          }
        },
      });
      return {
        output: formatSyncResult(result),
        code: result.parity.mismatches.length > 0 ? 1 : 0,
      };
    }

    const { checkFleetParity, formatParityResult } = await import("../../db/parity.js");
    const result = await checkFleetParity(db, io);
    return { output: formatParityResult(result), code: result.mismatches.length > 0 ? 1 : 0 };
  }

  // One-shot completion of design D5 (#539 Phase 2): copy every site's CURRENT
  // Airtable "Header image" attachment into sites.header_image*. Idempotent —
  // an already-populated BLOB is never overwritten (a re-run must not clobber
  // a freshly generated image with a stale Airtable copy). Exit 1 when any
  // fetch failed, so a partial backfill is never read as complete.
  if (action === "backfill-header-images") {
    const { readDbConfig, openDb } = await import("../../db/client.js");
    const db = await openDb(opts.url ? { url: opts.url } : readDbConfig());
    const { openBase, readAirtableConfig } = await import("../../reports/airtable/client.js");
    const base = openBase(readAirtableConfig());
    const { backfillHeaderImages, formatBackfillResult } =
      await import("../../db/header-images.js");
    const result = await backfillHeaderImages(db, {
      listWebsiteRecords: async () =>
        (await base("Websites").select().all()).map((r) => ({
          id: r.id,
          fields: r.fields as Record<string, unknown>,
        })),
      fetchBytes: async (url) => {
        try {
          const res = await fetch(url);
          return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
        } catch {
          return null;
        }
      },
    });
    return { output: formatBackfillResult(result), code: result.failed.length > 0 ? 1 : 0 };
  }

  // #609: one-shot copy of the single Airtable "Digest State" row into Turso,
  // so the first digest run after the read repoint sees yesterday's snapshot
  // instead of an empty one. An empty read is not a crash — it badges EVERY
  // item NEW, which lands in the operator's inbox reading as "the whole fleet
  // degraded overnight". REFUSES to overwrite a snapshot Turso already holds:
  // a re-run must never replace a fresher snapshot with a stale Airtable copy.
  if (action === "backfill-digest-state") {
    const { readDbConfig, openDb } = await import("../../db/client.js");
    const db = await openDb(opts.url ? { url: opts.url } : readDbConfig());
    const { readDigestState: readTurso, writeDigestState: writeTurso } =
      await import("../../db/digest-state.js");
    const existing = await readTurso(db);
    if (Object.keys(existing).length > 0) {
      return {
        output: `DIGEST_BACKFILL skipped=1 reason=turso-already-populated keys=${Object.keys(existing).length}`,
        code: 0,
      };
    }
    const { openBase, readAirtableConfig } = await import("../../reports/airtable/client.js");
    const base = openBase(readAirtableConfig());
    const { readDigestState: readAirtable, DIGEST_STATE_TABLE } =
      await import("../../alerts/digest-state.js");
    // `source` separates "Airtable has no row" from "Airtable has a row holding
    // an empty snapshot" — the reader collapses BOTH to {}, so copied=0 alone
    // cannot tell a quiet fleet from a failed read. Learned by running this: the
    // first real run printed copied=0 and only a hand probe showed the row was
    // there and genuinely empty.
    const rows = await base(DIGEST_STATE_TABLE).select({ maxRecords: 1, pageSize: 1 }).all();
    const snap = await readAirtable(base);
    const keys = Object.keys(snap).length;
    await writeTurso(db, snap);
    // Read it BACK. A returning write is not evidence the row landed — the same
    // rule forms-notify-target learned on 2026-08-03. `stored` counts the ROW,
    // not its keys, so an empty-but-present snapshot verifies as written.
    const stored = (await db.selectFrom("digest_state").selectAll().execute()).length;
    const after = Object.keys(await readTurso(db)).length;
    return {
      output:
        `DIGEST_BACKFILL source=${rows.length > 0 ? "row" : "absent"} ` +
        `copied=${keys} verified=${after} rows=${stored}`,
      code: after === keys && stored === 1 ? 0 : 1,
    };
  }

  // Phase 1.5 of #539: platform-auth-free SQL dump to stdout-adjacent output.
  // The nightly backup workflow redirects this to a file, encrypts, uploads;
  // the rehearsed restore loads it into stock sqlite3 and compares row counts.
  if (action === "dump") {
    const { readDbConfig } = await import("../../db/client.js");
    const cfg = opts.url ? { url: opts.url } : readDbConfig();
    const { createClient } = await import("@libsql/client");
    const client = createClient(cfg.url === ":memory:" ? { url: ":memory:" } : cfg);
    const { dumpDatabase } = await import("../../db/dump.js");
    const sql = await dumpDatabase({
      execute: async (q) => {
        const r = await client.execute(q);
        return { columns: r.columns, rows: r.rows as Array<Record<string, unknown>> };
      },
    });
    return { output: sql, code: 0 };
  }

  // The restore rehearsal (Phase 1.5's hard gate), runnable every night: load
  // the dump into a FRESH in-memory engine and compare restored row counts
  // against the INSERT counts in the dump text itself. A dump that cannot
  // restore is not a backup — and per the repo's instrument rule the check
  // emits its machine line on every run, clean included.
  if (action === "verify-dump") {
    const file = opts.file;
    if (!file) return { output: "verify-dump: pass the dump path via --file", code: 1 };
    const { readFile } = await import("node:fs/promises");
    const sql = await readFile(file, "utf-8");
    const { createClient } = await import("@libsql/client");
    const scratch = createClient({ url: ":memory:" });
    try {
      await scratch.executeMultiple(sql);
    } catch (err) {
      return { output: `DUMP_VERIFY loaded=false error=${String(err)}`, code: 1 };
    }
    const { tableCounts, countInsertsInDump } = await import("../../db/dump.js");
    const restored = await tableCounts({
      execute: async (q) => {
        const r = await scratch.execute(q);
        return { columns: r.columns, rows: r.rows as Array<Record<string, unknown>> };
      },
    });
    const expected = countInsertsInDump(sql);
    const mismatches: string[] = [];
    for (const [table, want] of Object.entries(expected)) {
      if ((restored[table] ?? 0) !== want) {
        mismatches.push(`${table}: dump=${want} restored=${restored[table] ?? 0}`);
      }
    }
    const total = Object.values(restored).reduce((a, b) => a + b, 0);
    const lines = [
      ...mismatches.map((m) => `✗ ${m}`),
      `DUMP_VERIFY loaded=true tables=${Object.keys(restored).length} rows=${total} mismatches=${mismatches.length}`,
    ];
    return { output: lines.join("\n"), code: mismatches.length > 0 ? 1 : 0 };
  }

  return {
    output: `unknown db action '${action}'. Use: migrate, replay-deadletters, import-airtable, parity, sync, backfill-header-images, backfill-digest-state, dump, verify-dump.`,
    code: 1,
  };
}
