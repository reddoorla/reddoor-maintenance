export type DbCommandOptions = {
  /** Override the libSQL url (tests use ":memory:"); otherwise read from env. */
  url?: string;
  /** verify-dump: path to the dump file to load into a scratch engine. */
  file?: string;
  /** usage: org slug override; defaults to TURSO_ORG, else discovered. */
  org?: string;
  /** import-airtable / sync: run despite the freeze — a deliberate
   *  rollback-window converge from the frozen Airtable shadow. */
  force?: boolean;
  cwd?: string;
  verbose?: boolean;
};

/** Injected seams — deliberately NOT part of DbCommandOptions, which is the set
 *  of things a shell can type (a registration gate asserts exactly that). The
 *  platform token lives here rather than on a flag because a secret passed on
 *  argv is readable from `ps`. */
export type DbCommandDeps = {
  /** Tests pass "" to exercise the unconfigured path, so the implementation
   *  must use `?? env` and never `|| env`. */
  platformToken?: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: Date;
  /** restore: auth token for the TARGET database; defaults to
   *  TURSO_RESTORE_AUTH_TOKEN. Deliberately does NOT fall back to the ambient
   *  TURSO_AUTH_TOKEN — that one belongs to production, and inheriting it would
   *  undo the whole point of making --url explicit. */
  restoreAuthToken?: string;
};

/** #643 (the freeze): the scheduled import retired with the flip, but the
 *  MANUAL import survives as the rollback-window converge tool — and run out of
 *  habit it would overwrite authoritative Turso rows with the frozen Airtable
 *  archive, including any post-flip write whose best-effort shadow was
 *  swallowed. So the writing actions refuse under the freeze unless the
 *  operator says `--force`. `parity` stays unguarded: it only compares, and
 *  "did the shadow drift?" is exactly the rollback-window question.
 *
 *  Pure and exported so the test injects BOTH switch states; `runDbCommand`
 *  passes the shipped constant. Returns the refusal, or null to proceed. */
export function freezeGuardsDbWrite(
  action: string,
  force: boolean,
  authoritative: boolean,
): { output: string; code: number } | null {
  if (!authoritative) return null;
  if (action !== "import-airtable" && action !== "sync") return null;
  if (force) return null;
  return {
    output:
      `db ${action} refused: TURSO_IS_AUTHORITATIVE is on (the freeze, 2026-08-31). ` +
      `An import now OVERWRITES authoritative Turso rows with the frozen Airtable ` +
      `archive. Pass --force only for a deliberate rollback-window converge.`,
    code: 1,
  };
}

/** `db <action>` — migrate | replay-deadletters | import-airtable | parity | sync | dump | verify-dump. The db layer is imported
 *  dynamically so a non-db CLI invocation (and `--help`) never loads
 *  @libsql/client. Config is resolved inside each branch so an unknown action
 *  returns without needing any Turso env. */
