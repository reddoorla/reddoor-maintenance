export type DbCommandOptions = {
  /** Override the libSQL url (tests use ":memory:"); otherwise read from env. */
  url?: string;
  /** verify-dump: path to the dump file to load into a scratch engine. */
  file?: string;
  /** usage: org slug override; defaults to TURSO_ORG, else discovered. */
  org?: string;
  /** replay-deadletters: abandon this slug's queued leads (or one `dl_…` row id)
   *  as resolved-by-decision instead of replaying them (#786). */
  abandon?: string;
  /** replay-deadletters --abandon: why. Required — an undocumented write-off of
   *  a client's leads is the thing this is meant to stop being necessary. */
  reason?: string;
  /** replay-deadletters --abandon: who decided. Defaults to OPERATOR_EMAIL. */
  by?: string;
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

/** `db <action>` — migrate | replay-deadletters | dump | verify-dump | restore | usage. The db layer is imported
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
  // owed — still failing, re-ingested but unmarked (MED-10b), or undecodable
  // (MED-10c). The operator should not read the run as "all leads landed".
  // Zero rows is a clean 0: nothing owed.
  if (action === "replay-deadletters") {
    const { readDbConfig, openDb } = await import("../../db/client.js");
    // #786. `--abandon` is the escape hatch for the queue #785 deliberately
    // stopped draining: a slug that is genuinely dead but still deployed keeps
    // dead-lettering leads, holds this command at exit 1, and leaves a standing
    // CRITICAL cockpit item. Validated BEFORE opening any store, so a missing
    // reason refuses without needing Turso creds.
    if (opts.abandon !== undefined) {
      const reason = (opts.reason ?? "").trim();
      if (reason === "") {
        return {
          output:
            'db replay-deadletters --abandon refused: pass --reason "…". Abandoning writes ' +
            "off a client's captured leads, and the record of WHY has to outlive the decision.",
          code: 1,
        };
      }
      const by = opts.by ?? process.env.OPERATOR_EMAIL ?? "operator";
      const db = await openDb(opts.url ? { url: opts.url } : readDbConfig());
      const { abandonDeadLetters } = await import("../../db/deadletter.js");
      // Row ids are minted `dl_…` (newDeadLetterId), and a site slug never is —
      // so the one argument can name either without a second flag.
      const target = opts.abandon.startsWith("dl_") ? { id: opts.abandon } : { slug: opts.abandon };
      const ids = await abandonDeadLetters(db, { ...target, by, reason, now: new Date() });
      const lines = [
        ...ids.map((id) => `abandoned ${id}`),
        `DEADLETTER_ABANDONED target=${opts.abandon} rows=${ids.length} by=${by}`,
      ];
      return { output: lines.join("\n"), code: 0 };
    }
    const db = await openDb(opts.url ? { url: opts.url } : readDbConfig());
    const { getSiteBySlug } = await import("../../db/fleet-state.js");
    // #645. Recovery resolves sites exactly as the live ingest path does: Turso's
    // `getSiteBySlug`, so live and recovery cannot disagree about what the fleet is.
    const lookupSite = (slug: string) => getSiteBySlug(db, slug);
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
      getWebsiteBySlug: lookupSite,
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

    // MED-10. Four buckets, three of them non-zero-is-not-nothing. `still_failing`
    // is a STANDING condition (a slug awaiting `ensure-site`, or a dead one
    // awaiting `--abandon`) and already has an alarm — the `deadletter` attention
    // item. `unmarked` and `unreadable` are DEFECTS with no other surface at all:
    // this output is the only place either is ever named.
    const lines = [
      ...result.replayed.map(
        (r) => `replayed ${r.id} → ${r.outcome}${r.submissionId ? ` (${r.submissionId})` : ""}`,
      ),
      ...result.stillFailing.map((r) => `still failing ${r.id}: ${r.error}`),
      ...result.unmarked.map(
        (r) =>
          `UNMARKED ${r.id}: re-ingested as ${r.submissionId ?? "(no submission)"} → ${r.outcome}, ` +
          `but the terminal mark could NOT be written (${r.error}). The row is still queued, so ` +
          `replaying again before it is reconciled will mint a DUPLICATE of this lead.`,
      ),
      ...result.unreadable.map(
        (r) =>
          `UNREADABLE ${r.id} (site '${r.siteSlug}', received ${r.receivedAt}): ${r.error}. ` +
          `The row is untouched — repair the stored JSON, or retire it with ` +
          `\`db replay-deadletters --abandon ${r.id} --reason "…"\`.`,
      ),
      `DEADLETTER_REPLAY replayed=${result.replayed.length} still_failing=${result.stillFailing.length} unmarked=${result.unmarked.length} unreadable=${result.unreadable.length}`,
    ];
    const owed = result.stillFailing.length + result.unmarked.length + result.unreadable.length > 0;
    return { output: lines.join("\n"), code: owed ? 1 : 0 };
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
      // A FUNCTION, not a string: re-evaluated per attempt, so a dump that
      // succeeded on attempt 3 is stamped with attempt 3's time instead of
      // carrying the timestamp of two dumps that were discarded.
      () => new Date().toISOString(),
      {
        // MED-12: a torn snapshot is re-taken, not shipped. Report each discard
        // on STDERR — stdout is the dump itself, and a diagnostic written there
        // would land inside the SQL (the `pnpm exec` trap, one layer down).
        onTorn: (attempt, moved) =>
          console.error(
            `[db dump] attempt ${attempt} discarded: the database changed while it was being ` +
              `read (${moved.join("; ")}). Re-taking the dump.`,
          ),
      },
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
    output: `unknown db action '${action}'. Use: migrate, replay-deadletters, dump, verify-dump, restore, usage.`,
    code: 1,
  };
}