export async function runDbCommand(
  action: string,
  opts: DbCommandOptions,
  deps: DbCommandDeps = {},
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
    const { TURSO_IS_AUTHORITATIVE } = await import("../../db/freeze.js");
    const refused = freezeGuardsDbWrite(action, opts.force === true, TURSO_IS_AUTHORITATIVE);
    if (refused) return refused;
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
    const sql = await dumpDatabase(
      {
        execute: async (q) => {
          const r = await client.execute(q);
          return { columns: r.columns, rows: r.rows as Array<Record<string, unknown>> };
        },
      },
      new Date().toISOString(),
    );
    return { output: sql, code: 0 };
  }

  // Load a dump back into a REAL libSQL target (#612 review). The nightly
  // rehearsal loads into `:memory:`, which proves the SQL parses — it does not
  // prove you can get the data back into Turso, and that is the operation an
  // actual recovery needs. Replaying ~17 MB of SQL with megabytes of inline hex
  // over HTTP is materially different from an in-process load, and it had never
  // been done. Refuses to touch a database that already holds rows: a restore
  // is for an EMPTY target, and pointing this at production by mistake should
  // cost nothing.
  if (action === "restore") {
    const file = opts.file;
    if (!file) return { output: "restore: pass the dump path via --file", code: 1 };
    if (!opts.url) {
      return {
        output:
          "restore: pass the TARGET database via --url (never defaults, to keep production out of reach)",
        code: 1,
      };
    }
    // Classify the target BEFORE reading the dump, so a missing token names
    // itself instead of arriving as an opaque 401 (or, worse, as an ENOENT that
    // sends you hunting for the dump file). This command built its client from
    // a url alone until 2026-08-26, which worked against every target the tests
    // and rehearsals used — `:memory:` and a local `turso dev` — and failed
    // against every target an actual recovery has.
    const { parseDumpManifest, requiresAuthToken } = await import("../../db/dump.js");
    const authToken = deps.restoreAuthToken ?? process.env.TURSO_RESTORE_AUTH_TOKEN ?? "";
    if (requiresAuthToken(opts.url) && !authToken) {
      return { output: "RESTORE refused=auth-token-absent", code: 1 };
    }
    const { readFile } = await import("node:fs/promises");
    const sql = await readFile(file, "utf-8");
    const manifest = parseDumpManifest(sql);
    if (!manifest) return { output: "RESTORE refused=manifest-absent", code: 1 };
    const { createClient } = await import("@libsql/client");
    const target = createClient(authToken ? { url: opts.url, authToken } : { url: opts.url });
    const existing = await target.execute(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    );
    if (Number(existing.rows[0]?.n ?? 0) > 0) {
      return { output: "RESTORE refused=target-not-empty", code: 1 };
    }
    await target.executeMultiple(sql);
    const { tableCounts, headerImageBytes } = await import("../../db/dump.js");
    const exec = {
      execute: async (q: string) => {
        const r = await target.execute(q);
        return { columns: r.columns, rows: r.rows as Array<Record<string, unknown>> };
      },
    };
    const counts = await tableCounts(exec);
    const bytes = await headerImageBytes(exec);
    // Same origin-anchored comparison as verify-dump: a restore that "succeeded"
    // with fewer rows than the origin held is not a restore.
    const bad: string[] = [];
    for (const [t, want] of Object.entries(manifest.tables)) {
      if ((counts[t] ?? 0) !== want) bad.push(`${t}: origin=${want} restored=${counts[t] ?? 0}`);
    }
    if (bytes !== manifest.blobBytes)
      bad.push(`header_image bytes: origin=${manifest.blobBytes} restored=${bytes}`);
    const rows = Object.values(counts).reduce((a, b) => a + b, 0);
    return {
      output: [
        ...bad.map((b) => `✗ ${b}`),
        `RESTORE loaded=true tables=${Object.keys(counts).length} rows=${rows} blob_bytes=${bytes} mismatches=${bad.length}`,
      ].join("\n"),
      code: bad.length > 0 ? 1 : 0,
    };
  }

  // How much of the plan's quota the fleet has burned this billing cycle
  // (#539 HIGH-10). The starter plan carries `overages: false`, so crossing a
  // quota BLOCKS reads and writes rather than billing for them — and once the
  // Airtable cutover lands, Turso is the only store there is. This is the one
  // alarm that fires before a wall rather than after it.
  //
  // Needs a PLATFORM token, which is a different credential from the
  // database-level TURSO_AUTH_TOKEN the rest of the fleet runs on: the database
  // token cannot read quota state at all.
  if (action === "usage") {
    const token = deps.platformToken ?? process.env.TURSO_FLEET_USAGE ?? "";
    // An unconfigured alarm must not read as a quiet, healthy one. The tell for
    // "never ran" has to be a failure, not a missing line (#585).
    if (!token) {
      return {
        output:
          "FLEET_DB_USAGE verdict=no-token — set TURSO_FLEET_USAGE (turso auth api-tokens mint …). " +
          "This is the PLATFORM token, not the database TURSO_AUTH_TOKEN.",
        code: 1,
      };
    }
    const { collectUsage, assessUsage } = await import("../../db/usage.js");
    const input = await collectUsage({
      token,
      org: opts.org ?? process.env.TURSO_ORG,
      fetchImpl: deps.fetchImpl,
      now: deps.now ?? new Date(),
    });
    const r = assessUsage(input);
    const window = `${input.cycleStart.toISOString().slice(0, 10)} → ${input.cycleEnd
      .toISOString()
      .slice(0, 10)}`;
    return {
      output: [`Turso plan=${input.plan}  billing cycle ${window}`, ...r.lines, "", r.marker].join(
        "\n",
      ),
      code: r.code,
    };
  }

  // The restore rehearsal (Phase 1.5's hard gate), runnable every night: load
  // the dump into a FRESH in-memory engine and compare what came back against
  // the ORIGIN MANIFEST the dump carries.
  //
  // It used to compare against INSERT counts parsed out of the dump text — i.e.
  // the dump against itself. Both sides derived from one artifact, so a dump
  // that collected 5 of 44 sites shrank both numbers together and verified
  // clean. The manifest is read from the live database before any row is
  // serialised, which is the only measurement that can notice a short dump.
  //
  // A dump that cannot restore is not a backup — and per the repo's instrument
  // rule the check emits its machine line on every run, clean included.
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
    const { tableCounts, headerImageBytes, parseDumpManifest } = await import("../../db/dump.js");
    const manifest = parseDumpManifest(sql);
    if (!manifest) {
      // Refuse rather than fall back to self-comparison. Falling back would
      // re-enable exactly the blind spot the manifest exists to close, and it
      // would do so silently on the one artifact nobody was watching.
      return {
        output: "DUMP_VERIFY loaded=true manifest=absent — dump predates the origin manifest",
        code: 1,
      };
    }
    const exec = {
      execute: async (q: string) => {
        const r = await scratch.execute(q);
        return { columns: r.columns, rows: r.rows as Array<Record<string, unknown>> };
      },
    };
    const restored = await tableCounts(exec);
    const restoredBlobBytes = await headerImageBytes(exec);
    const mismatches: string[] = [];
    for (const [table, want] of Object.entries(manifest.tables)) {
      if ((restored[table] ?? 0) !== want) {
        mismatches.push(`${table}: origin=${want} restored=${restored[table] ?? 0}`);
      }
    }
    // A table the origin held and the dump never mentioned would otherwise be
    // invisible: absent from `restored` AND absent from the loop above.
    for (const table of Object.keys(restored)) {
      if (!(table in manifest.tables)) mismatches.push(`${table}: not in origin manifest`);
    }
    // Coverage: every table the APP owns must be present. `tables=N` used to be
    // printed and never asserted, so a table a migration failed to create — or
    // that the dump lost — rode green forever. `digest_state` and
    // `prospect_audits` were both absent from every artifact the night this was
    // found, purely because they postdated the last run.
    const { DATABASE_TABLES } = await import("../../db/schema.js");
    for (const table of DATABASE_TABLES) {
      if (!(table in restored)) mismatches.push(`${table}: MISSING from the backup entirely`);
    }
    if (restoredBlobBytes !== manifest.blobBytes) {
      mismatches.push(
        `header_image bytes: origin=${manifest.blobBytes} restored=${restoredBlobBytes}`,
      );
    }
    const total = Object.values(restored).reduce((a, b) => a + b, 0);
    const lines = [
      ...mismatches.map((m) => `✗ ${m}`),
      `DUMP_VERIFY loaded=true tables=${Object.keys(restored).length} rows=${total} blob_bytes=${restoredBlobBytes} mismatches=${mismatches.length}`,
    ];
    return { output: lines.join("\n"), code: mismatches.length > 0 ? 1 : 0 };
  }

  return {
    output: `unknown db action '${action}'. Use: migrate, replay-deadletters, import-airtable, parity, sync, backfill-header-images, backfill-digest-state, dump, verify-dump, restore.`,
    code: 1,
  };
}
